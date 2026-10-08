"""Cross-dispatch token/call budget accounting (ADR-0055, Wave D1).

After every model call the active objective's durable budget counters absorb
the response's token usage; a soft limit surfaces a system-reminder and a
one-time task-state decision entry. Counters keep accumulating across handoff
(I-6). Accounting is observational: it never alters the model response, never
blocks the model loop, stores no parameter values, and is off by default
(``RAPTIX_TASK_BUDGET``).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Any, cast

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

from raptix.core.dispatch_context import active_dispatch
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix.orchestration.mission.task_state import (
    DecisionRecord,
    TaskState,
    fold_task_budget,
    read_task_state,
    scoped_task_backend,
)

log = logging.getLogger(__name__)

_MAX_SECONDS = 4
_TOKEN_LIMIT_ENV = "RAPTIX_TASK_BUDGET_TOKENS"
_CALL_LIMIT_ENV = "RAPTIX_TASK_BUDGET_CALLS"
_TOKENS_MARKER = "budget_exhausted:tokens"
_CALLS_MARKER = "budget_exhausted:calls"
_REMINDER = (
    "<system-reminder>Objective budget reached its soft limit; prefer "
    "consolidating evidence and reporting over starting new exploration."
    "</system-reminder>"
)
_WRITERS = ThreadPoolExecutor(max_workers=2, thread_name_prefix="task-budget")
_WRITE_SLOTS = threading.BoundedSemaphore(2)


def task_budget_enabled() -> bool:
    return os.environ.get("RAPTIX_TASK_BUDGET", "0").strip().lower() in {"1", "true", "yes"}


def _positive_limit(env_name: str) -> int:
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return 0
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{env_name}={raw!r} is not an integer.") from exc
    if parsed <= 0:
        raise RuntimeError(f"{env_name}={raw!r} must be a positive integer.")
    return parsed


def budget_limits() -> tuple[int, int]:
    """Return ``(token_limit, call_limit)``; ``0`` means no soft limit."""
    return _positive_limit(_TOKEN_LIMIT_ENV), _positive_limit(_CALL_LIMIT_ENV)


def _as_int(value: Any) -> int:
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return 0


def usage_delta(response: Any) -> tuple[int, int, int]:
    """Return ``(model_calls, input_tokens, output_tokens)`` for one model result."""
    messages = getattr(response, "result", None)
    if not isinstance(messages, list):
        messages = [response]
    for message in reversed(messages):
        usage = getattr(message, "usage_metadata", None)
        if isinstance(usage, dict) and usage:
            return 1, _as_int(usage.get("input_tokens")), _as_int(usage.get("output_tokens"))
    return 1, 0, 0


class TaskBudgetMiddleware(AgentMiddleware):
    """Accumulate per-objective usage; never alter or delay the response."""

    state_schema = ObjectiveContextState

    def __init__(self, *, backend: Any = None, token_limit: int = 0, call_limit: int = 0) -> None:
        super().__init__()
        self._backend = backend
        if token_limit or call_limit:
            self._token_limit, self._call_limit = token_limit, call_limit
        else:
            self._token_limit, self._call_limit = budget_limits()

    def _objective_id(self, request: Any) -> str | None:
        context = active_dispatch.get()
        if context is not None and context.objective_id:
            return context.objective_id
        state = getattr(request, "state", None) or {}
        objective_id = state.get("active_objective_id")
        return str(objective_id) if objective_id else None

    def _backend_for(self, request: Any) -> Any:
        runtime = getattr(request, "runtime", None) or request
        try:
            return scoped_task_backend(self._backend, runtime)
        except Exception as exc:  # noqa: BLE001 — accounting never blocks the model loop
            log.debug("task-budget backend unavailable: %s", type(exc).__name__)
            return None

    def _marker(self, prior: TaskState | None, calls: int, tokens: int) -> DecisionRecord | None:
        prior_calls = prior.budget.model_calls if prior is not None else 0
        prior_tokens = (
            prior.budget.input_tokens + prior.budget.output_tokens if prior is not None else 0
        )
        if self._call_limit and prior_calls + calls >= self._call_limit:
            return DecisionRecord(
                action=_CALLS_MARKER,
                outcome="exhausted",
                reason=f"model_calls={prior_calls + calls} reached soft limit {self._call_limit}",
            )
        if self._token_limit and prior_tokens + tokens >= self._token_limit:
            return DecisionRecord(
                action=_TOKENS_MARKER,
                outcome="exhausted",
                reason=f"tokens={prior_tokens + tokens} reached soft limit {self._token_limit}",
            )
        return None

    def _fold(self, request: Any, objective_id: str, response: Any) -> None:
        calls, input_tokens, output_tokens = usage_delta(response)
        backend = self._backend_for(request)
        if backend is None:
            return
        prior = read_task_state(backend, objective_id).state
        marker = self._marker(prior, calls, input_tokens + output_tokens)
        fold_task_budget(
            backend,
            objective_id,
            model_calls=calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            decision=marker,
        )

    def _remind(self, request: Any, objective_id: str) -> Any:
        backend = self._backend_for(request)
        if backend is None:
            return request
        state = read_task_state(backend, objective_id).state
        if state is None or not any(
            entry.action in {_TOKENS_MARKER, _CALLS_MARKER} for entry in state.decision_record
        ):
            return request
        content = (
            [*request.system_message.content_blocks] if request.system_message is not None else []
        )
        content.append({"type": "text", "text": "\n\n" + _REMINDER})
        return request.override(
            system_message=SystemMessage(content=cast("list[str | dict[str, str]]", content))
        )

    def _bounded(self, action: Any, *args: Any) -> Any:
        if not _WRITE_SLOTS.acquire(blocking=False):
            return None
        context = copy_context()

        def run() -> Any:
            try:
                return context.run(action, *args)
            finally:
                _WRITE_SLOTS.release()

        try:
            future = _WRITERS.submit(run)
        except RuntimeError as exc:
            _WRITE_SLOTS.release()
            log.debug("task-budget writer unavailable: %s", type(exc).__name__)
            return None
        future.add_done_callback(lambda completed: completed.exception())
        try:
            return future.result(timeout=_MAX_SECONDS)
        except Exception as exc:  # noqa: BLE001 — accounting never blocks the model loop
            log.debug("task-budget fold skipped: %s", type(exc).__name__)
            return None

    async def _to_thread(self, action: Any, *args: Any) -> Any:
        if not _WRITE_SLOTS.acquire(blocking=False):
            return None
        context = copy_context()

        def run() -> Any:
            try:
                return context.run(action, *args)
            finally:
                _WRITE_SLOTS.release()

        future = _WRITERS.submit(run)
        future.add_done_callback(lambda completed: completed.exception())
        try:
            return await asyncio.wait_for(
                asyncio.shield(asyncio.wrap_future(future)), timeout=_MAX_SECONDS
            )
        except Exception as exc:  # noqa: BLE001 — accounting never blocks the model loop
            log.debug("task-budget fold skipped: %s", type(exc).__name__)
            return None

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        if not task_budget_enabled():
            return handler(request)
        objective_id = self._objective_id(request)
        if not objective_id:
            return handler(request)
        request = self._bounded(self._remind, request, objective_id) or request
        result = handler(request)
        self._bounded(self._fold, request, objective_id, result)
        return result

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        if not task_budget_enabled():
            return await handler(request)
        objective_id = self._objective_id(request)
        if not objective_id:
            return await handler(request)
        request = await self._to_thread(self._remind, request, objective_id) or request
        result = await handler(request)
        await self._to_thread(self._fold, request, objective_id, result)
        return result


__all__ = [
    "TaskBudgetMiddleware",
    "budget_limits",
    "task_budget_enabled",
    "usage_delta",
]
