"""Decision matrix for the generic fan-out admission policy (ADR-0077).

Fixtures here are work-unit shapes, not domains: the policy module itself
must contain no domain names (enforced by ``test_policy_module_is_domain_free``).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from raptix.middleware.fanout_admission import (
    CAPACITY_EXCEEDED,
    EFFECT_CONFLICT,
    FRAGILE_CAP,
    OPSEC_CONFLICT,
    RESOURCE_CONFLICT,
    Ceilings,
    ResilienceState,
    WorkUnit,
    decide,
)
from raptix_core.types.engagement import EffectClass, OpsecLevel


def unit(**overrides: object) -> WorkUnit:
    fields: dict = {
        "dispatch_id": "d1",
        "objective_id": "OBJ-001",
        "role": "specialist_a",
    }
    fields.update(overrides)
    return WorkUnit(**fields)  # type: ignore[arg-type]


def _read(resource: str, **overrides: object) -> WorkUnit:
    return unit(effects=EffectClass.READ, resources=frozenset({resource}), **overrides)


def _mutate(resource: str, **overrides: object) -> WorkUnit:
    return unit(effects=EffectClass.MUTATE, resources=frozenset({resource}), **overrides)


STANDARD_CEILINGS = Ceilings()


# ── 1. destructive ────────────────────────────────────────────────────


def test_destructive_blocked_without_sanction() -> None:
    d = decide(unit(effects=EffectClass.DESTRUCTIVE), [], ceilings=STANDARD_CEILINGS)
    assert not d.admitted
    assert d.code == EFFECT_CONFLICT


def test_destructive_requires_empty_flight_even_when_sanctioned() -> None:
    ceilings = Ceilings(allow_destructive=True)
    d = decide(unit(effects=EffectClass.DESTRUCTIVE), [unit()], ceilings=ceilings)
    assert not d.admitted
    assert d.code == EFFECT_CONFLICT
    d = decide(unit(effects=EffectClass.DESTRUCTIVE), [], ceilings=ceilings)
    assert d.admitted


# ── 2/3. resource overlap ─────────────────────────────────────────────


def test_read_read_same_resource_serializes_until_widened() -> None:
    # Un-widened resources cap ALL work (reads included) at per_target_max;
    # widening comes only from observed clean outcomes (progressive widening).
    in_flight = [_read("res:x", dispatch_id="d0")]
    d = decide(_read("res:x"), in_flight, ceilings=STANDARD_CEILINGS)
    assert not d.admitted
    assert d.code == FRAGILE_CAP
    d = decide(_read("res:x"), in_flight, ceilings=STANDARD_CEILINGS, resilient={"res:x": True})
    assert d.admitted


@pytest.mark.parametrize(
    ("candidate", "in_flight"),
    [
        ("mutate", "read"),
        ("read", "mutate"),
        ("mutate", "mutate"),
    ],
)
def test_any_non_read_pair_sharing_resource_conflicts(candidate: str, in_flight: str) -> None:
    factory = {"read": _read, "mutate": _mutate}
    d = decide(
        factory[candidate]("res:x"),
        [factory[in_flight]("res:x", dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == RESOURCE_CONFLICT
    assert d.blocking == ("d0",)


def test_mutate_pair_disjoint_resources_still_serializes_when_unknown() -> None:
    d = decide(
        _mutate("res:a"),
        [_mutate("res:b", dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == EFFECT_CONFLICT


def test_mutate_parallel_safe_pair_disjoint_resources_admitted() -> None:
    d = decide(
        _mutate("res:a", parallel_safe=True),
        [_mutate("res:b", parallel_safe=True, dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert d.admitted


def test_declared_safe_candidate_blocked_by_unguarded_in_flight_mutate() -> None:
    d = decide(
        _mutate("res:a", parallel_safe=True),
        [_mutate("res:b", parallel_safe=None, dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == EFFECT_CONFLICT


def test_mutate_shared_resource_conflicts_even_when_declared_safe() -> None:
    d = decide(
        _mutate("res:x", parallel_safe=True),
        [_mutate("res:x", parallel_safe=True, dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == RESOURCE_CONFLICT


def test_read_candidate_unaffected_by_mutating_work_elsewhere() -> None:
    d = decide(
        _read("res:a"),
        [_mutate("res:b", dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert d.admitted


# ── 4. OPSEC (read units + distinct resources so only the noise tier fires) ──


def test_loud_candidate_never_overlaps() -> None:
    d = decide(
        _read("res:c", opsec=OpsecLevel.LOUD),
        [_read("res:i", dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == OPSEC_CONFLICT


def test_loud_in_flight_blocks_everything() -> None:
    d = decide(
        _read("res:c", opsec=OpsecLevel.SILENT),
        [_read("res:i", opsec=OpsecLevel.LOUD, dispatch_id="d0")],
        ceilings=STANDARD_CEILINGS,
    )
    assert not d.admitted
    assert d.code == OPSEC_CONFLICT


def test_standard_pair_overlaps_fine() -> None:
    d = decide(_read("res:c"), [_read("res:i", dispatch_id="d0")], ceilings=STANDARD_CEILINGS)
    assert d.admitted


def test_engagement_tier_can_permit_loud_overlap() -> None:
    ceilings = Ceilings(parallel_max_loudness=4)
    d = decide(
        _read("res:c", opsec=OpsecLevel.LOUD),
        [_read("res:i", dispatch_id="d0")],
        ceilings=ceilings,
    )
    assert d.admitted


# ── 5. resilience / fragile cap ───────────────────────────────────────


def test_unwidened_resource_caps_in_flight_at_one() -> None:
    in_flight = [_read("host:1", dispatch_id="d0")]
    d = decide(_read("host:1"), in_flight, ceilings=STANDARD_CEILINGS)
    assert not d.admitted
    assert d.code == FRAGILE_CAP


def test_widened_resource_allows_more_in_flight() -> None:
    ceilings = Ceilings(per_target_max=1, global_max=4)
    in_flight = [_read("host:1", dispatch_id="d0"), _read("host:1", dispatch_id="d1")]
    d = decide(_read("host:1"), in_flight, ceilings=ceilings, resilient={"host:1": True})
    assert d.admitted


def test_declared_fragile_caps_even_when_widened() -> None:
    ceilings = Ceilings(per_target_max=1, global_max=4)
    in_flight = [_read("host:1", dispatch_id="d0", fragile_target=True)]
    d = decide(
        _read("host:1"),
        in_flight,
        ceilings=ceilings,
        resilient={"host:1": True},
    )
    assert not d.admitted
    assert d.code == FRAGILE_CAP


# ── 6. capacity ───────────────────────────────────────────────────────


def test_global_capacity_is_the_outer_bound() -> None:
    ceilings = Ceilings(global_max=2, per_target_max=8)
    in_flight = [
        _read("host:a", dispatch_id="d0"),
        _read("host:b", dispatch_id="d1"),
    ]
    d = decide(_read("host:c"), in_flight, ceilings=ceilings)
    assert not d.admitted
    assert d.code == CAPACITY_EXCEEDED


def test_no_in_flight_admits_by_default() -> None:
    assert decide(unit(), [], ceilings=STANDARD_CEILINGS).admitted


# ── progressive widening ──────────────────────────────────────────────


def test_resilience_widens_after_clean_streak_and_drops_on_failure() -> None:
    state = ResilienceState(widen_after_clean=3)
    assert state.resilient_map() == {}
    state.record(["host:1"], ok=True)
    state.record(["host:1"], ok=True)
    assert state.resilient_map() == {}
    state.record(["host:1"], ok=True)
    assert state.resilient_map() == {"host:1": True}
    state.record(["host:1"], ok=False)
    assert state.resilient_map() == {}


def test_resilience_ignores_unannotated_units() -> None:
    state = ResilienceState(widen_after_clean=1)
    state.record([], ok=True)
    assert state.resilient_map() == {}


# ── domain-freedom invariant ──────────────────────────────────────────


def test_policy_module_is_domain_free() -> None:
    source = Path(
        Path(__file__).parents[3], "raptix", "middleware", "fanout_admission.py"
    ).read_text(encoding="utf-8")
    forbidden = [
        r"\bAD\b",
        r"active directory",
        "kerberos",
        "kerberoast",
        "dcsync",
        "smb",
        "werkzeug",
        "juice",
        "graphql",
        "sqli",
        r"\bxss\b",
        r"\baws\b",
        "azure",
        "kubernetes",
        "gpo",
        "goad",
    ]
    for token in forbidden:
        assert re.search(token, source, flags=re.IGNORECASE) is None, (
            f"fanout_admission.py mentions domain token {token!r}; the generic "
            "policy must stay domain-free (ADR-0077)"
        )
