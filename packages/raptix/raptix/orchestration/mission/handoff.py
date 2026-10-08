"""Safe handoff policy: single-owner lease and resume reconciliation (ADR-0057).

Default off (``RAPTIX_TASK_HANDOFF``). A dispatch claims an objective's owner
lease before continuing and releases it when done; a second owner cannot claim
an unexpired lease, and a stale owner cannot release or fold after handover.
Resume reconciliation surfaces executions that never reached a terminal state
as ``outcome_unknown`` instead of silently re-running them (I-7). Handoff is
never automatic — triggers are evaluated, but an operator or the next dispatch
drives the change.
"""

from __future__ import annotations

import logging
import os
import time
from enum import StrEnum

from deepagents.backends.protocol import BackendProtocol

from raptix.orchestration.mission.task_state import (
    OwnerLease,
    TaskState,
    TaskStateRefused,
    mutate_task_state,
    read_task_state,
)

log = logging.getLogger(__name__)

HANDOFF_FLAG = "RAPTIX_TASK_HANDOFF"
DEFAULT_LEASE_TTL_S = 900.0


def handoff_enabled() -> bool:
    return os.environ.get(HANDOFF_FLAG, "0").strip().lower() in {"1", "true", "yes"}


class HandoffReason(StrEnum):
    BUDGET_EXHAUSTED = "budget_exhausted"
    STALL = "stall"
    PHASE_TRANSITION = "phase_transition"
    OPERATOR = "operator"


def handoff_reason(
    *,
    requested: bool = False,
    budget_exhausted: bool = False,
    stalled: bool = False,
    phase_changed: bool = False,
) -> HandoffReason | None:
    """Rank an explicit operator request above the automatic triggers."""
    if requested:
        return HandoffReason.OPERATOR
    if budget_exhausted:
        return HandoffReason.BUDGET_EXHAUSTED
    if stalled:
        return HandoffReason.STALL
    if phase_changed:
        return HandoffReason.PHASE_TRANSITION
    return None


def lease_token(dispatch_id: str, attempt: int) -> str:
    return f"{dispatch_id}:{attempt}"


def claim_lease(
    backend: BackendProtocol | None,
    objective_id: str,
    *,
    token: str,
    owner: str = "",
    ttl_s: float = DEFAULT_LEASE_TTL_S,
    now: float | None = None,
) -> str | None:
    """Take the objective's lease unless a different unexpired owner holds it.

    Returns a reason string when the claim is refused, otherwise ``None``. An
    expired lease is replaced; a repeated claim by the same token renews it.
    """
    current = time.time() if now is None else now

    def mutate(state: TaskState) -> None:
        lease = state.owner_lease
        if lease is not None and lease.token != token and lease.expires_at > current:
            raise TaskStateRefused(f"lease held by {lease.owner or lease.token}")
        state.owner_lease = OwnerLease(token=token, owner=owner, expires_at=current + ttl_s)

    try:
        state = mutate_task_state(backend, objective_id, mutate)
    except TaskStateRefused as exc:
        return str(exc)
    return None if state is not None else "lease backend unavailable"


def release_lease(backend: BackendProtocol | None, objective_id: str, token: str) -> bool:
    """Clear the lease only when ``token`` is its current owner (ADR-0057)."""
    released = False

    def mutate(state: TaskState) -> None:
        nonlocal released
        if state.owner_lease is not None and state.owner_lease.token == token:
            state.owner_lease = None
            released = True

    mutate_task_state(backend, objective_id, mutate)
    return released


def lease_owner(backend: BackendProtocol | None, objective_id: str, token: str) -> bool:
    """True when ``token`` is the objective's current lease owner (expiry aside)."""
    try:
        state = read_task_state(backend, objective_id).state
    except Exception as exc:  # noqa: BLE001 — ownership check is best-effort
        log.debug("lease ownership unavailable: %s", type(exc).__name__)
        return False
    return state is not None and state.owner_lease is not None and state.owner_lease.token == token


def pending_executions(backend: BackendProtocol | None, objective_id: str) -> list[dict]:
    """Started receipts with no terminal sibling, as ``outcome_unknown`` (I-7)."""
    from raptix.middleware.execution_ledger import (
        _load_entries,
        ledger_path,
        reconcile_receipts,
    )

    try:
        entries = _load_entries(backend, ledger_path(objective_id))
    except Exception as exc:  # noqa: BLE001 — reconciliation is best-effort
        log.debug("pending executions unavailable: %s", type(exc).__name__)
        return []
    return [
        entry for entry in reconcile_receipts(entries) if entry.get("kind") == "outcome_unknown"
    ]


__all__ = [
    "DEFAULT_LEASE_TTL_S",
    "HANDOFF_FLAG",
    "HandoffReason",
    "claim_lease",
    "handoff_enabled",
    "handoff_reason",
    "lease_owner",
    "lease_token",
    "pending_executions",
    "release_lease",
]
