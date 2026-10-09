"""Durable per-objective task state (ADR-0049, Wave B1).

Work/execution state that survives conversation compaction or a fresh worker:
what an objective is doing, what it tried, what it proved, what comes next, and
the counters it has consumed. Persisted per objective through the
engagement-scoped backend — the same plumbing OPPLAN uses, a different file.

Non-authoritative by design: the OPPLAN stays the plan of record and the KG
stays canonical for findings. Every writer here is best-effort and gated by
``RAPTIX_TASK_STATE`` (default off).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import posixpath
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from enum import StrEnum
from types import SimpleNamespace
from typing import Any, Literal

from deepagents.backends.protocol import BackendProtocol
from pydantic import BaseModel, ConfigDict, Field, field_validator

from raptix_core.types.engagement import ObjectiveStatus

log = logging.getLogger(__name__)

TASK_STATE_SCHEMA_VERSION = "1"
TASK_STATE_DIR = "/workspace/plan/task-state"

# Bounded sections: keep the most recent entries so an objective that runs for
# a long time cannot grow an unbounded document.
_MAX_EVIDENCE_REFS = 50
_MAX_DECISIONS = 50
_MAX_DOCUMENT_BYTES = 256_000


def document_lock(path: str, backend: Any = None) -> Any:
    from raptix.orchestration.mission.task_transaction import task_transaction

    return task_transaction(path, backend)


def scoped_task_backend(backend: Any, runtime: Any) -> BackendProtocol | None:
    from raptix.middleware.filesystem import (
        EngagementFilesystemBackend,
        _rebind_sandbox_per_run,
        _workspace_from_runtime,
    )

    if backend is None:
        return None
    if getattr(runtime, "config", None) is None:
        from langgraph.config import get_config

        try:
            config = get_config()
        except RuntimeError:
            config = {}
        runtime = SimpleNamespace(
            **{
                name: getattr(runtime, name, None)
                for name in ("state", "store", "context", "stream_writer", "tool_call_id")
            },
            config=config,
        )
    resolved = backend(runtime) if callable(backend) else backend
    return EngagementFilesystemBackend(
        _rebind_sandbox_per_run(resolved, runtime), _workspace_from_runtime(runtime)
    )


class WorkStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    EXHAUSTED = "exhausted"


# OPPLAN status → task-state work status. ``cancelled`` maps to ``exhausted``:
# no further work will be done on the objective, but it did not succeed.
_WORK_STATUS_BY_OPPLAN: dict[str, WorkStatus] = {
    ObjectiveStatus.PENDING.value: WorkStatus.PENDING,
    ObjectiveStatus.IN_PROGRESS.value: WorkStatus.RUNNING,
    ObjectiveStatus.COMPLETED.value: WorkStatus.COMPLETED,
    ObjectiveStatus.BLOCKED.value: WorkStatus.BLOCKED,
    ObjectiveStatus.CANCELLED.value: WorkStatus.EXHAUSTED,
}


def work_status_for(opplan_status: str) -> WorkStatus:
    """Map an OPPLAN ``ObjectiveStatus`` value to a task-state ``WorkStatus``."""
    return _WORK_STATUS_BY_OPPLAN.get(opplan_status, WorkStatus.PENDING)


def task_state_enabled() -> bool:
    return os.environ.get("RAPTIX_TASK_STATE", "0").strip().lower() in {"1", "true", "yes"}


def _safe_objective_id(objective_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", objective_id):
        raise ValueError("invalid objective id")
    return objective_id


def task_state_path(objective_id: str) -> str:
    return posixpath.join(TASK_STATE_DIR, f"{_safe_objective_id(objective_id)}.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class WorkState(BaseModel):
    status: WorkStatus = WorkStatus.PENDING
    reason: str = Field(default="", max_length=2000)


class EvidenceRef(BaseModel):
    ref: str = Field(min_length=1, max_length=512)
    sha256: str = Field(default="", pattern=r"^(?:[a-fA-F0-9]{64})?$")
    note: str = Field(default="", max_length=500)


class DecisionRecord(BaseModel):
    action: str = Field(max_length=256)
    outcome: str = Field(max_length=32)
    reason: str = Field(default="", max_length=2000)
    retry_condition: str = Field(default="", max_length=500)


class Continuation(BaseModel):
    next_steps: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    awaiting: list[str] = Field(default_factory=list)

    @field_validator("next_steps", "blockers", "awaiting")
    @classmethod
    def bound_steps(cls, steps: list[str]) -> list[str]:
        return [step[:500] for step in steps[:8]]


class Budget(BaseModel):
    model_calls: int = Field(default=0, ge=0, strict=True)
    input_tokens: int = Field(default=0, ge=0, strict=True)
    output_tokens: int = Field(default=0, ge=0, strict=True)
    wall_clock_s: float = Field(default=0.0, ge=0, allow_inf_nan=False)
    attempts: int = Field(default=0, ge=0, strict=True)


class OwnerLease(BaseModel):
    """Single-owner lease on an objective's work (ADR-0057, Wave D3)."""

    token: str = Field(min_length=1, max_length=128)
    owner: str = Field(default="", max_length=128)
    expires_at: float = Field(ge=0, allow_inf_nan=False)


class WorkerResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objective_id: str
    outcome: Literal["success", "failed", "blocked"]
    evidence_refs: list[EvidenceRef] = Field(default_factory=list, max_length=50)
    continuation: Continuation = Field(default_factory=Continuation)
    budget_delta: Budget = Field(default_factory=Budget)
    reason: str = Field(default="", max_length=500)


class TaskState(BaseModel):
    """One objective's durable work/execution state."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1"] = TASK_STATE_SCHEMA_VERSION
    objective_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    state_revision: int = Field(default=0, ge=0, strict=True)
    accounting_revision: int = Field(default=0, ge=0, strict=True)
    saved_at: str = ""
    updated_by: str = ""
    last_event_id: str = ""
    observed_opplan_revision: str | None = None
    observed_kg_revision: str | None = None
    work_state: WorkState = Field(default_factory=WorkState)
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    decision_record: list[DecisionRecord] = Field(default_factory=list)
    continuation: Continuation = Field(default_factory=Continuation)
    budget: Budget = Field(default_factory=Budget)
    owner_lease: OwnerLease | None = None
    handoff_signals: list[Literal["stall"]] = Field(default_factory=list, max_length=1)
    last_worker_phase: str = Field(default="", max_length=128)
    applied_dispatches: list[str] = Field(default_factory=list, max_length=768)

    @field_validator("evidence_refs", "decision_record")
    @classmethod
    def bound_records(cls, entries: list) -> list:
        return entries[-50:]

    def bounded(self) -> TaskState:
        """Trim the bounded sections in place; keep the most recent entries."""
        self.evidence_refs = self.evidence_refs[-_MAX_EVIDENCE_REFS:]
        self.decision_record = self.decision_record[-_MAX_DECISIONS:]
        return self


class TaskStateBundle(BaseModel):
    """Result of a read: state when present, error when the file is unusable."""

    objective_id: str
    state: TaskState | None = None
    error: str | None = None


def _read_text(backend: BackendProtocol, file_path: str) -> tuple[str | None, str | None]:
    result = backend.read(file_path, offset=0, limit=256_001)
    if result.error:
        return None, result.error
    data = result.file_data
    if not isinstance(data, dict):
        return None, f"File '{file_path}': backend returned no file data"
    if data.get("encoding", "utf-8") != "utf-8":
        return None, f"File '{file_path}': expected utf-8 text, got {data.get('encoding')}"
    content = data.get("content", "")
    if not isinstance(content, str):
        return None, f"File '{file_path}': backend returned non-text content"
    if len(content.encode("utf-8")) > _MAX_DOCUMENT_BYTES:
        return None, "document exceeds byte limit"
    return content, None


def _looks_missing(error: str | None) -> bool:
    if not error:
        return False
    lowered = error.lower()
    return "not_found" in lowered or "not found" in lowered or "no such file" in lowered


def _upsert_text(backend: BackendProtocol, file_path: str, content: str) -> str | None:
    old_content, read_error = _read_text(backend, file_path)
    if old_content is None:
        if read_error and not _looks_missing(read_error):
            return read_error
        write_result = backend.write(file_path, content)
        return write_result.error
    if old_content == content:
        return None
    return backend.edit(file_path, old_content, content).error


def read_task_state(backend: BackendProtocol | None, objective_id: str) -> TaskStateBundle:
    """Read one objective's task state without ever raising.

    A missing file is an empty bundle (no error); a malformed file is an
    explicit error with no state.
    """
    if backend is None:
        return TaskStateBundle(objective_id=objective_id)
    try:
        content, error = _read_text(backend, task_state_path(objective_id))
        if content is None:
            return TaskStateBundle(
                objective_id=objective_id,
                error=(error if error and not _looks_missing(error) else None),
            )
        state = TaskState(**json.loads(content))
        if state.objective_id != objective_id:
            return TaskStateBundle(objective_id=objective_id, error="objective identity mismatch")
    except Exception as exc:  # noqa: BLE001 — corrupt file must not crash the reader
        return TaskStateBundle(
            objective_id=objective_id, error=f"malformed task state: {type(exc).__name__}"
        )
    return TaskStateBundle(objective_id=objective_id, state=state.bounded())


def write_task_state(
    backend: BackendProtocol | None, state: TaskState, *, owner_token: str | None = None
) -> str | None:
    """Persist one objective's task state. Returns a backend error string, if any."""
    if backend is None:
        return "no backend"
    try:
        path = task_state_path(state.objective_id)
        with document_lock(path, backend):
            old, error = _read_text(backend, path)
            if old is None and error and not _looks_missing(error):
                return error
            if old is not None:
                prior = TaskState.model_validate_json(old)
                _assert_owner(prior, owner_token)
                if state.accounting_revision < prior.accounting_revision:
                    return "stale accounting revision"
                if (
                    prior.objective_id != state.objective_id
                    or state.state_revision <= prior.state_revision
                ):
                    return "stale task-state revision or identity mismatch"
                state.owner_lease = prior.owner_lease
            checked = TaskState.model_validate(state.bounded().model_dump())
            content = checked.model_dump_json(indent=2)
            if len(content.encode("utf-8")) > _MAX_DOCUMENT_BYTES:
                return "document exceeds byte limit"
            if old is None:
                return backend.write(path, content).error
            return backend.edit(path, old, content).error
    except Exception as exc:  # noqa: BLE001 — persistence never blocks a tool
        return f"task-state write failed: {type(exc).__name__}"


