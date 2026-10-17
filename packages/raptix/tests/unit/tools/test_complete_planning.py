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


def _write_bundle(root: Path, *, target: str = "https://target.example") -> None:
    plan = root / "plan"
    plan.mkdir()
    documents = {
        "roe.json": {
            "engagement_name": "autohunt-demo",
            "client": "Demo",
            "start_date": "2026-08-26",
            "end_date": "2026-08-27",
            "engagement_type": "external",
            "testing_window": "24/7",
            "in_scope": [{"target": target, "type": "web_url"}],
            "authorization_reference": "ROE-2026-812",
        },
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
        "data-handling.json": {"engagement_name": "autohunt-demo"},
        "abort.json": {"engagement_name": "autohunt-demo"},
        "cleanup.json": {"engagement_name": "autohunt-demo"},
    }
    for filename, payload in documents.items():
        (plan / filename).write_text(json.dumps(payload), encoding="utf-8")


def test_validate_planning_bundle_accepts_complete_authorized_bundle(tmp_path: Path) -> None:
    _write_bundle(tmp_path)

    assert (
        validate_planning_bundle(
            tmp_path,
            target_value="https://target.example",
            authorization_confirmed=True,
        )
        is None
    )


def test_validate_planning_bundle_rejects_unconfirmed_authorization(tmp_path: Path) -> None:
    _write_bundle(tmp_path)

    assert validate_planning_bundle(tmp_path, authorization_confirmed=False) == (
        "Authorization is not confirmed; do not hand off the engagement."
    )


def test_validate_planning_bundle_rejects_declared_target_outside_roe(tmp_path: Path) -> None:
    _write_bundle(tmp_path)

    assert validate_planning_bundle(tmp_path, target_value="https://other.example") == (
        "RoE in_scope must contain the exact launcher-declared target."
    )


def test_validate_planning_bundle_reports_every_invalid_document(tmp_path: Path) -> None:
    _write_bundle(tmp_path)
    (tmp_path / "plan" / "cleanup.json").unlink()
    abort = {
        "engagement_name": "autohunt-demo",
        "halt_triggers": [
            {"condition": "Out-of-scope target responds", "severity": "EMERGENCY", "response_action": "halt"}
        ],
    }
    (tmp_path / "plan" / "abort.json").write_text(json.dumps(abort), encoding="utf-8")

    failure = validate_planning_bundle(tmp_path, target_value="https://target.example", authorization_confirmed=True)

    assert failure is not None
    assert "plan/cleanup.json: missing; write this document" in failure
    assert "plan/abort.json: halt_triggers.0.severity:" in failure
    assert "(got 'EMERGENCY')" in failure


@pytest.fixture
def bundle_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(complete_planning, "_runtime_context", lambda: (str(tmp_path), "https://target.example", True))
    return tmp_path


def _call(call_id: str):
    return complete_engagement_planning.invoke(
        {"name": "complete_engagement_planning", "args": {}, "id": call_id, "type": "tool_call"}
    )


def test_complete_engagement_planning_returns_error_status_while_blocked(bundle_workspace: Path) -> None:
    _write_bundle(bundle_workspace)
    (bundle_workspace / "plan" / "cleanup.json").unlink()

    result = _call("call-blocked")

    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert result.tool_call_id == "call-blocked"
    assert "Planning handoff blocked" in result.content
    assert "plan/cleanup.json: missing" in result.content


def test_complete_engagement_planning_succeeds_on_a_complete_bundle(bundle_workspace: Path) -> None:
    _write_bundle(bundle_workspace, target="https://target.example")

    result = _call("call-ready")

    assert isinstance(result, ToolMessage)
    assert result.status == "success"
    assert result.content.startswith("Planning complete.")
