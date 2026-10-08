"""Persistent task-boundary failure handling; no role-wide retry suppression."""

# NOTE: this module must NOT use ``from __future__ import annotations``.
# The ``task`` tool below declares a bare ``runtime: ToolRuntime`` parameter
# that langgraph's ToolNode injects at call time. Detection reads
# ``inspect.signature`` annotations, which are *strings* under the future
# import — langchain-core then fails to recognise the injected arg, drops it
# during schema validation, and every dispatch crashes with
# ``atask() missing 1 required positional argument: 'runtime'``.
# (deepagents' own task tool works precisely because it has no future import.)

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
from raptix.middleware.subagent_transcript_state import SubagentTranscriptState
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix.orchestration.mission.task_state import (
    DecisionRecord,
    WorkerResult,
    advance_task_state,
    document_lock,
    read_task_state,
    scoped_task_backend,
    task_state_path,
    write_task_state,
)
from raptix_core.types.dispatch_outcome import (
    DispatchFailureOutcome,
    classify_dispatch_failure,
)

MAX_DISPATCHES = 256

log = logging.getLogger(__name__)

# WorkerInput handoff (ADR-0051): how many list items per section the
# deterministic block may carry, and the total character cap.
_HANDOFF_MAX_ITEMS = 8
_WORKER_INPUT_MAX_CHARS = 4000

# Child state keys that never merge into the parent update (ADR-0044).
# StreamingRunnable already withholds PrivateStateAttr channels before the
# child state reaches deepagents' task tool; this second layer survives a
# future wrapper change at the dispatch seam.
_PARENT_PRIVATE_STATE_KEYS = PRIVATE_CHILD_STATE_KEYS


def merge_dispatch_ledger(left: dict | None, right: dict | None) -> dict:
    merged = dict(left or {})
    for key, row in (right or {}).items():
        prior = merged.get(key, {})
        if row.get("attempt", 0) >= prior.get("attempt", 0):
            merged[key] = row
    return merged


