"""Generic fan-out admission policy (ADR-0077).

Pure, deterministic, domain-free: given a candidate work unit and the units
currently in flight, decide whether the dispatch may start. Domain knowledge
never appears here — it enters upstream as declarative annotations on the
objective (``effects`` / ``resources`` / ``parallel_safe``, raptix-core) and
via skill ``metadata.fanout`` metadata consumed by the producers. This module
must contain no domain names; ``tests/unit/middleware/test_fanout_admission.py``
asserts that invariant in code.

The whole generic rule (docs/design/2026-10-16-generic-fanout-admission-
implementation.md §3):

1. ``destructive`` work runs alone and only when the mission sanctions it.
2. ``read`` units skip resource checks (reads may overlap) but still face
   noise, resilience, and ceiling checks.
3. ``mutate`` units serialize on shared resources; unannotated (unknown)
   mutating work also serializes against every other mutating unit —
   unknown means conservative.
4. OPSEC: overlapping work may not be louder than the engagement's
   parallel-noise ceiling (default: STANDARD — LOUD work runs alone).
5. Resilience: resources observed (or declared) fragile cap their in-flight
   unit count at ``per_target_max`` until progressively widened.
6. Capacity: the global concurrent-dispatch ceiling stays as the outermost
   bound — the backstop, never the only control.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from raptix_core.types.engagement import EffectClass, OpsecLevel

# Decision codes surfaced to the orchestrator as ``dispatch_<code>`` replies
# and to events.jsonl as the ``code`` field of a ``dispatch.admission`` event.
ADMITTED = "admitted"
RESOURCE_CONFLICT = "resource_conflict"
EFFECT_CONFLICT = "effect_conflict"
OPSEC_CONFLICT = "opsec_conflict"
FRAGILE_CAP = "fragile_cap"
CAPACITY_EXCEEDED = "capacity_exceeded"

# Louder overlaps produce noisier blended traces; LOUD work exists to test
# detection and must never share the sky. The table is deliberately tiny and
# explicit — LOUD is the loudest, SILENT the quietest.
_LOUDNESS: dict[str, int] = {
    OpsecLevel.LOUD.value: 4,
    OpsecLevel.STANDARD.value: 3,
    OpsecLevel.CAREFUL.value: 2,
    OpsecLevel.QUIET.value: 1,
    OpsecLevel.SILENT.value: 0,
}


@dataclass(frozen=True)
class WorkUnit:
    """One dispatch intent, annotated for admission.

    ``resources`` must already be concrete (templates like ``account:*``
    expanded by the caller); ``fragile_target`` mirrors a skill-declared
    ``metadata.fanout.fragile_target`` for the candidate's resources.
    """

    dispatch_id: str
    objective_id: str
    role: str
    effects: EffectClass = EffectClass.MUTATE
    resources: frozenset[str] = frozenset()
    parallel_safe: bool | None = None
    opsec: OpsecLevel = OpsecLevel.STANDARD
    fragile_target: bool = False


@dataclass(frozen=True)
class Ceilings:
    """Engagement-level admission bounds (env/RoE derived upstream)."""

    global_max: int = 3
    per_target_max: int = 1
    allow_destructive: bool = False
    # Loudest OPSEC level permitted to overlap with any other in-flight unit.
    # Default STANDARD means LOUD never overlaps (opsec_conflict otherwise).
    parallel_max_loudness: int = _LOUDNESS[OpsecLevel.STANDARD.value]


@dataclass(frozen=True)
class AdmissionDecision:
    admitted: bool
    code: str
    detail: str
    blocking: tuple[str, ...] = ()

    @property
    def reject_code(self) -> str:
        """The middleware reply code for a rejection (``dispatch_<code>``)."""
        return self.code if not self.admitted else ADMITTED


def _conflict(code: str, detail: str, blocking: Sequence[str]) -> AdmissionDecision:
    return AdmissionDecision(False, code, detail, tuple(blocking))


def decide(
    candidate: WorkUnit,
    in_flight: Sequence[WorkUnit],
    *,
    ceilings: Ceilings,
    resilient: Mapping[str, bool] | None = None,
) -> AdmissionDecision:
    """Admit or reject ``candidate`` against the in-flight set. Deterministic."""
    resilient = resilient or {}
    flight = list(in_flight)

    # 1. Destructive work runs alone, and only when sanctioned.
    if candidate.effects is EffectClass.DESTRUCTIVE:
        if not ceilings.allow_destructive:
            return _conflict(
                EFFECT_CONFLICT,
                "Destructive work is only admitted in the mission-sanctioned "
                "final phase; schedule it there or downgrade the effect class",
                [u.dispatch_id for u in flight],
            )
        if flight:
            return _conflict(
                EFFECT_CONFLICT,
                "Destructive work must run alone; wait for in-flight dispatches",
                [u.dispatch_id for u in flight],
            )
        return AdmissionDecision(True, ADMITTED, "destructive work sanctioned and alone")

    # 2/3. Shared-resource conflicts. Reads overlap freely with reads; any
    # other combination sharing a resource conflicts, whichever side mutates.
    blocking_by_resource: list[str] = []
    for unit in flight:
        shared = candidate.resources & unit.resources
        if not shared:
            continue
        if candidate.effects is EffectClass.READ and unit.effects is EffectClass.READ:
            continue
        blocking_by_resource.append(unit.dispatch_id)
    if blocking_by_resource:
        shared = sorted(candidate.resources)
        return _conflict(
            RESOURCE_CONFLICT,
            "In-flight dispatch holds the same resource(s): "
            + ", ".join(shared)
            + "; finish the blocking dispatch(es) first",
            blocking_by_resource,
        )

    # Unknown mutating work never overlaps other mutating work (invariant:
    # unknown means conservative). Declared parallel-safe mutating units may
    # overlap only each other and only on disjoint resources (checked above).
    if candidate.effects is EffectClass.MUTATE:
        if candidate.parallel_safe is not True:
            mutating = [u for u in flight if u.effects is EffectClass.MUTATE]
            if mutating:
                return _conflict(
                    EFFECT_CONFLICT,
                    "Candidate effect class is unknown/unannotated, so mutating "
                    "work is serialized; annotate effects/parallel_safe on the "
                    "objective to unlock parallelism",
                    [u.dispatch_id for u in mutating],
                )
        else:
            unguarded = [
                u for u in flight if u.effects is EffectClass.MUTATE and u.parallel_safe is not True
            ]
            if unguarded:
                return _conflict(
                    EFFECT_CONFLICT,
                    "An in-flight mutating dispatch is not declared parallel-safe; "
                    "wait for it before starting another mutating unit",
                    [u.dispatch_id for u in unguarded],
                )

    # 4. OPSEC: overlapping work must stay within the engagement's
    # parallel-noise tolerance — LOUD (default boundary) never overlaps.
    if flight:
        candidate_loud = _LOUDNESS.get(candidate.opsec.value, 3)
        flight_loud = max(_LOUDNESS.get(u.opsec.value, 3) for u in flight)
        if candidate_loud > ceilings.parallel_max_loudness:
            return _conflict(
                OPSEC_CONFLICT,
                f"Candidate OPSEC ({candidate.opsec.value}) exceeds the "
                "engagement's parallel-noise tier; run it alone",
                [u.dispatch_id for u in flight],
            )
        if flight_loud > ceilings.parallel_max_loudness:
            return _conflict(
                OPSEC_CONFLICT,
                "An in-flight dispatch runs at a louder OPSEC tier; wait for it "
                "before adding concurrent noise",
                [u.dispatch_id for u in flight],
            )

    # 5. Resilience: fragile (declared, observed-fragile, or not yet widened)
    # resources cap their in-flight unit count at per_target_max.
    per_target = max(1, ceilings.per_target_max)
    fragile_blocking: list[str] = []
    for resource in sorted(candidate.resources):
        touching = [u for u in flight if resource in u.resources]
        declared_fragile = candidate.fragile_target or any(u.fragile_target for u in touching)
        widened = resilient.get(resource) is True
        if not declared_fragile and widened:
            continue
        if len(touching) < per_target:
            continue
        fragile_blocking = [u.dispatch_id for u in touching][:per_target]
        break
    if fragile_blocking:
        return _conflict(
            FRAGILE_CAP,
            "Resource is fragile or not yet widened; at most "
            f"{per_target} in-flight dispatch(es) may touch it",
            fragile_blocking,
        )

    # 6. Capacity — the outermost bound, kept from ADR-0067.
    if len(flight) >= ceilings.global_max:
        return _conflict(
            CAPACITY_EXCEEDED,
            f"Max {ceilings.global_max} concurrent dispatch(es) already active; "
            "wait for one to finish before starting another",
            [],
        )

    return AdmissionDecision(True, ADMITTED, "within ceilings and conflict-free")


class ResilienceState:
    """Progressive-widening state per engagement scope (ADR-0077 §widening).

    Every resource starts narrow (``resilient.get(r) is not True`` ⇒ capped
    at ``per_target_max``). Consecutive clean dispatch outcomes widen the
    resource to the global ceiling; any failure drops it back to the narrow
    cap immediately. Thread-safe: the dispatch middleware updates this from
    concurrent tool threads.
    """

    WIDEN_AFTER_CLEAN = 3

    def __init__(self, widen_after_clean: int = WIDEN_AFTER_CLEAN) -> None:
        self._widen_after = max(1, widen_after_clean)
        self._clean: dict[str, int] = {}
        self._resilient: set[str] = set()
        self._lock = threading.Lock()

    def resilient_map(self) -> dict[str, bool]:
        with self._lock:
            return {resource: True for resource in self._resilient}

    def record(self, resources: Sequence[str], *, ok: bool) -> None:
        """Record one dispatch outcome against each of its resources."""
        with self._lock:
            for resource in resources:
                if ok:
                    clean = self._clean.get(resource, 0) + 1
                    self._clean[resource] = clean
                    if clean >= self._widen_after:
                        self._resilient.add(resource)
                else:
                    self._clean[resource] = 0
                    self._resilient.discard(resource)
