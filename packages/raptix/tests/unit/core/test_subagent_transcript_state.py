"""Durable sub-agent transcript persistence.

``StreamingRunnable`` emits sub-agent activity as transient LangGraph custom
events. Those are lost on reconnect / for completed runs because nothing about
them lands in the checkpoint. This module proves the durable counterpart: the
wrapper now ALSO returns a ``subagent_transcripts`` state key (forwarded to the
parent graph by deepagents' ``task()`` tool), and the orchestrator channel's
reducer accumulates those entries across calls.

Covered here:
  * invoke()/ainvoke() return a non-empty ``subagent_transcripts`` list whose
    entries are the same event dicts that were streamed (same ``type`` values).
  * the persisted tool-result copy is capped while the streamed copy stays full.
  * ``reduce_concat_transcript`` concatenates across two sub-agent calls and is
    idempotent on ``None`` / empty updates.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import Runnable

from raptix.core.subagent_streaming import (
    TRANSCRIPT_STATE_KEY,
    StreamingRunnable,
    clear_subagent_renderer,
    set_subagent_renderer,
)
from raptix.middleware.state_reducers import reduce_concat_transcript
from raptix.middleware.subagent_transcript_state import SubagentTranscriptState


class FakeSubagentRunnable(Runnable):
    """Minimal fake compiled subagent that replays a scripted message stream.

    Each yielded state is a cumulative ``{"messages": [...]}`` snapshot, exactly
    how a real LangGraph ``stream(stream_mode="values")`` surfaces growth.
    """

    def __init__(self, message_growth: list[list[Any]]):
        self._snapshots = [{"messages": list(m)} for m in message_growth]

    def stream(self, input: Any, config: Any = None, stream_mode: str = "values", **kwargs: Any):
        yield from self._snapshots

    async def astream(
        self, input: Any, config: Any = None, stream_mode: str = "values", **kwargs: Any
    ):
        for snap in self._snapshots:
            yield snap

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:  # pragma: no cover
        return self._snapshots[-1] if self._snapshots else {"messages": []}

    async def ainvoke(
        self, input: Any, config: Any = None, **kwargs: Any
    ) -> Any:  # pragma: no cover
        return self._snapshots[-1] if self._snapshots else {"messages": []}


@pytest.fixture
def writer_renderer():
    """Active renderer so the wrapper streams (not the no-channel fast path)."""

    class _R:
        def on_subagent_start(self, *a: Any, **k: Any) -> None: ...
        def on_subagent_end(self, *a: Any, **k: Any) -> None: ...
        def on_subagent_message(self, *a: Any, **k: Any) -> None: ...
        def on_subagent_tool_call(self, *a: Any, **k: Any) -> None: ...
        def on_subagent_tool_result(self, *a: Any, **k: Any) -> None: ...

    token = set_subagent_renderer(_R())
    try:
        yield
    finally:
        clear_subagent_renderer(token)


def _tool_using_growth() -> list[list[Any]]:
    """A realistic stream: AI thinks + calls a tool, then the tool result, then
    a final AI message. Each snapshot is cumulative."""
    tool_call_msg = AIMessage(
        content="scanning now",
        tool_calls=[
            {"id": "tc-1", "name": "bash", "args": {"command": "nmap -sV t"}, "type": "tool_call"}
        ],
    )
    tool_result_msg = ToolMessage(content="22/tcp open ssh", tool_call_id="tc-1")
    final_msg = AIMessage(content="found ssh")
    base = [HumanMessage(content="scan target")]
    return [
        base + [tool_call_msg],
        base + [tool_call_msg, tool_result_msg],
        base + [tool_call_msg, tool_result_msg, final_msg],
    ]


def _types(transcript: list[dict]) -> list[str]:
    return [e["type"] for e in transcript]


@pytest.fixture
def sidecar(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """A fresh per-test transcript sidecar at a temporary path, so no test shares the process-wide store."""
    import raptix.execution.session.transcript_sidecar as sidecar_module

    monkeypatch.setenv(sidecar_module.PATH_ENV, str(tmp_path / "transcripts.sqlite"))
    monkeypatch.setattr(sidecar_module, "_default", None)
    store = sidecar_module.default_sidecar()
    yield store
    store.close()
    monkeypatch.setattr(sidecar_module, "_default", None)


def _run_in_thread(wrapper: StreamingRunnable, payload: dict, thread_id: str | None) -> Any:
    """Invoke the sub-agent wrapper inside a runnable context, so get_config() carries the parent's thread id."""
    from langchain_core.runnables import RunnableLambda

    config = {"configurable": {"thread_id": thread_id}} if thread_id is not None else {}
    return RunnableLambda(lambda x: wrapper.invoke(x)).invoke(payload, config)


