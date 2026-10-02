"""ADR-0031 (Step 4) — verified-foothold gate tests.

Part 1 pins ``is_usable_access`` against the audit's five foothold
states A–E, loaded directly from the Step-0 baseline fixture
(``tests/fixtures/baseline/recon_exploit_handoff.json``) — states A–D
must evaluate to False (IF work continues, NP blocked), only state E
permits the IF→NP transition.

Part 2 pins the gate inside ``update_objective``: starting a
propagation-phase objective (post-exploit / c2 / exfiltration) requires
typed evidence of usable access; Initial-Foothold objectives are never
gated; evidence recorded on a prior call satisfies a later start;
evidence round-trips through OPPLAN persistence.

No network / docker / LLM dependencies.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from raptix.tools.opplan import _build_opplan_payload, build_opplan_tools
from raptix_core.types.engagement import OPPLAN
from raptix_core.types.foothold import AccessEvidence, is_usable_access

_REPO_ROOT = Path(__file__).resolve().parents[5]
_FIXTURE = _REPO_ROOT / "tests/fixtures/baseline/recon_exploit_handoff.json"

# The fixture's evidence keys map 1:1 onto AccessEvidence fields; only
# keys the schema declares are forwarded (extra fixture hints ignored).
_EVIDENCE_FIELDS = set(AccessEvidence.model_fields)


def _fixture_states() -> list[dict[str, Any]]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))["foothold_states"]


def _evidence_from_state(state: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in state["evidence"].items() if k in _EVIDENCE_FIELDS}


def _persisted_evidence(state: dict[str, Any]) -> dict[str, Any]:
    """The evidence dict as the tool persists it (all declared fields)."""
    return AccessEvidence.model_validate(_evidence_from_state(state)).model_dump(mode="json")


# ── Part 1: the predicate, against the audit's fixture states ────────


@pytest.mark.parametrize("state", _fixture_states(), ids=lambda s: f"state-{s['id']}")
def test_fixture_foothold_states_match_predicate(state: dict[str, Any]) -> None:
    evidence = AccessEvidence.model_validate(_evidence_from_state(state))
    assert is_usable_access(evidence) is state["expected_if_to_np_transition"]


def test_fail_closed_on_empty_evidence() -> None:
    assert is_usable_access(AccessEvidence()) is False


def test_fail_closed_on_unknown_privilege_level() -> None:
    evidence = AccessEvidence(
        execution_capability=True,
        session_managed=True,
        session_live=True,
        privilege="godmode",
        required_privilege="admin",
    )
    assert is_usable_access(evidence) is False


def test_credential_path_needs_verified_reachability() -> None:
    usable = AccessEvidence(
        execution_capability=True,
        credential_captured=True,
        credential_usable=True,
        reachability_verified=True,
    )
    unreachable = usable.model_copy(update={"reachability_verified": False})
    assert is_usable_access(usable) is True
    assert is_usable_access(unreachable) is False


def test_session_path_without_required_privilege_allows_any_live_session() -> None:
    evidence = AccessEvidence(
        execution_capability=True,
        session_managed=True,
        session_live=True,
        privilege="user",
    )
    assert is_usable_access(evidence) is True


# ── Part 2: the gate inside update_objective ─────────────────────────


class _ToolBag:
    def __init__(self) -> None:
        by_name = {getattr(t, "name", None) or t.__name__: t for t in build_opplan_tools()}
        self.add = by_name["add_objective"]
        self.update = by_name["update_objective"]


def _call_tool(tool: Any, args: dict[str, Any], state: dict[str, Any]) -> Any:
    payload = {
        "name": getattr(tool, "name", "tool"),
        "type": "tool_call",
        "id": "test-call-id",
        "args": {**args, "state": state},
    }
    return tool.invoke(payload)


def _state_from(command: Any, state: dict[str, Any]) -> dict[str, Any]:
    new_state = {**state}
    update = getattr(command, "update", None) or {}
    for key, value in update.items():
        if key == "messages":
            continue
        new_state[key] = value
    return new_state


def _last_message(command: Any) -> str:
    update = getattr(command, "update", None) or {}
    messages = update.get("messages") or []
    if not messages:
        return ""
    msg = messages[-1]
    return getattr(msg, "content", str(msg))


def _objective(oid: str, phase: str, status: str = "pending") -> dict[str, Any]:
    return {
        "id": oid,
        "phase": phase,
        "title": oid,
        "description": "d",
        "acceptance_criteria": ["c"],
        "priority": 1,
        "status": status,
    }


@pytest.fixture
def bag() -> _ToolBag:
    return _ToolBag()


@pytest.fixture
def state() -> dict[str, Any]:
    return {"objectives": [], "objective_counter": 0}


def _np_state(state: dict[str, Any]) -> dict[str, Any]:
    """State holding one pending post-exploit objective."""
    return {**state, "objectives": [_objective("OBJ-010", "post-exploit")]}


def test_propagation_start_without_evidence_rejected(bag: _ToolBag, state: dict[str, Any]) -> None:
    s = _np_state(state)
    cmd = _call_tool(bag.update, {"objective_id": "OBJ-010", "status": "in-progress"}, s)
    assert cmd.update["messages"][0].status == "error"
    assert "verified usable access" in _last_message(cmd)
    # The objective must remain pending.
    assert _state_from(cmd, s)["objectives"][0]["status"] == "pending"


@pytest.mark.parametrize("foot", _fixture_states(), ids=lambda s: f"state-{s['id']}")
def test_fixture_states_gated_across_the_boundary(
    bag: _ToolBag, state: dict[str, Any], foot: dict[str, Any]
) -> None:
    """The five fixture foothold states drive the tool gate end-to-end.

    A–D must be rejected with the matching rationale; only E starts.
    """
    s = _np_state(state)
    args = {
        "objective_id": "OBJ-010",
        "status": "in-progress",
        "access_evidence": _evidence_from_state(foot),
    }
    cmd = _call_tool(bag.update, args, s)
    if foot["expected_if_to_np_transition"]:
        assert cmd.update["messages"][0].status != "error"
        updated = _state_from(cmd, s)["objectives"][0]
        assert updated["status"] == "in-progress"
        assert updated["access_evidence"] == _persisted_evidence(foot)
    else:
        assert cmd.update["messages"][0].status == "error"
        message = _last_message(cmd)
        assert "verified usable access" in message
        # The rejection must name the unmet precondition matching the
        # fixture's rationale: A/B/D lack controlled execution, C lacks
        # privilege.
        unmet_by_state = {
            "A": "execution_capability not verified",
            "B": "execution_capability not verified",
            "C": "insufficient privilege",
            "D": "execution_capability not verified",
        }
        assert unmet_by_state[foot["id"]] in message


def test_state_c_rationale_names_privilege(bag: _ToolBag, state: dict[str, Any]) -> None:
    s = _np_state(state)
    evidence = _evidence_from_state(_fixture_states()[2])
    cmd = _call_tool(
        bag.update,
        {"objective_id": "OBJ-010", "status": "in-progress", "access_evidence": evidence},
        s,
    )
    assert "privesc" in _last_message(cmd)


def test_state_e_persists_evidence_and_round_trips(bag: _ToolBag, state: dict[str, Any]) -> None:
    s = _np_state(state)
    evidence = _evidence_from_state(_fixture_states()[4])
    cmd = _call_tool(
        bag.update,
        {"objective_id": "OBJ-010", "status": "in-progress", "access_evidence": evidence},
        s,
    )
    s2 = _state_from(cmd, s)
    assert s2["objectives"][0]["access_evidence"] == _persisted_evidence(_fixture_states()[4])

    # Round-trip through persistence: the declared Objective field must
    # survive _build_opplan_payload → OPPLAN(**data) (ad-hoc keys would
    # be dropped by the pydantic extra-field policy).
    payload = _build_opplan_payload(
        OPPLAN(
            engagement_name="e",
            threat_profile="t",
            objectives=[s2["objectives"][0]],
        )
    )
    reloaded = OPPLAN(**payload)
    assert reloaded.objectives[0].access_evidence is not None
    assert reloaded.objectives[0].access_evidence.execution_capability is True
    assert reloaded.objectives[0].access_evidence.privilege == evidence["privilege"]


def test_prior_recorded_evidence_satisfies_gate(bag: _ToolBag, state: dict[str, Any]) -> None:
    """Evidence recorded on an earlier call satisfies a later start."""
    s = _np_state(state)
    evidence = _evidence_from_state(_fixture_states()[4])
    s = _state_from(
        _call_tool(bag.update, {"objective_id": "OBJ-010", "access_evidence": evidence}, s),
        s,
    )
    cmd = _call_tool(bag.update, {"objective_id": "OBJ-010", "status": "in-progress"}, s)
    assert cmd.update["messages"][0].status != "error"
    assert _state_from(cmd, s)["objectives"][0]["status"] == "in-progress"


def test_blocked_to_in_progress_retry_is_gated(bag: _ToolBag, state: dict[str, Any]) -> None:
    s = {**_np_state(state), "objectives": [_objective("OBJ-010", "post-exploit", "blocked")]}
    cmd = _call_tool(bag.update, {"objective_id": "OBJ-010", "status": "in-progress"}, s)
    assert cmd.update["messages"][0].status == "error"
    assert "verified usable access" in _last_message(cmd)


@pytest.mark.parametrize("phase", ["recon", "initial-access"])
def test_if_phases_are_never_gated(bag: _ToolBag, state: dict[str, Any], phase: str) -> None:
    s = {**state, "objectives": [_objective("OBJ-011", phase)]}
    cmd = _call_tool(bag.update, {"objective_id": "OBJ-011", "status": "in-progress"}, s)
    assert cmd.update["messages"][0].status != "error"
    assert _state_from(cmd, s)["objectives"][0]["status"] == "in-progress"


def test_all_propagation_phases_are_gated(bag: _ToolBag, state: dict[str, Any]) -> None:
    for i, phase in enumerate(["post-exploit", "c2", "exfiltration"], start=1):
        s = {**state, "objectives": [_objective(f"OBJ-{i:03d}", phase)]}
        cmd = _call_tool(bag.update, {"objective_id": f"OBJ-{i:03d}", "status": "in-progress"}, s)
        assert cmd.update["messages"][0].status == "error", phase
        assert "verified usable access" in _last_message(cmd)


def test_malformed_evidence_shape_rejected(bag: _ToolBag, state: dict[str, Any]) -> None:
    """A dict with a non-boolean field is rejected by validation
    (pydantic coerces truthy strings like "yes" to bool, so use a type
    that cannot coerce)."""
    s = _np_state(state)
    cmd = _call_tool(
        bag.update,
        {
            "objective_id": "OBJ-010",
            "status": "in-progress",
            "access_evidence": {"execution_capability": [1]},
        },
        s,
    )
    assert cmd.update["messages"][0].status == "error"
    assert "Invalid access_evidence" in _last_message(cmd)


def test_wrong_field_evidence_fails_closed(bag: _ToolBag, state: dict[str, Any]) -> None:
    """Unknown/nonsense evidence must not unlock propagation."""
    s = _np_state(state)
    cmd = _call_tool(
        bag.update,
        {
            "objective_id": "OBJ-010",
            "status": "in-progress",
            "access_evidence": {"narrative": "exploit said it worked"},
        },
        s,
    )
    assert cmd.update["messages"][0].status == "error"
    assert "execution_capability not verified" in _last_message(cmd)


def test_evidence_recorded_alongside_completion(bag: _ToolBag, state: dict[str, Any]) -> None:
    """Recording evidence on a non-start update persists it without gating."""
    s = {**state, "objectives": [_objective("OBJ-012", "initial-access", "in-progress")]}
    evidence = _evidence_from_state(_fixture_states()[4])
    cmd = _call_tool(
        bag.update,
        {"objective_id": "OBJ-012", "status": "completed", "access_evidence": evidence},
        s,
    )
    assert cmd.update["messages"][0].status != "error"
    updated = _state_from(cmd, s)["objectives"][0]
    assert updated["status"] == "completed"
    assert updated["access_evidence"] == _persisted_evidence(_fixture_states()[4])


def test_non_dict_evidence_rejected_at_tool_schema(bag: _ToolBag, state: dict[str, Any]) -> None:
    """A non-dict access_evidence never reaches the tool body — the
    ``dict | None`` schema rejects it before invocation (fail-closed)."""
    from pydantic import ValidationError

    s = _np_state(state)
    with pytest.raises(ValidationError):
        _call_tool(
            bag.update,
            {"objective_id": "OBJ-010", "status": "in-progress", "access_evidence": "rce bro"},
            s,
        )
    # And the objective stays pending.
    assert _np_state(state)["objectives"][0]["status"] == "pending"
