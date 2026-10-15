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
from raptix.middleware.dispatch import (
    DispatchMiddleware,
    _resolve_max_concurrent_dispatches,
    merge_dispatch_ledger,
)
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


class _Hangs(Runnable):
    """A sub-agent that never converges — the runaway-loop case."""

    def __init__(self, sleep_seconds: float) -> None:
        self.calls = 0
        self.sleep_seconds = sleep_seconds
        self.cancelled = False

    async def astream(self, input: Any, config: Any = None, **kwargs: Any):
        self.calls += 1
        try:
            await asyncio.sleep(self.sleep_seconds)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        yield

    def stream(self, input: Any, config: Any = None, **kwargs: Any):
        self.calls += 1
        raise RuntimeError("sync path unused in this test")
        yield

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        self.calls += 1
        raise RuntimeError("sync path unused in this test")


class _Renderer:
    def on_subagent_start(self, *args: Any) -> None: ...

    def on_subagent_end(self, *args: Any, **kwargs: Any) -> None: ...

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
async def test_async_task_times_out_instead_of_hanging_forever() -> None:
    """A runaway sub-agent must be bounded by wall clock, not just step count.

    Reproduces the GraphRecursionError pattern observed in real engagements
    (a debug-loop dispatch running tens of minutes before the hard
    recursion ceiling caught it) with a sub-agent that never converges.
    """
    inner = _Hangs(sleep_seconds=5.0)
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
    middleware._timeout_seconds = 0.05
    tool = middleware.tools[0]
    token = set_subagent_renderer(_Renderer())
    try:
        runtime = SimpleNamespace(
            state={"objectives": [{"id": "A"}]}, tool_call_id="async-tool", config={}
        )
        reply = await tool.coroutine(
            description="intent", subagent_type="exploit", objective_id="A", runtime=runtime
        )
    finally:
        clear_subagent_renderer(token)
    outcome = reply.update["messages"][0].additional_kwargs["dispatch_failure_outcome"]
    assert outcome["error_type"] == "TimeoutError"
    assert outcome["failure_kind"] == "execution"


def test_resolve_max_concurrent_dispatches_default_and_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("RAPTIX_MAX_CONCURRENT_DISPATCHES", raising=False)
    assert _resolve_max_concurrent_dispatches() == 3
    monkeypatch.setenv("RAPTIX_MAX_CONCURRENT_DISPATCHES", "7")
    assert _resolve_max_concurrent_dispatches() == 7
    monkeypatch.setenv("RAPTIX_MAX_CONCURRENT_DISPATCHES", "not-a-number")
    assert _resolve_max_concurrent_dispatches() == 3


@pytest.mark.asyncio
async def test_concurrent_dispatches_are_capped_per_scope() -> None:
    """The Nth+1 concurrent dispatch for the same engagement must be
    rejected, not silently allowed to run alongside the others.

    Reproduces the gap behind a real incident: nothing previously stopped
    an unbounded number of distinct dispatches from running at once — the
    "up to 3" convention was prompt text only, never enforced in code.
    """
    inner = _Hangs(sleep_seconds=0.3)
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
    middleware._max_concurrent = 3
    tool = middleware.tools[0]
    token = set_subagent_renderer(_Renderer())
    state = {"objectives": [{"id": str(i)} for i in range(4)]}

    async def one(n: int):
        runtime = SimpleNamespace(state=state, tool_call_id=str(n), config={})
        return await tool.coroutine(
            description="same intent",
            subagent_type="exploit",
            objective_id=str(n),
            dispatch_id=f"d{n}",
            runtime=runtime,
        )

    try:
        replies = await asyncio.gather(one(0), one(1), one(2), one(3))
    finally:
        clear_subagent_renderer(token)

    rejected = [
        r for r in replies if "dispatch_capacity_exceeded" in r.update["messages"][0].content
    ]
    assert len(rejected) == 1
    assert inner.calls == 3


@pytest.mark.asyncio
async def test_concurrent_dispatch_cap_does_not_leak_across_scopes() -> None:
    """Two distinct engagements (distinct state objects) must each get
    their own capacity — one engagement's in-flight dispatches must never
    count against a different engagement's ceiling."""
    inner = _Hangs(sleep_seconds=0.3)
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
    middleware._max_concurrent = 1
    tool = middleware.tools[0]
    token = set_subagent_renderer(_Renderer())
    state_a = {"objectives": [{"id": "A"}]}
    state_b = {"objectives": [{"id": "B"}]}

    async def one(state: dict, objective: str):
        runtime = SimpleNamespace(state=state, tool_call_id=objective, config={})
        return await tool.coroutine(
            description="intent",
            subagent_type="exploit",
            objective_id=objective,
            runtime=runtime,
        )

    try:
        reply_a, reply_b = await asyncio.gather(one(state_a, "A"), one(state_b, "B"))
    finally:
        clear_subagent_renderer(token)

    assert "dispatch_capacity_exceeded" not in reply_a.update["messages"][0].content
    assert "dispatch_capacity_exceeded" not in reply_b.update["messages"][0].content
    assert inner.calls == 2


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


def test_timeout_error_classifies_as_execution_not_tool() -> None:
    """TimeoutError is an OSError subclass — without an explicit check it
    would silently fall into the TOOL bucket (meant for a single failed
    tool call), rather than EXECUTION (the same bucket a recursion-limit
    fault already uses for "the dispatch ran too long").
    """
    assert classify_dispatch_failure(TimeoutError("dispatch exceeded wall clock")) == (
        FailureKind.EXECUTION
    )


def test_task_tool_runtime_param_survives_schema_validation(task: tuple) -> None:
    """The ``runtime`` param must be recognised as framework-injected.

    langgraph's ToolNode injects ``runtime`` by analysing
    ``inspect.signature`` annotations. Under
    ``from __future__ import annotations`` those are strings, langchain-core
    drops the arg during schema validation, and every real dispatch dies
    with ``atask() missing 1 required positional argument: 'runtime'``
    while direct ``tool.func(...)`` calls (as above) keep passing.
    """
    tool, _ = task
    assert "runtime" in tool._injected_args_keys


def test_task_stamps_active_objective_id_into_parent_state(task: tuple) -> None:
    """The objective the dispatch validated must reach the parent state.

    Nothing set ``active_objective_id`` before, so the RoE guardrail and
    the run recorder logged an empty ``objective_id`` forever.
    """
    tool, _ = task
    state = {"objectives": [{"id": "A"}], "engagement_name": "lab"}
    reply = _call(tool, state, objective="A")
    assert reply.update["active_objective_id"] == "A"


def test_task_without_objective_clears_previous_objective_stamp(task: tuple) -> None:
    tool, _ = task
    state = {"objectives": [{"id": "A"}], "active_objective_id": "A"}
    reply = _call(tool, state, objective=None)
    assert reply.update["active_objective_id"] == ""
