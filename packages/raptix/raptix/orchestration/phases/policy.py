"""Phase transition policy.

Policy is configuration, not law: :class:`DefaultPhasePolicy` encodes a
conservative forward chain, and later waves (or deployments) may swap in
their own implementation of :class:`PhasePolicy`.
"""

from __future__ import annotations

from typing import Protocol

from raptix.orchestration.phases.model import PHASE_ORDER, UKCPhase


class PhasePolicy(Protocol):
    """Whether a phase change is permitted."""

    def allows(self, current: UKCPhase, proposed: UKCPhase) -> tuple[bool, str]:
        """Return ``(allowed, reason)`` for the proposed change."""
        ...


class DefaultPhasePolicy:
    """Conservative default: forward or re-affirm, never backward.

    - self-transitions are always allowed (re-affirming the phase),
    - forward transitions are allowed; skipping is permitted because a
      target may already sit inside a later macro-phase,
    - backward transitions are denied.
    """

    allow_skip_forward: bool = True
    allow_backward: bool = False

    def allows(self, current: UKCPhase, proposed: UKCPhase) -> tuple[bool, str]:
        if current == proposed:
            return True, "re-affirmed"
        current_index = PHASE_ORDER.index(current)
        proposed_index = PHASE_ORDER.index(proposed)
        if proposed_index > current_index:
            if proposed_index > current_index + 1 and not self.allow_skip_forward:
                return False, "skipping forward phases is disabled by policy"
            return True, "forward"
        if self.allow_backward:
            return True, "backward (policy-permitted)"
        return False, "backward transition denied by default policy"
