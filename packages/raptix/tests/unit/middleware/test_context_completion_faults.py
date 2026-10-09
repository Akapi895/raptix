"""Ownership, progress and capture failures from the composed context audit."""

import json
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents.middleware.types import ModelRequest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableLambda
from langgraph.types import Command

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.intelligence.llm.factory import _ProxiedChatOpenAI
from raptix.middleware.dispatch import DispatchMiddleware
from raptix.middleware.tried_edges import TriedEdgesMiddleware
from raptix.orchestration.mission.handoff import claim_lease
from raptix.orchestration.mission.task_state import (
    TaskStateRefused,
    fold_task_budget,
    read_task_state,
)
from raptix.runtime.recording import (
    NonReplayableRecord,
    RecordingMiddleware,
    RecordModeError,
    open_replay,
    wrap_summary_model,
)


def _runtime(thread="one"):
    return SimpleNamespace(
        state={"workspace_path": "/workspace", "objectives": [{"id": "A", "title": "offline"}]},
        config={"configurable": {"thread_id": thread}},
        tool_call_id="call",
    )


def _dispatch(backend):
    return DispatchMiddleware(
        backend=backend,
        subagents=[
            {
                "name": "worker",
                "description": "offline",
                "runnable": RunnableLambda(lambda state: {"messages": [AIMessage(content="done")]}),
            }
        ],
    )


def test_threads_cannot_renew_each_others_invocation_lease(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_TASK_HANDOFF", "1")
    middleware = _dispatch(FilesystemBackend(root_dir=tmp_path, virtual_mode=True))
    first = middleware._prepare("work", "worker", _runtime("one"), "A", "same")
    second = middleware._prepare("work", "worker", _runtime("two"), "A", "same")
    assert isinstance(first, tuple) and isinstance(second, Command)
    updates = second.update or {}
    assert "handoff_lease_held" in updates["messages"][0].content


def test_busy_lease_writer_refuses_dispatch_without_side_effects(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_TASK_HANDOFF", "1")
    middleware = _dispatch(FilesystemBackend(root_dir=tmp_path, virtual_mode=True))
    assert middleware._task_io._slots.acquire(blocking=False)
    assert middleware._task_io._slots.acquire(blocking=False)
    try:
        prepared = middleware._prepare("work", "worker", _runtime(), "A", "busy")
        assert isinstance(prepared, Command)
        assert not middleware._active
    finally:
        middleware._task_io._slots.release()
        middleware._task_io._slots.release()


def test_old_owner_cannot_fold_or_account_after_handover(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_TASK_HANDOFF", "1")
    monkeypatch.setenv("RAPTIX_DISPATCH_HANDOFF", "1")
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    old = DispatchContext("old", "A", 1)
    claim_lease(backend, "A", token=old.lease_token, now=1000, ttl_s=1)
    claim_lease(backend, "A", token="new", now=1002)
    _dispatch(backend)._merge_task_state(_runtime(), old, {"status": "success"}, None)
    token = active_dispatch.set(old)
    try:
        with pytest.raises(TaskStateRefused, match="owner changed"):
            fold_task_budget(backend, "A", input_tokens=10)
    finally:
        active_dispatch.reset(token)
    saved = read_task_state(backend, "A").state
    assert saved is not None and saved.budget.input_tokens == 0 and saved.applied_dispatches == []


_CHILD_CLAIM = """
import json, sys
from pathlib import Path
repo = Path(__REPO__)
sys.path[:0] = [str(repo), *[str(repo / "packages" / name) for name in ("raptix", "raptix-core", "raptix-sdk")]]
from deepagents.backends.filesystem import FilesystemBackend
from raptix.orchestration.mission.handoff import claim_lease
backend = FilesystemBackend(root_dir=Path(sys.argv[1]), virtual_mode=True)
print(json.dumps({"reason": claim_lease(backend, "A", token=sys.argv[2])}))
"""


def _child_claim(root: str, token: str) -> str | None:
    repo = str(Path(__file__).resolve().parents[5])
    script = _CHILD_CLAIM.replace("__REPO__", repr(repo))
    completed = subprocess.run(
        [sys.executable, "-c", script, root, token],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])["reason"]


def test_filesystem_lease_is_exclusive_across_processes(tmp_path):
    from raptix.orchestration.mission.task_transaction import task_transaction

    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    path = "/workspace/plan/task-state/A.json"
    with task_transaction(path, backend):
        blocked = _child_claim(str(tmp_path), "child-blocked")
    free = _child_claim(str(tmp_path), "child-free")
    assert blocked is not None
    assert free is None


@pytest.mark.parametrize("changes", ["kg", "tail", "command"])
def test_progress_tracks_real_input_or_result_changes(tmp_path, monkeypatch, changes):
    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    middleware = TriedEdgesMiddleware(store=None, role="worker")
    request = SimpleNamespace(
        state={"engagement_name": "offline", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="synthetic"),
        tool_call={"id": "one", "args": {}},
    )
    for index in range(12):
        request.state["kg_revision"] = index if changes == "kg" else 0
        if changes == "command":
            request.tool_call["args"] = {"parameter": index}
        reply = ToolMessage(
            content="x" * 4096 + str(index) if changes == "tail" else "same", tool_call_id="one"
        )
        assert middleware.wrap_tool_call(request, lambda req, reply=reply: reply) is reply
    assert bool(middleware._progress_text(request)) == (changes == "command")


def test_slow_progress_io_is_bounded_and_does_not_replace_result(tmp_path, monkeypatch):
    import threading

    monkeypatch.setenv("RAPTIX_PROGRESS_OBSERVE", "1")
    monkeypatch.setattr("raptix.middleware.execution_ledger._MAX_SECONDS", 0.1)
    gate = threading.Event()

    class StalledBackend(FilesystemBackend):
        def read(self, *args, **kwargs):
            gate.wait(2)
            return super().read(*args, **kwargs)

    observer = TriedEdgesMiddleware(
        store=None, role="worker", backend=StalledBackend(root_dir=tmp_path, virtual_mode=True)
    )
    request = SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="synthetic"),
        tool_call={"id": "one", "args": {}},
    )
    reply = ToolMessage(content="done", tool_call_id="one")
    started = time.monotonic()
    try:
        assert observer.wrap_tool_call(request, lambda req: reply) is reply
        assert time.monotonic() - started < 0.5
    finally:
        gate.set()


