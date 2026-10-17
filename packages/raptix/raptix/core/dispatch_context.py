"""Per-task context; concurrent invocations never share mutable role counters."""

from contextvars import ContextVar
from dataclasses import dataclass, field

from raptix_core.types.dispatch_outcome import DispatchFailureOutcome


@dataclass(frozen=True)
class DispatchContext:
    dispatch_id: str
    objective_id: str | None
    attempt: int
    failures: list[DispatchFailureOutcome] = field(default_factory=list)
    # The subagent role that owns this dispatch; the ledger records it so a roster can name the instance.
    role: str | None = None


active_dispatch: ContextVar[DispatchContext | None] = ContextVar("active_dispatch", default=None)