def advance_task_state(
    objective: dict,
    *,
    prior: TaskState | None,
    updated_by: str = "",
) -> TaskState:
    """Derive the next task state for an objective from its OPPLAN record.

    Bumps ``state_revision`` and refreshes ``work_state``/``saved_at``; carries
    every other section forward so a fresh worker does not lose evidence,
    decisions, continuation, or budget counters.
    """
    base = (
        prior.model_copy(deep=True)
        if prior is not None
        else TaskState(objective_id=str(objective.get("id") or "unscoped"))
    )
    base.objective_id = str(objective.get("id") or base.objective_id)
    status = str(objective.get("status") or ObjectiveStatus.PENDING.value)
    note = str(objective.get("notes") or "")
    base.work_state = WorkState(status=work_status_for(status), reason=note[:2000])
    base.state_revision = base.state_revision + 1
    base.saved_at = _now()
    base.updated_by = updated_by or str(objective.get("owner") or "") or "opplan"
    base.last_event_id = uuid.uuid4().hex[:16]
    base.bounded()
    return base


class TaskStateRefused(Exception):
    """A locked task-state mutation declined by its own invariant (ADR-0057)."""


def _assert_owner(state: TaskState, owner_token: str | None = None) -> None:
    from raptix.core.dispatch_context import active_dispatch

    if os.environ.get("RAPTIX_TASK_HANDOFF", "0").lower() not in {"1", "true", "yes"}:
        return
    context = active_dispatch.get()
    token = owner_token or (context.lease_token if context else None)
    if token and (state.owner_lease is None or state.owner_lease.token != token):
        raise TaskStateRefused("task owner changed")


