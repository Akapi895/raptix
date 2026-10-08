"""Deterministic masking of old tool results (ADR-0054, WP-C3b).

Old, large ``ToolMessage`` contents are replaced with a compact observation plus
an artifact reference; the full text is offloaded to ``/workspace/.scratch`` so
the worker can still retrieve it. Status-bearing markers, system-reminders and
untrusted-output envelopes are never masked (guardrail wrappers stay intact).
Fail-safe: any offload failure leaves the message unchanged so masking can never
silently drop content.
"""

from __future__ import annotations

import hashlib
import logging
import posixpath
from typing import Any

from langchain_core.messages import ToolMessage

log = logging.getLogger(__name__)

SCRATCH_DIR = "/workspace/.scratch"
_PREVIEW_CHARS = 1000
_EXEMPT_MARKERS = (
    "<system-reminder>",
    "<UNTRUSTED_TOOL_OUTPUT>",
    "<AGENT_HALTED>",
    "[ROE_REFUSED]",
    "[BACKGROUND]",
    "[AUTO-BACKGROUND]",
)


def is_maskable(message: Any, *, turns_ago: int, after_turns: int, min_chars: int) -> bool:
    if not isinstance(message, ToolMessage):
        return False
    if getattr(message, "status", None) == "error":
        return False
    content = message.content if isinstance(message.content, str) else ""
    if any(marker in content for marker in _EXEMPT_MARKERS):
        return False
    if turns_ago <= after_turns:
        return False
    return len(content) > min_chars


def _scratch_path(message: ToolMessage) -> str:
    token = getattr(message, "id", None) or str(id(message))
    digest = hashlib.sha256(str(token).encode()).hexdigest()[:16]
    return posixpath.join(SCRATCH_DIR, f"masked-{digest}.txt")


def mask_messages(
    messages: list[Any],
    *,
    backend: Any,
    after_turns: int,
    min_chars: int,
) -> tuple[list[Any], int]:
    """Return (messages, masked_count); never raises."""
    if backend is None:
        return list(messages), 0
    total = len(messages)
    out = list(messages)
    masked = 0
    for index, message in enumerate(messages):
        turns_ago = total - index
        if not is_maskable(
            message, turns_ago=turns_ago, after_turns=after_turns, min_chars=min_chars
        ):
            continue
        content = message.content
        ref = _scratch_path(message)
        try:
            existing = backend.read(ref, offset=0, limit=1)
            if existing.error:
                write = backend.write(ref, content)
                if write.error:
                    continue
        except Exception as exc:  # noqa: BLE001 — fail-safe: leave message intact
            log.debug("mask offload failed: %s", type(exc).__name__)
            continue
        preview = content[:_PREVIEW_CHARS].strip()
        replacement = (
            f"[masked tool output: {getattr(message, 'name', 'tool')} result, "
            f"{len(content)} chars -> {ref}]\n{preview}\n[... truncated]"
        )
        out[index] = message.model_copy(update={"content": replacement})
        masked += 1
    return out, masked


__all__ = ["SCRATCH_DIR", "is_maskable", "mask_messages"]