def _handoff_enabled() -> bool:
    return os.environ.get("RAPTIX_DISPATCH_HANDOFF", "0").strip().lower() in {"1", "true", "yes"}


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

    def __init__(self, *, backend: Any, subagents: list, task_state_backend: Any = None) -> None:
        super().__init__(backend=backend, subagents=subagents)
        self._task = self.tools[0]
        self._lock = threading.Lock()
        self._active: set[tuple[str, str]] = set()
        self._task_state_backend = task_state_backend if task_state_backend is not None else backend
        from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

        self._task_io = ExecutionLedgerMiddleware(role="dispatch", backend=backend)
        self.tools = [self._guarded_tool()]

    def _prepare(
        self,
        description: str,
        role: str,
        runtime: ToolRuntime,
        objective_id: str | None,
        dispatch_id: str | None,
    ) -> tuple[DispatchContext, tuple[str, str], str, str] | Command:
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
        config = getattr(runtime, "config", None) or {}
        scope = (config.get("configurable") or {}).get("thread_id")
        scope = str(scope or runtime.state.get("engagement_name") or id(runtime.state))
        key = (scope, dispatch_id)
        with self._lock:
            if key in self._active:
                return _reply(
                    runtime,
                    "dispatch_in_flight",
                    "An invocation of this dispatch is already active",
                )
            self._active.add(key)
        return (
            DispatchContext(dispatch_id, objective_id, int(prior.get("attempt", 0)) + 1),
            key,
            fingerprint,
            (
                self._task_io._bounded(
                    self._handoff_description, description, runtime, objective_id
                )
                or description
            )
            if _handoff_enabled()
            else description,
        )

    def _finish(
        self,
        result: Any,
        context: DispatchContext,
        fingerprint: str,
        runtime: ToolRuntime,
        error: Exception | None = None,
    ) -> Command:
        if error is not None:
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
        worker_result = updates.pop("worker_result", None)
        leaked = _PARENT_PRIVATE_STATE_KEYS.intersection(updates)
        if leaked:
            updates = {k: v for k, v in updates.items() if k not in _PARENT_PRIVATE_STATE_KEYS}
        if context.failures:
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
                "objective_id": context.objective_id,
                "attempt": context.attempt,
                "outcome": outcome,
            }
        }
        updates["active_objective_id"] = context.objective_id or ""
        if _handoff_enabled():
            self._task_io._bounded(self._merge_task_state, runtime, context, outcome, worker_result)
        return Command(update=updates)

    def _task_state_backend_for(self, runtime: ToolRuntime) -> Any:
        """Resolve a workspace-scoped task-state backend, or None (best-effort)."""
        try:
            return scoped_task_backend(self._task_state_backend, runtime)
        except Exception as exc:  # noqa: BLE001 — handoff must not affect dispatch
            log.debug("handoff backend unavailable: %s", type(exc).__name__)
            return None

    def _handoff_description(
        self, description: str, runtime: ToolRuntime, objective_id: str | None
    ) -> str:
        """Append the deterministic WorkerInput block when the flag is on."""
        if not _handoff_enabled() or not objective_id:
            return description
        state = getattr(runtime, "state", None) or {}
        objective = next(
            (o for o in state.get("objectives", []) if o.get("id") == objective_id), None
        )
        if objective is None:
            return description
        try:
            block = self._render_worker_input(objective, runtime, objective_id)
        except Exception as exc:  # noqa: BLE001 — handoff must not affect dispatch
            log.debug("handoff context unavailable: %s", type(exc).__name__)
            return description
        return f"{description}\n\n{block}" if block else description

    def _render_worker_input(self, objective: dict, runtime: ToolRuntime, objective_id: str) -> str:
        """Render a bounded, deterministic handoff block from persisted state."""
        lines = [
            f'<WORKER_INPUT objective="{objective_id}">',
            f"Objective: {str(objective.get('title', ''))[:256]}",
            f"Phase: {objective.get('phase', '')}",
        ]
        criteria = [str(c)[:160] for c in (objective.get("acceptance_criteria") or [])][
            :_HANDOFF_MAX_ITEMS
        ]
        if criteria:
            lines.append("Acceptance criteria:")
            lines.extend(f"- {c}" for c in criteria)
        backend = self._task_state_backend_for(runtime)
        task_state = read_task_state(backend, objective_id).state if backend is not None else None
        if task_state is None:
            lines.append("Task-state revision: 0")
        else:
            lines.append(f"Task-state revision: {task_state.state_revision}")
            lines.append(f"Work state: {task_state.work_state.status.value}")
            lines.append(f"Work reason: {task_state.work_state.reason[:256]}")
            refs = [ref.ref for ref in task_state.evidence_refs][-_HANDOFF_MAX_ITEMS:]
            if refs:
                lines.append("Evidence refs:")
                lines.extend(f"- {ref[:160]}" for ref in refs)
            if task_state.decision_record:
                lines.append("Completed/attempted work (not objective verification):")
                lines.extend(
                    f"- {entry.action[:80]}: {entry.outcome} ({entry.reason[:80]})"
                    for entry in task_state.decision_record[-4:]
                )
            from raptix.middleware.execution_ledger import (
                _load_entries,
                ledger_path,
                reconcile_receipts,
            )

            receipts = reconcile_receipts(_load_entries(backend, ledger_path(objective_id)))
            pending = [entry for entry in receipts if entry.get("kind") == "outcome_unknown"]
            if pending:
                lines.append("Unknown executions: reconcile before any retry.")
                lines.extend(f"- {entry['action_hash']}" for entry in pending[:4])
            continuation = task_state.continuation
            for label, items in (
                ("Next steps", continuation.next_steps),
                ("Blockers", continuation.blockers),
                ("Awaiting", continuation.awaiting),
            ):
                trimmed = [str(item)[:120] for item in items][:_HANDOFF_MAX_ITEMS]
                if trimmed:
                    lines.append(f"{label}:")
                    lines.extend(f"- {item}" for item in trimmed)
            budget = task_state.budget
            lines.append(
                f"Budget: attempts={budget.attempts} model_calls={budget.model_calls} "
                f"input_tokens={budget.input_tokens} wall_clock_s={budget.wall_clock_s} (consumed)"
            )
        instructions = (
            '\nReturn a JSON WorkerResult: {"objective_id":"'
            + objective_id
            + '","outcome":"success|failed|blocked","evidence_refs":[],"continuation":'
            '{"next_steps":[],"blockers":[],"awaiting":[]},"budget_delta":'
            '{"model_calls":0,"input_tokens":0,"wall_clock_s":0},"reason":""}.'
            "\nA successful tool/dispatch does not mark the objective completed."
        )
        suffix = instructions + "\n</WORKER_INPUT>"
        return "\n".join(lines)[: _WORKER_INPUT_MAX_CHARS - len(suffix)] + suffix

    def _merge_task_state(
        self, runtime: ToolRuntime, context: DispatchContext, outcome: dict, worker_result: Any
    ) -> None:
        """Best-effort fold of the dispatch outcome into durable task state."""
        if not _handoff_enabled() or not context.objective_id:
            return
        backend = self._task_state_backend_for(runtime)
        if backend is None:
            return
        try:
            state = getattr(runtime, "state", None) or {}
            objective = next(
                (o for o in state.get("objectives", []) if o.get("id") == context.objective_id),
                {"id": context.objective_id},
            )
            path = task_state_path(context.objective_id)
            with document_lock(path):
                bundle = read_task_state(backend, context.objective_id)
                if bundle.error:
                    log.debug("handoff merge skipped: %s", bundle.error)
                    return
                marker = f"{context.dispatch_id}:{context.attempt}"
                if bundle.state is not None and marker in bundle.state.applied_dispatches:
                    return
                merged = advance_task_state(objective, prior=bundle.state, updated_by="dispatch")
                reported = None
                if worker_result:
                    try:
                        candidate = WorkerResult.model_validate(worker_result)
                        if candidate.objective_id == context.objective_id:
                            reported = candidate
                    except ValueError as exc:
                        log.debug("worker result ignored: %s", type(exc).__name__)
                status = (
                    "failed"
                    if outcome.get("status") == "failed"
                    else (reported.outcome if reported else "success")
                )
                merged.decision_record.append(
                    DecisionRecord(
                        action=f"dispatch:{context.dispatch_id}"[:256],
                        outcome=status,
                        reason=(
                            context.failures[-1].error_type
                            if context.failures
                            else (reported.reason if reported else "")
                        ),
                        retry_condition=(
                            "review evidence before retry" if status != "success" else ""
                        ),
                    )
                )
                if reported is not None:
                    refs = {ref.ref: ref for ref in merged.evidence_refs}
                    refs.update({ref.ref: ref for ref in reported.evidence_refs})
                    merged.evidence_refs = list(refs.values())[-50:]
                    merged.continuation = reported.continuation
                    for field in ("model_calls", "input_tokens", "wall_clock_s"):
                        setattr(
                            merged.budget,
                            field,
                            getattr(merged.budget, field) + getattr(reported.budget_delta, field),
                        )
                merged.budget.attempts += 1
                merged.applied_dispatches.append(marker)
                error = write_task_state(backend, merged)
                if error:
                    log.debug("handoff merge failed: %s", error)
        except Exception as exc:  # noqa: BLE001 — best-effort
            log.debug("dispatch task-state merge skipped: %s", exc)

    @staticmethod
    def _child_runtime(runtime: ToolRuntime, context: DispatchContext) -> ToolRuntime:
        child_runtime = copy(runtime)
        child_runtime.state = {
            **{
                key: value
                for key, value in runtime.state.items()
                if key not in PRIVATE_CHILD_STATE_KEYS and key != "worker_result"
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
            context, key, fingerprint, child_description = prepared
            token = active_dispatch.set(context)
            try:
                try:
                    result = self._task.func(
                        description=child_description,
                        subagent_type=subagent_type,
                        runtime=self._child_runtime(runtime, context),
                    )
                except Exception as exc:
                    return self._finish(None, context, fingerprint, runtime, exc)
                return self._finish(result, context, fingerprint, runtime)
            finally:
                active_dispatch.reset(token)
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
            context, key, fingerprint, child_description = prepared
            token = active_dispatch.set(context)
            try:
                try:
                    result = await self._task.coroutine(
                        description=child_description,
                        subagent_type=subagent_type,
                        runtime=self._child_runtime(runtime, context),
                    )
                except Exception as exc:
                    return self._finish(None, context, fingerprint, runtime, exc)
                return self._finish(result, context, fingerprint, runtime)
            finally:
                active_dispatch.reset(token)
                self._release(key)

        return StructuredTool.from_function(
            name="task",
            func=task,
            coroutine=atask,
            args_schema=DispatchTaskSchema,
            infer_schema=False,
            description=self._task.description,
        )
