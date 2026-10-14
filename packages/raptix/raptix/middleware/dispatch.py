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
from raptix_core.types.dispatch_outcome import (
    DispatchFailureOutcome,
    classify_dispatch_failure,
)

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
        self.tools = [self._guarded_tool()]

    def _prepare(
        self,
        description: str,
        role: str,
        runtime: ToolRuntime,
        objective_id: str | None,
        dispatch_id: str | None,
    ) -> tuple[DispatchContext, tuple[str, str], str] | Command:
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
            active_in_scope = sum(1 for active_scope, _ in self._active if active_scope == scope)
            if active_in_scope >= self._max_concurrent:
                return _reply(
                    runtime,
                    "dispatch_capacity_exceeded",
                    f"Max {self._max_concurrent} concurrent dispatches already active for "
                    "this engagement; wait for one to finish before starting another",
                )
            self._active.add(key)
        return (
            DispatchContext(dispatch_id, objective_id, int(prior.get("attempt", 0)) + 1),
            key,
            fingerprint,
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
            try:
                try:
                    result = self._task.func(
                        description=description,
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
            context, key, fingerprint = prepared
            token = active_dispatch.set(context)
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
