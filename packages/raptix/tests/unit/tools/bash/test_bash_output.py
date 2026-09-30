"""bash_output / bash_kill / bash_status tool unit tests."""

import asyncio
from dataclasses import dataclass, field
from unittest.mock import AsyncMock, MagicMock

from raptix.sandbox_kernel import BackgroundJobTracker
from raptix.tools.bash.bash import (
    _passive_read_state,
    bash,
    bash_kill,
    bash_output,
    bash_status,
    bash_workspace,
    set_sandbox,
)


def _fake_sandbox():
    sandbox = MagicMock()
    sandbox._jobs = BackgroundJobTracker()
    return sandbox


@dataclass
class _FakeSessionState:
    cwd: str
    history: list[str] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)


class _SessionIsolatingSandbox:
    """Deterministic stand-in for the tmux daemon's session contract."""

    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], _FakeSessionState] = {}
        self.calls: list[tuple[str, str, str]] = []

    def execute(self, command: str, *, timeout: int | None = None) -> None:
        del command, timeout

    async def execute_tmux_async(
        self,
        *,
        command: str,
        session: str,
        workspace_path: str,
        timeout: int,
        is_input: bool,
    ) -> str:
        del timeout, is_input
        key = (workspace_path, session)
        state = self.sessions.setdefault(key, _FakeSessionState(cwd=workspace_path))
        self.calls.append((workspace_path, session, command))
        if command.startswith("cd "):
            state.cwd = command[3:]
            state.history.append(command)
            return state.cwd
        if command.startswith("write "):
            _, name, value = command.split(" ", 2)
            state.files[name] = value
            state.history.append(command)
            return "written"
        if command == "pwd":
            state.history.append(command)
            return state.cwd
        if command == "cat result.txt":
            state.history.append(command)
            return state.files.get("result.txt", "missing")
        if command == "history":
            return "\n".join(state.history)
        return "stable screen"


def _invoke_bash(command: str, session: str) -> str:
    with bash_workspace("/workspace/b0-isolation"):
        return asyncio.run(
            bash.ainvoke(
                {
                    "command": command,
                    "session": session,
                    "description": "Exercise deterministic session isolation",
                }
            )
        )


def test_bash_output_running_job_returns_running_marker():
    sandbox = _fake_sandbox()
    sandbox._jobs.register("scan", command="nmap", initial_markers=1)
    sandbox.poll_completion = MagicMock(side_effect=lambda s: sandbox._jobs.get(s))
    sandbox.read_session_log_diff = MagicMock(return_value="partial output")
    set_sandbox(sandbox)

    result = asyncio.run(bash_output.ainvoke({"session": "scan"}))

    assert "[RUNNING" in result
    assert "partial output" in result


def test_bash_output_done_job_marks_consumed_and_exposes_exit_code():
    sandbox = _fake_sandbox()
    sandbox._jobs.register("scan", command="nmap", initial_markers=1)
    sandbox._jobs.mark_complete("scan", exit_code=0)
    sandbox.poll_completion = MagicMock(side_effect=lambda s: sandbox._jobs.get(s))
    sandbox.read_session_log_diff = MagicMock(return_value="full nmap output")
    set_sandbox(sandbox)

    result = asyncio.run(bash_output.ainvoke({"session": "scan"}))

    assert "[DONE" in result
    assert "exit=0" in result
    assert sandbox._jobs.get("scan").consumed is True


def test_bash_output_idle_when_no_job_registered():
    sandbox = _fake_sandbox()
    sandbox.poll_completion = MagicMock(return_value=None)
    sandbox.read_session_log_diff = MagicMock(return_value="")
    set_sandbox(sandbox)

    result = asyncio.run(bash_output.ainvoke({"session": "never-seen"}))

    assert "[IDLE]" in result


def test_bash_kill_invokes_sandbox_kill_session():
    sandbox = _fake_sandbox()
    sandbox._jobs.register("scan", command="nmap", initial_markers=1)
    sandbox.kill_session = MagicMock()
    set_sandbox(sandbox)

    result = asyncio.run(bash_kill.ainvoke({"session": "scan"}))

    sandbox.kill_session.assert_called_once_with("scan")
    assert "[KILLED]" in result
    assert "scan" in result


