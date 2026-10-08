"""Whole-wave context regressions through the actual compaction/masking seams."""

import json
import re
from types import SimpleNamespace

import pytest
from deepagents.backends import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import Field

from raptix.intelligence.agents.middleware_slots import _make_summarization
from raptix.intelligence.context.masking import mask_messages
from raptix.intelligence.context.summary_contract import validate_structured_summary
from raptix.orchestration.mission.task_state import (
    EvidenceRef,
    TaskState,
    read_task_state,
    write_task_state,
)

HEADERS = "## SESSION INTENT\ngo\n## SUMMARY\nwork\n## ARTIFACTS\nNone\n## NEXT STEPS\ncontinue"


@pytest.fixture(autouse=True)
def clear_context_flags(monkeypatch):
    for name in (
        "RAPTIX_TRANSACTIONAL_COMPACTION",
        "RAPTIX_SUMMARY_STRUCTURED",
        "RAPTIX_CONTEXT_ASSEMBLY",
        "RAPTIX_CONTEXT_MANIFEST",
        "RAPTIX_CONTEXT_MASK",
    ):
        monkeypatch.delenv(name, raising=False)


def test_structured_prompt_can_be_formatted_by_real_summary_helper(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_SUMMARY_STRUCTURED", "1")
    slot = _make_summarization(
        backend=CompositeBackend(
            default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), routes={}
        ),
        llm=GenericFakeChatModel(messages=iter([])),
    )
    formatted = slot._inner._lc_helper.summary_prompt.format(messages="synthetic history")
    assert '"completed_work"' in formatted


def test_unknown_action_is_rejected_even_when_ledger_is_empty(tmp_path):
    payload = {
        "completed_work": [],
        "evidence": [],
        "failed_attempts": [
            {
                "action_hash": "a" * 64,
                "reason": "failed",
                "retry_condition": "changed input",
            }
        ],
        "unresolved": [],
        "hypotheses": [],
    }
    ok, errors = validate_structured_summary(
        HEADERS + "\n```json\n" + json.dumps(payload) + "\n```",
        action_hashes=[],
        backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True),
    )
    assert not ok, errors


def test_reused_message_id_cannot_return_a_pointer_to_different_content(tmp_path):
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    for character in ("a", "b"):
        original = character * 5000
        messages = [ToolMessage(original, tool_call_id="t", id="reused"), HumanMessage("later")]
        masked, count = mask_messages(messages, backend=backend, after_turns=1, min_chars=100)
        assert count == 1
        match = re.search(r"-> ([^\]]+)\]", masked[0].content)
        assert match is not None
        ref = match.group(1)
        saved = backend.read(ref, limit=10_000).file_data
        assert saved is not None
        assert saved["content"] == original


@pytest.mark.parametrize("marker", ["[RUNNING]", "[DONE]", "[AGENT_HALTED]", "[Exit code: 0]"])
def test_masking_keeps_status_bearing_messages_intact(tmp_path, marker):
    message = ToolMessage(marker + "x" * 5000, tool_call_id="t")
    masked, count = mask_messages(
        [message, HumanMessage("later")],
        backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True),
        after_turns=1,
        min_chars=100,
    )
    assert count == 0
    assert masked[0] is message


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_unrecoverable_compaction_never_reaches_downstream(
    tmp_path, monkeypatch, asynchronous
):
    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "1")
    backend = CompositeBackend(
        default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), routes={}
    )
    model = GenericFakeChatModel(messages=iter([AIMessage(content=HEADERS)]))
    slot = _make_summarization(backend=backend, llm=model)
    # Real deepagents offload cannot resolve a workspace; it produces no pointer.
    messages = [
        HumanMessage("important work", id="work"),
        AIMessage("evidence", id="e"),
        HumanMessage("continue", id="next"),
    ]
    request = ModelRequest(
        model=model,
        messages=messages,
        tools=[],
        state={"messages": messages},
        runtime=SimpleNamespace(config={}, context=None, store=None, stream_writer=None),
    )
    seen = []

    def handler(request):
        seen.append(request)
        return ModelResponse(result=[AIMessage("done")])

    async def ahandler(request):
        return handler(request)

    result = (
        await slot.awrap_model_call(request, ahandler)
        if asynchronous
        else slot.wrap_model_call(request, handler)
    )
    assert len(seen) == 1
    assert seen[0].messages == messages
    command = getattr(result, "command", None)
    assert command is None or "_summarization_event" not in command.update


