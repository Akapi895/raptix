"""Structured summary references are validated before a compaction commits (ADR-0053)."""

from __future__ import annotations

import json
from types import SimpleNamespace

from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain.agents.middleware.types import ExtendedModelResponse, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from raptix.intelligence.agents.middleware_slots import _SafeSummarizationProxy
from raptix.intelligence.context.summary_contract import validate_structured_summary

GOOD = "## SESSION INTENT\nx\n## SUMMARY\ny\n## ARTIFACTS\nNone\n## NEXT STEPS\nz"
REF = "/workspace/evidence/a.txt"


class MemoryBackend:
    def __init__(self, files: dict[str, str] | None = None) -> None:
        self.files = dict(files or {})

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


class Inner:
    state_schema = dict
    tools: list = []
    name = "inner"


def _content(payload: dict) -> str:
    return f"{GOOD}\n```json\n{json.dumps(payload)}\n```"


def _valid(ref: str = REF) -> dict:
    return {
        "completed_work": [{"ref": ref, "evidence": True}],
        "evidence": [{"ref": ref}],
        "failed_attempts": [],
        "unresolved": [],
        "hypotheses": [],
    }


def _request() -> SimpleNamespace:
    state = {
        "context_epoch": 0,
        "active_objective_id": "OBJ-001",
        "workspace_path": "/workspace",
        "messages": [HumanMessage("a")],
    }
    return SimpleNamespace(
        state=state,
        runtime=SimpleNamespace(config={"configurable": {"thread_id": "t"}}),
        messages=state["messages"],
    )


def _proxy(backend: MemoryBackend) -> _SafeSummarizationProxy:
    return _SafeSummarizationProxy(Inner(), task_state_backend=backend)


def _finalize(proxy: _SafeSummarizationProxy, content: str, request) -> dict:
    response = ExtendedModelResponse(
        ModelResponse(result=[AIMessage(content="ok")]),
        Command(
            update={
                "_summarization_event": {
                    "cutoff_index": 1,
                    "summary_message": HumanMessage(content),
                    "file_path": None,
                }
            }
        ),
    )
    return proxy._finalize(response, request).command.update


def test_validator_accepts_a_resolvable_summary() -> None:
    backend = MemoryBackend({REF: "evidence"})
    ok, errors = validate_structured_summary(
        _content(_valid()), evidence_refs=[], action_hashes=[], backend=backend
    )
    assert ok, errors


def test_validator_rejects_missing_block() -> None:
    ok, errors = validate_structured_summary(GOOD, evidence_refs=[], action_hashes=[], backend=None)
    assert not ok
    assert "missing structured JSON block" in errors


def test_validator_rejects_unknown_ledger_hash() -> None:
    payload = _valid()
    payload["failed_attempts"] = [
        {"action_hash": "deadbeef", "reason": "x", "retry_condition": "y"}
    ]
    ok, errors = validate_structured_summary(
        _content(payload), evidence_refs=[], action_hashes=["cafe"], backend=None
    )
    assert not ok
    assert any("unknown ledger action hash" in error for error in errors)


def test_validator_rejects_hypothesis_as_completed_work() -> None:
    payload = _valid(ref="maybe-sqli")
    payload["hypotheses"] = ["maybe-sqli"]
    ok, errors = validate_structured_summary(
        _content(payload),
        evidence_refs=[],
        action_hashes=[],
        backend=MemoryBackend({"maybe-sqli": "x"}),
    )
    assert not ok
    assert any("hypothesis cited as completed work" in error for error in errors)


def test_proxy_keeps_valid_structured_event(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_SUMMARY_STRUCTURED", "1")
    backend = MemoryBackend({REF: "evidence"})
    update = _finalize(_proxy(backend), _content(_valid()), _request())
    assert "_summarization_event" in update


def test_proxy_strips_unresolved_reference(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_SUMMARY_STRUCTURED", "1")
    backend = MemoryBackend({REF: "evidence"})
    payload = _valid(ref="/workspace/evidence/missing.txt")
    update = _finalize(_proxy(backend), _content(payload), _request())
    assert "_summarization_event" not in update


def test_proxy_strips_malformed_structured_block(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_SUMMARY_STRUCTURED", "1")
    backend = MemoryBackend({REF: "evidence"})
    update = _finalize(_proxy(backend), f"{GOOD}\n```json\nnot json\n```", _request())
    assert "_summarization_event" not in update
