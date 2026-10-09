"""``EligibilityEvaluator`` — answers ONLY "does current state make this
applicable?".

State inputs, in the frozen order:

1. **Role** — ``allowed_roles == ()`` is UNRESTRICTED; a non-empty
   tuple admits only the listed runtime role ids.
2. **Phase (hard)** — ``allowed_phases is None`` means every UKC phase;
   a set value is a HARD constraint (used sparingly per the plan).
   ``phase_affinity`` is deliberately NOT consulted here — it is a soft
   ranking signal for T9 exposure, never a filter.
3. **AKG requirements** — each ``RequirementSpec`` is checked by a
   runtime ``RequirementEvaluator`` (the runtime decides HOW — graph
   query, state lookup — because the core contract carries no query
   field). With no evaluator registered for the runtime, declared
   requirements count as UNMET (conservative: eligibility is never
   assumed).

Authorization (scope / RoE / approval / budget) is NOT evaluated here —
it is the hard invocation-time guard, separate from eligibility.
"""

from __future__ import annotations

from typing import Protocol

from raptix_core.types.capability import (
    CapabilityEligibility,
    CapabilityId,
    CapabilityManifest,
    RequirementSpec,
)


class RequirementEvaluator(Protocol):
    """Runtime-side requirement checks — decides HOW each requirement
    id is verified (graph query, state lookup, service probe, ...)."""

    def check(self, requirement: RequirementSpec) -> bool: ...


class EligibilityEvaluator:
    """Evaluate :class:`CapabilityEligibility` for one manifest under
    the current role/phase/requirement state."""

    def __init__(self, requirement_evaluator: RequirementEvaluator | None = None) -> None:
        self._requirements = requirement_evaluator

    def evaluate(
        self,
        manifest: CapabilityManifest,
        *,
        role: str,
        phase: str | None = None,
    ) -> CapabilityEligibility:
        capability_id = CapabilityId(str(manifest.id))
        if manifest.allowed_roles and str(role) not in {str(r) for r in manifest.allowed_roles}:
            return CapabilityEligibility(
                capability_id=capability_id,
                eligible=False,
                reason=f"role {role!r} not allowed "
                f"(allowed: {sorted(str(r) for r in manifest.allowed_roles)})",
            )
        if manifest.allowed_phases is not None:
            if phase is None:
                return CapabilityEligibility(
                    capability_id=capability_id,
                    eligible=False,
                    reason="capability is phase-restricted but no phase was supplied",
                )
            if phase not in manifest.allowed_phases:
                return CapabilityEligibility(
                    capability_id=capability_id,
                    eligible=False,
                    reason=f"phase {phase!r} not allowed "
                    f"(allowed: {sorted(manifest.allowed_phases)})",
                )
        unmet = tuple(
            requirement.id
            for requirement in manifest.requirements
            if not self._requirement_met(requirement)
        )
        if unmet:
            return CapabilityEligibility(
                capability_id=capability_id,
                eligible=False,
                unmet_requirements=unmet,
                reason="unmet requirements: " + ", ".join(unmet),
            )
        return CapabilityEligibility(capability_id=capability_id, eligible=True)

    def _requirement_met(self, requirement: RequirementSpec) -> bool:
        if self._requirements is None:
            # Conservative: an unresolvable requirement is unmet, never
            # silently satisfied.
            return False
        return self._requirements.check(requirement)
