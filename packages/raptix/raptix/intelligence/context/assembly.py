"""Optional estimate budget for adapter-owned blocks; zero means unlimited."""

from __future__ import annotations

from typing import Any

from raptix.intelligence.context.blocks import block_owner, content_hash, enabled
from raptix.intelligence.context.manifest import build_manifest


def assemble_request(request: Any, *, budget_tokens: int, backend: Any) -> Any:
    system = request.system_message
    if system is None:
        return request
    blocks = list(system.content_blocks)
    seen: set[tuple[str, str]] = set()
    kept = []
    # Last emission owns a logical block. Preserve the relative order of all
    # surviving blocks, including every unknown/safety-owned system block.
    for block in reversed(blocks):
        owner = block_owner(block.get("text", ""))
        identity = (owner.owner, owner.key) if owner else None
        if identity is not None and identity in seen:
            continue
        if identity is not None:
            seen.add(identity)
        kept.append(block)
    blocks = list(reversed(kept))
    if enabled("RAPTIX_CONTEXT_PREFIX_ORDER"):
        start = 0
        while start < len(blocks):
            if block_owner(blocks[start].get("text", "")) is None:
                start += 1
                continue
            end = start
            while end < len(blocks) and block_owner(blocks[end].get("text", "")) is not None:
                end += 1
            blocks[start:end] = sorted(
                blocks[start:end],
                key=lambda block: bool(
                    (owner := block_owner(block.get("text", ""))) and owner.source_revision
                ),
            )
            start = end
    candidate = request.override(system_message=system.model_copy(update={"content": blocks}))
    if budget_tokens > 0 and backend is not None:
        cost = build_manifest(candidate)["total_chars"]
        options = [
            (index, block_owner(block.get("text", ""))) for index, block in enumerate(blocks)
        ]
        for index, owner in sorted(options, key=lambda pair: pair[1].priority if pair[1] else 100):
            if cost <= budget_tokens * 4:
                break
            if owner is None or owner.compact is None:
                continue
            full = blocks[index]["text"]
            ref = f"/workspace/.scratch/context-{content_hash(full)}.txt"
            reduced = owner.compact + f"\nFull {owner.owner}/{owner.key} block: {ref}\n"
            if len(reduced) >= len(full) or len(full.encode("utf-8")) > 1_000_000:
                continue
            written = backend.write(ref, full)
            recovered = backend.read(ref, offset=0, limit=1_000_001)
            if (
                recovered.error
                or not recovered.file_data
                or recovered.file_data.get("content") != full
            ):
                # Existing immutable artifacts are acceptable only after exact
                # read-back; a failed write is never grounds to lose context.
                continue
            if written.error and "already exists" not in written.error.lower():
                continue
            blocks[index] = {**blocks[index], "text": reduced}
            cost -= len(full) - len(reduced)
            # Keep ownership/revision visible on the compact representation.
            from raptix.intelligence.context.blocks import emit_block

            emit_block(owner.owner, owner.key, blocks[index], source_revision=owner.source_revision)
        candidate = request.override(system_message=system.model_copy(update={"content": blocks}))
    return candidate if blocks != list(system.content_blocks) else request