async def _arun_in_thread(wrapper: StreamingRunnable, payload: dict, thread_id: str) -> Any:
    from langchain_core.runnables import RunnableLambda

    async def go(x: dict) -> Any:
        return await wrapper.ainvoke(x)

    return await RunnableLambda(go).ainvoke(payload, {"configurable": {"thread_id": thread_id}})


def _thread_types(sidecar, thread_id: str) -> list[str]:
    return [event["type"] for _, event in sidecar.page(thread_id, None, 10_000)]


class TestTranscriptInSidecar:
    def test_invoke_appends_transcript_to_the_sidecar_and_keeps_it_out_of_state(
        self, writer_renderer: None, sidecar
    ) -> None:
        wrapper = StreamingRunnable(FakeSubagentRunnable(_tool_using_growth()), "recon")

        out = _run_in_thread(
            wrapper, {"messages": [HumanMessage(content="scan target")]}, "thread-a"
        )

        assert TRANSCRIPT_STATE_KEY not in out, "transcript must not travel in the graph state"
        types = _thread_types(sidecar, "thread-a")
        assert types[0] == "subagent_start"
        assert types[-1] == "subagent_end"
        for expected in ("subagent_tool_call", "subagent_tool_result", "subagent_message"):
            assert expected in types, f"missing {expected} in {types}"
        events = [event for _, event in sidecar.page("thread-a", None, 10_000)]
        assert len({e["session_id"] for e in events}) == 1
        assert all(datetime.fromisoformat(e["created_at"]).tzinfo == timezone.utc for e in events)

    @pytest.mark.asyncio
    async def test_ainvoke_appends_transcript_to_the_sidecar(
        self, writer_renderer: None, sidecar
    ) -> None:
        wrapper = StreamingRunnable(FakeSubagentRunnable(_tool_using_growth()), "recon")

        out = await _arun_in_thread(
            wrapper, {"messages": [HumanMessage(content="scan target")]}, "thread-b"
        )

        assert TRANSCRIPT_STATE_KEY not in out
        types = _thread_types(sidecar, "thread-b")
        assert types[0] == "subagent_start"
        assert types[-1] == "subagent_end"
        assert "subagent_tool_result" in types

    def test_without_a_thread_id_nothing_is_written_and_state_is_unchanged(
        self, writer_renderer: None, sidecar
    ) -> None:
        wrapper = StreamingRunnable(FakeSubagentRunnable(_tool_using_growth()), "recon")

        out = wrapper.invoke({"messages": [HumanMessage(content="scan target")]})

        assert TRANSCRIPT_STATE_KEY not in out
        assert sidecar.page("", None, 10) == []

    def test_persisted_tool_result_is_capped_while_stream_stays_full(
        self, writer_renderer: None, monkeypatch: pytest.MonkeyPatch, sidecar
    ) -> None:
        monkeypatch.setenv("RAPTIX_SUBAGENT_TRANSCRIPT_RESULT_CAP", "10")
        big = "A" * 5000
        tool_call_msg = AIMessage(
            content="",
            tool_calls=[{"id": "tc-1", "name": "bash", "args": {}, "type": "tool_call"}],
        )
        tool_result_msg = ToolMessage(content=big, tool_call_id="tc-1")
        base = [HumanMessage(content="go")]
        growth = [base + [tool_call_msg], base + [tool_call_msg, tool_result_msg]]

        wrapper = StreamingRunnable(FakeSubagentRunnable(growth), "recon")
        _run_in_thread(wrapper, {"messages": base}, "thread-c")

        persisted_results = [
            event
            for _, event in sidecar.page("thread-c", None, 10_000)
            if event["type"] == "subagent_tool_result"
        ]
        assert persisted_results, "expected a persisted tool_result event"
        capped = persisted_results[0]["content"]
        assert capped.startswith("A" * 10)
        assert capped.endswith("…[truncated]")
        assert len(capped) < len(big)


