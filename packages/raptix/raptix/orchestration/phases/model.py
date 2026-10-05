"""UKC phase value objects.

Phase is runtime orchestration state: it is never a folder layout, an
agent grouping or a skill grouping. Agents, skills and tools keep their
capability/domain organisation and may carry ``ukc_phases`` metadata
that references the slugs defined here (see
``raptix-repository-architecture.md`` §2.3 and §7).
"""

from __future__ import annotations

from enum import Enum


class UKCPhase(str, Enum):
    """Canonical UKC macro-phase.

    The slug values double as the ``ukc_phases`` metadata vocabulary for
    skills and are stable across releases.
    """

    INITIAL_FOOTHOLD = "initial_foothold"
    NETWORK_PROPAGATION = "network_propagation"
    ACTION_ON_OBJECTIVES = "action_on_objectives"

    @property
    def slug(self) -> str:
        return self.value


PHASE_ORDER: tuple[UKCPhase, ...] = (
    UKCPhase.INITIAL_FOOTHOLD,
    UKCPhase.NETWORK_PROPAGATION,
    UKCPhase.ACTION_ON_OBJECTIVES,
)
