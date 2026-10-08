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


active_dispatch: ContextVar[DispatchContext | None] = ContextVar("active_dispatch", default=None)
