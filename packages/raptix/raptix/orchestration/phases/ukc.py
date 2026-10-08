"""Canonical UKC slug helpers.

Stable vocabulary shared by skill metadata (``ukc_phases``, W8),
orchestration state and observability payloads.
"""

from __future__ import annotations

from raptix.orchestration.phases.model import PHASE_ORDER, UKCPhase

_SLUGS = {phase.slug: phase for phase in PHASE_ORDER}


def canonical_phases() -> tuple[UKCPhase, ...]:
    """The three canonical macro-phases in canonical order."""
    return PHASE_ORDER


def phase_from_slug(slug: str) -> UKCPhase | None:
    """Resolve a ``ukc_phases`` metadata slug (case-insensitive)."""
    return _SLUGS.get(slug.strip().lower())


def is_canonical_slug(slug: str) -> bool:
    return phase_from_slug(slug) is not None


def phase_index(phase: UKCPhase) -> int:
    return PHASE_ORDER.index(phase)


def next_phase(phase: UKCPhase) -> UKCPhase | None:
    """The next macro-phase in canonical order, ``None`` at the end."""
    index = phase_index(phase)
    if index + 1 >= len(PHASE_ORDER):
        return None
    return PHASE_ORDER[index + 1]
