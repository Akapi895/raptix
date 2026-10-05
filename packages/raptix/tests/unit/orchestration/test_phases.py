"""T0 mechanism tests for the W7 UKC phase orchestration structure."""

import dataclasses
from datetime import UTC, datetime, timedelta

import pytest

from raptix.orchestration.phases import (
    PHASE_ORDER,
    DefaultPhasePolicy,
    InvalidPhaseTransition,
    PhaseStateMachine,
    UKCPhase,
    canonical_phases,
    is_canonical_slug,
    next_phase,
    phase_from_slug,
    phase_index,
)


def test_exactly_three_canonical_macro_phases() -> None:
    assert tuple(phase.slug for phase in canonical_phases()) == (
        "initial_foothold",
        "network_propagation",
        "action_on_objectives",
    )
    assert len(set(PHASE_ORDER)) == 3


def test_slug_helpers_are_case_insensitive_round_trip() -> None:
    for phase in PHASE_ORDER:
        resolved = phase_from_slug(phase.slug.upper())
        assert resolved is phase
        assert is_canonical_slug(f"  {phase.slug} ") is True
    assert phase_from_slug("persistence") is None
    assert is_canonical_slug("") is False


def test_phase_index_and_next_phase() -> None:
    assert phase_index(UKCPhase.INITIAL_FOOTHOLD) == 0
    assert next_phase(UKCPhase.INITIAL_FOOTHOLD) is UKCPhase.NETWORK_PROPAGATION
    assert next_phase(UKCPhase.ACTION_ON_OBJECTIVES) is None


def test_default_policy_forward_self_skip_backward() -> None:
    policy = DefaultPhasePolicy()
    assert policy.allows(UKCPhase.INITIAL_FOOTHOLD, UKCPhase.NETWORK_PROPAGATION) == (
        True,
        "forward",
    )
    assert policy.allows(UKCPhase.INITIAL_FOOTHOLD, UKCPhase.ACTION_ON_OBJECTIVES) == (
        True,
        "forward",
    )
    assert policy.allows(UKCPhase.NETWORK_PROPAGATION, UKCPhase.NETWORK_PROPAGATION) == (
        True,
        "re-affirmed",
    )
    allowed, reason = policy.allows(UKCPhase.ACTION_ON_OBJECTIVES, UKCPhase.INITIAL_FOOTHOLD)
    assert allowed is False
    assert "backward" in reason


def test_policy_flags_are_configurable() -> None:
    no_skip = DefaultPhasePolicy()
    no_skip.allow_skip_forward = False
    allowed, reason = no_skip.allows(UKCPhase.INITIAL_FOOTHOLD, UKCPhase.ACTION_ON_OBJECTIVES)
    assert allowed is False
    assert "skipping" in reason

    permissive = DefaultPhasePolicy()
    permissive.allow_backward = True
    assert permissive.allows(UKCPhase.ACTION_ON_OBJECTIVES, UKCPhase.INITIAL_FOOTHOLD) == (
        True,
        "backward (policy-permitted)",
    )


def test_shadow_mode_records_denied_transitions_without_raising() -> None:
    machine = PhaseStateMachine()
    assert machine.shadow is True
    assert machine.current is UKCPhase.INITIAL_FOOTHOLD
    assert machine.transition(UKCPhase.INITIAL_FOOTHOLD) is None
    assert machine.transition(UKCPhase.NETWORK_PROPAGATION, reason="lateral move") is not None
    assert machine.current is UKCPhase.NETWORK_PROPAGATION
    assert machine.transition(UKCPhase.INITIAL_FOOTHOLD) is None
    assert machine.current is UKCPhase.NETWORK_PROPAGATION
    assert len(machine.history) == 1


def test_strict_mode_raises_on_denied_transition() -> None:
    machine = PhaseStateMachine(shadow=False)
    machine.transition(UKCPhase.ACTION_ON_OBJECTIVES, reason="direct objectives")
    assert machine.current is UKCPhase.ACTION_ON_OBJECTIVES
    with pytest.raises(InvalidPhaseTransition):
        machine.transition(UKCPhase.INITIAL_FOOTHOLD)
    assert machine.current is UKCPhase.ACTION_ON_OBJECTIVES


def test_history_is_bounded_and_transitions_immutable() -> None:
    machine = PhaseStateMachine(history_bound=2)
    machine.transition(UKCPhase.NETWORK_PROPAGATION)
    machine.transition(UKCPhase.ACTION_ON_OBJECTIVES)
    machine.transition(UKCPhase.ACTION_ON_OBJECTIVES)
    assert len(machine.history) == 2
    first, last = machine.history
    assert (first.from_phase, first.to_phase) == (
        UKCPhase.INITIAL_FOOTHOLD,
        UKCPhase.NETWORK_PROPAGATION,
    )
    assert (last.from_phase, last.to_phase) == (
        UKCPhase.NETWORK_PROPAGATION,
        UKCPhase.ACTION_ON_OBJECTIVES,
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        first.to_phase = UKCPhase.INITIAL_FOOTHOLD  # type: ignore[misc]


def test_transition_timestamp_is_timezone_aware() -> None:
    machine = PhaseStateMachine()
    step = machine.transition(UKCPhase.NETWORK_PROPAGATION)
    assert step is not None
    assert step.recorded_at.tzinfo is not None
    assert step.recorded_at.utcoffset() == timedelta(0)
    assert step.recorded_at <= datetime.now(UTC)


def test_status_payload_shape() -> None:
    machine = PhaseStateMachine()
    payload = machine.status()
    assert payload == {
        "current": "initial_foothold",
        "index": 0,
        "shadow": True,
        "transitions": 0,
    }


def test_history_bound_must_be_positive() -> None:
    with pytest.raises(ValueError):
        PhaseStateMachine(history_bound=0)
