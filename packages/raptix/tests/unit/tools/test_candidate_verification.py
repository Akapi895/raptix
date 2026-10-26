from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.plumbing import candidate_verification
from raptix.execution.tools.plumbing.candidate_verification import (
    verify_workspace_candidate,
    with_status,
)

FINDING = "FIND-001"
FINDING_PATH = "findings/FIND-001.md"
RECORD_PATH = "findings/evidence/FIND-001_verification.json"
POC_PATH = "findings/poc/FIND-001.py"
ROE_PATH = "plan/roe.json"
POC_BYTES = b"print('root:x:0:0')\n"
CVSS = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"
PAYLOAD = "%27OR1%3D1--"
COMMAND = "curl -s 'http://10.0.0.5/search?q=%27OR1%3D1--'"
NEGATIVE = "curl -s 'http://10.0.0.5/search?q='"


def _block(**overrides: Any) -> dict[str, Any]:
    """The unsealed fields of a PoC block, as the generator writes them (ADR-0103)."""
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


def _seal(block: dict[str, Any]) -> dict[str, Any]:
    """The block with its seal, computed with the recipe from the finding protocol rather than the module's helper."""
    body = {key: value for key, value in block.items() if key != "spec_sha256"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {**body, "spec_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest()}


def _finding(section: str | None, status: str = "candidate") -> str:
    poc = f"## Proof of Concept\n```json\n{section}\n```\n" if section is not None else ""
    return f"---\nid: {FINDING}\nstatus: {status}\n---\n# Title\n\n{poc}"


def _sealed_finding(block: dict[str, Any] | None, status: str = "candidate") -> str:
    return _finding(None if block is None else json.dumps(_seal(block), indent=2), status)


class _Files:
    """An in-memory project with the read and write surface of ProjectFiles."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = dict(files)
        self.writes: list[str] = []
        self.unreachable: set[str] = set()

    def read_bytes(self, rel: str, *, max_bytes: int = 0) -> bytes | None:
        if rel in self.unreachable:
            raise ProjectFileUnavailable(f"{rel}: sandbox unreachable")
        return self.files.get(rel)

    def write_bytes(self, rel: str, data: bytes) -> None:
        self.writes.append(rel)
        self.files[rel] = data


class _Validator:
    """Stands in for validate_workspace_finding: records each call and returns a canned result."""

    def __init__(self, result: str) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def ainvoke(self, args: dict[str, Any], config: Any = None) -> str:
        self.calls.append(args)
        return self.result


def _complete() -> dict[str, Any]:
    return {
        "proof": {"complete": True, "exit_code": 0},
        "control": {"complete": True, "exit_code": 0},
    }


def _validated() -> str:
    return json.dumps(
        {"finding_id": FINDING, "validated": True, "verification_execution": _complete()},
        sort_keys=True,
    )


def _rejected() -> str:
    return json.dumps(
        {"finding_id": FINDING, "validated": False, "verification_execution": _complete()},
        sort_keys=True,
    )


def _incomplete() -> str:
    execution = _complete()
    execution["proof"] = {"complete": False, "exit_code": None}
    return json.dumps(
        {"finding_id": FINDING, "validated": False, "verification_execution": execution},
        sort_keys=True,
    )


def _project(finding: str, *, poc: bytes | None = POC_BYTES, roe: str | None = None) -> _Files:
    files = {FINDING_PATH: finding.encode("utf-8")}
    if poc is not None:
        files[POC_PATH] = poc
    if roe is not None:
        files[ROE_PATH] = roe.encode("utf-8")
    return _Files(files)


async def _verify(
    monkeypatch: pytest.MonkeyPatch,
    files: _Files,
    validator: _Validator | None = None,
    finding_id: str = FINDING,
) -> dict[str, Any]:
    monkeypatch.setattr(candidate_verification, "project_files_for", lambda config: files)
    monkeypatch.setattr(
        candidate_verification,
        "validate_workspace_finding",
        validator if validator is not None else _Validator(_validated()),
    )
    raw = await verify_workspace_candidate.ainvoke({"finding_id": finding_id}, config={})
    return json.loads(raw)


def _record(files: _Files) -> dict[str, Any]:
    return json.loads(files.files[RECORD_PATH])


def _status(files: _Files) -> str:
    return files.files[FINDING_PATH].decode("utf-8").split("status: ", 1)[1].split("\n", 1)[0]


def test_tool_takes_only_the_finding_id() -> None:
    assert set(verify_workspace_candidate.args) == {"finding_id"}


async def test_validated_poc_confirms_the_finding(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()))

    result = await _verify(monkeypatch, files, _Validator(_validated()))

    assert result == {
        "finding_id": FINDING,
        "verdict": "confirmed",
        "refusal": None,
        "record": RECORD_PATH,
    }
    record = _record(files)
    assert record["verdict"] == "confirmed"
    assert record["poc_sha256"] == hashlib.sha256(POC_BYTES).hexdigest()
    assert record["spec_sha256"] == _seal(_block())["spec_sha256"]
    assert record["tool_result"]["validated"] is True
    assert _status(files) == "confirmed"


async def test_validator_receives_only_the_sealed_values(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()))
    validator = _Validator(_validated())

    await _verify(monkeypatch, files, validator)

    assert validator.calls == [
        {
            "finding_id": FINDING,
            "poc_command": COMMAND,
            "success_patterns": "root:x:0:0",
            "negative_command": NEGATIVE,
            "negative_patterns": "no results",
            "cvss_vector": CVSS,
        }
    ]


async def test_poc_that_runs_without_validating_rejects_the_finding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block()))

    result = await _verify(monkeypatch, files, _Validator(_rejected()))

    assert result["verdict"] == "rejected"
    assert result["refusal"] is None
    assert _record(files)["verdict"] == "rejected"
    assert _status(files) == "rejected"


async def test_incomplete_execution_keeps_the_finding_a_candidate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block()))

    result = await _verify(monkeypatch, files, _Validator(_incomplete()))

    assert result["verdict"] == "candidate"
    assert result["refusal"] == "execution_incomplete"
    assert _status(files) == "candidate"


async def test_tool_error_keeps_the_finding_a_candidate(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()))
    error = json.dumps({"error": "HTTPSandbox not initialized"}, sort_keys=True)

    result = await _verify(monkeypatch, files, _Validator(error))

    assert result["verdict"] == "candidate"
    assert result["refusal"] == "verification_error: HTTPSandbox not initialized"


async def test_unreadable_tool_output_keeps_the_finding_a_candidate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block()))

    result = await _verify(monkeypatch, files, _Validator("not json"))

    assert result["verdict"] == "candidate"
    assert result["refusal"] == "verification_error: unreadable tool output"


@pytest.mark.parametrize(
    ("validator_result", "verdict", "expected_writes"),
    [
        (_validated(), "confirmed", [RECORD_PATH, FINDING_PATH]),
        (_rejected(), "rejected", [FINDING_PATH, RECORD_PATH]),
    ],
)
async def test_status_is_written_after_its_record_only_when_confirmed(
    monkeypatch: pytest.MonkeyPatch,
    validator_result: str,
    verdict: str,
    expected_writes: list[str],
) -> None:
    files = _project(_sealed_finding(_block()))

    await _verify(monkeypatch, files, _Validator(validator_result))

    assert files.writes == expected_writes
    assert _record(files)["verdict"] == verdict


async def test_finding_without_a_poc_block_stays_a_candidate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_finding(None))
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"] == "no_poc_block"
    assert validator.calls == []


async def test_poc_block_that_is_not_json_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_finding("{not json"))
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("poc_block_invalid_json")
    assert validator.calls == []


async def test_poc_block_that_is_not_an_object_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_finding("[1, 2]"))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == "poc_block_not_object"


async def test_block_edited_after_sealing_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    sealed = _seal(_block())
    sealed["command"] = COMMAND.replace("1%3D1", "2%3D2")
    files = _project(_finding(json.dumps(sealed, indent=2)))
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("seal_mismatch")
    assert validator.calls == []


async def test_confirmed_finding_loses_its_confirmation_when_its_block_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sealed = _seal(_block())
    sealed["command"] = COMMAND.replace("1%3D1", "2%3D2")
    files = _project(_finding(json.dumps(sealed, indent=2), status="confirmed"))

    result = await _verify(monkeypatch, files)

    assert result["verdict"] == "candidate"
    assert _status(files) == "candidate"


async def test_block_missing_a_required_field_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    block = _block()
    del block["negative_patterns"]
    files = _project(_finding(json.dumps(_seal(block), indent=2)))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == "poc_block_missing: negative_patterns"


async def test_blank_text_field_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block(cvss_vector="   ")))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == "poc_block_invalid: cvss_vector"


async def test_pattern_field_that_is_not_a_list_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block(success_patterns="root:x:0:0")))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == "poc_block_invalid: success_patterns"


async def test_poc_outside_the_poc_directory_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block(file="findings/FIND-001.py")))
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"] == "poc_block_invalid: file must be under findings/poc/"
    assert validator.calls == []


async def test_missing_poc_file_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()), poc=None)

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == f"poc_file_missing: {POC_PATH}"


async def test_poc_file_edited_after_sealing_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()), poc=b"print('changed')\n")
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("poc_hash_mismatch")
    assert validator.calls == []


async def test_payload_occurring_twice_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    command = f"{COMMAND} {PAYLOAD}"
    files = _project(_sealed_finding(_block(command=command)))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == (
        "baseline_invalid: the payload must occur exactly once in the command"
    )


async def test_negative_command_that_is_not_the_baseline_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block(negative_command="curl -s 'http://10.0.0.5/other'")))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == (
        "baseline_invalid: negative_command is not the command with the payload removed"
    )


async def test_pattern_with_a_comma_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block(success_patterns=["root,x:0:0"])))

    result = await _verify(monkeypatch, files)

    assert result["refusal"] == "pattern_invalid: a pattern cannot contain a comma"


async def test_pattern_shorter_than_four_characters_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block(success_patterns=["ro"])))

    result = await _verify(monkeypatch, files)

    assert result["refusal"].startswith("pattern_invalid: shorter than 4 characters")


async def test_pattern_that_is_not_a_regex_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block(success_patterns=["(root"])))

    result = await _verify(monkeypatch, files)

    assert result["refusal"].startswith("pattern_invalid:")


async def test_pattern_that_matches_empty_output_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block(success_patterns=[r"\w*\s*\d*"])))

    result = await _verify(monkeypatch, files)

    assert result["refusal"].startswith("pattern_invalid: matches the empty output")


async def test_unreadable_roe_refuses_the_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()), roe="{not json")
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("roe_unavailable:")
    assert validator.calls == []


async def test_unknown_roe_mode_refuses_the_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    roe = json.dumps({"machine_enforcement": {"mode": "bogus"}})
    files = _project(_sealed_finding(_block()), roe=roe)
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("roe_unavailable:")
    assert validator.calls == []


async def test_unreachable_sandbox_refuses_the_roe_read(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _project(_sealed_finding(_block()))
    files.unreachable.add(ROE_PATH)
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("roe_unavailable:")
    assert validator.calls == []


async def test_target_outside_the_in_scope_list_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    roe = json.dumps({"machine_enforcement": {"mode": "enforce", "in_scope": ["192.168.1.0/24"]}})
    files = _project(_sealed_finding(_block()), roe=roe)
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("out_of_scope: NOT_IN_SCOPE")
    assert validator.calls == []


async def test_target_in_scope_is_verified(monkeypatch: pytest.MonkeyPatch) -> None:
    roe = json.dumps({"machine_enforcement": {"mode": "enforce", "in_scope": ["10.0.0.0/24"]}})
    files = _project(_sealed_finding(_block()), roe=roe)

    result = await _verify(monkeypatch, files, _Validator(_validated()))

    assert result["verdict"] == "confirmed"


async def test_forbidden_command_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    roe = json.dumps(
        {"machine_enforcement": {"mode": "enforce", "forbidden_command_patterns": ["OR1%3D1"]}}
    )
    files = _project(_sealed_finding(_block()), roe=roe)
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("out_of_scope: FORBIDDEN_COMMAND")
    assert validator.calls == []


async def test_blackout_window_refuses_the_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(UTC)
    window = [(now - timedelta(hours=1)).isoformat(), (now + timedelta(hours=1)).isoformat()]
    roe = json.dumps({"machine_enforcement": {"mode": "enforce", "blackout_windows": [window]}})
    files = _project(_sealed_finding(_block()), roe=roe)
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator)

    assert result["refusal"].startswith("out_of_scope: BLACKOUT_WINDOW")
    assert validator.calls == []


async def test_missing_finding_is_reported_without_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _Files({})

    result = await _verify(monkeypatch, files)

    assert result == {"error": "finding_not_found", "finding_id": FINDING}
    assert files.writes == []


async def test_unreachable_project_is_reported_without_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _project(_sealed_finding(_block()))
    files.unreachable.add(FINDING_PATH)

    result = await _verify(monkeypatch, files)

    assert result["error"] == "project_unavailable"
    assert files.writes == []


@pytest.mark.parametrize("finding_id", ["FIND-1", "../FIND-001", "find-001", "FIND-0001"])
async def test_malformed_finding_id_is_rejected_before_any_read(
    monkeypatch: pytest.MonkeyPatch, finding_id: str
) -> None:
    files = _project(_sealed_finding(_block()))
    validator = _Validator(_validated())

    result = await _verify(monkeypatch, files, validator, finding_id=finding_id)

    assert result == {"error": "invalid_finding_id"}
    assert validator.calls == []
    assert files.writes == []


async def test_finding_that_is_not_utf8_is_reported_without_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _Files({FINDING_PATH: b"\xff\xfe\x00"})

    result = await _verify(monkeypatch, files)

    assert result == {"error": "finding_not_utf8", "finding_id": FINDING}
    assert files.writes == []


def test_with_status_replaces_an_existing_status_line() -> None:
    markdown = "---\nid: FIND-001\nstatus: candidate\n---\n# Title\n"

    assert with_status(markdown, "confirmed") == (
        "---\nid: FIND-001\nstatus: confirmed\n---\n# Title\n"
    )


def test_with_status_adds_a_status_line_to_frontmatter_without_one() -> None:
    markdown = "---\nid: FIND-001\n---\n# Title\n"

    assert (
        with_status(markdown, "rejected") == "---\nid: FIND-001\nstatus: rejected\n---\n# Title\n"
    )


def test_with_status_adds_frontmatter_when_there_is_none() -> None:
    assert with_status("# Title\n", "candidate") == "---\nstatus: candidate\n---\n# Title\n"