def test_revision_change_during_real_summary_generation_uses_uncompacted_request(
    tmp_path, monkeypatch
):
    from raptix.middleware.filesystem import EngagementFilesystemBackend

    monkeypatch.setenv("RAPTIX_TRANSACTIONAL_COMPACTION", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "1")
    storage = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    scoped = EngagementFilesystemBackend(storage, "/workspace/lab")
    write_task_state(scoped, TaskState(objective_id="A", state_revision=1))

    def summary():
        write_task_state(scoped, TaskState(objective_id="A", state_revision=2))
        yield AIMessage(HEADERS)

    model = GenericFakeChatModel(messages=summary())
    slot = _make_summarization(backend=CompositeBackend(default=storage, routes={}), llm=model)
    messages = [
        HumanMessage("work", id="w"),
        AIMessage("evidence", id="e"),
        HumanMessage("continue", id="c"),
    ]
    request = ModelRequest(
        model=model,
        messages=messages,
        tools=[],
        state={
            "messages": messages,
            "active_objective_id": "A",
            "workspace_path": "/workspace/lab",
        },
        runtime=SimpleNamespace(config={}, context=None, store=None, stream_writer=None),
    )
    seen = []
    result = slot.wrap_model_call(
        request, lambda request: seen.append(request) or ModelResponse(result=[AIMessage("done")])
    )
    assert len(seen) == 1 and seen[0].messages == messages
    assert getattr(result, "command", None) is None


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_real_graph_commits_valid_structured_summary_masks_tail_and_reads_every_ref(
    tmp_path, monkeypatch, asynchronous
):
    import hashlib
    from typing import NotRequired

    from langchain.agents import AgentState, create_agent
    from langgraph.checkpoint.memory import InMemorySaver

    from raptix.intelligence.agents.build import build_middleware
    from raptix.middleware.filesystem import EngagementFilesystemBackend
    from raptix_core.contracts.slots import MiddlewareSlot as Slot

    for flag in (
        "RAPTIX_TRANSACTIONAL_COMPACTION",
        "RAPTIX_SUMMARY_STRUCTURED",
        "RAPTIX_CONTEXT_ASSEMBLY",
        "RAPTIX_CONTEXT_MASK",
        "RAPTIX_CONTEXT_MANIFEST",
    ):
        monkeypatch.setenv(flag, "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "0")
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK_AFTER_TURNS", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_MASK_MIN_CHARS", "100")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "6")
    storage = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    scoped = EngagementFilesystemBackend(storage, "/workspace/lab")
    ref = "/workspace/evidence/scan.txt"
    scoped.write(ref, "synthetic evidence")
    write_task_state(
        scoped,
        TaskState(
            objective_id="A",
            state_revision=3,
            evidence_refs=[
                EvidenceRef(ref=ref, sha256=hashlib.sha256(b"synthetic evidence").hexdigest())
            ],
        ),
    )
    payload = {
        "completed_work": [{"ref": ref, "evidence": True}],
        "evidence": [{"ref": ref}],
        "failed_attempts": [],
        "unresolved": [{"summary": "continue"}],
        "hypotheses": [],
    }
    summary = HEADERS + "\n```json\n" + json.dumps(payload) + "\n```"

    class WorkspaceState(AgentState):
        workspace_path: NotRequired[str]
        active_objective_id: NotRequired[str]

    class Capture(GenericFakeChatModel):
        seen: list = Field(default_factory=list)

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.seen.append(list(messages))
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    model = Capture(messages=iter([AIMessage(summary), AIMessage("done")]))
    backend = CompositeBackend(default=storage, routes={})
    agent = create_agent(
        model,
        system_prompt="mandatory guardrail",
        state_schema=WorkspaceState,
        middleware=build_middleware(
            role="recon",
            backend=backend,
            llm=model,
            slots=frozenset({Slot.SUMMARIZATION, Slot.CONTEXT_MANIFEST}),
        ),
        checkpointer=InMemorySaver(),
    )
    raw_output = "synthetic output " * 500
    messages = [
        HumanMessage("recover this knowledge", id="m0"),
        AIMessage("prior", id="m1"),
        HumanMessage("work", id="m2"),
        AIMessage(content="", id="m3", tool_calls=[{"name": "already_ran", "args": {}, "id": "t"}]),
        ToolMessage(raw_output, tool_call_id="t", id="m4"),
        AIMessage("observed", id="m5"),
        HumanMessage("continue", id="m6"),
    ]
    config = {"configurable": {"thread_id": "whole-c"}}
    initial = {"messages": messages, "workspace_path": "/workspace/lab", "active_objective_id": "A"}
    if asynchronous:
        await agent.ainvoke(initial, config)
    else:
        agent.invoke(initial, config)
    saved = agent.get_state(config).values
    assert saved["context_epoch"] == 1
    event = saved["_summarization_event"]
    assert event["source_revision"] == 3
    assert event["source_messages_hash"]
    history = scoped.read(event["file_path"], limit=10_000).file_data
    assert history is not None and "recover this knowledge" in history["content"]
    main_view = model.seen[-1]
    masked = [
        message
        for message in main_view
        if isinstance(message, ToolMessage) and "[masked tool output:" in message.content
    ]
    assert masked
    match = re.search(r"-> ([^\]]+)\]", masked[0].content)
    assert match is not None
    recovered = scoped.read(match.group(1), limit=10_000).file_data
    assert recovered is not None and recovered["content"] == raw_output
    assert (
        next(message.content for message in saved["messages"] if message.id == "m4") == raw_output
    )
    assert scoped.read(ref).error is None