def test_record_modes_cannot_be_mixed_and_any_redacted_marker_refuses_replay(tmp_path, monkeypatch):
    path = tmp_path / "mixed.jsonl"
    path.write_text('{"kind":"model_call","req_hash":"fake","response":{}}\n', encoding="utf-8")
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_LEVEL", "redacted")
    with pytest.raises(RecordModeError):
        RecordingMiddleware(path=path)
    with path.open("a", encoding="utf-8") as handle:
        handle.write('{"kind":"record_header","replayable":false}\n')
    with pytest.raises(NonReplayableRecord):
        open_replay(path)


def test_failed_summary_retains_identity_and_records_error(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(tmp_path / "record.jsonl"))

    class ProviderFailure:
        def invoke(self, *args, **kwargs):
            raise RuntimeError("synthetic provider unavailable")

    with pytest.raises(RuntimeError):
        wrap_summary_model(ProviderFailure(), role="worker").invoke("offline")
    rows = [
        json.loads(line)
        for line in (tmp_path / "record.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert rows[0]["kind"] == "summary_call" and rows[0]["attempt_id"]
    assert rows[0]["response"]["type"] == "error"


def test_http_sdk_retry_attempts_are_recorded_without_changing_retry_policy(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(tmp_path / "record.jsonl"))
    calls = []

    def upstream(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(500, json={"error": {"message": "synthetic unavailable"}})
        return httpx.Response(
            200,
            json={
                "id": "offline",
                "object": "chat.completion",
                "created": 0,
                "model": "served",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "done"},
                    }
                ],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            },
        )

    with httpx.Client(transport=httpx.MockTransport(upstream)) as client:
        model = _ProxiedChatOpenAI(
            model="offline",
            api_key="synthetic-key",
            base_url="http://offline/v1",
            http_client=client,
            max_retries=1,
        )
        recorder = RecordingMiddleware(path=tmp_path / "record.jsonl")
        request = ModelRequest(model=model, messages=[HumanMessage(content="offline")], state={})
        response = recorder.wrap_model_call(request, lambda req: req.model.invoke(req.messages))
    assert response.content == "done"
    rows = [
        json.loads(line)
        for line in (tmp_path / "record.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    attempts = [row for row in rows if row["kind"] == "upstream_attempt"]
    assert [row["http_status"] for row in attempts] == [500, 200]
    assert len({row["logical_call_id"] for row in rows}) == 1
    assert "synthetic-key" not in (tmp_path / "record.jsonl").read_text(encoding="utf-8")


def test_compaction_epoch_reloads_skills_without_changing_tool_schema(monkeypatch):
    from raptix.middleware.skillogy import _make_load_skill_tool

    monkeypatch.setenv("RAPTIX_SKILL_DEDUPE_SCOPE", "thread")

    class Skills:
        def load_skill(self, path):
            return {"path": path, "name": "offline", "body": "recoverable skill body"}

    loader = _make_load_skill_tool(Skills())
    invoke = RunnableLambda(
        lambda epoch: loader.func(
            "/skills/offline/SKILL.md", runtime=SimpleNamespace(state={"context_epoch": epoch})
        )
    )
    config = {"configurable": {"thread_id": "skill-epoch"}}
    assert "recoverable skill body" in invoke.invoke(0, config)
    assert "already_loaded" in invoke.invoke(0, config)
    assert "recoverable skill body" in invoke.invoke(1, config)
    assert set(loader.args) == {"name_or_path", "force"}
