"""Per-request context manifest (ADR-0054, WP-C3a).

Observation only: enumerate the blocks that make up one model request, hash them,
estimate their size, and expose the current context epoch and active objective.
The middleware that calls this never mutates the request; it logs the manifest so
"what does this request cost?" has a deterministic, per-request answer.
"""

from __future__ import annotations

import hashlib
from typing import Any

_TOKEN_CHARS = 4


def _estimate_tokens(chars: int) -> int:
    return max(1, chars // _TOKEN_CHARS)


def _block_entry(index: int, kind: str, role: str, text: str) -> dict[str, Any]:
    return {
        "index": index,
        "kind": kind,
        "role": role,
        "chars": len(text),
        "token_estimate": _estimate_tokens(len(text)),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()[:16],
    }


def build_manifest(request: Any) -> dict[str, Any]:
    """Summarise one model request; never mutates it."""
    blocks: list[dict[str, Any]] = []
    system = getattr(request, "system_message", None)
    if system is not None:
        text = getattr(system, "text", None) or str(getattr(system, "content", ""))
        blocks.append(_block_entry(0, "system", "system", text))
    for index, message in enumerate(getattr(request, "messages", None) or [], start=1):
        content = getattr(message, "content", "")
        text = content if isinstance(content, str) else str(content)
        blocks.append(
            _block_entry(index, type(message).__name__, getattr(message, "type", "?"), text)
        )

    state = getattr(request, "state", None) or {}
    total = sum(block["chars"] for block in blocks)
    return {
        "block_count": len(blocks),
        "total_chars": total,
        "total_token_estimate": _estimate_tokens(total),
        "context_epoch": state.get("context_epoch"),
        "active_objective_id": state.get("active_objective_id"),
        "blocks": blocks,
    }


def render_manifest(manifest: dict[str, Any]) -> str:
    lines = [
        "[context-manifest] "
        f"blocks={manifest['block_count']} chars={manifest['total_chars']} "
        f"~tokens={manifest['total_token_estimate']} epoch={manifest['context_epoch']} "
        f"objective={manifest['active_objective_id']}"
    ]
    for block in manifest["blocks"]:
        lines.append(
            f"  [{block['index']}] {block['kind']}/{block['role']} "
            f"chars={block['chars']} sha={block['sha256']}"
        )
    return "\n".join(lines)


def duplicate_block_hashes(manifest: dict[str, Any]) -> list[str]:
    """Hashes that appear more than once — a same-block duplication regression."""
    seen: dict[str, int] = {}
    for block in manifest["blocks"]:
        seen[block["sha256"]] = seen.get(block["sha256"], 0) + 1
    return [digest for digest, count in seen.items() if count > 1]


__all__ = ["build_manifest", "duplicate_block_hashes", "render_manifest"]
