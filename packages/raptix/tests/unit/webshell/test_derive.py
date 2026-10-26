"""Unit tests for deterministic WebShell profile derivation (derive.py)."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from raptix.execution.tools.webshell.derive import (
    _derive_from_spec,
    _parse_curl_tokens,
    derive_profile,
)


# --- _parse_curl_tokens -------------------------------------------------

class TestParseCurlTokens:
    def test_simple_post_form(self) -> None:
        tokens = ["curl", "-X", "POST", "-d", "cmd=id", "http://10.0.0.1/shell.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["url"] == "http://10.0.0.1/shell.php"
        assert result["method"] == "POST"
        assert result["form"] == {"cmd": "id"}

    def test_data_urlencode(self) -> None:
        tokens = ["curl", "--data-urlencode", "cmd=whoami", "http://10.0.0.1/shell.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["method"] == "POST"
        assert result["form"] == {"cmd": "whoami"}

    def test_header_extraction(self) -> None:
        tokens = ["curl", "-H", "User-Agent: RT/1.0", "-d", "cmd=id", "http://10.0.0.1/sh.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["headers"]["User-Agent"] == "RT/1.0"

    def test_no_url_returns_none(self) -> None:
        tokens = ["curl", "-d", "cmd=id"]
        result = _parse_curl_tokens(tokens)
        assert result is None

    def test_not_curl_returns_none(self) -> None:
        tokens = ["wget", "http://10.0.0.1/"]
        result = _parse_curl_tokens(tokens)
        assert result is None

    def test_empty_returns_none(self) -> None:
        assert _parse_curl_tokens([]) is None

    def test_skip_flags_ignored(self) -> None:
        tokens = ["curl", "-s", "-k", "-L", "http://10.0.0.1/shell.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["url"] == "http://10.0.0.1/shell.php"
        assert result["method"] == "GET"

    def test_arg_flags_consumed(self) -> None:
        tokens = ["curl", "--max-time", "30", "-d", "cmd=id", "http://10.0.0.1/shell.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["form"] == {"cmd": "id"}

    def test_multiple_form_fields(self) -> None:
        tokens = ["curl", "-d", "user=admin&cmd=id", "http://10.0.0.1/sh.php"]
        result = _parse_curl_tokens(tokens)
        assert result is not None
        assert result["form"] == {"user": "admin", "cmd": "id"}


# --- _derive_from_spec ---------------------------------------------------

def _make_spec(
    command: str = "curl -X POST -d 'cmd=id;hostname' http://10.0.0.1/phpbash.php",
    negative_command: str = "curl -X POST -d 'cmd=' http://10.0.0.1/phpbash.php",
    payload: str = "id;hostname",
    success_patterns: list[str] | None = None,
    poc_sha256: str = "abc123",
) -> Any:
    spec = MagicMock()
    spec.command = command
    spec.negative_command = negative_command
    spec.payload = payload
    spec.success_patterns = success_patterns if success_patterns is not None else ["uid=\\d+"]
    spec.poc_sha256 = poc_sha256
    return spec


class TestDeriveFromSpec:
    def test_happy_path(self) -> None:
        spec = _make_spec()
        block: dict[str, Any] = {"spec_sha256": "seal123"}
        result = _derive_from_spec(spec, block)
        assert result["status"] == "derived"
        profile = result["profile"]
        assert profile["provider"] == "http-form-command"
        assert profile["target"] == "10.0.0.1"
        assert profile["endpoint"] == "http://10.0.0.1/phpbash.php"
        assert profile["command_parameter"] == "cmd"
        assert profile["probe_command"] == "id;hostname"
        assert profile["probe_pattern"] == "uid=\\d+"
        assert result["poc_sha256"] == "abc123"

    def test_not_a_curl_command(self) -> None:
        spec = _make_spec(command="wget http://10.0.0.1/phpbash.php", negative_command="wget http://10.0.0.1/phpbash.php")
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "not_a_curl_command"

    def test_method_not_post(self) -> None:
        spec = _make_spec(command="curl http://10.0.0.1/phpbash.php", negative_command="curl http://10.0.0.1/phpbash.php")
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "method_not_post"

    def test_url_mismatch(self) -> None:
        spec = _make_spec(
            command="curl -X POST -d 'cmd=id' http://10.0.0.1/shell.php",
            negative_command="curl -X POST -d 'cmd=' http://10.0.0.1/other.php",
        )
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "url_mismatch_between_commands"

    def test_ambiguous_parameter(self) -> None:
        spec = _make_spec(
            command="curl -X POST -d 'a=id;hostname&b=id;hostname' http://10.0.0.1/sh.php",
            negative_command="curl -X POST -d 'a=&b=' http://10.0.0.1/sh.php",
        )
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "command_parameter_ambiguous"

    def test_no_success_patterns(self) -> None:
        spec = _make_spec(success_patterns=[])
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "no_success_patterns"

    def test_unparseable_command(self) -> None:
        spec = _make_spec(command="curl -d 'unterminated", negative_command="curl -d 'unterminated")
        result = _derive_from_spec(spec, {})
        assert result["status"] == "needs_refinement"
        assert result["reason"] == "command_not_parseable"

    def test_headers_filtered(self) -> None:
        spec = _make_spec(
            command="curl -X POST -H 'User-Agent: Bashed-RT/1.0' -H 'X-Evil: drop' -d 'cmd=id;hostname' http://10.0.0.1/phpbash.php",
            negative_command="curl -X POST -H 'User-Agent: Bashed-RT/1.0' -H 'X-Evil: drop' -d 'cmd=' http://10.0.0.1/phpbash.php",
        )
        result = _derive_from_spec(spec, {})
        assert result["status"] == "derived"
        assert result["profile"]["headers"] == {"User-Agent": "Bashed-RT/1.0"}


# --- derive_profile (async integration) ----------------------------------

def _seal_of_block(block: dict[str, Any]) -> str:
    from raptix.execution.tools.plumbing.candidate_verification import seal_of
    return seal_of(block)


class TestDeriveProfile:
    @pytest.mark.asyncio
    async def test_finding_not_found(self) -> None:
        files = MagicMock()
        files.read_bytes.return_value = None
        result = await derive_profile(files, "FIND-999")
        assert result["status"] == "refused"
        assert "finding_not_found" in result["reason"]

    @pytest.mark.asyncio
    async def test_project_unavailable(self) -> None:
        from raptix.execution.backends.project_files import ProjectFileUnavailable
        files = MagicMock()
        files.read_bytes.side_effect = ProjectFileUnavailable("gone")
        result = await derive_profile(files, "FIND-001")
        assert result["status"] == "refused"
        assert "project_unavailable" in result["reason"]
