"""Context manifest + deterministic masking host (ADR-0054, WP-C3a/C3b).

Sits just inside the last policy slots and just outside RECORD, so it observes
the fully assembled request and can rewrite old, large tool results before the
recorder captures them. Both behaviors are independently flag-gated and
default-off; the middleware returns the request unchanged when both are off.
"""

from __future__ import annotations

import logging
import os
from types import SimpleNamespace
from typing import Any

from langchain.agents.middleware import AgentMiddleware

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

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        return handler(self._process(request))

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        return await handler(self._process(request))

    def _process(self, request: Any) -> Any:
        if _enabled("RAPTIX_CONTEXT_MANIFEST"):
            try:
                log.info("%s", render_manifest(build_manifest(request)))
            except Exception as exc:  # noqa: BLE001 — observation never blocks
                log.debug("context manifest skipped: %s", type(exc).__name__)
        if _enabled("RAPTIX_CONTEXT_MASK"):
            try:
                request = self._mask(request)
            except Exception as exc:  # noqa: BLE001 — masking never blocks a call
                log.debug("context masking skipped: %s", type(exc).__name__)
        return request

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
        messages, count = mask_messages(
            list(getattr(request, "messages", None) or []),
            backend=self._scoped_backend(request),
            after_turns=self._after_turns,
            min_chars=self._min_chars,
        )
        if count:
            log.info("context masking: %d old tool result(s) masked", count)
            return request.override(messages=messages)
        return request


__all__ = ["ContextManifestMiddleware"]
