"""Persistent task-boundary failure handling; no role-wide retry suppression."""

# NOTE: this module must NOT use ``from __future__ import annotations``.
# The ``task`` tool below declares a bare ``runtime: ToolRuntime`` parameter
# that langgraph's ToolNode injects at call time. Detection reads
# ``inspect.signature`` annotations, which are *strings* under the future
# import — langchain-core then fails to recognise the injected arg, drops it
# during schema validation, and every dispatch crashes with
# ``atask() missing 1 required positional argument: 'runtime'``.
# (deepagents' own task tool works precisely because it has no future import.)

import asyncio
import hashlib
import json
import logging
import os
import threading
from copy import copy
from typing import Annotated, Any, NotRequired

from deepagents.middleware.subagents import SubAgentMiddleware, TaskToolSchema
from langchain.agents.middleware.types import OmitFromInput
from langchain.tools import ToolRuntime
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.types import Command
from pydantic import Field

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.core.subagent_streaming import (
    MAX_SUBAGENT_CONSECUTIVE_FAILURES,
    PRIVATE_CHILD_STATE_KEYS,
)
from raptix.execution.backends.project_files import project_files_for_runtime
from raptix.execution.session.event_log import EventLog, EventType
from raptix.execution.session.instance_mailbox import default_mailbox
from raptix.middleware.fanout_admission import (
    AdmissionDecision,
    Ceilings,
    ResilienceState,
    WorkUnit,
    decide,
)
from raptix.middleware.instance_mailbox import InstanceCancellationRequested
from raptix.middleware.subagent_transcript_state import SubagentTranscriptState
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix_core.types.dispatch_outcome import (
    DispatchFailureOutcome,
    classify_dispatch_failure,
)
from raptix_core.types.engagement import EffectClass, OpsecLevel

log = logging.getLogger(__name__)

MAX_DISPATCHES = 256

# A runaway sub-agent (unbounded probe/debug loop, no stop condition) is
# currently only caught by the per-role LangGraph ``recursion_limit``
# (1000 for exploit, 400 for postexploit) — a step count, not a time bound.
# Across real recorded engagements this ceiling has fired repeatedly, and
# the dispatch ran for as long as ~70 minutes before the step ceiling
# caught it, while every *legitimate* dispatch observed across those same
# engagements finished well under 40 minutes. 45 minutes (with headroom
# above the largest observed legitimate dispatch) bounds that worst case
# without touching the step-count ceiling itself, whose steps don't map
# cleanly to the per-dispatch tool/model-call counts we can observe.
# Override with ``RAPTIX_DISPATCH_TIMEOUT_SECONDS`` for scenarios that
# need deliberately longer dispatches.
DISPATCH_TIMEOUT_ENV = "RAPTIX_DISPATCH_TIMEOUT_SECONDS"
DEFAULT_DISPATCH_TIMEOUT_SECONDS = 45 * 60

# ADR-0021/0023/0026 justify a 3-wide parallel fan-out bound entirely on
# orchestrator-side isolation (distinct tmux sessions, distinct workspace
# dirs) — none of them consider the TARGET side: a single-worker service
# can be permanently wedged by one blocking dispatch, and every sibling
# (and every later recovery attempt) queues behind the same wedge. That
# has happened in a real engagement. "Up to 3 concurrent dispatches" has
# so far only ever been a convention written into the orchestrator prompt
# — nothing here actually stopped a 4th, 5th, ... Nth distinct dispatch
# from running at once. This ceiling is the real backstop.
# Override with ``RAPTIX_MAX_CONCURRENT_DISPATCHES`` for scenarios that
# deliberately need wider fan-out.
DISPATCH_CONCURRENCY_ENV = "RAPTIX_MAX_CONCURRENT_DISPATCHES"
DEFAULT_MAX_CONCURRENT_DISPATCHES = 3

