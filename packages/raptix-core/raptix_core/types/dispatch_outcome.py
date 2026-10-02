"""Typed dispatch failure outcome schema.

Step 1 of the control-plane fix sequence (ADR-0028). Replaces the
text-only ``[TERMINAL]`` marker with a structured outcome that the
orchestrator can inspect without string-matching.

Design constraints (from ARCHITECTURE_AUDIT_FIX.md §1):

- ``terminal_for_this_dispatch`` is the key field. It means "this
  specific dispatch should not be retried", NOT "this role is
  disabled" or "this path is banned forever".
- The counter is dispatch-scoped, not role-scoped. A role can receive
  many objectives and parallel calls; one failed dispatch must not
  poison the next.
- ``partial_state_refs`` preserves artifacts that are still valid
  after the failure, so the orchestrator does not need to re-derive
  them from filesystem.
- The text marker (``[TERMINAL]``) is preserved in the AIMessage
  content for backward compatibility with existing consumers and
  tests. New consumers should read the structured field instead.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class FailureKind(StrEnum):
    """Classification of why a sub-agent dispatch failed.

    Aligned with the audit's failure taxonomy (ARCHITECTURE_AUDIT.md
    §6.2): PLANNING / TOOL / EXECUTION / STATE / CONTROL.
    """

    PLANNING = "planning"
    TOOL = "tool"
    EXECUTION = "execution"
    STATE = "state"
    CONTROL = "control"


class DispatchFailureOutcome(BaseModel):
    """Structured outcome for a failed sub-agent dispatch.

    Embedded in the AIMessage returned by ``StreamingRunnable`` when a
    dispatch fails. The orchestrator can inspect this to decide whether
    to retry, switch strategy, or move on.

    Fields:

    - ``status``: always ``"failed"`` for this model. Distinguishes
      failure outcomes from success outcomes in the same message stream.
    - ``failure_kind``: classification of the failure (see
      ``FailureKind``).
    - ``terminal_for_this_dispatch``: when True, the orchestrator must
      NOT retry this specific dispatch. Other dispatches (even to the
      same role) are unaffected.
    - ``objective_id``: the objective this dispatch was working on.
      ``None`` when the dispatch was not bound to an objective.
    - ``dispatch_id``: unique id for this dispatch invocation. Two
      parallel ``task("recon", ...)`` calls get different ids.
    - ``consecutive_failure_count``: how many back-to-back failures
      this dispatch has seen. At or above the cap, the outcome is
      terminal.
    - ``error_type``: Python exception class name (e.g.
      ``"RecursionError"``).
    - ``error_message``: exception message text.
    - ``partial_state_refs``: list of artifact paths or state keys
      that are still valid after the failure. The orchestrator can
      read these without re-deriving from scratch.
    """

    status: str = Field(default="failed", frozen=True)
    failure_kind: FailureKind
    terminal_for_this_dispatch: bool = False
    objective_id: str | None = None
    dispatch_id: str | None = None
    consecutive_failure_count: int = 0
    error_type: str | None = None
    error_message: str | None = None
    partial_state_refs: list[str] = Field(default_factory=list)
