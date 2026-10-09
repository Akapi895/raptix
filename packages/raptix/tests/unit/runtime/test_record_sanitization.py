"""Recorder export sanitization and redacted-record replay refusal (ADR-0060)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from raptix.runtime.recording import (
    NonReplayableRecord,
    RecordingMiddleware,
    export_sanitized,
    open_replay,
    record_level,
    sanitize_entry,
)


def test_sanitize_entry_redacts_secret_shapes_deterministically() -> None:
    entry = {
        "request": {
            "args": {
                "command": "curl -H 'Authorization: Bearer abcdef1234567890' http://x",
                "env": "API_KEY=sk-abcdefghijklmnop1234",
            }
        },
        "response": {
            "content": "password=SuperSecret1\njwt eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqrst"
        },
    }
    first = sanitize_entry(entry)
    second = sanitize_entry(entry)
    assert first == second
    blob = json.dumps(first)
    assert "abcdef1234567890" not in blob
    assert "sk-abcdefghijklmnop1234" not in blob
    assert "SuperSecret1" not in blob
    assert "[REDACTED:bearer]" in blob
    assert "[REDACTED:credential]" in blob


def test_sanitize_entry_leaves_ordinary_text_untouched() -> None:
    entry = {"response": {"content": "the password policy allows rotations every 90 days"}}
    assert sanitize_entry(entry) == entry


def test_redacted_level_marks_the_record_non_replayable(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_LEVEL", "redacted")
    path = tmp_path / "redacted.jsonl"
    middleware = RecordingMiddleware(path=path, role="recon")
    from types import SimpleNamespace

    request = SimpleNamespace(
        model=SimpleNamespace(model_name="m", name=None),
        system_message=None,
        messages=[],
        tools=[],
        state={},
        runtime=None,
    )
    from langchain.agents.middleware.types import ModelResponse
    from langchain_core.messages import AIMessage

    response = ModelResponse(result=[AIMessage(content="ok")], structured_response=None)
    middleware.wrap_model_call(request, lambda _r: response)

    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert lines[0]["kind"] == "record_header"
    assert lines[0]["replayable"] is False
    with pytest.raises(NonReplayableRecord):
        open_replay(path)


def test_export_sanitized_removes_secrets_and_marks_non_replayable(tmp_path: Path) -> None:
    source = tmp_path / "raw.jsonl"
    source.write_text(
        json.dumps(
            {
                "kind": "tool_call",
                "req_hash": "H1",
                "request": {
                    "tool": "bash",
                    "args": {"command": "export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz"},
                },
                "response": {"type": "tool", "content": "done"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    target = tmp_path / "share.jsonl"
    written = export_sanitized(source, target)
    assert written == 1
    contents = target.read_text(encoding="utf-8")
    assert "ghp_abcdefghijklmnopqrstuvwxyz" not in contents
    assert "[REDACTED:api_key]" in contents
    with pytest.raises(NonReplayableRecord):
        open_replay(target)


def test_raw_level_is_the_default(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_RUNTIME__RECORD_LEVEL", raising=False)
    assert record_level() == "raw"


def test_invalid_record_level_fails_naming_variable(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_RUNTIME__RECORD_LEVEL", "obfuscated")
    with pytest.raises(RuntimeError, match="RAPTIX_RUNTIME__RECORD_LEVEL"):
        record_level()