# ADR-0077: generic fan-out admission. When disabled (default), the ceiling
# above is the only control — byte-for-byte today's behaviour. When enabled,
# each dispatch intent is admitted through the pure policy in
# ``raptix.middleware.fanout_admission``: resource overlap, effect class,
# OPSEC noise tier, per-target resilience, then the same global ceiling as
# the outermost bound. Domain knowledge enters only through objective
# annotations and skill metadata — never here.
FANOUT_ADMISSION_ENV = "RAPTIX_FANOUT_ADMISSION"
FANOUT_PER_TARGET_ENV = "RAPTIX_MAX_CONCURRENT_PER_TARGET"
FANOUT_ALLOW_DESTRUCTIVE_ENV = "RAPTIX_FANOUT_ALLOW_DESTRUCTIVE"
_TRUTHY = frozenset({"1", "true", "yes", "on"})


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


# Child state keys that never merge into the parent update (ADR-0045).
# StreamingRunnable already withholds PrivateStateAttr channels before the
# child state reaches deepagents' task tool; this second layer survives a
# future wrapper change at the dispatch seam.
_PARENT_PRIVATE_STATE_KEYS = PRIVATE_CHILD_STATE_KEYS


def _resolve_dispatch_timeout_seconds() -> float:
    raw = os.environ.get(DISPATCH_TIMEOUT_ENV)
    if raw:
        try:
            value = float(raw)
        except ValueError:
            value = 0.0
        if value > 0:
            return value
    return DEFAULT_DISPATCH_TIMEOUT_SECONDS


def _resolve_max_concurrent_dispatches() -> int:
    raw = os.environ.get(DISPATCH_CONCURRENCY_ENV)
    if raw:
        try:
            value = int(raw)
        except ValueError:
            value = 0
        if value > 0:
            return value
    return DEFAULT_MAX_CONCURRENT_DISPATCHES


def merge_dispatch_ledger(left: dict | None, right: dict | None) -> dict:
    merged = dict(left or {})
    for key, row in (right or {}).items():
        prior = merged.get(key, {})
        if row.get("attempt", 0) >= prior.get("attempt", 0):
            merged[key] = row
    return merged


class DispatchState(SubagentTranscriptState, ObjectiveContextState):
    dispatch_ledger: NotRequired[Annotated[dict, OmitFromInput, merge_dispatch_ledger]]


class DispatchTaskSchema(TaskToolSchema):
    objective_id: str | None = Field(default=None, max_length=128)
    dispatch_id: str | None = Field(default=None, min_length=1, max_length=128)


def _reply(runtime: ToolRuntime, code: str, detail: str) -> Command:
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=json.dumps({"error": code, "message": detail}),
                    tool_call_id=runtime.tool_call_id or "dispatch-rejected",
                    status="error",
                )
            ]
        }
    )


