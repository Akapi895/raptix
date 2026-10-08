"""Wave B persistence and handoff exercised against a real filesystem backend."""

import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import NotRequired

import pytest
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents import AgentState, create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from pydantic import Field

from raptix.core.dispatch_context import DispatchContext
from raptix.intelligence.agents.build import build_middleware
from raptix.middleware.dispatch import DispatchMiddleware
from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware
from raptix.orchestration.mission.task_state import (
    TaskState,
    persist_task_state_for_objectives,
    read_task_state,
    task_state_path,
    write_task_state,
)
from raptix_core.contracts.slots import MiddlewareSlot as Slot
from raptix_core.types.dispatch_outcome import DispatchFailureOutcome


@pytest.fixture
def backend(tmp_path):
    return FilesystemBackend(root_dir=tmp_path, virtual_mode=True)


@pytest.fixture(autouse=True)
def no_live_sandbox(monkeypatch):
    def unexpected_transport(*args, **kwargs):
        raise AssertionError("filesystem-backed tests must not create an HTTP transport")

    monkeypatch.setattr(
        "raptix.execution.backends.factory.build_sandbox_backend", unexpected_transport
    )


@pytest.fixture
def enabled(monkeypatch):
    for flag in ("RAPTIX_TASK_STATE", "RAPTIX_EXECUTION_LEDGER", "RAPTIX_DISPATCH_HANDOFF"):
        monkeypatch.setenv(flag, "1")


def _runtime():
    return SimpleNamespace(
        state={"workspace_path": "/workspace", "objectives": [{"id": "A", "title": "task"}]},
        config={"configurable": {"thread_id": "thread"}},
        tool_call_id="dispatch-call",
    )


def _dispatch(backend):
    return DispatchMiddleware(
        backend=backend,
        subagents=[
            {
                "name": "worker",
                "description": "test",
                "runnable": RunnableLambda(lambda state: {"messages": [AIMessage(content="done")]}),
            }
        ],
    )


def test_handoff_reads_construction_backend_with_only_thread_config(backend, enabled):
    write_task_state(backend, TaskState(objective_id="A", state_revision=7))
    description = _dispatch(backend)._handoff_description("continue", _runtime(), "A")
    assert "Task-state revision: 7" in description


def test_distinct_dispatches_accumulate_attempts(backend, enabled):
    middleware = _dispatch(backend)
    middleware._task_state_backend = backend
    runtime = _runtime()
    middleware._finish("done", DispatchContext("first", "A", 1), "first", runtime)
    middleware._finish("done", DispatchContext("second", "A", 1), "second", runtime)
    persisted = read_task_state(backend, "A").state
    assert persisted is not None
    assert persisted.budget.attempts == 2


def test_child_failure_without_raised_exception_is_persisted_as_failed(backend, enabled):
    middleware = _dispatch(backend)
    middleware._task_state_backend = backend
    context = DispatchContext("failed", "A", 1)
    context.failures.append(
        DispatchFailureOutcome(
            dispatch_id="failed",
            objective_id="A",
            consecutive_failure_count=1,
            error_type="RuntimeError",
            error_message="worker stopped",
        )
    )
    middleware._finish(None, context, "fingerprint", _runtime())
    persisted = read_task_state(backend, "A").state
    assert persisted is not None
    assert persisted.decision_record[-1].outcome == "failed"


def test_handoff_read_failure_does_not_reserve_dispatch_forever(backend, enabled):
    def unavailable(*args, **kwargs):
        raise OSError("backend unavailable")

    backend.read = unavailable
    middleware = _dispatch(backend)
    middleware._task_state_backend = backend
    runtime = _runtime()
    prepared = middleware._prepare("continue", "worker", runtime, "A", "dispatch")
    assert isinstance(prepared, tuple)
    middleware._release(prepared[1])
    assert not middleware._active


def test_corrupt_state_is_never_overwritten_as_empty(backend, enabled):
    path = task_state_path("A")
    backend.write(path, "{broken")
    persist_task_state_for_objectives(backend, [{"id": "A", "status": "in-progress"}])
    assert backend.read(path).file_data["content"] == "{broken"


def test_stale_writer_cannot_replace_newer_revision(backend):
    write_task_state(backend, TaskState(objective_id="A", state_revision=5))
    error = write_task_state(backend, TaskState(objective_id="A", state_revision=2))
    assert error is not None
    persisted = read_task_state(backend, "A").state
    assert persisted is not None
    assert persisted.state_revision == 5


