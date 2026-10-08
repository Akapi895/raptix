"""Context manifest + masking: unit contract and a real scripted agent run (ADR-0054)."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import NotRequired

import pytest
from deepagents.backends.filesystem import FilesystemBackend
from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain.agents import AgentState, create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from pydantic import Field

from raptix.intelligence.context.manifest import build_manifest, duplicate_block_hashes
from raptix.intelligence.context.masking import is_maskable, mask_messages
from raptix.middleware.context_manifest import ContextManifestMiddleware


class MemoryBackend:
    def __init__(self, *, broken: bool = False) -> None:
        self.files: dict[str, str] = {}
        self.broken = broken

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if self.broken:
            raise RuntimeError("backend down")
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        if self.broken:
            raise RuntimeError("backend down")
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


def _big_tool_message(content: str = "X" * 5000, *, status: str = "success") -> ToolMessage:
    return ToolMessage(content=content, tool_call_id="call", id="msg-1", status=status)


def test_manifest_lists_blocks_without_duplication() -> None:
    request = SimpleNamespace(
        system_message=SimpleNamespace(text="sys", content="sys"),
        messages=[HumanMessage("one"), AIMessage("two")],
        state={"context_epoch": 2, "active_objective_id": "OBJ-001"},
    )
    manifest = build_manifest(request)
    assert manifest["block_count"] == 3
    assert manifest["context_epoch"] == 2
    assert duplicate_block_hashes(manifest) == []


def test_mask_replaces_old_large_message_and_offloads_full_text() -> None:
    backend = MemoryBackend()
    messages = [HumanMessage("q"), _big_tool_message("Y" * 9000), HumanMessage("later")]
    masked, count = mask_messages(messages, backend=backend, after_turns=1, min_chars=100)
    assert count == 1
    assert "[masked tool output:" in masked[1].content
    assert len(masked[1].content) < 2000
    # The full text is recoverable from the scratch reference.
    ref = next(ref for ref in backend.files if ref.startswith("/workspace/.scratch/"))
    assert backend.files[ref] == "Y" * 9000


def test_mask_exempts_status_errors_envelopes_and_recent_messages() -> None:
    error = _big_tool_message("E" * 9000, status="error")
    envelope = _big_tool_message("<UNTRUSTED_TOOL_OUTPUT>" + "z" * 9000)
    recent = _big_tool_message("R" * 9000)
    args = {"turns_ago": 3, "after_turns": 1, "min_chars": 100}
    assert not is_maskable(error, **args)
    assert not is_maskable(envelope, **args)
    assert not is_maskable(recent, turns_ago=1, after_turns=1, min_chars=100)
    assert is_maskable(_big_tool_message(), **args)


def test_mask_offload_failure_leaves_message_unchanged() -> None:
    messages = [HumanMessage("q"), _big_tool_message(), HumanMessage("later")]
    masked, count = mask_messages(
        messages, backend=MemoryBackend(broken=True), after_turns=1, min_chars=100
    )
    assert count == 0
    assert masked[1] is messages[1]


def test_flags_off_returns_request_unchanged(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_CONTEXT_MANIFEST", raising=False)
    monkeypatch.delenv("RAPTIX_CONTEXT_MASK", raising=False)
    request = SimpleNamespace(messages=[_big_tool_message()], state={}, runtime=None)
    middleware = ContextManifestMiddleware(backend=MemoryBackend())
    assert middleware._process(request) is request


def test_invalid_mask_threshold_names_env(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK_MIN_CHARS", "0")
    with pytest.raises(RuntimeError, match="RAPTIX_CONTEXT_MASK_MIN_CHARS"):
        ContextManifestMiddleware(backend=MemoryBackend())


class WorkspaceState(AgentState):
    workspace_path: NotRequired[str]


class ScriptedModel(GenericFakeChatModel):
    seen: list[list[str]] = Field(default_factory=list)
    step: int = 0

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.seen.append([str(getattr(m, "content", "")) for m in messages])
        step = self.step
        self.step += 1
        if step == 0:
            message = AIMessage(
                content="", tool_calls=[{"name": "big_tool", "args": {"tag": "a"}, "id": "c1"}]
            )
        elif step == 1:
            message = AIMessage(
                content="", tool_calls=[{"name": "big_tool", "args": {"tag": "b"}, "id": "c2"}]
            )
        else:
            message = AIMessage(content="done")
        return ChatResult(generations=[ChatGeneration(message=message)])


def test_real_agent_masks_old_tool_result_and_keeps_it_recoverable(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_MANIFEST", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK_AFTER_TURNS", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK_MIN_CHARS", "100")
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)

    @tool
    def big_tool(tag: str) -> str:
        """Return a large synthetic tool payload."""
        return f"{tag}:" + ("Z" * 5000)

    model = ScriptedModel(messages=iter([]))
    agent = create_agent(
        model,
        tools=[big_tool],
        middleware=[ContextManifestMiddleware(backend=backend)],
        state_schema=WorkspaceState,
    )
    records: list[logging.LogRecord] = []
    handler = logging.Handler(level=logging.INFO)
    handler.emit = records.append  # type: ignore[method-assign]
    logger = logging.getLogger("raptix.middleware.context_manifest")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        agent.invoke(
            {"messages": [HumanMessage("go")], "workspace_path": "/workspace"},
            {"configurable": {"thread_id": "mask-run"}},
        )
    finally:
        logger.removeHandler(handler)

    final_view = "\n".join(model.seen[-1])
    # Exactly the older tool result is masked; the most recent one is legible.
    assert final_view.count("[masked tool output:") == 1
    assert final_view.count("Z") < 9500  # one 5000-char payload was replaced
    assert any("context-manifest" in record.getMessage() for record in records)

    # The offloaded text is recoverable through the engagement-scoped mapping.
    from raptix.middleware.filesystem import EngagementFilesystemBackend

    scoped = EngagementFilesystemBackend(backend, "/workspace")
    assert scoped.ls("/workspace/.scratch").entries
