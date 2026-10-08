"""Per-request context manifest (ADR-0054, WP-C3a).

Observation only: enumerate the blocks that make up one model request, hash them,
estimate their size, and expose the current context epoch and active objective.
The middleware that calls this never mutates the request; it logs the manifest so
"what does this request cost?" has a deterministic, per-request answer.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from raptix.intelligence.context.blocks import block_owner

_TOKEN_CHARS = 4


def _estimate_tokens(chars: int) -> int:
    return (chars + _TOKEN_CHARS - 1) // _TOKEN_CHARS


def _block_entry(index: int, kind: str, role: str, text: str) -> dict[str, Any]:
    owner = block_owner(text) if kind == "system" else None
    return {
        "index": index,
        "kind": kind,
        "role": role,
        "chars": len(text),
        "token_estimate": _estimate_tokens(len(text)),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()[:16],
        "owner": owner.owner if owner else ("system.unmanaged" if kind == "system" else role),
        "key": owner.key if owner else str(index),
        "source_revision": owner.source_revision if owner else None,
    }


def build_manifest(request: Any) -> dict[str, Any]:
    """Summarise one model request; never mutates it."""
    blocks: list[dict[str, Any]] = []
    system = getattr(request, "system_message", None)
    if system is not None:
        content = getattr(system, "content_blocks", None)
        if content is None:
            content = [{"text": getattr(system, "text", None) or str(system.content)}]
        for block in content:
            text = block.get("text") if isinstance(block, dict) else None
            blocks.append(
                _block_entry(
                    len(blocks),
                    "system",
                    "system",
                    text if isinstance(text, str) else json.dumps(block, default=str),
                )
            )
    for index, message in enumerate(getattr(request, "messages", None) or [], start=1):
        content = getattr(message, "content", "")
        text = content if isinstance(content, str) else str(content)
        calls = getattr(message, "tool_calls", None)
        if calls:
            text += json.dumps(calls, sort_keys=True, ensure_ascii=False, default=str)
        blocks.append(
            _block_entry(index, type(message).__name__, getattr(message, "type", "?"), text)
        )

    tools = getattr(request, "tools", None) or []
    if tools:
        from langchain_core.utils.function_calling import convert_to_openai_tool

        schemas = [convert_to_openai_tool(tool) for tool in tools]
        blocks.append(_block_entry(len(blocks), "tools", "tools", json.dumps(schemas, default=str)))
    state = getattr(request, "state", None) or {}
    total = sum(block["chars"] for block in blocks)
    return {
        "block_count": len(blocks),
        "total_chars": total,
        "total_token_estimate": _estimate_tokens(total),
        "context_epoch": state.get("context_epoch"),
        "active_objective_id": state.get("active_objective_id"),
        "task_state_revision": state.get(
            "task_state_revision", (state.get("_summarization_event") or {}).get("source_revision")
        ),
        "blocks": blocks,
    }


def render_manifest(manifest: dict[str, Any]) -> str:
    lines = [
        "[context-manifest] "
        f"blocks={manifest['block_count']} chars={manifest['total_chars']} "
        f"~tokens={manifest['total_token_estimate']} epoch={manifest['context_epoch']} "
        f"objective={manifest['active_objective_id']} task_revision={manifest.get('task_state_revision')} "
        f"budget={manifest.get('budget_tokens', 0)} overflow={manifest.get('budget_overflow', False)}"
    ]
    for block in manifest["blocks"]:
        lines.append(
            f"  [{block['index']}] {block['kind']}/{block['role']} "
            f"owner={block['owner']}/{block['key']} revision={block['source_revision']} "
            f"chars={block['chars']} sha={block['sha256']}"
        )
    return "\n".join(lines)


def duplicate_block_hashes(manifest: dict[str, Any]) -> list[str]:
    """Hashes that appear more than once — a same-block duplication regression."""
    seen: dict[str, int] = {}
    for block in manifest["blocks"]:
        if not block["chars"]:
            continue
        seen[block["sha256"]] = seen.get(block["sha256"], 0) + 1
    return [digest for digest, count in seen.items() if count > 1]


__all__ = ["build_manifest", "duplicate_block_hashes", "render_manifest"]
