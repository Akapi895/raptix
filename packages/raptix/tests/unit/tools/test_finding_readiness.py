from __future__ import annotations

import json

import pytest

from raptix.execution.backends.project_files import ProjectFileUnavailable
from raptix.execution.tools.plumbing import candidate_verification
from raptix.execution.tools.plumbing.candidate_verification import scan_workspace_findings


class _Files:
    """An in-memory project with the list/read surface scan_workspace_findings needs."""

    def __init__(self, files: dict[str, bytes], *, listing: list[str] | None = None) -> None:
        self.files = dict(files)
        self.listing = listing

    def list_files(self, rel: str) -> list[str] | None:
        if self.listing is not None:
            return self.listing
        prefix = rel + "/"
        return sorted(name[len(prefix) :] for name in self.files if name.startswith(prefix))

    def read_bytes(self, rel: str) -> bytes | None:
        return self.files.get(rel)


def _finding(
    *, status: str = "candidate", evidence: str | None = None, poc: str | None = None
) -> str:
    body = "---\nid: FIND-001\nstatus: " + status + "\n---\n# Title\n\n"
    if evidence is not None:
        body += f"## Evidence\n{evidence}\n\n"
    if poc is not None:
        body += f"## Proof of Concept\n```json\n{poc}\n```\n\n"
    return body


async def _scan(monkeypatch: pytest.MonkeyPatch, files: _Files) -> dict:
    monkeypatch.setattr(candidate_verification, "project_files_for", lambda config: files)
    raw = await scan_workspace_findings.ainvoke({"config": {}})
    return json.loads(raw)


@pytest.mark.asyncio
async def test_candidate_with_neither_section_needs_both(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _Files({"findings/FIND-001.md": _finding().encode("utf-8")})
    result = await _scan(monkeypatch, files)
    assert result["findings"] == [
        {
            "finding_id": "FIND-001",
            "status": "candidate",
            "has_evidence": False,
            "poc_block": "absent",
            "verdict": "needs_evidence_and_poc",
        }
    ]


@pytest.mark.asyncio
async def test_candidate_with_evidence_only_needs_poc(monkeypatch: pytest.MonkeyPatch) -> None:
    markdown = _finding(evidence="- findings/evidence/FIND-001.txt: proof").encode("utf-8")
    files = _Files({"findings/FIND-001.md": markdown})
    result = await _scan(monkeypatch, files)
    assert result["findings"][0]["has_evidence"] is True
    assert result["findings"][0]["poc_block"] == "absent"
    assert result["findings"][0]["verdict"] == "needs_poc"


@pytest.mark.asyncio
async def test_candidate_with_empty_evidence_section_still_needs_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A '## Evidence' heading with no content under it (placeholder left blank) does not count."""
    markdown = _finding(evidence="   ").encode("utf-8")
    files = _Files({"findings/FIND-001.md": markdown})
    result = await _scan(monkeypatch, files)
    assert result["findings"][0]["has_evidence"] is False


@pytest.mark.asyncio
async def test_candidate_with_both_sections_is_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    poc_json = json.dumps(
        {
            "file": "findings/poc/FIND-001.py",
            "poc_sha256": "a" * 64,
            "payload": "x",
            "command": "run x",
            "success_patterns": ["ok"],
            "negative_command": "run ",
            "negative_patterns": ["no"],
            "cvss_vector": "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N",
            "spec_sha256": "b" * 64,
        }
    )
    markdown = _finding(evidence="- proof.txt: confirmed", poc=poc_json).encode("utf-8")
    files = _Files({"findings/FIND-001.md": markdown})
    result = await _scan(monkeypatch, files)
    assert result["findings"][0] == {
        "finding_id": "FIND-001",
        "status": "candidate",
        "has_evidence": True,
        "poc_block": "present",
        "verdict": "ready_for_verification",
    }


@pytest.mark.asyncio
async def test_malformed_poc_json_is_reported_invalid_not_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    markdown = _finding(evidence="- proof.txt", poc="{not valid json").encode("utf-8")
    files = _Files({"findings/FIND-001.md": markdown})
    result = await _scan(monkeypatch, files)
    assert result["findings"][0]["poc_block"] == "invalid"
    assert result["findings"][0]["verdict"] == "needs_poc"


@pytest.mark.asyncio
async def test_confirmed_finding_passes_through_its_own_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    markdown = _finding(status="confirmed", evidence="- proof.txt").encode("utf-8")
    files = _Files({"findings/FIND-001.md": markdown})
    result = await _scan(monkeypatch, files)
    assert result["findings"][0]["verdict"] == "confirmed"


@pytest.mark.asyncio
async def test_poc_and_evidence_subdirectory_files_are_not_treated_as_findings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = _Files(
        {
            "findings/FIND-001.md": _finding(evidence="- e").encode("utf-8"),
            "findings/poc/FIND-001.py": b"print('x')",
            "findings/evidence/FIND-001_verification.json": b"{}",
        }
    )
    result = await _scan(monkeypatch, files)
    assert [f["finding_id"] for f in result["findings"]] == ["FIND-001"]


@pytest.mark.asyncio
async def test_no_findings_directory_returns_empty_list(monkeypatch: pytest.MonkeyPatch) -> None:
    files = _Files({}, listing=None)
    result = await _scan(monkeypatch, files)
    assert result == {"findings": []}


@pytest.mark.asyncio
async def test_project_unavailable_is_reported_as_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(config: object) -> None:
        raise ProjectFileUnavailable("sandbox unreachable")

    monkeypatch.setattr(candidate_verification, "project_files_for", _raise)
    raw = await scan_workspace_findings.ainvoke({"config": {}})
    result = json.loads(raw)
    assert result["error"] == "project_unavailable"