def mutate_task_state(
    backend: BackendProtocol | None,
    objective_id: str,
    mutate: Callable[[TaskState], None],
    *,
    fence: bool = True,
) -> TaskState | None:
    """Locked, revision-neutral read-modify-write of one objective's state.

    Used by accounting and lease mutations, which must not advance
    ``state_revision`` (that would invalidate transactional compaction). A
    mutation that detects a conflicting invariant raises ``TaskStateRefused``,
    which propagates to the caller unchanged; every other failure is swallowed
    as ``None``. Reads and writes share the per-document lock OPPLAN uses.
    """
    if backend is None:
        return None
    path = task_state_path(objective_id)
    with document_lock(path, backend):
        try:
            old, error = _read_text(backend, path)
            if old is None and error and not _looks_missing(error):
                return None
            if old is None:
                state = TaskState(objective_id=objective_id)
            else:
                state = TaskState.model_validate_json(old)
            if state.objective_id != objective_id:
                return None
            if fence:
                _assert_owner(state)
            mutate(state)
            state.saved_at = _now()
            content = state.bounded().model_dump_json(indent=2)
            if len(content.encode("utf-8")) > _MAX_DOCUMENT_BYTES:
                return None
            if old is None:
                persisted = backend.write(path, content)
            elif old != content:
                persisted = backend.edit(path, old, content)
            else:
                return state
            if persisted.error:
                log.debug("task-state persistence refused")
                return None
            recovered, error = _read_text(backend, path)
            if error or recovered != content:
                return None
            return state
        except TaskStateRefused:
            raise
        except Exception as exc:  # noqa: BLE001 — mutation never blocks the model loop
            log.debug("task-state mutation failed: %s", type(exc).__name__)
            return None


def fold_task_budget(
    backend: BackendProtocol | None,
    objective_id: str,
    *,
    model_calls: int = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    wall_clock_s: float = 0.0,
    decision: DecisionRecord | None = None,
) -> TaskState | None:
    """Accumulate usage counters without bumping ``state_revision`` (ADR-0055).

    Budget accounting is not a work-state transition. Leaving the revision
    unchanged keeps transactional-compaction source checks stable (ADR-0052)
    while the counters still survive handoff (I-6). ``decision`` is appended
    only once, keyed by its ``action``.
    """

    def mutate(state: TaskState) -> None:
        deltas = Budget(
            model_calls=model_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            wall_clock_s=wall_clock_s,
        )
        for key in ("model_calls", "input_tokens", "output_tokens", "wall_clock_s"):
            setattr(state.budget, key, getattr(state.budget, key) + getattr(deltas, key))
        state.accounting_revision += 1
        if decision is not None and not any(
            entry.action == decision.action for entry in state.decision_record
        ):
            state.decision_record.append(decision)
        state.updated_by = "budget"

    return mutate_task_state(backend, objective_id, mutate)


def persist_task_state_for_objectives(
    backend: BackendProtocol | None,
    objectives: list[dict],
    *,
    updated_by: str = "",
    observed_kg_revision: str | None = None,
) -> None:
    """Best-effort refresh of every objective's task state after a mutation.

    No-op when the flag is off or no backend is available. Never raises: task
    state is non-authoritative and the OPPLAN write has already happened.
    """
    if not task_state_enabled() or backend is None:
        return
    for objective in objectives:
        objective_id = objective.get("id")
        if not objective_id:
            continue
        try:
            with document_lock(task_state_path(str(objective_id)), backend):
                bundle = read_task_state(backend, str(objective_id))
                if bundle.error:
                    log.debug("task-state refresh skipped: %s", bundle.error)
                    continue
                state = advance_task_state(objective, prior=bundle.state, updated_by=updated_by)
                state.observed_opplan_revision = hashlib.sha256(
                    json.dumps(objectives, sort_keys=True, default=str).encode()
                ).hexdigest()
                state.observed_kg_revision = observed_kg_revision
                error = write_task_state(backend, state)
            if error:
                log.debug("task-state write failed for %s: %s", objective_id, error)
        except Exception as exc:  # noqa: BLE001 — best-effort persistence
            log.debug("task-state refresh failed for %s: %s", objective_id, type(exc).__name__)


__all__ = [
    "Budget",
    "Continuation",
    "DecisionRecord",
    "EvidenceRef",
    "OwnerLease",
    "TASK_STATE_DIR",
    "TASK_STATE_SCHEMA_VERSION",
    "TaskState",
    "TaskStateBundle",
    "TaskStateRefused",
    "WorkState",
    "WorkStatus",
    "advance_task_state",
    "fold_task_budget",
    "mutate_task_state",
    "persist_task_state_for_objectives",
    "read_task_state",
    "task_state_enabled",
    "task_state_path",
    "work_status_for",
    "write_task_state",
]
