"""Local Agent Server checkpoints survive a closed/reopened persistence connection."""

from pathlib import Path
from typing import TypedDict

import pytest
from langchain_core.runnables import RunnableConfig
from langgraph.graph import START, StateGraph
from langgraph.types import Command, interrupt

from raptix.server.checkpointer import sqlite_checkpointer


class InterviewState(TypedDict):
    target: str
    answer: str


def ask_scope(state: InterviewState) -> dict[str, str]:
    answer = interrupt(
        {"type": "ask_user_question", "id": "scope-call", "question": state["target"]}
    )
    return {"answer": answer}


@pytest.mark.asyncio
async def test_pending_question_and_thread_isolation_survive_connection_reopen(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAPTIX_CHECKPOINT_PATH", str(tmp_path / "state" / "checkpoints.sqlite"))
    builder = (
        StateGraph(InterviewState).add_node("interview", ask_scope).add_edge(START, "interview")
    )
    first: RunnableConfig = {"configurable": {"thread_id": "first"}}
    other: RunnableConfig = {"configurable": {"thread_id": "other"}}
    async with sqlite_checkpointer() as saver:
        graph = builder.compile(checkpointer=saver)
        await graph.ainvoke({"target": "authorized-lab-a", "answer": ""}, first)
        await graph.ainvoke({"target": "authorized-lab-b", "answer": ""}, other)

    async with sqlite_checkpointer() as saver:
        graph = builder.compile(checkpointer=saver)
        snapshot = await graph.aget_state(first)
        assert snapshot.tasks[0].interrupts[0].value["id"] == "scope-call"
        assert snapshot.values["target"] == "authorized-lab-a"
        resumed = await graph.ainvoke(Command(resume="keep exact scope"), first)
        assert resumed["answer"] == "keep exact scope"
        assert (await graph.aget_state(other)).values["answer"] == ""

    async with sqlite_checkpointer() as saver:
        graph = builder.compile(checkpointer=saver)
        snapshot = await graph.aget_state(first)
        assert snapshot.values["answer"] == "keep exact scope"
        assert not snapshot.next
