"""Transactional compaction commits only a valid, recoverable revision (ADR-0052)."""

from __future__ import annotations

from types import SimpleNamespace

from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain.agents.middleware.types import ExtendedModelResponse, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from raptix.intelligence.agents.middleware_slots import _SafeSummarizationProxy
from raptix.orchestration.mission.task_state import TaskState, write_task_state

GOOD = "## SESSION INTENT\nx\n## SUMMARY\ny\n## ARTIFACTS\nNone\n## NEXT STEPS\nz"
POINTER = "/workspace/conversation_history/t.md"


class MemoryBackend:
    def __init__(self) -> None:
        self.files: dict[str, str] = {}

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


class Inner:
    state_schema = dict
    tools: list = []
    name = "inner"


def _response(event: dict) -> ExtendedModelResponse:
    return ExtendedModelResponse(
        ModelResponse(result=[AIMessage(content="ok")]),
        Command(update={"_summarization_event": event}),
    )


def _request(state: dict | None = None) -> SimpleNamespace:
    state = state or {
        "context_epoch": 0,
        "active_objective_id": "OBJ-001",
        "workspace_path": "/workspace",
        "messages": [HumanMessage("a")],
    }
    return SimpleNamespace(
        state=state,
        runtime=SimpleNamespace(config={"configurable": {"thread_id": "t"}}),
        messages=state["messages"],
    )


def _event(content: str = GOOD, file_path: str | None = POINTER, **extra) -> dict:
    event = {
        "cutoff_index": 1,
        "summary_message": HumanMessage(content=content),
        "file_path": file_path,
    }
    event.update(extra)
    return event


def _proxy(backend: MemoryBackend) -> _SafeSummarizationProxy:
    return _SafeSummarizationProxy(Inner(), task_state_backend=backend)


def _update(result: ExtendedModelResponse) -> dict:
    command = result.command
    assert command is not None
    return command.update


def test_flag_off_keeps_event_even_without_recovery_pointer(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_TRANSACTIONAL_COMPACTION", raising=False)
    event = _event(file_path=None)
    update = _update(_proxy(MemoryBackend())._finalize(_response(event), _request()))
    assert "_summarization_event" in update


def test_missing_offload_pointer_is_stripped(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    event = _event(file_path=None)
    result = _proxy(MemoryBackend())._finalize(_response(event), _request())
    assert "_summarization_event" not in _update(result)


def test_unreadable_pointer_is_stripped(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    result = _proxy(MemoryBackend())._finalize(_response(_event()), _request())
    assert "_summarization_event" not in _update(result)


def test_missing_headers_are_stripped(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    backend = MemoryBackend()
    backend.files[POINTER] = "history"
    event = _event(content="free text only")
    result = _proxy(backend)._finalize(_response(event), _request())
    assert "_summarization_event" not in _update(result)


def test_happy_path_commits_with_epoch_and_source_revision(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    backend = MemoryBackend()
    backend.files[POINTER] = "history"
    write_task_state(backend, TaskState(objective_id="OBJ-001", state_revision=3))
    request = _request()
    proxy = _proxy(backend)
    snapshot = proxy._source_snapshot(request)
    update = _update(proxy._finalize(_response(_event()), request, snapshot))
    assert update["_summarization_event"]["context_epoch"] == 1
    assert update["context_epoch"] == 1
    assert update["_summarization_event"]["source_revision"] == 3


def test_stale_epoch_is_stripped(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    backend = MemoryBackend()
    backend.files[POINTER] = "history"
    state = {
        "context_epoch": 5,
        "active_objective_id": "OBJ-001",
        "workspace_path": "/workspace",
        "messages": [HumanMessage("a")],
    }
    request = _request(state)
    result = _proxy(backend)._finalize(_response(_event(context_epoch=0)), request)
    assert "_summarization_event" not in _update(result)


def test_source_revision_change_is_stripped(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    backend = MemoryBackend()
    backend.files[POINTER] = "history"
    write_task_state(backend, TaskState(objective_id="OBJ-001", state_revision=3))
    request = _request()
    proxy = _proxy(backend)
    snapshot = proxy._source_snapshot(request)
    write_task_state(backend, TaskState(objective_id="OBJ-001", state_revision=4))
    result = proxy._finalize(_response(_event()), request, snapshot)
    assert "_summarization_event" not in _update(result)
