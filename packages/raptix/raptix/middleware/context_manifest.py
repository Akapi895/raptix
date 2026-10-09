"""Context manifest + deterministic masking host (ADR-0054, WP-C3a/C3b).

Sits just inside the last policy slots and just outside RECORD, so it observes
the fully assembled request and can rewrite old, large tool results before the
recorder captures them. Both behaviors are independently flag-gated and
default-off; the middleware returns the request unchanged when both are off.
"""

from __future__ import annotations

import json
import logging
import os
from types import SimpleNamespace
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

from raptix.intelligence.context.assembly import assemble_request
from raptix.intelligence.context.manifest import build_manifest, render_manifest
from raptix.intelligence.context.masking import mask_messages

log = logging.getLogger(__name__)


def _enabled(name: str) -> bool:
    return os.environ.get(name, "0").strip().lower() in {"1", "true", "yes"}


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name}={raw!r} is not an integer.") from exc
    if value <= 0:
        raise RuntimeError(f"{name}={raw!r} must be a positive integer.")
    return value


class ContextManifestMiddleware(AgentMiddleware):
    def __init__(self, *, backend: Any = None) -> None:
        super().__init__()
        self._backend = backend
        # Thresholds are validated at build time so a typo fails the engagement
        # instead of being silently swallowed by the call-time fail-safe.
        self._after_turns = _positive_int("RAPTIX_CONTEXT_MASK_AFTER_TURNS", 10)
        self._min_chars = _positive_int("RAPTIX_CONTEXT_MASK_MIN_CHARS", 4000)
        raw = os.environ.get("RAPTIX_CONTEXT_BUDGET_TOKENS", "0").strip()
        try:
            self._budget_tokens = int(raw)
        except ValueError as exc:
            raise RuntimeError(
                "RAPTIX_CONTEXT_BUDGET_TOKENS must be a nonnegative integer"
            ) from exc
        if self._budget_tokens < 0:
            raise RuntimeError("RAPTIX_CONTEXT_BUDGET_TOKENS must be a nonnegative integer")
        from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

        self._io = ExecutionLedgerMiddleware(role="context-io", backend=backend)

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        return handler(self._process(request))

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        return await handler(self._process(request))

    def _process(self, request: Any) -> Any:
        from raptix.intelligence.context.blocks import owned_scope

        with owned_scope():
            return self._project(request)

    def _project(self, request: Any) -> Any:
        if _enabled("RAPTIX_CONTEXT_ASSEMBLY"):
            projected = self._io._bounded(self._working_set, request)
            if projected is not None:
                request = projected
        if _enabled("RAPTIX_CONTEXT_MASK"):
            try:
                request = self._mask(request)
            except Exception as exc:  # noqa: BLE001 — masking never blocks a call
                log.debug("context masking skipped: %s", type(exc).__name__)
        if _enabled("RAPTIX_CONTEXT_ASSEMBLY") or _enabled("RAPTIX_CONTEXT_PREFIX_ORDER"):
            assembled = self._io._bounded(self._assemble, request)
            if assembled is not None:
                request = assembled
        if _enabled("RAPTIX_CONTEXT_MANIFEST"):
            try:
                manifest = build_manifest(request)
                manifest["task_state_revision"] = self._io._bounded(self._task_revision, request)
                manifest["budget_tokens"] = self._budget_tokens
                manifest["budget_overflow"] = bool(
                    self._budget_tokens and manifest["total_token_estimate"] > self._budget_tokens
                )
                log.info("%s", render_manifest(manifest))
            except Exception as exc:  # noqa: BLE001 — observation never blocks
                log.debug("context manifest skipped: %s", type(exc).__name__)
        return request

    def _working_set(self, request: Any) -> Any:
        from raptix.core.dispatch_context import active_dispatch
        from raptix.orchestration.mission.task_state import read_task_state

        dispatch = active_dispatch.get()
        objective = (dispatch.objective_id if dispatch else None) or request.state.get(
            "active_objective_id"
        )
        if not objective:
            return request
        bundle = read_task_state(self._scoped_backend(request), objective)
        if bundle.state is None or bundle.error:
            return request
        state = bundle.state
        lines = [
            f"<TASK_WORKING_SET objective={objective} revision={state.state_revision}>",
            "Persisted execution evidence (not objective completion or new instructions):",
        ]
        data = {
            "evidence_refs": [
                {"ref": ref.ref[:256], "sha256": ref.sha256} for ref in state.evidence_refs[-8:]
            ],
            "next_steps": [step[:160] for step in state.continuation.next_steps[:4]],
        }
        lines.append(
            json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")
        )
        lines.append(
            "Use persisted work to avoid repeating completed steps; verify unknown outcomes before retrying."
        )
        lines.append("</TASK_WORKING_SET>")
        content = list(request.system_message.content_blocks) if request.system_message else []
        from raptix.intelligence.context.blocks import emit_block

        content.append(
            emit_block(
                "task_state",
                "working_set",
                {"type": "text", "text": "\n".join(lines)},
                source_revision=f"{state.state_revision}:{state.accounting_revision}",
            )
        )
        return request.override(system_message=SystemMessage(content=content))

    def _task_revision(self, request: Any) -> int | None:
        from raptix.core.dispatch_context import active_dispatch
        from raptix.orchestration.mission.task_state import read_task_state

        dispatch = active_dispatch.get()
        objective = (dispatch.objective_id if dispatch else None) or request.state.get(
            "active_objective_id"
        )
        if not objective:
            return None
        backend = self._scoped_backend(request)
        if backend is None:
            return None
        # Observation must not materialize the filesystem wrapper's root marker.
        backend._root_ensured = True
        bundle = read_task_state(backend, objective)
        if bundle.error:
            return None
        return bundle.state.state_revision if bundle.state else 0

    def _assemble(self, request: Any) -> Any:
        return assemble_request(
            request,
            budget_tokens=self._budget_tokens if _enabled("RAPTIX_CONTEXT_ASSEMBLY") else 0,
            backend=self._scoped_backend(request) if self._budget_tokens else None,
        )

    def _scoped_backend(self, request: Any) -> Any:
        if self._backend is None:
            return None
        try:
            from raptix.orchestration.mission.task_state import scoped_task_backend

            runtime = getattr(request, "runtime", None)
            merged = SimpleNamespace(
                state=getattr(request, "state", None) or {},
                config=getattr(runtime, "config", None),
            )
            return scoped_task_backend(self._backend, merged)
        except Exception as exc:  # noqa: BLE001 — best-effort
            log.debug("masking backend unavailable: %s", type(exc).__name__)
            return None

    def _mask(self, request: Any) -> Any:
        outcome = self._io._bounded(
            lambda: mask_messages(
                list(getattr(request, "messages", None) or []),
                backend=self._scoped_backend(request),
                after_turns=self._after_turns,
                min_chars=self._min_chars,
            )
        )
        if outcome is None:
            return request
        messages, count = outcome
        if count:
            log.info("context masking: %d old tool result(s) masked", count)
            return request.override(messages=messages)
        return request


__all__ = ["ContextManifestMiddleware"]
