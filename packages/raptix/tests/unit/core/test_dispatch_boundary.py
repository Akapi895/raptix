"""Task boundary: failures survive the child tool and remain dispatch-scoped."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.runnables import Runnable

from raptix.core.subagent_streaming import (
    StreamingRunnable,
    clear_subagent_renderer,
    set_subagent_renderer,
)
from raptix.middleware.dispatch import DispatchMiddleware, merge_dispatch_ledger
from raptix_core.types.dispatch_outcome import FailureKind, classify_dispatch_failure


class _Fails(Runnable):
    def __init__(self) -> None:
        self.calls = 0

    def stream(self, input: Any, config: Any = None, **kwargs: Any):
        self.calls += 1
        raise RuntimeError("backend unavailable")
        yield

    async def astream(self, input: Any, config: Any = None, **kwargs: Any):
        self.calls += 1
        await asyncio.sleep(0)
        raise RuntimeError("backend unavailable")
        yield

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        self.calls += 1
        raise RuntimeError("backend unavailable")


class _Renderer:
    def on_subagent_start(self, *args: Any) -> None: ...
    def on_subagent_end(self, *args: Any) -> None: ...
    def on_subagent_message(self, *args: Any) -> None: ...


@pytest.fixture
def task():
    inner = _Fails()
    middleware = DispatchMiddleware(
        backend=object(),
        subagents=[
            {
                "name": "exploit",
                "description": "test role",
                "runnable": StreamingRunnable(inner, "exploit"),
            }
        ],
    )
    token = set_subagent_renderer(_Renderer())
    try:
        yield middleware.tools[0], inner
    finally:
        clear_subagent_renderer(token)


def _call(
    tool: Any,
    state: dict,
    *,
    objective: str | None = "A",
    intent: str = "same intent",
    dispatch: str | None = None,
) -> Any:
    runtime = SimpleNamespace(
        state=state, tool_call_id="tool-1", config={"configurable": {"thread_id": "thread-1"}}
    )
    return tool.func(
        description=intent,
        subagent_type="exploit",
        objective_id=objective,
        dispatch_id=dispatch,
        runtime=runtime,
    )


def _apply(state: dict, command: Any) -> dict:
    return {
        **state,
        "dispatch_ledger": merge_dispatch_ledger(
            state.get("dispatch_ledger"), command.update.get("dispatch_ledger")
        ),
    }


def test_task_parent_receives_typed_failure_and_terminal_rejects_redispatch(task: tuple) -> None:
    tool, inner = task
    state = {"objectives": [{"id": "A"}, {"id": "B"}], "engagement_name": "lab"}
    for count in range(1, 4):
        response = _call(tool, state)
        message = response.update["messages"][0]
        assert message.status == "error"
        assert (
            message.additional_kwargs["dispatch_failure_outcome"]["consecutive_failure_count"]
            == count
        )
        state = _apply(state, response)
    assert state["dispatch_ledger"][next(iter(state["dispatch_ledger"]))]["outcome"][
        "terminal_for_this_dispatch"
    ]
    rejected = _call(tool, state)
    assert "terminal_dispatch" in rejected.update["messages"][0].content
    assert inner.calls == 3
    # Supplying another ID for the same intent must not bypass the controller.
    assert (
        "terminal_intent"
        in _call(tool, state, dispatch="different-id").update["messages"][0].content
    )
    other = _call(tool, state, objective="B")
    assert (
        other.update["messages"][0].additional_kwargs["dispatch_failure_outcome"][
            "consecutive_failure_count"
        ]
        == 1
    )
    assert inner.calls == 4


@pytest.mark.asyncio
async def test_async_task_failure_preserves_parent_tool_result(task: tuple) -> None:
    tool, _ = task
    runtime = SimpleNamespace(
        state={"objectives": [{"id": "A"}]}, tool_call_id="async-tool", config={}
    )
    reply = await tool.coroutine(
        description="intent", subagent_type="exploit", objective_id="A", runtime=runtime
    )
    assert reply.update["messages"][0].tool_call_id == "async-tool"
    assert (
        reply.update["messages"][0].additional_kwargs["dispatch_failure_outcome"]["objective_id"]
        == "A"
    )


@pytest.mark.asyncio
async def test_parallel_tasks_keep_failure_identity_separate(task: tuple) -> None:
    tool, _ = task
    state = {"objectives": [{"id": "A"}, {"id": "B"}]}

    async def one(objective: str):
        runtime = SimpleNamespace(state=state, tool_call_id=objective, config={})
        return await tool.coroutine(
            description="same text",
            subagent_type="exploit",
            objective_id=objective,
            runtime=runtime,
        )

    outcomes = await asyncio.gather(one("A"), one("B"))
    assert [
        o.update["messages"][0].additional_kwargs["dispatch_failure_outcome"]["objective_id"]
        for o in outcomes
    ] == ["A", "B"]


def test_unbound_description_is_scoped_and_role_remains_reusable(task: tuple) -> None:
    tool, _ = task
    state: dict = {}
    reply = _call(tool, state, objective=None, intent="first")
    state = _apply(state, reply)
    another = _call(tool, state, objective=None, intent="different task")
    assert (
        another.update["messages"][0].additional_kwargs["dispatch_failure_outcome"][
            "consecutive_failure_count"
        ]
        == 1
    )


def test_failure_kind_is_diagnostic_not_role_policy() -> None:
    assert classify_dispatch_failure(ValueError("bad state")) == FailureKind.STATE
    assert classify_dispatch_failure(PermissionError("denied")) == FailureKind.TOOL
    assert classify_dispatch_failure(RuntimeError("runtime")) == FailureKind.EXECUTION
