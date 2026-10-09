"""Request-local overlay ownership; metadata is never sent to the provider."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ContextBlock:
    owner: str
    key: str
    digest: str
    source_revision: str | None
    compact: str | None = None
    priority: int = 0


_BLOCKS: ContextVar[dict[str, ContextBlock] | None] = ContextVar("context_blocks", default=None)
_OWNER: ContextVar[str | None] = ContextVar("context_block_owner", default=None)


def enabled(name: str) -> bool:
    return os.environ.get(name, "0").strip().lower() in {"1", "true", "yes"}


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@contextmanager
def owned_scope() -> Iterator[None]:
    from raptix.core.dispatch_context import active_dispatch

    dispatch = active_dispatch.get()
    owner = dispatch.lease_token if dispatch else None
    if (_BLOCKS.get() is not None and _OWNER.get() == owner) or not (
        enabled("RAPTIX_CONTEXT_ASSEMBLY")
        or enabled("RAPTIX_CONTEXT_MANIFEST")
        or enabled("RAPTIX_CONTEXT_PREFIX_ORDER")
    ):
        yield
        return
    token = _BLOCKS.set({})
    owner_token = _OWNER.set(owner)
    try:
        yield
    finally:
        _BLOCKS.reset(token)
        _OWNER.reset(owner_token)


def emit_block(
    owner: str,
    key: str,
    block: dict[str, Any],
    *,
    source_revision: str | None = None,
    compact: str | None = None,
    priority: int = 0,
) -> dict[str, Any]:
    registry = _BLOCKS.get()
    if registry is not None:
        digest = content_hash(block["text"])
        registry[digest] = ContextBlock(owner, key, digest, source_revision, compact, priority)
    return block


def block_owner(text: str) -> ContextBlock | None:
    return (_BLOCKS.get() or {}).get(content_hash(text))
