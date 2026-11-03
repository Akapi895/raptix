"""Tests for the Soundwave/Autohunt completion gate."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langchain_core.messages import ToolMessage

from raptix.execution.tools.interaction import complete_planning
from raptix.execution.tools.interaction.complete_planning import (
    complete_engagement_planning,
    validate_planning_bundle,
)


def _write_bundle(
    root: Path, *, target: str = "https://target.example", enforce: bool = True
) -> None:
    plan = root / "plan"
    plan.mkdir()
    roe = {
        "engagement_name": "autohunt-demo",
        "client": "Demo",
        "start_date": "2026-08-26",
        "end_date": "2026-08-27",
        "engagement_type": "external",
        "testing_window": "24/7",
        "in_scope": [{"target": target, "type": "web_url"}],
        "authorization_reference": "ROE-2026-812",
    }
    if enforce:
        roe["machine_enforcement"] = {"mode": "enforce", "in_scope": ["target.example"]}
    documents = {
        "roe.json": roe,
        "threat-profile.json": {
            "engagement_name": "autohunt-demo",
            "actor_name": "External tester",
            "tier": "tier-1",
            "sophistication": "low",
            "motivation": "validation",
        },
        "conops.json": {
            "engagement_name": "autohunt-demo",
            "executive_summary": "Validate the declared target only.",
        },
        "deconfliction.json": {"engagement_name": "autohunt-demo"},
        "contact.json": {
            "engagement_name": "autohunt-demo",
            "primary_operator": {
                "name": "Operator",
                "role": "Primary Operator",
                "channel": "local:console",
            },
        },
        "data-handling.json": {
            "engagement_name": "autohunt-demo",
            "evidence_storage_path": "/workspace/autohunt-demo/evidence/",
        },
        "abort.json": {"engagement_name": "autohunt-demo"},
        "cleanup.json": {"engagement_name": "autohunt-demo"},
    }
    for filename, payload in documents.items():
        (plan / filename).write_text(json.dumps(payload), encoding="utf-8")


def test_validate_planning_bundle_accepts_complete_authorized_bundle(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)

    assert (
        validate_planning_bundle(
            project_files_at(tmp_path),
            target_value="https://target.example",
            authorization_confirmed=True,
        )
        is None
    )


def test_validate_planning_bundle_rejects_unconfirmed_authorization(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)

    assert validate_planning_bundle(project_files_at(tmp_path), authorization_confirmed=False) == (
        "Authorization is not confirmed; do not hand off the engagement."
    )


def test_validate_planning_bundle_rejects_declared_target_outside_roe(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)

    assert validate_planning_bundle(
        project_files_at(tmp_path), target_value="https://other.example"
    ) == ("RoE in_scope must contain the exact launcher-declared target.")


def test_validate_planning_bundle_requires_the_machine_enforcement_block(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path, enforce=False)

    failure = validate_planning_bundle(
        project_files_at(tmp_path),
        target_value="https://target.example",
        authorization_confirmed=True,
    )

    assert failure is not None
    assert failure.startswith("plan/roe.json: machine_enforcement is required before handoff.")


def test_validate_planning_bundle_refuses_an_enforce_block_with_no_scope(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)
    roe = json.loads((tmp_path / "plan" / "roe.json").read_text(encoding="utf-8"))
    roe["machine_enforcement"] = {"mode": "enforce", "in_scope": []}
    (tmp_path / "plan" / "roe.json").write_text(json.dumps(roe), encoding="utf-8")

    failure = validate_planning_bundle(
        project_files_at(tmp_path),
        target_value="https://target.example",
        authorization_confirmed=True,
    )

    assert failure is not None
    assert "machine_enforcement.in_scope must list at least one" in failure


def test_validate_planning_bundle_refuses_a_launcher_target_the_machine_block_does_not_allow(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)
    roe = json.loads((tmp_path / "plan" / "roe.json").read_text(encoding="utf-8"))
    roe["machine_enforcement"] = {"mode": "enforce", "in_scope": ["other.example"]}
    (tmp_path / "plan" / "roe.json").write_text(json.dumps(roe), encoding="utf-8")

    failure = validate_planning_bundle(
        project_files_at(tmp_path),
        target_value="https://target.example",
        authorization_confirmed=True,
    )

    assert failure is not None
    assert "launcher-declared target 'target.example' is refused by machine_enforcement" in failure


def test_validate_planning_bundle_reports_every_invalid_document(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)
    (tmp_path / "plan" / "cleanup.json").unlink()
    abort = {
        "engagement_name": "autohunt-demo",
        "halt_triggers": [
            {
                "condition": "Out-of-scope target responds",
                "severity": "EMERGENCY",
                "response_action": "halt",
            }
        ],
    }
    (tmp_path / "plan" / "abort.json").write_text(json.dumps(abort), encoding="utf-8")

    failure = validate_planning_bundle(
        project_files_at(tmp_path),
        target_value="https://target.example",
        authorization_confirmed=True,
    )

    assert failure is not None
    assert "plan/cleanup.json: missing; write this document" in failure
    assert "plan/abort.json: halt_triggers.0.severity:" in failure
    assert "(got 'EMERGENCY')" in failure


@pytest.fixture
def bundle_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, project_files_at) -> Path:
    monkeypatch.setattr(
        complete_planning, "_runtime_context", lambda: ("https://target.example", True)
    )
    monkeypatch.setattr(
        complete_planning, "ambient_project_files", lambda: project_files_at(tmp_path)
    )
    return tmp_path


def _call(call_id: str):
    return complete_engagement_planning.invoke(
        {"name": "complete_engagement_planning", "args": {}, "id": call_id, "type": "tool_call"}
    )


def test_complete_engagement_planning_returns_error_status_while_blocked(
    bundle_workspace: Path,
) -> None:
    _write_bundle(bundle_workspace)
    (bundle_workspace / "plan" / "cleanup.json").unlink()

    result = _call("call-blocked")

    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert result.tool_call_id == "call-blocked"
    assert "Planning handoff blocked" in result.content
    assert "plan/cleanup.json: missing" in result.content


def test_complete_engagement_planning_refuses_the_handoff_when_the_sandbox_is_unreachable(
    bundle_workspace: Path, project_files_at, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_bundle(bundle_workspace)
    unreachable = project_files_at(bundle_workspace)
    unreachable.unavailable = True
    monkeypatch.setattr(complete_planning, "ambient_project_files", lambda: unreachable)

    result = _call("call-unreachable")

    assert result.status == "error"
    assert "Planning handoff blocked" in result.content
    assert "the project sandbox could not be read" in result.content


def test_complete_engagement_planning_succeeds_on_a_complete_bundle(bundle_workspace: Path) -> None:
    _write_bundle(bundle_workspace, target="https://target.example")

    result = _call("call-ready")

    assert isinstance(result, ToolMessage)
    assert result.status == "success"
    assert isinstance(result.content, str)
    assert result.content.startswith("Planning complete.")


def test_validate_planning_bundle_rejects_evidence_path_outside_the_engagement_workspace(
    tmp_path: Path, project_files_at
) -> None:
    _write_bundle(tmp_path)
    data = json.loads((tmp_path / "plan" / "data-handling.json").read_text(encoding="utf-8"))
    data["evidence_storage_path"] = "/opt/evidence/"
    (tmp_path / "plan" / "data-handling.json").write_text(json.dumps(data), encoding="utf-8")

    failure = validate_planning_bundle(
        project_files_at(tmp_path),
        target_value="https://target.example",
        authorization_confirmed=True,
    )

    assert failure == (
        "plan/data-handling.json: evidence_storage_path must be inside /workspace/ "
        "(got '/opt/evidence/'). Write the concrete path, for example "
        "/workspace/evidence/."
    )