def test_nonzero_exit_is_a_failed_receipt(backend, enabled):
    middleware = ExecutionLedgerMiddleware(role="worker", backend=backend)
    request = SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="bash"),
        tool_call={"name": "bash", "id": "call", "args": {"command": "synthetic action"}},
    )
    reply = ToolMessage(content="failed\n[Exit code: 2]", tool_call_id="call")
    assert middleware.wrap_tool_call(request, lambda request: reply) is reply
    entries = [
        json.loads(line)
        for line in backend.read("/workspace/plan/task-state/A.ledger.jsonl")
        .file_data["content"]
        .splitlines()
    ]
    assert entries[-1]["kind"] == "failed"


def test_backend_exception_is_reported_by_reader(backend):
    def unavailable(*args, **kwargs):
        raise OSError("backend unavailable")

    backend.read = unavailable
    bundle = read_task_state(backend, "A")
    assert bundle.state is None
    assert bundle.error


class WorkspaceState(AgentState):
    workspace_path: NotRequired[str]


class ToolModel(GenericFakeChatModel):
    descriptions: list[str] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self


class ContinuationModel(ToolModel):
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        from langchain_core.outputs import ChatGeneration, ChatResult

        last = messages[-1]
        if isinstance(last, ToolMessage):
            step = str(last.content)
            response = AIMessage(
                content=json.dumps(
                    {
                        "objective_id": "OBJ-001",
                        "outcome": "success",
                        "evidence_refs": [
                            {
                                "ref": f"/workspace/evidence/{step}.txt",
                                "sha256": hashlib.sha256(step.encode()).hexdigest(),
                            }
                        ],
                        "continuation": {
                            "next_steps": ["execute second"] if step == "first" else []
                        },
                        "budget_delta": {"model_calls": 2, "input_tokens": 10, "wall_clock_s": 0.1},
                    }
                )
            )
        else:
            description = str(last.content)
            self.descriptions.append(description)
            step = "second" if "first.txt" in description else "first"
            response = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "record_step",
                        "args": {"step": step},
                        "id": f"record-{step}",
                    }
                ],
            )
        return ChatResult(generations=[ChatGeneration(message=response)])


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_real_agent_resumes_from_files_after_history_wipe(backend, enabled, asynchronous):
    actions = []

    @tool
    def record_step(step: str) -> str:
        """Record one synthetic stateful action and its evidence."""
        actions.append(step)
        result = backend.write(f"/workspace/lab/evidence/{step}.txt", step)
        assert result.error is None
        return step

    worker_model = ContinuationModel(messages=iter([]))
    child = create_agent(
        worker_model,
        tools=[record_step],
        state_schema=WorkspaceState,
        middleware=build_middleware(
            role="recon",
            backend=backend,
            llm=worker_model,
            slots=frozenset({Slot.EXECUTION_LEDGER}),
        ),
    )

    def call(name, args, identifier):
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": identifier}])

    parent_model = ToolModel(
        messages=iter(
            [
                call("load_opplan", {"workspace_path": "/workspace/lab"}, "load"),
                call(
                    "add_objective",
                    {
                        "title": "Two synthetic steps",
                        "phase": "recon",
                        "description": "persist evidence",
                        "acceptance_criteria": ["two files exist"],
                        "priority": 1,
                    },
                    "add",
                ),
                call(
                    "update_objective",
                    {"objective_id": "OBJ-001", "status": "in-progress"},
                    "start",
                ),
                call(
                    "task",
                    {
                        "description": "perform first step",
                        "subagent_type": "recon",
                        "objective_id": "OBJ-001",
                        "dispatch_id": "first-dispatch",
                    },
                    "first-dispatch",
                ),
                AIMessage(content="checkpoint"),
                call(
                    "task",
                    {
                        "description": "resume only persisted work",
                        "subagent_type": "recon",
                        "objective_id": "OBJ-001",
                        "dispatch_id": "second-dispatch",
                    },
                    "second-dispatch",
                ),
                AIMessage(content="finished synthetic continuation"),
            ]
        )
    )
    parent = create_agent(
        parent_model,
        checkpointer=InMemorySaver(),
        middleware=build_middleware(
            role="raptix",
            backend=backend,
            llm=parent_model,
            slots=frozenset({Slot.SUBAGENT, Slot.OPPLAN, Slot.EXECUTION_LEDGER}),
            subagents=[{"name": "recon", "description": "synthetic worker", "runnable": child}],
        ),
    )
    config = {
        "configurable": {"thread_id": "persistent-parent", "workspace_path": "/workspace/lab"}
    }
    first_input = {"messages": [HumanMessage(content="old history that must disappear")]}
    if asynchronous:
        await parent.ainvoke(first_input, config)
        await parent.aupdate_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        await parent.ainvoke({"messages": [HumanMessage(content="continue")]}, config)
    else:
        parent.invoke(first_input, config)
        parent.update_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        parent.invoke({"messages": [HumanMessage(content="continue")]}, config)
    assert actions == ["first", "second"]
    assert "first.txt" in worker_model.descriptions[-1]
    assert "execute second" in worker_model.descriptions[-1]
    assert "old history that must disappear" not in worker_model.descriptions[-1]
    from raptix.middleware.filesystem import EngagementFilesystemBackend

    scoped = EngagementFilesystemBackend(backend, "/workspace/lab")
    persisted = read_task_state(scoped, "OBJ-001").state
    assert persisted is not None
    assert persisted.budget.attempts == 2
    assert persisted.budget.model_calls == 4
    assert persisted.budget.input_tokens == 20
    assert len(persisted.evidence_refs) == 2
    for reference in persisted.evidence_refs:
        saved = scoped.read(reference.ref).file_data
        assert saved is not None
        content = saved["content"]
        assert hashlib.sha256(content.encode()).hexdigest() == reference.sha256
    # A successful dispatch must not turn an OPPLAN objective into a completed one.
    assert persisted.work_state.status.value == "running"
    assert parent.get_state(config).values["objectives"][0]["status"] == "in-progress"
    assert parent.get_state(config).values.get("worker_result") in (None, {})


