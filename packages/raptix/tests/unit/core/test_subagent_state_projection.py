"""ADR-0045: child private channels never cross the streaming boundary.

deepagents' task tool forwards every child state key that is not in its own
`_EXCLUDED_STATE_KEYS` into the parent `Command.update`. Its summarization
middleware keeps compaction bookkeeping in `_summarization_event`, declared
`PrivateStateAttr`, so without projection at the streaming seam, a child's
compaction event silently overwrites the parent's context projection
(defect C1, reproduced offline and observed in the Silentium run).

These tests pin the two defensive layers:
  - `StreamingRunnable` withholds `PrivateStateAttr` channels from every
    returned state (sync/async, success and caught-failure paths);
  - `DispatchMiddleware._finish` independently strips the known private
    channel from any incoming `Command.update`.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Annotated, Any, NotRequired

import pytest
from langchain.agents.middleware.types import AgentState, PrivateStateAttr
from langchain_core.messages import HumanMessage
from langchain_core.runnables import Runnable
from langgraph.types import Command

from raptix.core.subagent_streaming import (
    StreamingRunnable,
    clear_subagent_renderer,
    set_subagent_renderer,
)
from raptix.middleware.dispatch import DispatchMiddleware


class _FakeChildState(AgentState):
    """deepagents-style state: one public channel, one PrivateStateAttr channel."""

    _summarization_event: Annotated[NotRequired[Any], PrivateStateAttr]
    custom_channel: NotRequired[Any]


class _Graph(Runnable):
    """Fake compiled graph exposing a deepagents-like ``schema`` attribute."""

    schema = _FakeChildState

    def __init__(self, states: list[dict], *, fail: bool = False) -> None:
        self._states = states
        self._fail = fail

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        return self._states[-1] if self._states else {}

    async def ainvoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        return self._states[-1] if self._states else {}

    def stream(self, input: Any, config: Any = None, **kwargs: Any):  # type: ignore[override]
        if self._fail:
            raise RuntimeError("backend unavailable")
        yield from self._states

    async def astream(self, input: Any, config: Any = None, **kwargs: Any):  # type: ignore[override]
        if self._fail:
            raise RuntimeError("backend unavailable")
        for state in self._states:
            yield state
            await asyncio.sleep(0)


class _Renderer:
    def on_subagent_start(self, *args: Any) -> None: ...
    def on_subagent_end(
        self, name: str, elapsed: float, *, cancelled: bool = False, error: bool = False
    ) -> None: ...
    def on_subagent_message(self, *args: Any) -> None: ...
    def on_subagent_tool_call(self, *args: Any) -> None: ...
    def on_subagent_tool_result(self, *args: Any) -> None: ...


@pytest.fixture
def renderer():
    token = set_subagent_renderer(_Renderer())
    try:
        yield _Renderer()
    finally:
        clear_subagent_renderer(token)


def _deepagents_forward(result: dict) -> dict:
    """Mirror deepagents' parent-update filter (subagents.py:504)."""
    from deepagents.middleware.subagents import _EXCLUDED_STATE_KEYS

    return {k: v for k, v in result.items() if k not in _EXCLUDED_STATE_KEYS}


_CHILD_STATE: dict = {
    "messages": [HumanMessage(content="hi")],
    "custom_channel": "keep-me",
    "_summarization_event": {
        "cutoff_index": 162,
        "summary_message": "HumanMessage(fake foreign summary)",
        "file_path": None,
    },
}


def test_streamed_child_compaction_does_not_leak_to_parent(renderer: _Renderer) -> None:
    wrapper = StreamingRunnable(_Graph([dict(_CHILD_STATE)]), "exploit")

    result = wrapper.invoke({"messages": [HumanMessage(content="go")]})

    assert "_summarization_event" not in result
    forwarded = _deepagents_forward(result)
    assert "_summarization_event" not in forwarded
    assert result["custom_channel"] == "keep-me"


@pytest.mark.asyncio
async def test_astreamed_child_compaction_does_not_leak_to_parent(
    renderer: _Renderer,
) -> None:
    wrapper = StreamingRunnable(_Graph([dict(_CHILD_STATE)]), "exploit")

    result = await wrapper.ainvoke({"messages": [HumanMessage(content="go")]})

    assert "_summarization_event" not in result
    assert result["custom_channel"] == "keep-me"


def test_caught_failure_branch_returns_public_projection(renderer: _Renderer) -> None:
    graph = _Graph([], fail=True)
    wrapper = StreamingRunnable(graph, "exploit")

    result = wrapper.invoke({"messages": [HumanMessage(content="go")]})

    assert "_summarization_event" not in result
    assert "subagent_transcripts" not in result  # transcripts live in the sidecar


@pytest.mark.asyncio
async def test_acaught_failure_branch_returns_public_projection(
    renderer: _Renderer,
) -> None:
    graph = _Graph([], fail=True)
    wrapper = StreamingRunnable(graph, "exploit")

    result = await wrapper.ainvoke({"messages": [HumanMessage(content="go")]})

    assert "_summarization_event" not in result
    assert "subagent_transcripts" not in result  # transcripts live in the sidecar


def test_unresolvable_annotations_pass_through_conservatively(
    renderer: _Renderer,
) -> None:
    """A schema we cannot resolve keeps today's behavior: keys pass through."""

    class _OpaqueGraph(_Graph):
        schema: Any = None  # type: ignore[assignment]

    opaque = _OpaqueGraph([dict(_CHILD_STATE)])
    wrapper = StreamingRunnable(opaque, "exploit")

    result = wrapper.invoke({"messages": [HumanMessage(content="go")]})

    # Conservative means "never drop what we can't inspect", but the
    # belt-and-braces floor still withholds the known contaminant.
    assert "custom_channel" in result


class _PlainRunnable(Runnable):
    """No schema attribute at all (pre-deepagents ducktyped stand-ins)."""

    def stream(self, input: Any, config: Any = None, **kwargs: Any):  # type: ignore[override]
        yield {"messages": [HumanMessage(content="hi")], "misc": 1}

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        return {}

    async def ainvoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        return {}


def test_plain_runnables_without_schema_stream_all_state(renderer: _Renderer) -> None:
    wrapper = StreamingRunnable(_PlainRunnable(), "exploit")

    result = wrapper.invoke({"messages": [HumanMessage(content="go")]})

    assert "misc" in result


# DispatchMiddleware._finish strip (defense in depth).


def _dispatch_middleware() -> DispatchMiddleware:
    return DispatchMiddleware(
        backend=object(),
        subagents=[
            {
                "name": "exploit",
                "description": "d",
                "runnable": StreamingRunnable(_Graph([]), "exploit"),
            }
        ],
    )


def test_dispatch_finish_strips_private_event() -> None:
    middleware = _dispatch_middleware()
    context = _make_context()
    command = Command(update={**dict(_CHILD_STATE)})
    runtime = SimpleNamespace(tool_call_id="tc-1")

    result = middleware._finish(command, context, "fp", runtime, None)

    assert "_summarization_event" not in result.update
    assert "messages" in result.update


def _make_context() -> Any:
    from raptix.core.dispatch_context import DispatchContext

    return DispatchContext("dispatch-1", "OBJ-001", 1)
