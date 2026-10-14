"""Dispatch-scoped failures that survive the child/parent tool boundary."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FailureKind(StrEnum):
    EXECUTION = "execution"
    STATE = "state"
    TOOL = "tool"
    CONTROL = "control"


class DispatchFailureOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["failed"] = "failed"
    failure_kind: FailureKind = FailureKind.EXECUTION
    terminal_for_this_dispatch: bool = False
    objective_id: str | None = None
    dispatch_id: str
    consecutive_failure_count: int = Field(ge=1)
    error_type: str
    error_message: str = Field(max_length=2000)
    partial_state_refs: list[str] = Field(default_factory=list, max_length=20)


def classify_dispatch_failure(error: Exception) -> FailureKind:
    """Best-effort diagnostic classification, not a retry policy."""
    if isinstance(error, (KeyError, ValueError, TypeError, AttributeError)):
        return FailureKind.STATE
    # TimeoutError is an OSError subclass — check it first so a dispatch
    # that ran past its wall-clock budget classifies as EXECUTION (same
    # bucket as a recursion-limit fault) rather than TOOL.
    if isinstance(error, TimeoutError):
        return FailureKind.EXECUTION
    if isinstance(error, (PermissionError, ConnectionError, OSError)):
        return FailureKind.TOOL
    if type(error).__name__ == "BudgetExceeded":
        return FailureKind.CONTROL
    return FailureKind.EXECUTION