def test_concurrent_receipts_preserve_both_lifecycles(backend, enabled):
    middleware = ExecutionLedgerMiddleware(role="worker", backend=backend)

    def execute(index):
        request = SimpleNamespace(
            state={"workspace_path": "/workspace", "active_objective_id": "A"},
            runtime=None,
            tool=SimpleNamespace(name="synthetic"),
            tool_call={"id": str(index), "args": {"index": index}},
        )
        reply = ToolMessage(content="done", tool_call_id=str(index))
        return middleware.wrap_tool_call(request, lambda request: reply)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert len(list(pool.map(execute, [1, 2]))) == 2
    entries = [
        json.loads(line)
        for line in backend.read("/workspace/plan/task-state/A.ledger.jsonl")
        .file_data["content"]
        .splitlines()
    ]
    assert len(entries) == 6
    assert len({entry["receipt_id"] for entry in entries}) == 2


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_stalled_receipts_are_bounded_and_tool_runs_once(
    backend, enabled, monkeypatch, asynchronous
):
    gate = threading.Event()
    original_read = backend.read

    def stalled(*args, **kwargs):
        assert gate.wait(5)
        return original_read(*args, **kwargs)

    backend.read = stalled
    monkeypatch.setattr("raptix.middleware.execution_ledger._MAX_SECONDS", 0.1)
    middleware = ExecutionLedgerMiddleware(role="worker", backend=backend)
    request = SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="synthetic"),
        tool_call={"id": "one", "args": {}},
    )
    reply = ToolMessage(content="done", tool_call_id="one")
    calls = []

    def downstream(request):
        calls.append(request)
        return reply

    async def adownstream(request):
        return downstream(request)

    started = time.monotonic()
    try:
        result = (
            await middleware.awrap_tool_call(request, adownstream)
            if asynchronous
            else middleware.wrap_tool_call(request, downstream)
        )
        assert result is reply
        assert calls == [request]
        assert time.monotonic() - started < 1
    finally:
        gate.set()
    # Wait for the two bounded writers to release their capacity after unblocking I/O.
    deadline = time.monotonic() + 1
    while middleware._slots._value != 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert middleware._slots._value == 2


