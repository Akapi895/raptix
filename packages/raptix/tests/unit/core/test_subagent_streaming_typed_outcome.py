"""Typed dispatch failure outcome tests (ADR-0028, Step 1).

Validates that ``StreamingRunnable`` produces a structured
``DispatchFailureOutcome`` alongside the legacy text marker, and that
the failure counter is dispatch-scoped (not role-scoped) when an
explicit ``dispatch_id`` is provided.

Key invariants:

- The typed outcome is embedded in the AIMessage's
  ``additional_kwargs["dispatch_failure_outcome"]``.
- ``terminal_for_this_dispatch`` is True only at or above the cap.
- Different dispatch_ids have independent counters — one failed
  dispatch does not poison another.
- The text ``[TERMINAL]`` marker is preserved for backward compat.
- ``partial_state_refs`` captures artifact paths from the transcript.
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import Runnable

from raptix.core.subagent_streaming import (
    MAX_SUBAGENT_CONSECUTIVE_FAILURES,
    StreamingRunnable,
    clear_subagent_renderer,
    set_subagent_renderer,
)
from raptix_core.types.dispatch_outcome import (
    DispatchFailureOutcome,
    FailureKind,
)

TERMINAL_MARKER = "[TERMINAL]"


class _ToggleRunnable(Runnable):
    """Inner runnable whose stream/astream raises or yields a final state."""

    _FINAL: dict[str, Any] = {"messages": [AIMessage(content="ok")]}

    def __init__(self, should_fail: bool = True) -> None:
        self.should_fail = should_fail
        self._exc = RuntimeError("boom")

    def stream(self, input: Any, config: Any = None, stream_mode: str = "values", **kwargs: Any):
        if self.should_fail:
            raise self._exc
        yield self._FINAL

    async def astream(
        self, input: Any, config: Any = None, stream_mode: str = "values", **kwargs: Any
    ):
        if self.should_fail:
            raise self._exc
        yield self._FINAL

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:  # pragma: no cover
        if self.should_fail:
            raise self._exc
        return self._FINAL

    async def ainvoke(
        self, input: Any, config: Any = None, **kwargs: Any
    ) -> Any:  # pragma: no cover
        if self.should_fail:
            raise self._exc
        return self._FINAL


class _Renderer:
    def on_subagent_start(self, *a: Any, **kw: Any) -> None: ...
    def on_subagent_end(self, *a: Any, **kw: Any) -> None: ...
    def on_subagent_message(self, *a: Any, **kw: Any) -> None: ...
    def on_subagent_tool_call(self, *a: Any, **kw: Any) -> None: ...  # pragma: no cover
    def on_subagent_tool_result(self, *a: Any, **kw: Any) -> None: ...  # pragma: no cover


@pytest.fixture
def renderer():
    token = set_subagent_renderer(_Renderer())
    try:
        yield
    finally:
        clear_subagent_renderer(token)


def _last_ai(state: Any) -> AIMessage:
    """Return the last AIMessage in the state."""
    msgs = state["messages"]
    for m in reversed(msgs):
        if isinstance(m, AIMessage):
            return m
    raise AssertionError("no AIMessage in state")


def _outcome_from(state: Any) -> DispatchFailureOutcome:
    """Extract the typed outcome from the last AIMessage."""
    ai = _last_ai(state)
    raw = ai.additional_kwargs.get("dispatch_failure_outcome")
    assert raw is not None, "dispatch_failure_outcome missing from additional_kwargs"
    return DispatchFailureOutcome.model_validate(raw)


def _hm(dispatch_id: str | None = None, objective_id: str | None = None) -> dict[str, Any]:
    msg: dict[str, Any] = {"messages": [HumanMessage(content="go")]}
    if dispatch_id is not None or objective_id is not None:
        msg["configurable"] = {}
        if dispatch_id is not None:
            msg["configurable"]["dispatch_id"] = dispatch_id
        if objective_id is not None:
            msg["configurable"]["objective_id"] = objective_id
    return msg


class TestTypedOutcomePresent:
    def test_outcome_present_on_failure(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.status == "failed"
        assert outcome.failure_kind == FailureKind.EXECUTION
        assert outcome.error_type == "RuntimeError"
        assert outcome.error_message == "boom"

    def test_outcome_not_terminal_before_cap(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES - 1):
            out = wrapper.invoke(_hm())
            outcome = _outcome_from(out)
            assert outcome.terminal_for_this_dispatch is False
            assert outcome.consecutive_failure_count < MAX_SUBAGENT_CONSECUTIVE_FAILURES

    def test_outcome_terminal_at_cap(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        out: Any = None
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES):
            out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.terminal_for_this_dispatch is True
        assert outcome.consecutive_failure_count == MAX_SUBAGENT_CONSECUTIVE_FAILURES


class TestBackwardCompat:
    def test_text_marker_still_present(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        out: Any = None
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES):
            out = wrapper.invoke(_hm())
        text = str(_last_ai(out).content)
        assert TERMINAL_MARKER in text

    def test_text_marker_absent_before_cap(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        out = wrapper.invoke(_hm())
        text = str(_last_ai(out).content)
        assert TERMINAL_MARKER not in text


class TestDispatchScoped:
    def test_different_dispatch_ids_have_independent_counters(self, renderer: None) -> None:
        """One failed dispatch must not poison another dispatch to the same role."""
        wrapper = StreamingRunnable(_ToggleRunnable(), "exploit")
        # Dispatch A: fail 3 times → terminal
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES):
            out_a = wrapper.invoke(_hm(dispatch_id="dispatch-A"))
        outcome_a = _outcome_from(out_a)
        assert outcome_a.terminal_for_this_dispatch is True
        assert outcome_a.dispatch_id == "dispatch-A"

        # Dispatch B: first failure should NOT be terminal
        out_b = wrapper.invoke(_hm(dispatch_id="dispatch-B"))
        outcome_b = _outcome_from(out_b)
        assert outcome_b.terminal_for_this_dispatch is False
        assert outcome_b.consecutive_failure_count == 1
        assert outcome_b.dispatch_id == "dispatch-B"

    def test_success_resets_dispatch_counter(self, renderer: None) -> None:
        toggle = _ToggleRunnable(should_fail=True)
        wrapper = StreamingRunnable(toggle, "scanner")
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES - 1):
            wrapper.invoke(_hm(dispatch_id="dispatch-X"))
        toggle.should_fail = False
        ok = wrapper.invoke(_hm(dispatch_id="dispatch-X"))
        # Success: no outcome (not a failure)
        assert "dispatch_failure_outcome" not in _last_ai(ok).additional_kwargs
        toggle.should_fail = True
        out = wrapper.invoke(_hm(dispatch_id="dispatch-X"))
        outcome = _outcome_from(out)
        assert outcome.consecutive_failure_count == 1
        assert outcome.terminal_for_this_dispatch is False

    def test_objective_id_propagated(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "exploit")
        out = wrapper.invoke(_hm(objective_id="OBJ-042"))
        outcome = _outcome_from(out)
        assert outcome.objective_id == "OBJ-042"


class TestFailureClassification:
    def test_recursion_error_classified_as_execution(self, renderer: None) -> None:
        class _RecursionToggle(_ToggleRunnable):
            def __init__(self) -> None:
                super().__init__()
                self._exc = RecursionError("max recursion")

        wrapper = StreamingRunnable(_RecursionToggle(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.failure_kind == FailureKind.EXECUTION

    def test_key_error_classified_as_state(self, renderer: None) -> None:
        class _KeyToggle(_ToggleRunnable):
            def __init__(self) -> None:
                super().__init__()
                self._exc = KeyError("missing")

        wrapper = StreamingRunnable(_KeyToggle(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.failure_kind == FailureKind.STATE

    def test_permission_error_classified_as_tool(self, renderer: None) -> None:
        class _PermToggle(_ToggleRunnable):
            def __init__(self) -> None:
                super().__init__()
                self._exc = PermissionError("denied")

        wrapper = StreamingRunnable(_PermToggle(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.failure_kind == FailureKind.TOOL


class TestPartialStateRefs:
    def test_partial_state_refs_empty_when_no_artifacts(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.partial_state_refs == []

    def test_partial_state_refs_captures_tool_paths(self, renderer: None) -> None:
        """When a tool wrote to a file path before the failure, the path
        is captured in partial_state_refs so the orchestrator can read it
        without re-deriving from scratch."""

        class _WriteThenFail(Runnable):
            def stream(self, input, config=None, stream_mode="values", **kwargs):
                from langchain_core.messages import AIMessage, ToolMessage

                yield {
                    "messages": [
                        HumanMessage(content="go"),
                        AIMessage(
                            content="",
                            tool_calls=[
                                {"id": "tc1", "name": "write_file", "args": {"path": "/tmp/x"}}
                            ],
                        ),
                        ToolMessage(content="ok", tool_call_id="tc1"),
                    ]
                }
                raise RuntimeError("boom")

            async def astream(self, input, config=None, stream_mode="values", **kwargs):
                raise RuntimeError("boom")

            def invoke(self, input, config=None, **kwargs):  # pragma: no cover
                raise RuntimeError("boom")

            async def ainvoke(self, input, config=None, **kwargs):  # pragma: no cover
                raise RuntimeError("boom")

        wrapper = StreamingRunnable(_WriteThenFail(), "scanner")
        out = wrapper.invoke(_hm())
        outcome = _outcome_from(out)
        assert "/tmp/x" in outcome.partial_state_refs


@pytest.mark.asyncio
class TestAsyncTypedOutcome:
    async def test_async_outcome_present(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "verifier")
        out = await wrapper.ainvoke(_hm())
        outcome = _outcome_from(out)
        assert outcome.status == "failed"
        assert outcome.failure_kind == FailureKind.EXECUTION

    async def test_async_dispatch_scoped(self, renderer: None) -> None:
        wrapper = StreamingRunnable(_ToggleRunnable(), "verifier")
        for _ in range(MAX_SUBAGENT_CONSECUTIVE_FAILURES):
            await wrapper.ainvoke(_hm(dispatch_id="dispatch-A"))
        out_b = await wrapper.ainvoke(_hm(dispatch_id="dispatch-B"))
        outcome_b = _outcome_from(out_b)
        assert outcome_b.terminal_for_this_dispatch is False
        assert outcome_b.consecutive_failure_count == 1
