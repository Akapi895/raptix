"""ADR-0045 — summarization offload lands inside the engagement workspace.

deepagents computes the history prefix from the backend it is handed at
construction and later binds a callable backend per summarization run. The
Raptix summarization slot now hands it an ``_EngagementSummarizationBackend``:
a ``CompositeBackend`` (so the prefix is ``/workspace/conversation_history``)
that is also callable (so the write is rebound to the per-run sandbox and
scoped to the engagement workspace, mirroring ``FilesystemMiddleware``).

These tests pin the path/scoping decision and the read-back contract, without
a live sandbox (fake transport + a real ``StateBackend``).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from deepagents.backends import CompositeBackend
from deepagents.backends.state import StateBackend
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

from raptix.execution.backends.http_sandbox import HTTPSandbox
from raptix.intelligence.agents.middleware_slots import (
    _EngagementSummarizationBackend,
    _make_summarization,
)
from raptix.middleware.filesystem import EngagementFilesystemBackend


def _fake_model():
    return GenericFakeChatModel(messages=iter([]))


def _composite(default: Any) -> CompositeBackend:
    return CompositeBackend(default=default, routes={"/skills/": StateBackend()})


def test_make_summarization_sets_workspace_history_prefix() -> None:
    proxy = _make_summarization(backend=_composite(StateBackend()), llm=_fake_model())
    inner = proxy._inner
    assert inner._history_path_prefix == "/workspace/conversation_history"


def test_non_composite_backend_is_left_untouched() -> None:
    state = StateBackend()
    proxy = _make_summarization(backend=state, llm=_fake_model())
    # A plain StateBackend is not a CompositeBackend: today's construction
    # behavior is preserved (prefix derived from the "/" default).
    assert proxy._inner._history_path_prefix == "/conversation_history"
    assert proxy._inner._backend is state


def test_per_run_backend_scopes_to_engagement_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scoped = _EngagementSummarizationBackend(_composite(HTTPSandbox("http://sandbox.test")))

    import raptix.execution.backends as backends

    monkeypatch.setattr(backends, "build_sandbox_backend", lambda config=None: StateBackend())

    runtime = SimpleNamespace(
        state={},
        config={"configurable": {"workspace_path": "/workspace/lab"}},
    )
    resolved = scoped(runtime)

    assert isinstance(resolved, EngagementFilesystemBackend)
    assert resolved._root == "/workspace/lab"
    # The inner transport is the (rebound) composite, never the raw sandbox.
    assert isinstance(resolved._backend, CompositeBackend)
    assert resolved._backend.artifacts_root == "/workspace"


def test_per_run_backend_without_workspace_returns_fail_closed_wrapper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scoped = _EngagementSummarizationBackend(_composite(HTTPSandbox("http://sandbox.test")))

    import raptix.execution.backends as backends

    monkeypatch.setattr(backends, "build_sandbox_backend", lambda config=None: StateBackend())

    resolved = scoped(SimpleNamespace(state={}, config={"configurable": {}}))

    assert isinstance(resolved, EngagementFilesystemBackend)
    assert resolved._root is None


def test_offload_pointer_round_trips_through_engagement_wrapper(tmp_path) -> None:
    """The path deepagents embeds is exactly the path read_file resolves."""
    from deepagents.backends.filesystem import FilesystemBackend

    backend = EngagementFilesystemBackend(
        FilesystemBackend(root_dir=str(tmp_path), virtual_mode=True),
        "/workspace/lab",
    )
    ptr = "/workspace/conversation_history/thread-1.md"

    written = backend.write(ptr, "evicted history body")
    assert written.error is None

    read_back = backend.read(ptr)
    assert read_back.error is None
    assert read_back.file_data is not None
    assert "evicted history body" in str(read_back.file_data.get("content", ""))

    # The engagement directory is the physical home of the offload.
    physical = backend._real(ptr)
    assert physical == "/workspace/lab/conversation_history/thread-1.md"