@pytest.mark.parametrize("flag", ["0", "1"])
async def test_recorded_tool_replays_with_flags_off_and_on(backend, monkeypatch, tmp_path, flag):
    from raptix.runtime.recording import RecordingMiddleware, ReplayMiddleware

    for name in ("RAPTIX_TASK_STATE", "RAPTIX_EXECUTION_LEDGER", "RAPTIX_DISPATCH_HANDOFF"):
        monkeypatch.setenv(name, flag)
    request = SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="synthetic"),
        tool_call={"name": "synthetic", "id": "recorded", "args": {}},
    )
    reply = ToolMessage(content="recorded result", tool_call_id="recorded")
    recorder = RecordingMiddleware(path=tmp_path / "replay.jsonl")
    recorder.wrap_tool_call(request, lambda request: reply)
    assert recorder._sink is not None
    recorder._sink.close()
    replay = ReplayMiddleware(path=tmp_path / "replay.jsonl", strict=True)
    middleware = ExecutionLedgerMiddleware(role="worker", backend=backend)

    async def live_tool(request):
        raise AssertionError("replay must not execute live actions")

    async def replayed(request):
        return await replay.awrap_tool_call(request, live_tool)

    result = await middleware.awrap_tool_call(request, replayed)
    assert result.content == reply.content
    assert result.status == reply.status
    stored = backend.read("/workspace/plan/task-state/A.ledger.jsonl")
    assert bool(stored.error) == (flag == "0")


def test_duplicate_finish_does_not_double_charge(backend, enabled):
    from langgraph.types import Command

    middleware = _dispatch(backend)
    context = DispatchContext("one-dispatch", "A", 1)
    result = Command(
        update={
            "worker_result": {
                "objective_id": "A",
                "outcome": "success",
                "budget_delta": {"model_calls": 3},
            }
        }
    )
    for _ in range(2):
        middleware._finish(result, context, "fingerprint", _runtime())
    saved = read_task_state(backend, "A").state
    assert saved is not None
    assert saved.budget.attempts == 1
    assert saved.budget.model_calls == 3


def test_foreign_result_cannot_copy_evidence_or_erase_attempt(backend, enabled):
    from langgraph.types import Command

    result = Command(
        update={
            "worker_result": {
                "objective_id": "foreign",
                "outcome": "success",
                "evidence_refs": [{"ref": "foreign-data"}],
            }
        }
    )
    _dispatch(backend)._finish(result, DispatchContext("one", "A", 1), "fingerprint", _runtime())
    saved = read_task_state(backend, "A").state
    assert saved is not None
    assert saved.evidence_refs == []
    assert saved.budget.attempts == 1


def test_rolling_ledger_preserves_pending_execution(backend, enabled, monkeypatch):
    from raptix.middleware.execution_ledger import _load_entries, ledger_path

    monkeypatch.setattr("raptix.middleware.execution_ledger._MAX_ENTRIES", 7)
    middleware = ExecutionLedgerMiddleware(role="worker", backend=backend)
    request = SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": "A"},
        runtime=None,
        tool=SimpleNamespace(name="synthetic"),
        tool_call={"id": "one", "args": {}},
    )
    pending = middleware._receipt(request)
    middleware._start(request, pending)
    reply = ToolMessage(content="done", tool_call_id="one")
    for _ in range(5):
        middleware.wrap_tool_call(request, lambda request: reply)
    entries = _load_entries(backend, ledger_path("A"))
    assert len(entries) <= 7
    assert pending is not None
    assert any(entry["receipt_id"] == pending["receipt_id"] for entry in entries)


def test_scoped_state_records_opplan_and_kg_provenance(backend, enabled):
    from raptix.execution.tools.opplan import _persist_opplan_to_backend
    from raptix.middleware.filesystem import EngagementFilesystemBackend

    _persist_opplan_to_backend(
        backend,
        "/workspace/lab",
        [
            {
                "id": "A",
                "title": "task",
                "phase": "recon",
                "description": "synthetic",
                "acceptance_criteria": ["evidence exists"],
                "priority": 1,
            }
        ],
        "lab",
        "profile",
        observed_kg_revision="kg:opaque:12",
    )
    saved = read_task_state(EngagementFilesystemBackend(backend, "/workspace/lab"), "A").state
    assert saved is not None
    assert saved.last_event_id
    assert saved.observed_opplan_revision and len(saved.observed_opplan_revision) == 64
    assert saved.observed_kg_revision == "kg:opaque:12"


def test_invalid_schema_identity_and_budget_are_rejected(backend):
    path = task_state_path("A")
    backend.write(path, json.dumps({"objective_id": "B"}))
    assert read_task_state(backend, "A").error == "objective identity mismatch"
    with pytest.raises(ValueError):
        TaskState.model_validate({"objective_id": "A", "budget": {"attempts": -1}})
    with pytest.raises(ValueError):
        TaskState.model_validate({"objective_id": "A", "schema_version": "future"})
    with pytest.raises(ValueError):
        task_state_path("../other-objective")