@pytest.mark.parametrize("invalid", ["verified", "extra"])
def test_structured_completion_cannot_smuggle_unbacked_fields(tmp_path, invalid):
    payload = {
        "completed_work": [{"ref": "pretend", "evidence": True, invalid: True}],
        "evidence": [],
        "failed_attempts": [],
        "unresolved": [],
        "hypotheses": ["pretend"],
    }
    ok, _ = validate_structured_summary(
        HEADERS + "\n```json\n" + json.dumps(payload) + "\n```",
        backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True),
    )
    assert not ok


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_fresh_worker_continues_from_files_after_compaction_masking_and_history_wipe(
    tmp_path, monkeypatch, asynchronous
):
    from typing import NotRequired

    from langchain.agents import AgentState, create_agent
    from langchain_core.messages import RemoveMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph.message import REMOVE_ALL_MESSAGES

    from raptix.intelligence.agents.build import build_middleware
    from raptix.middleware.filesystem import EngagementFilesystemBackend
    from raptix_core.contracts.slots import MiddlewareSlot as Slot

    for flag in (
        "RAPTIX_TASK_STATE",
        "RAPTIX_EXECUTION_LEDGER",
        "RAPTIX_DISPATCH_HANDOFF",
        "RAPTIX_TRANSACTIONAL_COMPACTION",
        "RAPTIX_SUMMARY_STRUCTURED",
        "RAPTIX_CONTEXT_ASSEMBLY",
        "RAPTIX_CONTEXT_MASK",
        "RAPTIX_CONTEXT_MANIFEST",
    ):
        monkeypatch.setenv(flag, "1")
    for name, value in {
        "RAPTIX_CONTEXT_BUDGET_TOKENS": "0",
        "RAPTIX_SUMMARIZATION_TRIGGER_TOKENS": "1",
        "RAPTIX_SUMMARIZATION_KEEP_MESSAGES": "3",
        "RAPTIX_CONTEXT_MASK_AFTER_TURNS": "1",
        "RAPTIX_CONTEXT_MASK_MIN_CHARS": "100",
    }.items():
        monkeypatch.setenv(name, value)
    storage = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    scoped = EngagementFilesystemBackend(storage, "/workspace/lab")
    actions = []

    @tool
    def record_step(step: str) -> str:
        """Execute a synthetic step exactly once and save evidence."""
        assert step not in actions
        actions.append(step)
        assert scoped.write(f"/workspace/evidence/{step}.txt", step).error is None
        return step + "\n" + "synthetic observation " * 200

    @tool
    def inspect_saved(step: str) -> str:
        """Read persisted evidence without repeating the action."""
        saved = scoped.read(f"/workspace/evidence/{step}.txt").file_data
        assert saved is not None
        return saved["content"]

    class Worker(GenericFakeChatModel):
        views: list = Field(default_factory=list)
        summaries: int = 0

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            last = messages[-1]
            if isinstance(last, HumanMessage) and "Context Extraction Assistant" in last.content:
                self.summaries += 1
                empty = {
                    key: []
                    for key in (
                        "completed_work",
                        "evidence",
                        "failed_attempts",
                        "unresolved",
                        "hypotheses",
                    )
                }
                reply = AIMessage(HEADERS + "\n```json\n" + json.dumps(empty) + "\n```")
            elif isinstance(last, ToolMessage) and last.name == "record_step":
                step = str(last.content).split("\n", 1)[0]
                reply = AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "inspect_saved", "args": {"step": step}, "id": "inspect-" + step}
                    ],
                )
            elif isinstance(last, ToolMessage):
                self.views.append(messages)
                step = str(last.content)
                reply = AIMessage(
                    json.dumps(
                        {
                            "objective_id": "OBJ-001",
                            "outcome": "success",
                            "evidence_refs": [{"ref": f"/workspace/evidence/{step}.txt"}],
                            "continuation": {
                                "next_steps": ["execute second"] if step == "first" else []
                            },
                            "budget_delta": {"model_calls": 4},
                        }
                    )
                )
            else:
                self.views.append(messages)
                step = "second" if "first.txt" in str(last.content) else "first"
                reply = AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "record_step", "args": {"step": step}, "id": "record-" + step}
                    ],
                )
            return ChatResult(generations=[ChatGeneration(message=reply)])

    class ToolModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):
            return self

    class WorkspaceState(AgentState):
        workspace_path: NotRequired[str]

    worker = Worker(messages=iter([]))
    backend = CompositeBackend(default=storage, routes={})
    child = create_agent(
        worker,
        tools=[record_step, inspect_saved],
        state_schema=WorkspaceState,
        middleware=build_middleware(
            role="recon",
            backend=backend,
            llm=worker,
            slots=frozenset({Slot.EXECUTION_LEDGER, Slot.SUMMARIZATION, Slot.CONTEXT_MANIFEST}),
        ),
    )

    def call(name, args):
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": name}])

    parent_model = ToolModel(
        messages=iter(
            [
                call("load_opplan", {"workspace_path": "/workspace/lab"}),
                call(
                    "add_objective",
                    {
                        "title": "two persisted steps",
                        "phase": "recon",
                        "description": "synthetic",
                        "acceptance_criteria": ["two evidence files"],
                        "priority": 1,
                    },
                ),
                call("update_objective", {"objective_id": "OBJ-001", "status": "in-progress"}),
                call(
                    "task",
                    {
                        "objective_id": "OBJ-001",
                        "subagent_type": "recon",
                        "dispatch_id": "first",
                        "description": "execute first",
                    },
                ),
                AIMessage("checkpoint"),
                call(
                    "task",
                    {
                        "objective_id": "OBJ-001",
                        "subagent_type": "recon",
                        "dispatch_id": "second",
                        "description": "resume persisted state",
                    },
                ),
                AIMessage("done"),
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
            slots=frozenset(
                {Slot.OPPLAN, Slot.SUBAGENT, Slot.EXECUTION_LEDGER, Slot.CONTEXT_MANIFEST}
            ),
            subagents=[{"name": "recon", "description": "synthetic worker", "runnable": child}],
        ),
    )
    config = {"configurable": {"thread_id": "resume-c", "workspace_path": "/workspace/lab"}}
    if asynchronous:
        await parent.ainvoke({"messages": [HumanMessage("old history")]}, config)
        await parent.aupdate_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        await parent.ainvoke({"messages": [HumanMessage("continue")]}, config)
    else:
        parent.invoke({"messages": [HumanMessage("old history")]}, config)
        parent.update_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        parent.invoke({"messages": [HumanMessage("continue")]}, config)
    assert actions == ["first", "second"]
    assert worker.summaries >= 2
    assert any(
        "[masked tool output:" in str(message.content) for view in worker.views for message in view
    )
    persisted = read_task_state(scoped, "OBJ-001").state
    assert persisted is not None and persisted.budget.attempts == 2
    assert persisted.budget.model_calls == 8
    assert len(persisted.evidence_refs) == 2
    assert parent.get_state(config).values["objectives"][0]["status"] == "in-progress"
