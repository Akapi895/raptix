"""Read-only foothold decision contract; declarations never count as verification."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class AccessOperation(StrEnum):
    PREPARATION = "preparation"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    LATERAL_MOVEMENT = "lateral_movement"
    REMOTE_EXECUTION = "remote_execution"
    C2_COMMAND = "c2_command"
    EXFILTRATION = "exfiltration"


class AccessObservation(BaseModel):
    """A verifier-owned result, never populated from an agent tool argument."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    reference: str = Field(min_length=1, max_length=128)
    verified_at: datetime
    session_live: bool
    controlled_execution: bool
    privilege: str = ""
    reachable_targets: tuple[str, ...] = ()
    source: str = Field(min_length=1, max_length=64)


class AccessVerifier(Protocol):
    def observe(self, reference: str) -> AccessObservation | None: ...


_RANK = {"anonymous": 0, "user": 1, "admin": 2, "root": 3, "system": 3}
_REQUIRES_ACCESS = frozenset(
    {
        AccessOperation.LATERAL_MOVEMENT,
        AccessOperation.REMOTE_EXECUTION,
        AccessOperation.C2_COMMAND,
        AccessOperation.EXFILTRATION,
    }
)


def assess_access(
    operation: AccessOperation,
    reference: str | None,
    target: str | None,
    required_privilege: str | None,
    verifier: AccessVerifier | None,
    *,
    now: datetime | None = None,
) -> str:
    """Return a shadow decision; no caller may use it as authorization."""
    if operation not in _REQUIRES_ACCESS:
        return "not_applicable"
    if verifier is None or not reference:
        return "unverified: no independent access verifier/reference"
    observation = verifier.observe(reference)
    if observation is None or observation.reference != reference:
        return "unverified: reference not bound by verifier"
    now = now or datetime.now(timezone.utc)
    checked = observation.verified_at
    if checked.tzinfo is None or checked > now or now - checked > timedelta(seconds=60):
        return "unverified: stale or invalid observation"
    if not observation.session_live or not observation.controlled_execution:
        return "unverified: no live controlled execution"
    if target is None or target not in observation.reachable_targets:
        return "unverified: target reachability not independently observed"
    if required_privilege is not None:
        required = _RANK.get(required_privilege.lower())
        actual = _RANK.get(observation.privilege.lower())
        if required is None or actual is None or actual < required:
            return "unverified: insufficient or unknown privilege"
    return f"observed_by={observation.source} (shadow; not an authorization decision)"
