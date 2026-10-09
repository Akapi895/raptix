"""Exercise recording and dispatch through LangChain's actual graph boundary."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool

from raptix.middleware._audit_sink import RoEAuditSink
from raptix.middleware.dispatch import DispatchMiddleware
from raptix.middleware.roe import RoEGuardrailMiddleware
from raptix.orchestration.mission.opplan import OPPLANState
from raptix.execution.session.recording import RecordingMiddleware


class ToolModel(FakeMessagesListChatModel):
    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self


@tool
def echo_canary(text: str) -> str:
    """Return a canary without external effects."""
    return text


class SeedObjectives(AgentMiddleware):
    state_schema = OPPLANState

    def before_agent(self, state: Any, runtime: Any) -> dict:
        return {"objectives": [{"id": "A"}, {"id": "B"}]}


@pytest.mark.parametrize("async_mode", [False, True])
async def test_compiled_agent_records_model_payload(tmp_path: Path, async_mode: bool) -> None:
    canary = AIMessage(
        content="capture canary",
        tool_calls=[
            {"name": "echo_canary", "args": {"text": "canary"}, "id": "tc", "type": "tool_call"}
        ],
        usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
    )
    path = tmp_path / "record.jsonl"
    recorder = RecordingMiddleware(path=path, role="review")
    agent = create_agent(
        ToolModel(responses=[canary, AIMessage(content="done")]),
        tools=[echo_canary],
        middleware=[recorder],
    )
    try:
        inputs = {"messages": [{"role": "user", "content": "test"}]}
        if async_mode:
            await agent.ainvoke(inputs)
        else:
            agent.invoke(inputs)
    finally:
        recorder._sink.close()
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    response = next(e["response"] for e in entries if e["kind"] == "model_call")
    assert {key: response[key] for key in ("content", "tool_calls", "usage")} == {
        "content": canary.content,
        "tool_calls": canary.tool_calls,
        "usage": canary.usage_metadata,
    }


@pytest.mark.parametrize("async_mode", [False, True])
async def test_dispatch_objective_reaches_child_and_checkpoint(
    tmp_path: Path, async_mode: bool
) -> None:
    observed: list[str | None] = []

    def child(state: dict) -> dict:
        observed.append(state.get("active_objective_id"))
        return {"messages": [AIMessage(content="child report")]}

    dispatch = DispatchMiddleware(
        backend=object(),
        subagents=[{"name": "recon", "description": "review", "runnable": RunnableLambda(child)}],
    )
    model = ToolModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "task",
                        "args": {
                            "description": "objective A",
                            "subagent_type": "recon",
                            "objective_id": "A",
                        },
                        "id": "tc",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="done"),
        ]
    )
    path = tmp_path / "record.jsonl"
    recorder = RecordingMiddleware(path=path)
    agent = create_agent(model, middleware=[SeedObjectives(), dispatch, recorder])
    try:
        inputs = {"messages": [{"role": "user", "content": "review"}]}
        result = await agent.ainvoke(inputs) if async_mode else agent.invoke(inputs)
    finally:
        recorder._sink.close()
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    task = next(e for e in entries if e["kind"] == "tool_call")
    assert {
        "child": observed,
        "parent": result.get("active_objective_id"),
        "task": task["objective_id"],
        "report": task["response"]["messages"][0]["content"],
    } == {"child": ["A"], "parent": "A", "task": "A", "report": "child report"}


async def test_parallel_compiled_children_audit_their_own_objectives(tmp_path: Path) -> None:
    audit_path = tmp_path / "roe.jsonl"
    sink = RoEAuditSink(audit_path)
    children = []
    task_calls = []
    for role, objective in (("recon", "A"), ("exploit", "B")):
        model = ToolModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "echo_canary",
                            "args": {"text": "canary"},
                            "id": role,
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content="child report"),
            ]
        )
        child = create_agent(
            model, tools=[echo_canary], middleware=[RoEGuardrailMiddleware(sink=sink)]
        )
        children.append({"name": role, "description": "review", "runnable": child})
        task_calls.append(
            {
                "name": "task",
                "args": {"description": "review", "subagent_type": role, "objective_id": objective},
                "id": role,
                "type": "tool_call",
            }
        )
    parent = create_agent(
        ToolModel(
            responses=[AIMessage(content="", tool_calls=task_calls), AIMessage(content="done")]
        ),
        middleware=[
            SeedObjectives(),
            RoEGuardrailMiddleware(sink=sink),
            DispatchMiddleware(backend=object(), subagents=children),
        ],
    )
    await parent.ainvoke(
        {"messages": [{"role": "user", "content": "review"}], "active_objective_id": "previous"}
    )
    rows = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()]
    assert {
        name: sorted(row["objective_id"] for row in rows if row["tool"] == name)
        for name in ("task", "echo_canary")
    } == {"task": ["A", "B"], "echo_canary": ["A", "B"]}
