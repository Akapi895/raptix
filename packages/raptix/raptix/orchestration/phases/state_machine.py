"""Shadow-mode UKC phase state machine.

W7 ships this as status/shadow machinery only: nothing in the runtime
reads it for gating. ``shadow=True`` (the default) records denied
attempts without raising, so observability can be wired before any
enforcement turns on.
"""

from __future__ import annotations

import logging
from typing import Any

from raptix.orchestration.phases.model import PHASE_ORDER, UKCPhase
from raptix.orchestration.phases.policy import DefaultPhasePolicy, PhasePolicy
from raptix.orchestration.phases.transition import PhaseTransition

log = logging.getLogger(__name__)

_DEFAULT_HISTORY_BOUND = 64


class InvalidPhaseTransition(RuntimeError):
    """Raised in strict mode when the policy denies a transition."""


class PhaseStateMachine:
    """Tracks the current UKC macro-phase for one engagement scope.

    Shadow mode (default) never gates: denied transitions are recorded
    and logged, the current phase is unchanged and ``None`` is returned.
    Strict mode raises :class:`InvalidPhaseTransition` instead.
    """

    def __init__(
        self,
        *,
        initial: UKCPhase = PHASE_ORDER[0],
        policy: PhasePolicy | None = None,
        shadow: bool = True,
        history_bound: int = _DEFAULT_HISTORY_BOUND,
    ) -> None:
        if history_bound < 1:
            raise ValueError("history_bound must be >= 1")
        self._current = initial
        self._policy = policy or DefaultPhasePolicy()
        self._shadow = shadow
        self._bound = history_bound
        self._history: list[PhaseTransition] = []

    @property
    def current(self) -> UKCPhase:
        return self._current

    @property
    def shadow(self) -> bool:
        return self._shadow

    @property
    def history(self) -> tuple[PhaseTransition, ...]:
        return tuple(self._history)

    def transition(
        self, to_phase: UKCPhase, *, reason: str = "", actor: str = ""
    ) -> PhaseTransition | None:
        """Apply a phase change under the configured policy.

        Returns the recorded :class:`PhaseTransition` on a real change,
        ``None`` for re-affirmations and for denied attempts in shadow
        mode.
        """
        allowed, why = self._policy.allows(self._current, to_phase)
        if not allowed:
            log.info(
                "phase transition denied (%s -> %s): %s",
                self._current.slug,
                to_phase.slug,
                why,
            )
            if not self._shadow:
                raise InvalidPhaseTransition(f"{self._current.slug} -> {to_phase.slug}: {why}")
            return None
        if to_phase == self._current:
            return None
        step = PhaseTransition(
            from_phase=self._current, to_phase=to_phase, reason=reason or why, actor=actor
        )
        self._current = to_phase
        self._history.append(step)
        if len(self._history) > self._bound:
            del self._history[: len(self._history) - self._bound]
        return step

    def status(self) -> dict[str, Any]:
        """Compact observability payload (the shadow/status surface)."""
        return {
            "current": self._current.slug,
            "index": PHASE_ORDER.index(self._current),
            "shadow": self._shadow,
            "transitions": len(self._history),
        }
