"""UKC phase orchestration (W7).

Defines the three canonical UKC macro-phases as runtime state:

- :class:`raptix.orchestration.phases.model.UKCPhase` — the enum and
  canonical order,
- :mod:`raptix.orchestration.phases.ukc` — slug helpers shared with
  skill metadata (``ukc_phases``),
- :class:`raptix.orchestration.phases.state_machine.PhaseStateMachine`
  — shadow-mode state machine (status/observability only; nothing in
  the runtime gates on it yet),
- :mod:`raptix.orchestration.phases.policy` /
  :mod:`raptix.orchestration.phases.transition` — policy and record
  types.

Phases are never a source-tree layout: agents, skills and tools stay
organised by capability/domain (``raptix-repository-architecture.md``
§2.3, §7 and §16).
"""

from raptix.orchestration.phases.model import PHASE_ORDER, UKCPhase
from raptix.orchestration.phases.policy import DefaultPhasePolicy, PhasePolicy
from raptix.orchestration.phases.state_machine import (
    InvalidPhaseTransition,
    PhaseStateMachine,
)
from raptix.orchestration.phases.transition import PhaseTransition
from raptix.orchestration.phases.ukc import (
    canonical_phases,
    is_canonical_slug,
    next_phase,
    phase_from_slug,
    phase_index,
)

__all__ = [
    "PHASE_ORDER",
    "DefaultPhasePolicy",
    "InvalidPhaseTransition",
    "PhasePolicy",
    "PhaseStateMachine",
    "PhaseTransition",
    "UKCPhase",
    "canonical_phases",
    "is_canonical_slug",
    "next_phase",
    "phase_from_slug",
    "phase_index",
]
