"""Exercise compaction, accounting, leases and recovery in one compiled pipeline."""

import hashlib
import json
from typing import NotRequired

import pytest
from deepagents.backends import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents import AgentState, create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from pydantic import Field

from raptix.intelligence.agents.build import build_middleware
from raptix.middleware.filesystem import EngagementFilesystemBackend
from raptix.orchestration.mission.task_state import (
    advance_task_state,
    read_task_state,
    write_task_state,
)
from raptix_core.contracts.slots import MiddlewareSlot as Slot


class WorkspaceState(AgentState):
    workspace_path: NotRequired[str]


class PipelineModel(GenericFakeChatModel):
    parent: bool = False
    turn: int = 0
    descriptions: list[str] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        metadata = getattr(run_manager, "metadata", {}) or {}
        if metadata.get("lc_source") == "summarization":
            summary = "\n".join(
                (
                    "## SESSION INTENT",
                    "Continue the persisted objective.",
                    "## SUMMARY",
                    "Recover evidence and decisions from WorkerInput and files.",
                    "## ARTIFACTS",
                    "/workspace/evidence/",
                    "## NEXT STEPS",
                    "Continue next step.",
                )
            )
            summary += '\n```json\n{"completed_work":[],"evidence":[],"failed_attempts":[],"unresolved":[],"hypotheses":[]}\n```'
            reply = AIMessage(content=summary)
        elif self.parent:
            index = self.turn
            self.turn += 1
            reply = (
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "load_opplan",
                            "id": "load",
                            "args": {"workspace_path": "/workspace/lab"},
                        }
                    ],
                )
                if index == 0
                else AIMessage(content="checkpoint" if index == 2 else "finished")
                if index % 2 == 0
                else AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "task",
                            "id": f"dispatch-{index}",
                            "args": {
                                "description": "continue persisted work",
                                "subagent_type": "worker",
                                "objective_id": "A",
                                "dispatch_id": f"dispatch-{index}",
                            },
                        }
                    ],
                )
            )
        elif isinstance(messages[-1], ToolMessage):
            step = str(messages[-1].content)
            reply = AIMessage(
                content=json.dumps(
                    {
                        "objective_id": "A",
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
                        "budget_delta": {"model_calls": 999, "input_tokens": 999},
                    }
                )
            )
        else:
            description = str(messages[-1].content)
            self.descriptions.append(description)
            step = "second" if "first.txt" in description else "first"
            reply = AIMessage(
                content="",
                tool_calls=[
                    {"name": "record_step", "id": f"record-{step}", "args": {"step": step}}
                ],
            )
        reply.usage_metadata = {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}
        return ChatResult(generations=[ChatGeneration(message=reply)])


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_all_context_flags_survive_compaction_and_history_wipe(
    tmp_path, monkeypatch, asynchronous
):
    for name in (
        "RAPTIX_TASK_STATE",
        "RAPTIX_EXECUTION_LEDGER",
        "RAPTIX_DISPATCH_HANDOFF",
        "RAPTIX_TRANSACTIONAL_COMPACTION",
        "RAPTIX_SUMMARY_STRUCTURED",
        "RAPTIX_CONTEXT_MANIFEST",
        "RAPTIX_CONTEXT_MASK",
        "RAPTIX_CONTEXT_ASSEMBLY",
        "RAPTIX_CONTEXT_PREFIX_ORDER",
        "RAPTIX_TASK_BUDGET",
        "RAPTIX_PROGRESS_OBSERVE",
        "RAPTIX_TASK_HANDOFF",
    ):
        monkeypatch.setenv(name, "1")
    monkeypatch.setenv("RAPTIX_SKILL_DEDUPE_SCOPE", "thread")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "30")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "0")
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_LEVEL", "raw")
    record_path = tmp_path / "record.jsonl"
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(record_path))
    backend = CompositeBackend(
        default=FilesystemBackend(root_dir=tmp_path / "files", virtual_mode=True), routes={}
    )
    scoped = EngagementFilesystemBackend(backend, "/workspace/lab")
    objective = {
        "id": "A",
        "title": "two steps",
        "status": "in-progress",
        "phase": "recon",
        "acceptance_criteria": ["two evidence files exist"],
        "description": "persist two steps",
        "priority": 1,
    }
    write_task_state(scoped, advance_task_state(objective, prior=None))
    from raptix.execution.tools.opplan import _persist_opplan_to_backend

    _persist_opplan_to_backend(backend, "/workspace/lab", [objective], "lab", "profile")
    actions = []

    @tool
    def record_step(step: str) -> str:
        """Persist one synthetic step and its evidence."""
        actions.append(step)
        assert scoped.write(f"/workspace/evidence/{step}.txt", step).error is None
        return step

    child_model = PipelineModel(messages=iter([]))
    slots = frozenset(
        {
            Slot.TASK_BUDGET,
            Slot.TRIED_EDGES,
            Slot.EXECUTION_LEDGER,
            Slot.SUMMARIZATION,
            Slot.CONTEXT_MANIFEST,
            Slot.RECORD,
        }
    )
    child = create_agent(
        child_model,
        tools=[record_step],
        state_schema=WorkspaceState,
        middleware=build_middleware(role="recon", backend=backend, llm=child_model, slots=slots),
    )
    parent_model = PipelineModel(messages=iter([]), parent=True)
    parent = create_agent(
        parent_model,
        checkpointer=InMemorySaver(),
        state_schema=WorkspaceState,
        middleware=build_middleware(
            role="raptix",
            backend=backend,
            llm=parent_model,
            slots=slots | {Slot.SUBAGENT, Slot.OPPLAN},
            subagents=[{"name": "worker", "description": "offline worker", "runnable": child}],
        ),
    )
    config = {"configurable": {"thread_id": "pipeline", "workspace_path": "/workspace/lab"}}
    initial = {
        "messages": [HumanMessage(content="old history must disappear")],
        "workspace_path": "/workspace/lab",
        "objectives": [objective],
    }
    if asynchronous:
        await parent.ainvoke(initial, config)
        await parent.aupdate_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        await parent.ainvoke({"messages": [HumanMessage(content="continue")]}, config)
    else:
        parent.invoke(initial, config)
        parent.update_state(config, {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]})
        parent.invoke({"messages": [HumanMessage(content="continue")]}, config)
    assert actions == ["first", "second"]
    assert "first.txt" in child_model.descriptions[-1]
    assert "old history must disappear" not in child_model.descriptions[-1]
    saved = read_task_state(scoped, "A").state
    assert saved is not None and saved.owner_lease is None
    assert saved.budget.attempts == 2
    assert saved.budget.model_calls < 999
    assert len(saved.evidence_refs) == 2
    assert saved.work_state.status.value == "running"
    for reference in saved.evidence_refs:
        file_data = scoped.read(reference.ref).file_data
        assert file_data is not None
        body = file_data["content"]
        assert hashlib.sha256(body.encode()).hexdigest() == reference.sha256
    rows = [json.loads(line) for line in record_path.read_text(encoding="utf-8").splitlines()]
    summaries = [row for row in rows if row.get("kind") == "summary_call"]
    assert summaries
    assert all(row["attempt_id"] and row["logical_call_id"] for row in summaries)
    assert any(row.get("worker_instance_id") for row in summaries)
    task_rows = [row for row in rows if row.get("request", {}).get("tool") == "task"]
    worker_rows = [row for row in rows if row.get("worker_instance_id")]
    assert all(
        row["parent_attempt_id"] in {task["attempt_id"] for task in task_rows}
        for row in worker_rows
        if row["kind"] == "model_call"
    )


def test_prefix_order_preserves_guardrail_barriers_and_current_state(monkeypatch):
    from langchain.agents.middleware.types import ModelRequest
    from langchain_core.messages import SystemMessage

    from raptix.intelligence.context.assembly import assemble_request
    from raptix.intelligence.context.blocks import emit_block, owned_scope

    monkeypatch.setenv("RAPTIX_CONTEXT_PREFIX_ORDER", "1")
    with owned_scope():
        dynamic = emit_block(
            "opplan", "status", {"type": "text", "text": "latest revision 9"}, source_revision="9"
        )
        static = emit_block("kg", "instructions", {"type": "text", "text": "static policy"})
        barrier = {"type": "text", "text": "RoE must stay byte-identical"}
        request = ModelRequest(
            model=GenericFakeChatModel(messages=iter([])),
            messages=[],
            system_message=SystemMessage(content=[barrier, dynamic, static, barrier]),
            state={},
        )
        assembled = assemble_request(request, budget_tokens=0, backend=None)
        blocks = assembled.system_message.content_blocks
        assert blocks[0] == barrier and blocks[-1] == barrier
        assert [block["text"] for block in blocks[1:3]] == ["static policy", "latest revision 9"]
