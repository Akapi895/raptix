"""Attempt identity, served model, raw usage and separate summary-call capture."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, ToolMessage

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.runtime.recording import RecordingMiddleware, SummaryCallRecorder, wrap_summary_model


class _StubModel:
    def __init__(self, model_name: str = "requested-model") -> None:
        self.model_name = model_name
        self.name = None


def _model_request() -> SimpleNamespace:
    return SimpleNamespace(
        model=_StubModel(),
        system_message=None,
        messages=[],
        tools=[],
        state={"active_objective_id": "OBJ-001"},
        runtime=None,
    )


def _model_response(served: str = "served-model") -> ModelResponse:
    return ModelResponse(
        result=[
            AIMessage(
                content="answer",
                usage_metadata={"input_tokens": 11, "output_tokens": 3, "total_tokens": 14},
                response_metadata={"model_name": served},
            )
        ],
        structured_response=None,
    )


def _entries(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_model_entry_carries_attempt_chain_and_served_model(tmp_path: Path) -> None:
    path = tmp_path / "record.jsonl"
    middleware = RecordingMiddleware(path=path, role="recon")
    token = active_dispatch.set(DispatchContext("dispatch-7", "OBJ-001", 2))
    try:
        middleware.wrap_model_call(_model_request(), lambda _r: _model_response("custom/glm"))
    finally:
        active_dispatch.reset(token)
    entry = _entries(path)[0]
    assert entry["kind"] == "model_call"
    assert entry["parent_attempt_id"] == "dispatch-7:2"
    assert entry["attempt_id"]
    assert entry["served_model"] == "custom/glm"


def test_tool_entry_carries_attempt_chain(tmp_path: Path) -> None:
    path = tmp_path / "record.jsonl"
    middleware = RecordingMiddleware(path=path, role="recon")
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={"name": "bash", "id": "c1", "args": {"command": "id"}},
        state={"active_objective_id": "OBJ-001"},
        runtime=None,
    )
    token = active_dispatch.set(DispatchContext("dispatch-9", "OBJ-001", 1))
    try:
        middleware.wrap_tool_call(
            request, lambda _r: ToolMessage(content="uid=0", tool_call_id="c1")
        )
    finally:
        active_dispatch.reset(token)
    entry = _entries(path)[0]
    assert entry["kind"] == "tool_call"
    assert entry["parent_attempt_id"] == "dispatch-9:1"
    assert entry["attempt_id"]


def test_parent_attempt_id_absent_outside_a_dispatch(tmp_path: Path) -> None:
    path = tmp_path / "record.jsonl"
    middleware = RecordingMiddleware(path=path, role="recon")
    middleware.wrap_model_call(_model_request(), lambda _r: _model_response())
    assert _entries(path)[0]["parent_attempt_id"] is None


def test_raw_usage_passthrough_only_under_flag(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_LLM__LOG_RAW_USAGE", raising=False)
    path = tmp_path / "record.jsonl"
    middleware = RecordingMiddleware(path=path, role="recon")
    middleware.wrap_model_call(_model_request(), lambda _r: _model_response())
    assert "raw_usage" not in _entries(path)[0]

    monkeypatch.setenv("RAPTIX_LLM__LOG_RAW_USAGE", "1")
    path2 = tmp_path / "record2.jsonl"
    middleware2 = RecordingMiddleware(path=path2, role="recon")
    middleware2.wrap_model_call(_model_request(), lambda _r: _model_response())
    entry = _entries(path2)[0]
    assert entry["raw_usage"]["usage_metadata"]["input_tokens"] == 11


def test_summary_call_is_recorded_separately(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_PATH", str(tmp_path / "record.jsonl"))

    class _SummaryModel:
        def invoke(self, _input, config=None, **_kwargs):
            return AIMessage(
                content="summary text",
                usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
                response_metadata={"model_name": "custom/glm"},
            )

    recorder = wrap_summary_model(_SummaryModel(), role="recon")
    assert isinstance(recorder, SummaryCallRecorder)
    recorder.invoke("summarize this")
    entries = _entries(tmp_path / "record.jsonl")
    assert entries[0]["kind"] == "summary_call"
    assert entries[0]["served_model"] == "custom/glm"
    assert entries[0]["response"]["usage_metadata"]["input_tokens"] == 100


def test_summary_model_is_returned_unchanged_without_a_record_path(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_RUNTIME__RECORD_PATH", raising=False)
    model = object()
    assert wrap_summary_model(model) is model
