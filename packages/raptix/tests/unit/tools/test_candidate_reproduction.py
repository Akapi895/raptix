from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.plumbing.candidate_verification import (
    TOKEN_PLACEHOLDER,
    _Refused,
    read_sealed_poc,
    reproduce_sealed,
    substitute_token,
)

FINDING_PATH = "findings/FIND-001.md"
POC_PATH = "findings/poc/FIND-001.py"
POC_BYTES = b"print('root:x:0:0')\n"
CVSS = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"
PAYLOAD = "%27OR1%3D1--"
COMMAND = (
    f"curl -s 'http://{TOKEN_PLACEHOLDER}/search?q={PAYLOAD}' -H 'X-Session: {TOKEN_PLACEHOLDER}'"
)
NEGATIVE = f"curl -s 'http://{TOKEN_PLACEHOLDER}/search?q=' -H 'X-Session: {TOKEN_PLACEHOLDER}'"


def _seal(block: dict[str, Any]) -> dict[str, Any]:
    body = {key: value for key, value in block.items() if key != "spec_sha256"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {**body, "spec_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest()}


def _block(**overrides: Any) -> dict[str, Any]:
    block: dict[str, Any] = {
        "file": POC_PATH,
        "poc_sha256": hashlib.sha256(POC_BYTES).hexdigest(),
        "payload": PAYLOAD,
        "command": COMMAND,
        "success_patterns": ["root:x:0:0"],
        "negative_command": NEGATIVE,
        "negative_patterns": ["no results"],
        "cvss_vector": CVSS,
    }
    block.update(overrides)
    return block


def _finding(block: dict[str, Any] | None) -> str:
    section = (
        ""
        if block is None
        else f"## Proof of Concept\n```json\n{json.dumps(_seal(block), indent=2)}\n```\n"
    )
    return f"---\nid: FIND-001\nstatus: candidate\n---\n# Title\n\n{section}"


class _Files:
    """An in-memory project with the read, write and exists surface that the reproduction uses."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = dict(files)
        self.writes: list[str] = []

    def read_bytes(self, rel: str, *, max_bytes: int = 0) -> bytes | None:
        return self.files.get(rel)

    def write_bytes(self, rel: str, data: bytes) -> None:
        self.writes.append(rel)
        self.files[rel] = data

    def exists(self, rel: str) -> bool:
        return rel in self.files


class _Runner:
    """Stands in for the sandbox runner: records each command and returns canned (stdout, stderr, exit) tuples."""

    def __init__(self, outputs: list[tuple[str, str, int]]) -> None:
        self.outputs = outputs
        self.commands: list[str] = []

    async def __call__(self, command: str) -> tuple[str, str, int]:
        self.commands.append(command)
        return self.outputs[len(self.commands) - 1]


def _project(finding: str, *, roe: str | None = None, poc: bool = True) -> _Files:
    files = {FINDING_PATH: finding.encode("utf-8")}
    if poc:
        files[POC_PATH] = POC_BYTES
    if roe is not None:
        files["plan/roe.json"] = roe.encode("utf-8")
    return _Files(files)


def _reproducing_outputs() -> list[tuple[str, str, int]]:
    return [("root:x:0:0 uid=0", "", 0), ("no results", "", 0)]


def test_substitute_token_replaces_every_placeholder_and_keeps_the_rest() -> None:
    command = f"curl {TOKEN_PLACEHOLDER} {TOKEN_PLACEHOLDER}"

    assert substitute_token(command, "abc.def-1") == "curl abc.def-1 abc.def-1"


def test_substitute_token_leaves_a_command_without_placeholder_unchanged() -> None:
    assert substitute_token("id", None) == "id"


@pytest.mark.parametrize("value", [None, "", "a b", "a;id", "$(id)", "a'b", "x|y", "a\nb"])
def test_substitute_token_refuses_values_that_could_add_shell_syntax(value: str | None) -> None:
    with pytest.raises(_Refused, match="run_time_value_invalid"):
        substitute_token(f"curl {TOKEN_PLACEHOLDER}", value)


async def test_reproduction_runs_both_commands_with_the_value_substituted() -> None:
    files = _project(_finding(_block()))
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert runner.commands == [
        "curl -s 'http://tok-123/search?q=%27OR1%3D1--' -H 'X-Session: tok-123'",
        "curl -s 'http://tok-123/search?q=' -H 'X-Session: tok-123'",
    ]
    assert result["outcome"] == "ran"
    assert result["reproduced"] is True
    assert result["positive"]["matched_patterns"] == ["root:x:0:0"]
    assert result["negative"]["matched_patterns"] == ["no results"]


async def test_reproduction_writes_a_record_without_the_value_and_without_a_verdict() -> None:
    files = _project(_finding(_block()))
    runner = _Runner([("root:x:0:0 tok-123", "", 0), ("no results", "", 0)])

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    records = [
        path for path in files.writes if path.startswith("findings/evidence/FIND-001_reproduce_")
    ]
    assert len(records) == 1
    stored = files.files[records[0]].decode("utf-8")
    assert "tok-123" not in stored
    assert "tok-123" not in json.dumps(result)
    assert TOKEN_PLACEHOLDER in stored
    assert "findings/evidence/FIND-001_verification.json" not in files.writes
    assert files.files[FINDING_PATH].decode("utf-8").count("status: candidate") == 1


async def test_output_is_redacted_before_it_is_returned() -> None:
    files = _project(_finding(_block()))
    runner = _Runner([("session=tok-123 root:x:0:0", "", 0), ("no results", "", 0)])

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert "tok-123" not in result["positive"]["output"]
    assert "[redacted]" in result["positive"]["output"]


async def test_reproduction_refuses_a_missing_value_before_running_anything() -> None:
    files = _project(_finding(_block()))
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", None)

    assert result["outcome"] == "refused"
    assert result["refusal"].startswith("run_time_value_invalid")
    assert runner.commands == []


async def test_reproduction_refuses_a_broken_seal() -> None:
    sealed = _seal(_block())
    sealed["command"] = COMMAND.replace("OR1", "OR2")
    files = _project(
        f"---\nid: FIND-001\n---\n## Proof of Concept\n```json\n{json.dumps(sealed)}\n```\n"
    )
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert result["refusal"].startswith("seal_mismatch")
    assert runner.commands == []


async def test_reproduction_refuses_when_the_abort_marker_is_present() -> None:
    files = _project(_finding(_block()))
    files.files[".abort"] = b"stop"
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert result["refusal"].startswith("agent_halted")
    assert runner.commands == []


async def test_roe_checks_the_executed_command_so_a_value_cannot_add_a_target() -> None:
    roe = json.dumps({"machine_enforcement": {"mode": "enforce", "in_scope": ["10.0.0.0/24"]}})
    block = _block(
        command=f"curl -s http://{TOKEN_PLACEHOLDER}/search?q={PAYLOAD}",
        negative_command=f"curl -s http://{TOKEN_PLACEHOLDER}/search?q=",
    )
    files = _project(_finding(block), roe=roe)
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "192.168.9.9")

    assert result["refusal"].startswith("out_of_scope: NOT_IN_SCOPE")
    assert runner.commands == []


async def test_roe_unreadable_refuses_the_reproduction() -> None:
    files = _project(_finding(_block()), roe="{not json")
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert result["refusal"].startswith("roe_unavailable")
    assert runner.commands == []


async def test_blackout_window_refuses_the_reproduction() -> None:
    now = datetime.now(UTC)
    window = [(now - timedelta(hours=1)).isoformat(), (now + timedelta(hours=1)).isoformat()]
    roe = json.dumps({"machine_enforcement": {"mode": "enforce", "blackout_windows": [window]}})
    files = _project(_finding(_block()), roe=roe)
    runner = _Runner(_reproducing_outputs())

    result = await reproduce_sealed(files, runner, "FIND-001", "tok-123")

    assert result["refusal"].startswith("out_of_scope: BLACKOUT_WINDOW")
    assert runner.commands == []


async def test_unreachable_project_is_refused_not_raised() -> None:
    class _Down(_Files):
        def read_bytes(self, rel: str, *, max_bytes: int = 0) -> bytes | None:
            raise ProjectFileUnavailable(f"{rel}: sandbox unreachable")

    result = await reproduce_sealed(_Down({}), _Runner([]), "FIND-001", "tok-123")

    assert result["outcome"] == "refused"
    assert result["refusal"].startswith("project_unavailable")


async def test_read_returns_the_sealed_command_with_the_placeholder_and_no_value() -> None:
    files = _project(_finding(_block()))

    view = await read_sealed_poc(files, "FIND-001")

    assert view["status"] == "sealed"
    assert view["run_time_value"] is True
    assert TOKEN_PLACEHOLDER in view["command"]
    assert view["success_patterns"] == ["root:x:0:0"]
    assert files.writes == []


async def test_read_returns_the_poc_file_verbatim_and_the_payload() -> None:
    files = _project(_finding(_block()))

    view = await read_sealed_poc(files, "FIND-001")

    assert view["source"] == POC_BYTES.decode("utf-8")
    assert view["source_truncated"] is False
    assert view["payload"] == PAYLOAD


async def test_read_marks_a_poc_file_longer_than_the_limit_as_truncated() -> None:
    files = _project(_finding(_block()))
    files.files[POC_PATH] = b"x" * 70_000
    files.files[FINDING_PATH] = _finding(
        _block(poc_sha256=hashlib.sha256(b"x" * 70_000).hexdigest())
    ).encode("utf-8")

    view = await read_sealed_poc(files, "FIND-001")

    assert view["status"] == "sealed"
    assert view["source_truncated"] is True
    assert len(view["source"]) == 65536


async def test_read_reports_a_finding_without_a_block() -> None:
    files = _project(_finding(None), poc=False)

    view = await read_sealed_poc(files, "FIND-001")

    assert view == {"finding_id": "FIND-001", "status": "no_poc_block"}