def test_bash_status_lists_running_and_done_jobs():
    sandbox = _fake_sandbox()
    sandbox._jobs.register("scan", command="nmap target", initial_markers=1)
    sandbox._jobs.register("brute", command="hydra ...", initial_markers=1)
    sandbox._jobs.mark_complete("brute", exit_code=1)
    sandbox.poll_completion = MagicMock(side_effect=lambda s: sandbox._jobs.get(s))
    set_sandbox(sandbox)

    result = asyncio.run(bash_status.ainvoke({}))

    assert "scan" in result and "running" in result
    assert "brute" in result and "exit=1" in result


def test_bash_status_empty_returns_empty_marker():
    sandbox = _fake_sandbox()
    set_sandbox(sandbox)
    with bash_workspace("/workspace/test"):
        result = asyncio.run(bash_status.ainvoke({}))
    assert "[EMPTY]" in result


def test_bash_background_uses_engagement_workspace_context():
    sandbox = _fake_sandbox()
    sandbox.execute = MagicMock()
    sandbox.start_background = MagicMock()
    set_sandbox(sandbox)

    with bash_workspace("/workspace/test"):
        result = asyncio.run(
            bash.ainvoke(
                {
                    "command": "sleep 1",
                    "background": True,
                    "session": "scan",
                    "description": "Sleep in the background",
                }
            )
        )

    sandbox.start_background.assert_called_once_with(
        command="sleep 1",
        session="scan",
        workspace_path="/workspace/test",
    )
    assert "[BACKGROUND]" in result


def test_bash_uses_engagement_workspace_from_environment(monkeypatch):
    sandbox = _fake_sandbox()
    sandbox.execute = MagicMock()
    sandbox.execute_tmux_async = AsyncMock(return_value="ok")
    set_sandbox(sandbox)
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "env-engagement")

    result = asyncio.run(bash.ainvoke({"command": "pwd", "description": "Print working directory"}))

    sandbox.execute_tmux_async.assert_called_once_with(
        command="pwd",
        session="main",
        timeout=120,
        is_input=False,
        workspace_path="/workspace/env-engagement",
    )
    assert result == "ok"


def test_large_output_without_engagement_workspace_does_not_create_root_scratch():
    sandbox = _fake_sandbox()
    sandbox.execute = MagicMock()
    sandbox.execute_tmux_async = AsyncMock(return_value="x" * 15_001)
    set_sandbox(sandbox)

    result = asyncio.run(
        bash.ainvoke(
            {"command": "big", "description": "Produce large output"},
            config={"configurable": {"workspace_path": "/workspace"}},
        )
    )

    assert "/workspace/.scratch" not in result
    assert "not written" in result
    sandbox.execute.assert_not_called()


def test_named_sessions_isolate_workdir_history_files_and_stale_reads():
    sandbox = _SessionIsolatingSandbox()
    set_sandbox(sandbox)
    _passive_read_state.clear()

    _invoke_bash("cd /workspace/b0-isolation/a", "b0-cell-a")
    _invoke_bash("write result.txt only-a", "b0-cell-a")
    _invoke_bash("cd /workspace/b0-isolation/b", "b0-cell-b")
    _invoke_bash("write result.txt only-b", "b0-cell-b")

    assert set(sandbox.sessions) == {
        ("/workspace/b0-isolation", "b0-cell-a"),
        ("/workspace/b0-isolation", "b0-cell-b"),
    }
    assert _invoke_bash("pwd", "b0-cell-a") == "/workspace/b0-isolation/a"
    assert _invoke_bash("pwd", "b0-cell-b") == "/workspace/b0-isolation/b"
    assert _invoke_bash("cat result.txt", "b0-cell-a") == "only-a"
    assert _invoke_bash("cat result.txt", "b0-cell-b") == "only-b"
    assert "only-a" in _invoke_bash("history", "b0-cell-a")
    assert "only-a" not in _invoke_bash("history", "b0-cell-b")

    first_a = _invoke_bash("", "b0-cell-a")
    second_a = _invoke_bash("", "b0-cell-a")
    third_a = _invoke_bash("", "b0-cell-a")
    first_b = _invoke_bash("", "b0-cell-b")
    assert "[STALE]" not in first_a + second_a
    assert "[STALE]" in third_a
    assert "[STALE]" not in first_b