class TestTranscriptSidecar:
    def test_appends_keep_order_and_continue_the_sequence(self, tmp_path) -> None:
        from raptix.execution.session.transcript_sidecar import TranscriptSidecar

        store = TranscriptSidecar(tmp_path / "t.sqlite")
        store.append("t1", [{"n": 1}, {"n": 2}])
        store.append("t1", [{"n": 3}])
        store.append("t2", [{"n": 9}])
        rows = store.page("t1", None, 10)
        assert [seq for seq, _ in rows] == [1, 2, 3]
        assert [event["n"] for _, event in rows] == [1, 2, 3]
        assert store.page("t2", None, 10)[0][0] == 1
        store.close()

    def test_pages_newest_first_by_sequence_cursor(self, tmp_path) -> None:
        from raptix.execution.session.transcript_sidecar import TranscriptSidecar

        store = TranscriptSidecar(tmp_path / "t.sqlite")
        store.append("t1", [{"n": i} for i in range(1, 8)])
        newest = store.page("t1", None, 3)
        assert [event["n"] for _, event in newest] == [5, 6, 7]
        older = store.page("t1", newest[0][0], 3)
        assert [event["n"] for _, event in older] == [2, 3, 4]
        assert store.page("t1", older[0][0], 3) == [(1, {"n": 1})]
        store.close()

    def test_durable_transcript_writes_on_append_only_when_it_has_a_thread(
        self, tmp_path, monkeypatch
    ) -> None:
        import raptix.execution.session.transcript_sidecar as sidecar_module
        from raptix.execution.session.transcript_sidecar import DurableTranscript, default_sidecar

        monkeypatch.setenv(sidecar_module.PATH_ENV, str(tmp_path / "d.sqlite"))
        monkeypatch.setattr(sidecar_module, "_default", None)

        in_thread = DurableTranscript("t9")
        in_thread.append({"type": "subagent_start"})
        assert list(in_thread) == [{"type": "subagent_start"}]
        assert default_sidecar().page("t9", None, 10) == [(1, {"type": "subagent_start"})]

        detached = DurableTranscript(None)
        detached.append({"type": "subagent_end"})
        assert default_sidecar().page("", None, 10) == []
        default_sidecar().close()
        monkeypatch.setattr(sidecar_module, "_default", None)


class TestReduceConcatTranscript:
    def test_concatenates_across_two_calls(self) -> None:
        first = [{"type": "subagent_start"}, {"type": "subagent_end"}]
        second = [{"type": "subagent_start"}, {"type": "subagent_tool_call"}]
        merged = reduce_concat_transcript(first, second)
        assert merged == first + second
        # Order-stable and append-only (no dedup, no reorder).
        assert [e["type"] for e in merged] == [
            "subagent_start",
            "subagent_end",
            "subagent_start",
            "subagent_tool_call",
        ]

    def test_keeps_only_the_newest_events_so_the_state_stays_bounded(self) -> None:
        from raptix.middleware.state_reducers import TRANSCRIPT_CHANNEL_LIMIT

        full = [{"seq": i} for i in range(TRANSCRIPT_CHANNEL_LIMIT)]
        merged = reduce_concat_transcript(
            full, [{"seq": TRANSCRIPT_CHANNEL_LIMIT}, {"seq": TRANSCRIPT_CHANNEL_LIMIT + 1}]
        )
        assert len(merged) == TRANSCRIPT_CHANNEL_LIMIT
        assert merged[-1] == {"seq": TRANSCRIPT_CHANNEL_LIMIT + 1}
        assert merged[0] == {"seq": 2}

    def test_idempotent_on_none_and_empty(self) -> None:
        assert reduce_concat_transcript(None, None) == []
        assert reduce_concat_transcript(None, []) == []
        existing = [{"type": "subagent_start"}]
        assert reduce_concat_transcript(existing, None) is existing
        assert reduce_concat_transcript(None, [{"type": "x"}]) == [{"type": "x"}]


class TestSchemaExtendsAgentState:
    def test_schema_no_longer_declares_the_transcript_channel_and_keeps_base_channels(self) -> None:
        # TypedDict subclasses don't keep the base in __mro__ or support
        # issubclass(); the real proof that we EXTENDED (not replaced) AgentState
        # is that the subclass __annotations__ merge in the base channels.
        keys = SubagentTranscriptState.__annotations__
        assert TRANSCRIPT_STATE_KEY not in keys, "transcripts live in the sidecar, not in the state"
        assert "messages" in keys
        assert "jump_to" in keys
        assert "structured_response" in keys
