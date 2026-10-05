"""Claims cannot unlock work; a verifier observation is advisory only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from raptix.execution.tools.opplan import build_opplan_tools
from raptix_core.types.foothold import AccessObservation, AccessOperation, assess_access


class _Verifier:
    def __init__(self, observed: AccessObservation | None) -> None:
        self.observed = observed

    def observe(self, reference: str) -> AccessObservation | None:
        return self.observed


def _observation(*, live: bool = True, age: int = 0) -> AccessObservation:
    return AccessObservation(
        reference="session-1",
        source="trusted-test-adapter",
        verified_at=datetime.now(timezone.utc) - timedelta(seconds=age),
        session_live=live,
        controlled_execution=True,
        privilege="user",
        reachable_targets=("host-2",),
    )


def _start(tool, *, phase: str, operation: str = "lateral_movement"):
    state = {
        "objectives": [
            {
                "id": "OBJ-2",
                "phase": phase,
                "status": "pending",
                "title": "step",
                "description": "step",
                "acceptance_criteria": ["done"],
                "priority": 1,
            }
        ]
    }
    return tool.invoke(
        {
            "type": "tool_call",
            "name": "update_objective",
            "id": "tc-1",
            "args": {
                "objective_id": "OBJ-2",
                "status": "in-progress",
                "operation_kind": operation,
                "access_ref": "session-1",
                "target_asset": "host-2",
                "state": state,
            },
        }
    )


def test_access_requires_independent_fresh_live_observation() -> None:
    def check(verifier: _Verifier | None) -> str:
        return assess_access(
            AccessOperation.LATERAL_MOVEMENT, "session-1", "host-2", "user", verifier
        )

    assert "unverified" in check(None)
    assert "unverified" in check(_Verifier(_observation(live=False)))
    assert "unverified" in check(_Verifier(_observation(age=90)))
    assert "observed_by=trusted-test-adapter" in check(_Verifier(_observation()))
    assert assess_access(AccessOperation.PREPARATION, None, None, None, None) == "not_applicable"


def test_shadow_mode_does_not_gate_preparation_or_lateral_work(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_FOOTHOLD_MODE", "shadow")
    tool = {t.name: t for t in build_opplan_tools()}["update_objective"]
    np = _start(tool, phase="post-exploit")
    assert np.update["objectives"][0]["status"] == "in-progress"
    assert "unverified" in np.update["messages"][0].content
    prep = _start(tool, phase="c2", operation="preparation")
    assert prep.update["objectives"][0]["status"] == "in-progress"
    assert "not_applicable" in prep.update["messages"][0].content
    if_work = _start(tool, phase="initial-access")
    assert "Foothold shadow" not in if_work.update["messages"][0].content


def test_opt_in_verifier_evidence_does_not_become_model_auth(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_FOOTHOLD_MODE", "shadow")
    tool = {t.name: t for t in build_opplan_tools(access_verifier=_Verifier(_observation()))}[
        "update_objective"
    ]
    result = _start(tool, phase="post-exploit")
    assert "observed_by=trusted-test-adapter" in result.update["messages"][0].content
    assert "not an authorization decision" in result.update["messages"][0].content


def test_default_mode_keeps_existing_objective_semantics(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_FOOTHOLD_MODE", raising=False)
    tool = {t.name: t for t in build_opplan_tools()}["update_objective"]
    result = _start(tool, phase="post-exploit")
    assert result.update["objectives"][0]["status"] == "in-progress"
    assert "Foothold shadow" not in result.update["messages"][0].content
