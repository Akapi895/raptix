"""Per-task context; concurrent invocations never share mutable role counters."""

import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field

from raptix_core.types.dispatch_outcome import DispatchFailureOutcome


@dataclass(frozen=True)
class DispatchContext:
    dispatch_id: str
    objective_id: str | None
    attempt: int
    failures: list[DispatchFailureOutcome] = field(default_factory=list)
    lease_token: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: float = field(default_factory=time.monotonic)
    parent_call_id: str | None = None


active_dispatch: ContextVar[DispatchContext | None] = ContextVar("active_dispatch", default=None)
