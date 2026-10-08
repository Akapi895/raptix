"""Progress observation surfaces stalls without ever blocking or altering a call."""

from __future__ import annotations

from types import SimpleNamespace

from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain_core.messages import SystemMessage, ToolMessage


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


def _tool_request(command: str = "nmap -sV 10.0.0.1"):
    return SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={"id": "call-1", "args": {"command": command}},
        state={"engagement_name": "acme", "active_objective_id": "OBJ-001"},
        runtime=None,
    )


def _model_request():
    system = SystemMessage(content="base prompt")
    return SimpleNamespace(
        state={"engagement_name": "acme", "active_objective_id": "OBJ-001"},
        system_message=system,
        model=SimpleNamespace(name="recon"),
        messages=[],
        tools=[],
        runtime=None,
        override=lambda **kwargs: SimpleNamespace(
            system_message=kwargs["system_message"],
            state={"engagement_name": "acme", "active_objective_id": "OBJ-001"},
            runtime=None,
        ),
    )


def _middleware(backend=None):
    from raptix.middleware.tried_edges import TriedEdgesMiddleware

    return TriedEdgesMiddleware(store=None, role="recon", backend=backend)


def _repeat(
    middleware, times: int, content: str = "scan done\n[Exit code: 0]", command: str = "nmap"
) -> None:
    for _ in range(times):
        request = _tool_request(command)
        reply = ToolMessage(content=content, tool_call_id="call-1")
        assert middleware.wrap_tool_call(request, lambda _r, reply=reply: reply) is reply


def _system_text(middleware) -> str:
    seen: list[str] = []

    def handler(request):
        seen.append(str(request.system_message.content))
        return "model response"

    middleware.wrap_model_call(_model_request(), handler)
    return seen[0]


def test_progress_flag_off_never_reminds(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_PROGRESS_OBSERVE", raising=False)
    middleware = _middleware()
    _repeat(middleware, 12)
    assert "No verifiable progress" not in _system_text(middleware)


def test_repeated_identical_actions_remind_once(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    middleware = _middleware()
    _repeat(middleware, 12)
    assert "No verifiable progress" in _system_text(middleware)
    assert "No verifiable progress" not in _system_text(middleware)


def test_changed_result_suppresses_reminder(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    middleware = _middleware()
    _repeat(middleware, 6)
    _repeat(middleware, 1, content="scan done\n[Exit code: 1]", command="nmap")
    _repeat(middleware, 5)
    assert "No verifiable progress" not in _system_text(middleware)


def test_changed_state_revision_suppresses_reminder(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    from raptix.middleware.filesystem import EngagementFilesystemBackend
    from raptix.orchestration.mission.task_state import TaskState, write_task_state

    backend = MemoryBackend()
    scoped = EngagementFilesystemBackend(backend, "/workspace")
    middleware = _middleware(backend=backend)
    request = _tool_request()
    request.state["workspace_path"] = "/workspace"
    reply = ToolMessage(content="scan done\n[Exit code: 0]", tool_call_id="call-1")
    for revision in range(1, 13):
        write_task_state(scoped, TaskState(objective_id="OBJ-001", state_revision=revision))
        assert middleware.wrap_tool_call(request, lambda _r, reply=reply: reply) is reply
    assert "No verifiable progress" not in _system_text(middleware)


def test_observation_returns_original_result_and_runs_tool_once(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    middleware = _middleware()
    reply = ToolMessage(content="scan done", tool_call_id="call-1")
    calls: list[object] = []

    def handler(request):
        calls.append(request)
        return reply

    assert middleware.wrap_tool_call(_tool_request(), handler) is reply
    assert calls == [_tool_request()]


def test_progress_only_slot_builds_without_kg(monkeypatch) -> None:
    from raptix.intelligence.agents.middleware_slots import _make_tried_edges

    monkeypatch.delenv("RAPTIX_KG_TRIED_EDGES", raising=False)
    monkeypatch.delenv("RAPTIX_PROGRESS_OBSERVE", raising=False)
    assert _make_tried_edges(role="recon") is None
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    middleware = _make_tried_edges(role="recon")
    assert middleware is not None
    assert middleware._store is None
