"""Unit tests for LLM-assisted WebShell profile refinement (refine.py)."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from raptix.execution.tools.webshell.refine import (
    _extract_json,
    build_refine_messages,
    parse_refine_response,
    refine_profile,
)


ALLOWED = ["10.0.0.1"]

VALID_PROFILE = {
    "provider": "http-form-command",
    "target": "10.0.0.1",
    "endpoint": "http://10.0.0.1/phpbash.php",
    "method": "POST",
    "content_type": "application/x-www-form-urlencoded",
    "command_parameter": "cmd",
    "probe_command": "id;hostname",
    "probe_pattern": "uid=\\d+",
}


# --- _extract_json -------------------------------------------------------

class TestExtractJson:
    def test_plain_json(self) -> None:
        assert _extract_json('{"kind":"profile"}') == '{"kind":"profile"}'

    def test_fenced_json(self) -> None:
        text = '```json\n{"kind":"profile"}\n```'
        assert _extract_json(text) == '{"kind":"profile"}'

    def test_fenced_no_lang(self) -> None:
        text = '```\n{"kind":"profile"}\n```'
        assert _extract_json(text) == '{"kind":"profile"}'

    def test_whitespace_stripped(self) -> None:
        assert _extract_json('  {"ok":1}  ') == '{"ok":1}'


# --- build_refine_messages ------------------------------------------------

class TestBuildRefineMessages:
    def test_returns_two_messages(self) -> None:
        msgs = build_refine_messages({"poc": 1}, {"finding_id": "FIND-001"}, ALLOWED)
        assert len(msgs) == 2
        assert msgs[0]["role"] == "system"
        assert msgs[1]["role"] == "user"

    def test_includes_allowed_targets(self) -> None:
        msgs = build_refine_messages({}, {}, ["10.0.0.1", "10.0.0.2"])
        user = msgs[1]["content"]
        assert "10.0.0.1" in user
        assert "10.0.0.2" in user

    def test_includes_failure_reason(self) -> None:
        msgs = build_refine_messages({}, {}, ALLOWED, failure="command_parameter_ambiguous")
        user = msgs[1]["content"]
        assert "command_parameter_ambiguous" in user

    def test_failure_truncated(self) -> None:
        long_failure = "x" * 5000
        msgs = build_refine_messages({}, {}, ALLOWED, failure=long_failure)
        user = msgs[1]["content"]
        assert len(long_failure) > 4096
        assert "x" * 4096 in user


# --- parse_refine_response ------------------------------------------------

class TestParseRefineResponse:
    def test_valid_profile(self) -> None:
        text = json.dumps({"kind": "profile", "profile": VALID_PROFILE, "confidence": "high"})
        result = parse_refine_response(text, ALLOWED)
        assert result["status"] == "refined"
        assert result["profile"]["target"] == "10.0.0.1"
        assert result["confidence"] == "high"

    def test_refused(self) -> None:
        text = json.dumps({"kind": "refused", "reason": "not a webshell"})
        result = parse_refine_response(text, ALLOWED)
        assert result["status"] == "refused"
        assert "not a webshell" in result["reason"]

    def test_not_json(self) -> None:
        result = parse_refine_response("I cannot help with that.", ALLOWED)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_response_not_json"

    def test_not_object(self) -> None:
        result = parse_refine_response("[1,2,3]", ALLOWED)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_response_not_object"

    def test_missing_kind(self) -> None:
        result = parse_refine_response(json.dumps({"profile": VALID_PROFILE}), ALLOWED)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_response_missing_kind"

    def test_missing_profile(self) -> None:
        result = parse_refine_response(json.dumps({"kind": "profile"}), ALLOWED)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_response_missing_profile"

    def test_invalid_profile(self) -> None:
        bad = {**VALID_PROFILE, "provider": "wrong"}
        result = parse_refine_response(json.dumps({"kind": "profile", "profile": bad}), ALLOWED)
        assert result["status"] == "failed"
        assert "llm_profile_invalid" in result["reason"]

    def test_target_outside_scope(self) -> None:
        evil = {**VALID_PROFILE, "target": "evil.com", "endpoint": "http://evil.com/sh.php"}
        result = parse_refine_response(json.dumps({"kind": "profile", "profile": evil}), ALLOWED)
        assert result["status"] == "refused"
        assert "outside_scope" in result["reason"]

    def test_fenced_json_accepted(self) -> None:
        text = f"```json\n{json.dumps({'kind': 'profile', 'profile': VALID_PROFILE, 'confidence': 'medium'})}\n```"
        result = parse_refine_response(text, ALLOWED)
        assert result["status"] == "refined"


# --- refine_profile (async) -----------------------------------------------

class TestRefineProfile:
    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        response = MagicMock()
        response.content = json.dumps({"kind": "profile", "profile": VALID_PROFILE, "confidence": "high"})
        model = AsyncMock()
        model.ainvoke.return_value = response
        result = await refine_profile(model, {}, {}, ALLOWED)
        assert result["status"] == "refined"
        model.ainvoke.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_timeout(self) -> None:
        model = AsyncMock()
        model.ainvoke.side_effect = asyncio.TimeoutError()
        result = await refine_profile(model, {}, {}, ALLOWED, timeout_seconds=1)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_timeout"

    @pytest.mark.asyncio
    async def test_llm_error(self) -> None:
        model = AsyncMock()
        model.ainvoke.side_effect = RuntimeError("API down")
        result = await refine_profile(model, {}, {}, ALLOWED)
        assert result["status"] == "failed"
        assert "llm_error" in result["reason"]

    @pytest.mark.asyncio
    async def test_refused_by_llm(self) -> None:
        response = MagicMock()
        response.content = json.dumps({"kind": "refused", "reason": "not a webshell PoC"})
        model = AsyncMock()
        model.ainvoke.return_value = response
        result = await refine_profile(model, {}, {}, ALLOWED)
        assert result["status"] == "refused"

    @pytest.mark.asyncio
    async def test_garbage_response(self) -> None:
        response = MagicMock()
        response.content = "Sure! Here is some helpful text."
        model = AsyncMock()
        model.ainvoke.return_value = response
        result = await refine_profile(model, {}, {}, ALLOWED)
        assert result["status"] == "failed"
        assert result["reason"] == "llm_response_not_json"
