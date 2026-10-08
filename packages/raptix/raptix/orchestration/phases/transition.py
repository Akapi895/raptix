"""Phase transition records."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from raptix.orchestration.phases.model import UKCPhase


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class PhaseTransition:
    """A single accepted phase change. Immutable for audit purposes."""

    from_phase: UKCPhase
    to_phase: UKCPhase
    reason: str = ""
    actor: str = ""
    recorded_at: datetime = field(default_factory=_utcnow)
