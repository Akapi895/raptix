"""Serializer + record/replay-middleware coverage for
``raptix.execution.session.recording``.

``test_recording.py`` covers ``_canonicalize`` / ``_hash_request`` and the
basic sink/replay round-trip. This file adds the previously-uncovered parts:

* the five ``_serialize_*`` functions that turn live model/tool
  requests + responses into the stable on-disk shape (a wrong field here
  silently changes the request hash, so a replay never matches);
* ``_Replay`` skipping of entries missing ``kind`` / ``req_hash``;
* the ``RecordingMiddleware`` → ``ReplayMiddleware`` **round-trip** — the
  module's whole reason to exist: a recorded request must be served
  deterministically on replay (strict), mismatch must raise (strict) or
  fall through to the live handler (non-strict), and an unset path must
  be a pure passthrough. Sync + async + tool paths all covered.

Pure-logic + tmp_path; no network / docker / LLM.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from raptix.execution.session.recording import (
    RecordingMiddleware,
    ReplayMiddleware,
    ReplayMismatchError,
    _normalize_usage,
    _serialize_ai_response,
    _serialize_command_response,
    _serialize_messages,
    _serialize_model_request,
    _serialize_tool_request,
    _serialize_tool_response,
    open_replay,
)


def _model_request(content: str = "hi", model_name: str = "m1") -> SimpleNamespace:
    return SimpleNamespace(
        system_message=SimpleNamespace(content="sys"),
        model=SimpleNamespace(name=model_name),
        messages=[HumanMessage(content=content)],
        tools=[SimpleNamespace(name="bash")],
    )


def _tool_request(tool_name: str = "bash", args: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        tool=SimpleNamespace(name=tool_name),
        tool_call={"args": args if args is not None else {"cmd": "id"}},
    )


def _close(mw: RecordingMiddleware) -> None:
    if mw._sink is not None:
        mw._sink.close()


# ---------------------------------------------------------------- serializers


def test_serialize_messages_includes_only_truthy_optionals():
    msg = SimpleNamespace(
        type="ai",
        content="hi",
        name="bot",
        tool_calls=[{"id": "1"}],
        tool_call_id="",  # falsy -> omitted
        additional_kwargs={},  # falsy -> omitted
    )
    (entry,) = _serialize_messages([msg])
    assert entry == {"type": "ai", "content": "hi", "name": "bot", "tool_calls": [{"id": "1"}]}


def test_serialize_messages_falls_back_to_class_name():
    class Weird:
        content = "x"

    (entry,) = _serialize_messages([Weird()])
    assert entry["type"] == "Weird"
    assert entry["content"] == "x"


def test_serialize_messages_empty_and_none():
    assert _serialize_messages([]) == []
    assert _serialize_messages(None) == []


def test_serialize_model_request_shape():
    out = _serialize_model_request(_model_request("hi", "gpt"))
    assert out["model"] == "gpt"
    assert out["system"] == "sys"
    assert out["tools"] == ["bash"]
    assert out["messages"][0]["content"] == "hi"


def test_serialize_model_request_handles_missing_system():
    req = SimpleNamespace(
        system_message=None, model=SimpleNamespace(name="m"), messages=[], tools=[]
    )
    out = _serialize_model_request(req)
    assert out["system"] == ""
    assert out["messages"] == []


def test_serialize_tool_request_shape_and_missing_tool():
    out = _serialize_tool_request(_tool_request("nmap", {"target": "x"}))
    assert out == {"tool": "nmap", "args": {"target": "x"}}

    out2 = _serialize_tool_request(SimpleNamespace(tool=None, tool_call_args={}))
    assert out2 == {"tool": "", "args": {}}


def test_serialize_ai_response_shape():
    out = _serialize_ai_response(AIMessage(content="hi"))
    assert out["content"] == "hi"
    assert out["type"] == "ai"
    assert out["tool_calls"] == []


def test_serialize_tool_response_shape():
    out = _serialize_tool_response(
        ToolMessage(content="r", tool_call_id="t", name="bash", status="success")
    )
    assert out["type"] == "tool"
    assert out["content"] == "r"
    assert out["tool_call_id"] == "t"
    assert out["name"] == "bash"
    assert out["status"] == "success"


# ---------------------------------------------------------------- _Replay edges


def test_replay_skips_entries_missing_kind_or_hash(tmp_path: Path):
    path = tmp_path / "in.jsonl"
    path.write_text(
        '{"kind":"model_call","req_hash":"H1","response":{}}\n'
        '{"req_hash":"H2","response":{}}\n'  # missing kind
        '{"kind":"tool_call","response":{}}\n'  # missing req_hash
        '{"kind":"other","req_hash":"H3"}\n',  # unknown kind -> indexed nowhere
        encoding="utf-8",
    )
    replay = open_replay(path)
    assert replay.stats == {"model_calls": 1, "tool_calls": 0}


# ---------------------------------------------------------------- record disabled


def test_recording_disabled_is_passthrough(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_RUNTIME__RECORD_PATH", raising=False)
    rec = RecordingMiddleware()
    assert rec._sink is None
    out = rec.wrap_model_call(_model_request(), lambda _r: AIMessage(content="X"))
    assert out.content == "X"


def test_replay_disabled_is_passthrough(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_RUNTIME__REPLAY_PATH", raising=False)
    rep = ReplayMiddleware()
    assert rep._replay is None
    out = rep.wrap_model_call(_model_request(), lambda _r: AIMessage(content="X"))
    assert out.content == "X"


# ---------------------------------------------------------------- model round-trip


def test_record_then_replay_model_roundtrip(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _model_request("hi", "m1")

    rec = RecordingMiddleware(path=rec_path)
    out = rec.wrap_model_call(req, lambda _r: AIMessage(content="hello"))
    _close(rec)
    assert out.content == "hello"

    rep = ReplayMiddleware(path=rec_path, strict=True)

    def _boom(_r):
        raise AssertionError("handler must not run on a replay hit")

    served = rep.wrap_model_call(req, _boom)
    assert isinstance(served, AIMessage)
    assert served.content == "hello"


def test_replay_strict_mismatch_raises(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    rec.wrap_model_call(_model_request("hi", "m1"), lambda _r: AIMessage(content="hello"))
    _close(rec)

    rep = ReplayMiddleware(path=rec_path, strict=True)
    with pytest.raises(ReplayMismatchError):
        rep.wrap_model_call(_model_request("DIFFERENT", "m9"), lambda _r: AIMessage(content="x"))


def test_replay_non_strict_miss_falls_through_to_handler(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    rec.wrap_model_call(_model_request("hi", "m1"), lambda _r: AIMessage(content="hello"))
    _close(rec)

    rep = ReplayMiddleware(path=rec_path, strict=False)
    out = rep.wrap_model_call(_model_request("other", "m9"), lambda _r: AIMessage(content="LIVE"))
    assert out.content == "LIVE"


async def test_async_record_then_replay_model_roundtrip(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _model_request("hi", "m1")

    rec = RecordingMiddleware(path=rec_path)

    async def _h(_r):
        return AIMessage(content="async-hi")

    out = await rec.awrap_model_call(req, _h)
    _close(rec)
    assert out.content == "async-hi"

    rep = ReplayMiddleware(path=rec_path, strict=True)

    async def _boom(_r):
        raise AssertionError("handler must not run on a replay hit")

    served = await rep.awrap_model_call(req, _boom)
    assert served.content == "async-hi"


# ---------------------------------------------------------------- tool round-trip


def test_record_then_replay_tool_roundtrip(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _tool_request("bash", {"cmd": "id"})
    resp = ToolMessage(content="uid=0", tool_call_id="tc1", name="bash", status="success")

    rec = RecordingMiddleware(path=rec_path)
    out = rec.wrap_tool_call(req, lambda _r: resp)
    _close(rec)
    assert out is resp

    rep = ReplayMiddleware(path=rec_path, strict=True)

    def _boom(_r):
        raise AssertionError("handler must not run on a replay hit")

    served = rep.wrap_tool_call(req, _boom)
    assert isinstance(served, ToolMessage)
    assert served.content == "uid=0"
    assert served.tool_call_id == "tc1"


def test_record_tool_non_toolmessage_is_marked_command(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    sentinel = SimpleNamespace(foo="bar")  # e.g. a Command, not a ToolMessage
    out = rec.wrap_tool_call(_tool_request(), lambda _r: sentinel)
    _close(rec)
    assert out is sentinel
    line = json.loads(rec_path.read_text(encoding="utf-8").strip().splitlines()[0])
    assert line["response"] == {"type": "command"}


async def test_async_tool_roundtrip(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _tool_request("nmap", {"target": "10.0.0.1"})
    resp = ToolMessage(content="open: 22", tool_call_id="tc2", name="nmap", status="success")

    rec = RecordingMiddleware(path=rec_path)

    async def _h(_r):
        return resp

    await rec.awrap_tool_call(req, _h)
    _close(rec)

    rep = ReplayMiddleware(path=rec_path, strict=True)

    async def _boom(_r):
        raise AssertionError("handler must not run on a replay hit")

    served = await rep.awrap_tool_call(req, _boom)
    assert served.content == "open: 22"
    assert served.name == "nmap"


# ---------------------------------------------------------------- disabled (async/tool)
async def test_recording_disabled_async_and_tool_passthrough(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_RUNTIME__RECORD_PATH", raising=False)
    rec = RecordingMiddleware()

    async def _m(_r):
        return AIMessage(content="M")

    async def _t(_r):
        return "T"

    assert (await rec.awrap_model_call(_model_request(), _m)).content == "M"
    assert rec.wrap_tool_call(_tool_request(), lambda _r: "S") == "S"
    assert await rec.awrap_tool_call(_tool_request(), _t) == "T"


def test_replay_disabled_async_and_tool_passthrough(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_RUNTIME__REPLAY_PATH", raising=False)
    rep = ReplayMiddleware()
    assert rep.wrap_tool_call(_tool_request(), lambda _r: "S") == "S"


# ---------------------------------------------------------------- replay miss branches
def _boom_sync(_r):
    raise AssertionError("handler must not run on a replay hit")


async def test_async_replay_strict_model_mismatch_raises(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    rec.wrap_model_call(_model_request("hi", "m1"), lambda _r: AIMessage(content="hello"))
    _close(rec)
    rep = ReplayMiddleware(path=rec_path, strict=True)

    async def _h(_r):
        return AIMessage(content="x")

    with pytest.raises(ReplayMismatchError):
        await rep.awrap_model_call(_model_request("DIFF", "m9"), _h)


def test_replay_strict_tool_mismatch_raises(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    resp = ToolMessage(content="r", tool_call_id="t", name="bash", status="success")
    rec.wrap_tool_call(_tool_request("bash", {"cmd": "id"}), lambda _r: resp)
    _close(rec)
    rep = ReplayMiddleware(path=rec_path, strict=True)
    with pytest.raises(ReplayMismatchError):
        rep.wrap_tool_call(_tool_request("nmap", {"x": "y"}), _boom_sync)


def test_replay_non_strict_tool_miss_falls_through(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    resp = ToolMessage(content="r", tool_call_id="t", name="bash", status="success")
    rec.wrap_tool_call(_tool_request("bash", {"cmd": "id"}), lambda _r: resp)
    _close(rec)
    rep = ReplayMiddleware(path=rec_path, strict=False)
    live = ToolMessage(content="LIVE", tool_call_id="t2", name="nmap", status="success")
    out = rep.wrap_tool_call(_tool_request("nmap", {"x": "y"}), lambda _r: live)
    assert out.content == "LIVE"


async def test_async_replay_tool_miss_strict_raises(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    resp = ToolMessage(content="r", tool_call_id="t", name="bash", status="success")
    rec.wrap_tool_call(_tool_request("bash", {"cmd": "id"}), lambda _r: resp)
    _close(rec)
    rep = ReplayMiddleware(path=rec_path, strict=True)

    async def _h(_r):
        return resp

    with pytest.raises(ReplayMismatchError):
        await rep.awrap_tool_call(_tool_request("nmap", {"x": "y"}), _h)


def test_replay_skips_blank_lines(tmp_path: Path):
    path = tmp_path / "in.jsonl"
    path.write_text(
        '{"kind":"model_call","req_hash":"H1","response":{}}\n'
        "\n"
        "   \n"
        '{"kind":"model_call","req_hash":"H2","response":{}}\n',
        encoding="utf-8",
    )
    replay = open_replay(path)
    assert replay.stats["model_calls"] == 2


# ---------------------------------------------------------------- envelope (PR-A)


def _stateful_model_request(state: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        system_message=SimpleNamespace(content="sys"),
        model=SimpleNamespace(name="m1"),
        messages=[HumanMessage(content="hi")],
        tools=[],
        state=state or {},
        runtime=SimpleNamespace(agent_name=""),
    )


def test_record_entry_carries_observability_envelope(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _stateful_model_request(
        {
            "engagement_name": "lab-x",
            "workspace_path": "/workspace/lab-x",
            "active_objective_id": "OBJ-3",
        }
    )
    rec = RecordingMiddleware(path=rec_path, role="recon")
    rec.wrap_model_call(req, lambda _r: AIMessage(content="hello"))
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["agent"] == "recon"
    assert line["engagement"] == "lab-x"
    assert line["workspace"] == "/workspace/lab-x"
    assert line["objective_id"] == "OBJ-3"
    assert "T" in line["ts"]  # ISO-8601 timestamp
    assert isinstance(line["dur_ms"], int)
    assert line["req_hash"].startswith("sha256:")


def test_envelope_agent_falls_back_to_runtime_name(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    req = _stateful_model_request()
    req.runtime = SimpleNamespace(agent_name="exploiter")
    rec = RecordingMiddleware(path=rec_path)  # no role
    rec.wrap_model_call(req, lambda _r: AIMessage(content="x"))
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["agent"] == "exploiter"


def test_envelope_falls_back_to_process_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_ID", "env-eng")
    monkeypatch.setenv("RAPTIX_WORKSPACE_PATH", "/workspace/env-eng")
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path, role="recon")
    rec.wrap_model_call(_stateful_model_request(), lambda _r: AIMessage(content="x"))
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["engagement"] == "env-eng"
    assert line["workspace"] == "/workspace/env-eng"


# ---------------------------------------------------------------- usage (PR-A)


def test_usage_normalization_fallback_chain():
    um = {"input_tokens": 1, "output_tokens": 2}
    assert _normalize_usage(SimpleNamespace(usage_metadata=um)) == (um, "usage_metadata")
    assert _normalize_usage(
        SimpleNamespace(usage_metadata=None, response_metadata={"token_usage": um})
    ) == (um, "response_metadata")
    assert _normalize_usage(
        SimpleNamespace(usage_metadata=None, response_metadata={"usage": um})
    ) == (um, "response_metadata")
    assert _normalize_usage(
        SimpleNamespace(
            usage_metadata=None, response_metadata=None, additional_kwargs={"usage": um}
        )
    ) == (um, "additional_kwargs")
    assert _normalize_usage(AIMessage(content="x")) == (None, "absent")


def test_serialize_ai_response_records_usage_provenance():
    full = {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}
    out = _serialize_ai_response(AIMessage(content="hi", usage_metadata=full))
    assert out["usage"] == full
    assert out["usage_source"] == "usage_metadata"
    bare = _serialize_ai_response(AIMessage(content="hi"))
    assert bare["usage"] is None
    assert bare["usage_source"] == "absent"


# ---------------------------------------------------------------- Command (PR-A)


def test_command_response_serializes_subagent_report():
    from langgraph.types import Command

    cmd = Command(
        update={
            "messages": [ToolMessage(content="sub report", tool_call_id="t1")],
            "dispatch_ledger": {"d1": {"outcome": {"status": "success"}}},
            "other": 1,
        }
    )
    out = _serialize_command_response(cmd)
    assert out["type"] == "command"
    assert out["update_keys"] == ["dispatch_ledger", "messages", "other"]
    assert out["messages"][0]["content"] == "sub report"
    assert out["dispatch_ledger"]["d1"]["outcome"]["status"] == "success"


def test_record_task_command_keeps_subagent_report(tmp_path: Path):
    from langgraph.types import Command

    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    cmd = Command(update={"messages": [ToolMessage(content="sub report", tool_call_id="tc")]})
    rec.wrap_tool_call(_tool_request("task"), lambda _r: cmd)
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["response"]["type"] == "command"
    assert line["response"]["messages"][0]["content"] == "sub report"


# ---------------------------------------------------------------- errors (PR-A)


def test_model_call_failure_recorded_then_reraised(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)

    def _boom(_r):
        raise RuntimeError("provider down")

    with pytest.raises(RuntimeError, match="provider down"):
        rec.wrap_model_call(_model_request(), _boom)
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["response"]["type"] == "error"
    assert line["response"]["error"] == "RuntimeError"
    assert "provider down" in line["response"]["detail"]


def test_tool_call_failure_recorded_then_reraised(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)

    def _boom(_r):
        raise ValueError("tool exploded")

    with pytest.raises(ValueError, match="tool exploded"):
        rec.wrap_tool_call(_tool_request(), _boom)
    _close(rec)
    line = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert line["response"]["type"] == "error"
    assert line["response"]["error"] == "ValueError"


def test_replay_skips_error_entries(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    ok_req = _model_request("ok", "m1")
    rec.wrap_model_call(ok_req, lambda _r: AIMessage(content="fine"))

    def _boom(_r):
        raise RuntimeError("down")

    fail_req = _model_request("fail", "m1")
    with pytest.raises(RuntimeError):
        rec.wrap_model_call(fail_req, _boom)
    _close(rec)

    rep = ReplayMiddleware(path=rec_path, strict=True)
    served = rep.wrap_model_call(ok_req, _boom_sync)
    assert served.content == "fine"
    with pytest.raises(ReplayMismatchError):
        rep.wrap_model_call(fail_req, _boom_sync)


# ---------------------------------------------------------------- sink (PR-A)


def test_sink_poison_never_breaks_the_run(tmp_path: Path):
    rec_path = tmp_path / "rec.jsonl"
    rec = RecordingMiddleware(path=rec_path)
    rec._sink.close()  # simulate an unusable sink
    resp = ToolMessage(content="REAL", tool_call_id="t", name="bash", status="success")
    out = rec.wrap_tool_call(_tool_request(), lambda _r: resp)
    assert out is resp  # live result returned unchanged
    assert rec._sink.poisoned
    resp2 = ToolMessage(content="R2", tool_call_id="t2", name="nmap", status="success")
    out2 = rec.wrap_tool_call(_tool_request("nmap"), lambda _r: resp2)
    assert out2 is resp2  # later calls short-circuit too


def test_sinks_shared_per_path_seq_is_global(tmp_path: Path):
    rec_path = tmp_path / "shared.jsonl"
    m1 = RecordingMiddleware(path=rec_path, role="a")
    m2 = RecordingMiddleware(path=rec_path, role="b")
    assert m1._sink is m2._sink
    m1.wrap_model_call(_model_request("one", "m"), lambda _r: AIMessage(content="1"))
    m2.wrap_model_call(_model_request("two", "m"), lambda _r: AIMessage(content="2"))
    m1.wrap_tool_call(
        _tool_request(),
        lambda _r: ToolMessage(content="t", tool_call_id="x", name="bash", status="success"),
    )
    _close(m1)
    lines = [json.loads(line) for line in rec_path.read_text(encoding="utf-8").strip().splitlines()]
    assert [entry["seq"] for entry in lines] == [0, 1, 2]
    assert [entry["agent"] for entry in lines] == ["a", "b", "a"]


def test_seq_continues_from_existing_file(tmp_path: Path):
    rec_path = tmp_path / "cont.jsonl"
    m1 = RecordingMiddleware(path=rec_path)
    m1.wrap_model_call(_model_request("a", "m"), lambda _r: AIMessage(content="x"))
    _close(m1)
    m2 = RecordingMiddleware(path=rec_path)
    m2.wrap_model_call(_model_request("b", "m"), lambda _r: AIMessage(content="y"))
    _close(m2)
    seqs = [
        json.loads(line)["seq"]
        for line in rec_path.read_text(encoding="utf-8").strip().splitlines()
    ]
    assert seqs == [0, 1]


# ---------------------------------------------------------------- pre-flight (PR-A)


def test_make_record_unset_env_returns_none(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_RUNTIME__RECORD_PATH", raising=False)
    from raptix.intelligence.agents.middleware_slots import _make_record

    assert _make_record(role="recon") is None


def test_make_record_unusable_path_fails_loud(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where a directory is needed", encoding="utf-8")
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(blocker / "nested" / "rec.jsonl"))
    from raptix.intelligence.agents.middleware_slots import _make_record

    with pytest.raises(RuntimeError, match="RAPTIX_RUNTIME__RECORD_PATH"):
        _make_record(role="recon")


def test_make_record_threads_role(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(tmp_path / "rec.jsonl"))
    from raptix.intelligence.agents.middleware_slots import _make_record

    mw = _make_record(role="recon")
    assert mw is not None
    assert mw._role == "recon"
    mw._sink.close()
