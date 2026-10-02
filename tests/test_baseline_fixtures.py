"""Tests for baseline fixtures (ADR-0027, Step 0).

Validates that the three fixture categories are well-formed and
loadable. These tests are the contract between Step 0 and Steps 1-5:
if a fixture changes shape, these tests must be updated alongside the
consuming step's tests.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures.baseline import (
    fixture_schema_version,
    load_failed_task_dispatch,
    load_kg_freshness,
    load_recon_exploit_handoff,
)

EXPECTED_SCHEMA_VERSION = 1
FOOTHOLD_STATE_IDS = {"A", "B", "C", "D", "E"}


def test_failed_task_dispatch_loads() -> None:
    fixture = load_failed_task_dispatch()
    assert fixture_schema_version(fixture) == EXPECTED_SCHEMA_VERSION
    assert "dispatch" in fixture
    assert "expected_after_step1" in fixture


def test_failed_task_dispatch_has_outcome() -> None:
    fixture = load_failed_task_dispatch()
    outcome = fixture["dispatch"]["outcome"]
    assert outcome["status"] == "failed"
    assert outcome["terminal_for_this_dispatch"] is True
    assert "failure_kind" in outcome
    assert "partial_state_refs" in outcome


def test_failed_task_dispatch_has_redispatch_evidence() -> None:
    fixture = load_failed_task_dispatch()
    post = fixture["dispatch"]["post_dispatch"]
    assert post["redispatched"] is True
    assert post["redispatch_count"] >= 1
    assert post["same_objective_retried"] is True


def test_kg_freshness_loads() -> None:
    fixture = load_kg_freshness()
    assert fixture_schema_version(fixture) == EXPECTED_SCHEMA_VERSION
    assert "initial_state" in fixture
    assert "scenarios" in fixture
    assert len(fixture["scenarios"]) >= 3


def test_kg_freshness_has_required_scenarios() -> None:
    fixture = load_kg_freshness()
    names = {s["name"] for s in fixture["scenarios"]}
    assert "node_property_update" in names
    assert "edge_only_mutation" in names
    assert "same_second_writes" in names


def test_kg_freshness_initial_state_has_revision() -> None:
    fixture = load_kg_freshness()
    assert "revision" in fixture["initial_state"]
    assert isinstance(fixture["initial_state"]["revision"], int)


def test_recon_exploit_handoff_loads() -> None:
    fixture = load_recon_exploit_handoff()
    assert fixture_schema_version(fixture) == EXPECTED_SCHEMA_VERSION
    assert "handoff" in fixture
    assert "foothold_states" in fixture


def test_recon_exploit_handoff_has_all_foothold_states() -> None:
    fixture = load_recon_exploit_handoff()
    state_ids = {s["id"] for s in fixture["foothold_states"]}
    assert state_ids == FOOTHOLD_STATE_IDS


def test_recon_exploit_handoff_foothold_transitions() -> None:
    fixture = load_recon_exploit_handoff()
    for state in fixture["foothold_states"]:
        if state["id"] == "E":
            assert state["expected_if_to_np_transition"] is True
        else:
            assert state["expected_if_to_np_transition"] is False


def test_recon_exploit_handoff_has_observations() -> None:
    fixture = load_recon_exploit_handoff()
    handoff = fixture["handoff"]
    assert len(handoff["observations"]) > 0
    assert "acceptance_evidence" in handoff
    assert "classification_ownership" in handoff


def test_all_fixtures_have_descriptions() -> None:
    for loader in (
        load_failed_task_dispatch,
        load_kg_freshness,
        load_recon_exploit_handoff,
    ):
        fixture = loader()
        assert "description" in fixture
        assert "source" in fixture
        assert len(fixture["description"]) > 0


def test_fixture_files_exist_on_disk() -> None:
    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "baseline"
    assert fixtures_dir.exists()
    assert (fixtures_dir / "failed_task_dispatch.json").exists()
    assert (fixtures_dir / "kg_freshness.json").exists()
    assert (fixtures_dir / "recon_exploit_handoff.json").exists()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