class DispatchMiddleware(SubAgentMiddleware):
    state_schema = DispatchState

    def __init__(self, *, backend: Any, subagents: list) -> None:
        super().__init__(backend=backend, subagents=subagents)
        self._task = self.tools[0]
        self._lock = threading.Lock()
        self._active: set[tuple[str, str]] = set()
        self._timeout_seconds = _resolve_dispatch_timeout_seconds()
        self._max_concurrent = _resolve_max_concurrent_dispatches()
        # ADR-0077 admission state: in-flight work units + per-scope resilience.
        self._fanout_enabled = _env_flag(FANOUT_ADMISSION_ENV)
        self._active_units: dict[tuple[str, str], WorkUnit] = {}
        self._resilience: dict[str, ResilienceState] = {}
        self._event_logs: dict[tuple[str, str], EventLog] = {}
        self._ceilings = Ceilings(
            global_max=self._max_concurrent,
            per_target_max=max(1, _env_int(FANOUT_PER_TARGET_ENV, 1)),
            allow_destructive=_env_flag(FANOUT_ALLOW_DESTRUCTIVE_ENV),
        )
        self.tools = [self._guarded_tool()]

    def _prepare(
        self,
        description: str,
        role: str,
        runtime: ToolRuntime,
        objective_id: str | None,
        dispatch_id: str | None,
    ) -> tuple[DispatchContext, tuple[str, str], str] | Command:
        config = getattr(runtime, "config", None) or {}
        thread_id = (config.get("configurable") or {}).get("thread_id")
        # An operator's Retry or Reassign runs the persisted intent, never a model rewrite of it (ADR-0090).
        grant = self._operator_grant(thread_id, dispatch_id)
        if grant is not None:
            role, objective_id, description = grant.target_role, grant.objective_id, grant.intent
        if role not in self.subagent_names:
            return _reply(runtime, "unknown_role", f"Unknown subagent {role}")
        if objective_id and not any(
            o.get("id") == objective_id for o in runtime.state.get("objectives", [])
        ):
            return _reply(runtime, "unknown_objective", f"Unknown objective {objective_id}")
        fingerprint = hashlib.sha256(
            json.dumps([role, objective_id, description], ensure_ascii=False).encode()
        ).hexdigest()
        dispatch_id = dispatch_id or fingerprint
        ledger = runtime.state.get("dispatch_ledger") or {}
        prior = ledger.get(dispatch_id, {})
        # A cancelled intent is not reopened by the orchestrator under any dispatch id; only the operator's grant may re-run its own source.
        cancelled = [
            source
            for source, row in ledger.items()
            if row.get("fingerprint") == fingerprint
            and row.get("outcome", {}).get("status") == "cancelled"
        ]
        granted = grant.source_dispatch_id if grant else None
        if any(source != granted for source in cancelled):
            return _reply(
                runtime,
                "cancelled_intent",
                "The operator cancelled this intent; only an explicit operator Retry or Reassign may run it again",
            )
        # A restart interrupts the attempt; the replayed task call must not run the same intent again on its own.
        if any(source != granted for source in self._interrupted_sources(thread_id, fingerprint)):
            return _reply(
                runtime,
                "interrupted_intent",
                "The runtime interrupted this intent and it was not resumed; only an explicit operator Retry or Reassign may run it again",
            )
        if prior and prior.get("fingerprint") != fingerprint:
            return _reply(
                runtime, "dispatch_conflict", "Dispatch identity is already bound to another intent"
            )
        if prior.get("outcome", {}).get("status") == "success":
            return _reply(
                runtime, "dispatch_completed", "This dispatch already completed; use a new intent"
            )
        if prior.get("outcome", {}).get("terminal_for_this_dispatch"):
            return _reply(
                runtime,
                "terminal_dispatch",
                "This dispatch is terminal; select a different objective or strategy",
            )
        if any(
            row.get("fingerprint") == fingerprint
            and row.get("outcome", {}).get("terminal_for_this_dispatch")
            for row in ledger.values()
        ):
            return _reply(
                runtime,
                "terminal_intent",
                "This intent is terminal; change the strategy before retrying",
            )
        if not prior and len(ledger) >= MAX_DISPATCHES:
            return _reply(
                runtime,
                "dispatch_ledger_full",
                "Thread dispatch ledger is full; start a new thread",
            )
        scope = str(thread_id or runtime.state.get("engagement_name") or id(runtime.state))
        key = (scope, dispatch_id)
        with self._lock:
            if key in self._active:
                return _reply(
                    runtime,
                    "dispatch_in_flight",
                    "An invocation of this dispatch is already active",
                )
            if self._fanout_enabled:
                candidate = self._work_unit_for(runtime, objective_id, role, dispatch_id)
                in_flight = self._in_flight_units(scope)
                resilient = self._resilience.setdefault(scope, ResilienceState()).resilient_map()
                decision = decide(
                    candidate, in_flight, ceilings=self._ceilings, resilient=resilient
                )
                self._admission_event(runtime, candidate, decision)
                if not decision.admitted:
                    return _reply(runtime, f"dispatch_{decision.reject_code}", decision.detail)
                self._active.add(key)
                self._active_units[key] = candidate
            else:
                active_in_scope = sum(
                    1 for active_scope, _ in self._active if active_scope == scope
                )
                if active_in_scope >= self._max_concurrent:
                    return _reply(
                        runtime,
                        "dispatch_capacity_exceeded",
                        f"Max {self._max_concurrent} concurrent dispatches already active for "
                        "this engagement; wait for one to finish before starting another",
                    )
                self._active.add(key)
        # A replacement attempt must go above every attempt the mailbox ever started, including
        # attempts that never reached the ledger (cancelled or interrupted before finishing).
        attempt = max(
            int(prior.get("attempt", 0)), self._mailbox_attempt_floor(thread_id, dispatch_id)
        )
        # The dispatch executing right now, if any, is this one's parent (a child dispatching a grandchild).
        parent = active_dispatch.get()
        return (
            DispatchContext(
                dispatch_id,
                objective_id,
                attempt + 1,
                role=role,
                thread_id=str(thread_id) if thread_id else None,
                intent=description,
                replay_grant=grant.command_id if grant else None,
                fingerprint=fingerprint,
                parent_dispatch_id=parent.dispatch_id if parent else None,
            ),
            key,
            fingerprint,
        )

    @staticmethod
    def _interrupted_sources(thread_id: Any, fingerprint: str) -> list[str]:
        if not thread_id:
            return []
        return default_mailbox().interrupted_sources(str(thread_id), fingerprint)

    @staticmethod
    def _operator_grant(thread_id: Any, dispatch_id: str | None) -> Any:
        if not thread_id or not dispatch_id:
            return None
        try:
            return default_mailbox().open_grant_for_target(str(thread_id), dispatch_id)
        except Exception:  # noqa: BLE001 — without a readable grant the cancelled intent stays blocked
            log.warning("instance mailbox grant lookup failed", exc_info=True)
            return None

    @staticmethod
    def _mailbox_attempt_floor(thread_id: Any, dispatch_id: str) -> int:
        if not thread_id:
            return 0
        try:
            return default_mailbox().max_attempt(str(thread_id), dispatch_id)
        except Exception:  # noqa: BLE001 — the ledger stays the floor when the mailbox cannot be read
            log.warning("instance mailbox attempt floor unavailable", exc_info=True)
            return 0

    @staticmethod
    def _cancel_requested(context: DispatchContext) -> bool:
        if not context.thread_id:
            return False
        try:
            return default_mailbox().cancellation_requested(
                context.thread_id, context.dispatch_id, context.attempt
            )
        except Exception:  # noqa: BLE001 — an unreadable mailbox cannot show a cancel; the dispatch outcome stands
            log.warning("instance mailbox cancel check failed", exc_info=True)
            return False

    @staticmethod
    def _start_instance(context: DispatchContext) -> None:
        """Make the running instance visible to the operator mailbox (P10c); never breaks the dispatch."""
        if not context.thread_id:
            return
        try:
            default_mailbox().start_instance(
                context.thread_id,
                context.dispatch_id,
                context.attempt,
                context.role,
                context.intent,
                context.objective_id,
                context.fingerprint,
                context.parent_dispatch_id,
            )
            if context.replay_grant:
                default_mailbox().consume_grant(context.replay_grant)
        except Exception:  # noqa: BLE001 — mailbox bookkeeping must never fail a dispatch
            log.warning("instance mailbox registration failed", exc_info=True)

    @staticmethod
    def _end_instance(context: DispatchContext, *, interrupted: bool = False) -> None:
        if not context.thread_id:
            return
        try:
            default_mailbox().finish_instance(
                context.thread_id, context.dispatch_id, context.attempt, interrupted=interrupted
            )
        except Exception:  # noqa: BLE001 — a failed close leaves the row running until the next restart marks it interrupted
            log.warning("instance mailbox close failed", exc_info=True)

    # ── ADR-0077 fan-out admission helpers ──────────────────────────────

    @staticmethod
    def _coerce_bool(value: Any) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in _TRUTHY:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
        return None

    def _work_unit_for(
        self,
        runtime: ToolRuntime,
        objective_id: str | None,
        role: str,
        dispatch_id: str,
    ) -> WorkUnit:
        """Build the annotated work unit for a candidate dispatch.

        Missing/unparseable annotations collapse to the conservative default
        (``mutate``, unknown parallel safety) — unknown means conservative.
        """
        objectives = runtime.state.get("objectives") or []
        objective: dict = next((o for o in objectives if o.get("id") == objective_id), {})
        try:
            effects = EffectClass(str(objective.get("effects") or EffectClass.MUTATE.value))
        except ValueError:
            effects = EffectClass.MUTATE
        try:
            opsec = OpsecLevel(str(objective.get("opsec") or OpsecLevel.STANDARD.value))
        except ValueError:
            opsec = OpsecLevel.STANDARD
        raw_resources = objective.get("resources")
        resources = frozenset(
            str(r).strip()
            for r in (raw_resources if isinstance(raw_resources, (list, tuple, set)) else ())
            if str(r).strip()
        )
        return WorkUnit(
            dispatch_id=dispatch_id,
            objective_id=str(objective_id or ""),
            role=role,
            effects=effects,
            resources=resources,
            parallel_safe=self._coerce_bool(objective.get("parallel_safe")),
            opsec=opsec,
            fragile_target=bool(self._coerce_bool(objective.get("fragile_target"))),
        )

    def _in_flight_units(self, scope: str) -> list[WorkUnit]:
        """Caller must hold ``self._lock`` (non-reentrant)."""
        return [unit for (unit_scope, _), unit in self._active_units.items() if unit_scope == scope]

    def _record_outcome(self, key: tuple[str, str], *, ok: bool) -> None:
        """Feed the dispatch outcome into per-resource progressive widening."""
        with self._lock:
            unit = self._active_units.pop(key, None)
            if unit is None or not unit.resources:
                return
            state = self._resilience.setdefault(key[0], ResilienceState())
            state.record(sorted(unit.resources), ok=ok)

    def _admission_event(
        self, runtime: ToolRuntime, candidate: WorkUnit, decision: AdmissionDecision
    ) -> None:
        """Append one ``dispatch.admission`` record; never break the dispatch."""
        try:
            state = getattr(runtime, "state", None) or {}
            get = state.get if hasattr(state, "get") else (lambda _k, _d=None: None)
            engagement = str(
                get("engagement_name")
                or os.environ.get("RAPTIX_ENGAGEMENT_ID", "")
                or "default-engagement"
            )
            files = project_files_for_runtime(runtime)
            key = (files.key, engagement)
            event_log = self._event_logs.get(key)
            if event_log is None:
                event_log = EventLog.for_project(files, engagement)
                self._event_logs[key] = event_log
            event_log.append(
                EventType.DISPATCH_ADMISSION,
                {
                    "admitted": decision.admitted,
                    "code": decision.code,
                    "objective_id": candidate.objective_id,
                    "role": candidate.role,
                    "effects": candidate.effects.value,
                    "resource_count": len(candidate.resources),
                    "blocking": list(decision.blocking)[:8],
                },
                agent="orchestrator",
            )
        except Exception:  # noqa: BLE001 — admission telemetry must never break dispatch
            log.debug("dispatch.admission event not recorded", exc_info=True)

    def _finish(
        self,
        result: Any,
        context: DispatchContext,
        fingerprint: str,
        runtime: ToolRuntime,
        error: Exception | None = None,
    ) -> Command:
        # The operator's cancel decides the observed outcome even when the attempt also failed at the same boundary,
        # so the ledger and the mailbox agree on what ended the attempt.
        cancelled = isinstance(error, InstanceCancellationRequested) or self._cancel_requested(
            context
        )
        if error is not None and not cancelled:
            context.failures.append(
                DispatchFailureOutcome(
                    dispatch_id=context.dispatch_id,
                    objective_id=context.objective_id,
                    failure_kind=classify_dispatch_failure(error),
                    consecutive_failure_count=context.attempt,
                    terminal_for_this_dispatch=context.attempt >= MAX_SUBAGENT_CONSECUTIVE_FAILURES,
                    error_type=type(error).__name__,
                    error_message=str(error)[:2000],
                )
            )
        updates = dict(result.update) if isinstance(result, Command) else {}
        leaked = _PARENT_PRIVATE_STATE_KEYS.intersection(updates)
        if leaked:
            updates = {k: v for k, v in updates.items() if k not in _PARENT_PRIVATE_STATE_KEYS}
        if cancelled:
            outcome = {"status": "cancelled", "terminal_for_this_dispatch": False}
            updates["messages"] = [
                ToolMessage(
                    content="This dispatch attempt was cancelled cooperatively by the operator.",
                    tool_call_id=runtime.tool_call_id or context.dispatch_id,
                )
            ]
        elif context.failures:
            outcome = context.failures[-1].model_dump(mode="json")
            updates["messages"] = [
                ToolMessage(
                    content=json.dumps(outcome),
                    additional_kwargs={"dispatch_failure_outcome": outcome},
                    tool_call_id=runtime.tool_call_id or context.dispatch_id,
                    status="error",
                )
            ]
        else:
            outcome = {"status": "success", "terminal_for_this_dispatch": False}
            if not isinstance(result, Command):
                updates["messages"] = [
                    ToolMessage(
                        str(result), tool_call_id=runtime.tool_call_id or context.dispatch_id
                    )
                ]
        updates["dispatch_ledger"] = {
            context.dispatch_id: {
                "fingerprint": fingerprint,
                "role": context.role,
                "objective_id": context.objective_id,
                "parent_dispatch_id": context.parent_dispatch_id,
                "attempt": context.attempt,
                "outcome": outcome,
            }
        }
        updates["active_objective_id"] = context.objective_id or ""
        return Command(update=updates)

    @staticmethod
    def _child_runtime(runtime: ToolRuntime, context: DispatchContext) -> ToolRuntime:
        child_runtime = copy(runtime)
        child_runtime.state = {
            **{
                key: value
                for key, value in runtime.state.items()
                if key not in PRIVATE_CHILD_STATE_KEYS
            },
            "active_objective_id": context.objective_id or "",
        }
        return child_runtime

    def _release(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._active.discard(key)

    def _guarded_tool(self) -> StructuredTool:
        def task(
            description: str,
            subagent_type: str,
            runtime: ToolRuntime,
            objective_id: str | None = None,
            dispatch_id: str | None = None,
        ) -> Command:
            prepared = self._prepare(description, subagent_type, runtime, objective_id, dispatch_id)
            if isinstance(prepared, Command):
                return prepared
            context, key, fingerprint = prepared
            token = active_dispatch.set(context)
            self._start_instance(context)
            error: Exception | None = None
            try:
                try:
                    result = self._task.func(
                        description=description,
                        subagent_type=subagent_type,
                        runtime=self._child_runtime(runtime, context),
                    )
                except Exception as exc:
                    error = exc
                    return self._finish(None, context, fingerprint, runtime, exc)
                return self._finish(result, context, fingerprint, runtime)
            except asyncio.CancelledError as exc:
                error = exc
                raise
            finally:
                self._end_instance(context, interrupted=isinstance(error, asyncio.CancelledError))
                active_dispatch.reset(token)
                self._record_outcome(
                    key, ok=error is None or isinstance(error, InstanceCancellationRequested)
                )
                self._release(key)

        async def atask(
            description: str,
            subagent_type: str,
            runtime: ToolRuntime,
            objective_id: str | None = None,
            dispatch_id: str | None = None,
        ) -> Command:
            prepared = self._prepare(description, subagent_type, runtime, objective_id, dispatch_id)
            if isinstance(prepared, Command):
                return prepared
            context, key, fingerprint = prepared
            token = active_dispatch.set(context)
            self._start_instance(context)
            error: Exception | None = None
            try:
                try:
                    result = await asyncio.wait_for(
                        self._task.coroutine(
                            description=description,
                            subagent_type=subagent_type,
                            runtime=self._child_runtime(runtime, context),
                        ),
                        timeout=self._timeout_seconds,
                    )
                except Exception as exc:
                    error = exc
                    return self._finish(None, context, fingerprint, runtime, exc)
                return self._finish(result, context, fingerprint, runtime)
            except asyncio.CancelledError as exc:
                error = exc
                raise
            finally:
                self._end_instance(context, interrupted=isinstance(error, asyncio.CancelledError))
                active_dispatch.reset(token)
                self._record_outcome(
                    key, ok=error is None or isinstance(error, InstanceCancellationRequested)
                )
                self._release(key)

        return StructuredTool.from_function(
            name="task",
            func=task,
            coroutine=atask,
            args_schema=DispatchTaskSchema,
            infer_schema=False,
            description=self._task.description,
        )
