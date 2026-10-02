# 0028. Typed dispatch failure outcome (Step 1 of control-plane fixes)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** @PurpleCHOIms
- **Related:** [ARCHITECTURE_AUDIT.md](../../ARCHITECTURE_AUDIT.md), [ARCHITECTURE_AUDIT_FIX.md](../../ARCHITECTURE_AUDIT_FIX.md), [ADR-0027](0027-baseline-freeze-for-control-plane-fixes.md)

## Context

The architecture audit identified P0-1: failure/terminal is text-only.
`_consecutive_failures` lives on the `StreamingRunnable` instance
(role-scoped), and `[TERMINAL]` is just a string marker in the
returned AIMessage content. Runtime A1 evidence confirmed this is not
hypothetical: 6 recursion errors and 4 `[TERMINAL]` markers, yet
dispatch continued afterward.

The follow-up review (`ARCHITECTURE_AUDIT_FIX.md` §1) reframed this
as a **failure/control boundary problem**, not a "terminal flag bug".
The orchestrator has no machine-readable signal that says:

> "dispatch X has terminated because Y; these are the partial
> artifacts still valid; objective Z should not retry this edge;
> next admissible control actions are …"

Without that signal, the model falls back to filesystem polling to
reconstruct state — which is exactly the 204 repeated `ls` calls
observed in A1.

The review also specified the **regression principle** for Initial
Foothold horizontal exploration: fixes may tighten "when the system
declares a usable foothold / when propagation is permitted", but must
NOT tighten "which hypotheses the exploit worker may try inside IF".
A role-scoped terminal marker that disables the role would violate
this principle.

## Decision

We introduce a **typed dispatch failure outcome** that replaces the
text-only `[TERMINAL]` marker with a structured schema the
orchestrator can inspect without string-matching.

### Schema

New pydantic model in `raptix-core` (pure-pydantic, no framework
imports):

```python
class FailureKind(StrEnum):
    PLANNING = "planning"
    TOOL = "tool"
    EXECUTION = "execution"
    STATE = "state"
    CONTROL = "control"

class DispatchFailureOutcome(BaseModel):
    status: str = "failed"  # frozen
    failure_kind: FailureKind
    terminal_for_this_dispatch: bool = False
    objective_id: str | None = None
    dispatch_id: str | None = None
    consecutive_failure_count: int = 0
    error_type: str | None = None
    error_message: str | None = None
    partial_state_refs: list[str] = []
```

### Dispatch-scoped counter

The failure counter moves from role-scoped (`_consecutive_failures`
on the `StreamingRunnable` instance) to **dispatch-scoped**
(`_dispatch_failures: dict[str, int]` keyed by `dispatch_id`).

- When the orchestrator passes an explicit `dispatch_id` (via input
  or config), the counter is scoped to that dispatch.
- When no explicit `dispatch_id` is provided (legacy callers, existing
  tests), the counter falls back to a stable per-wrapper-instance id
  so the pre-Step-1 role-scoped behavior is preserved.
- A successful run resets only the current dispatch's counter, not
  all counters.

### Embedding in AIMessage

The typed outcome is embedded in the returned AIMessage's
`additional_kwargs["dispatch_failure_outcome"]` (JSON-serialized
pydantic dump). The text `[TERMINAL]` marker is preserved in the
content for backward compatibility with existing consumers and the
terminal-guard tests.

### Partial state refs

When a tool wrote to a file path before the failure, the path is
captured in `partial_state_refs` (scanning the transcript for
`subagent_tool_result` events with `path`/`file_path`/`output_path`
args). The orchestrator can read these refs without re-deriving state
from scratch.

### Failure classification

Best-effort mapping from Python exception class to `FailureKind`:

| Exception | FailureKind |
|---|---|
| `RecursionError`, `TimeoutError`, `asyncio.TimeoutError` | EXECUTION |
| `KeyError`, `ValueError`, `TypeError`, `AttributeError` | STATE |
| `PermissionError`, `ConnectionError`, `OSError` | TOOL |
| `BudgetExceeded` | CONTROL |
| (default) | EXECUTION |

The classification is a hint, not a hard contract.

## Consequences

- **Easier:** the orchestrator can inspect `terminal_for_this_dispatch`
  without string-matching `[TERMINAL]`. New consumers should read the
  structured field; old consumers keep working via the text marker.
- **Easier:** one failed dispatch no longer poisons other dispatches
  to the same role. The counter is per-dispatch, not per-role.
- **Easier:** `partial_state_refs` gives the orchestrator a starting
  point for recovery without re-deriving from filesystem.
- **Harder:** the orchestrator must learn to read the structured
  field. Until it does, the text marker still works (backward compat).
- **Harder:** the dispatch_id must be threaded through the dispatch
  path. When the orchestrator doesn't provide one, we fall back to
  per-wrapper-instance tracking (legacy behavior).
- **Given up:** the ability to disable a role globally via a single
  counter. This was never the right control surface; the new design
  makes it explicit that terminal is per-dispatch.
- **Migration:** none for existing callers. The text marker is
  preserved. New consumers should migrate to the structured field.

## Alternatives considered

- **Keep text-only, just add more markers.** Rejected because the
  review explicitly identifies this as a control-plane problem, not a
  marker problem. String-matching is fragile and the orchestrator
  still has no machine-readable signal.
- **Make the counter objective-scoped instead of dispatch-scoped.**
  Rejected because objectives can have multiple parallel dispatches.
  Dispatch is the right granularity: one dispatch = one invocation =
  one counter.
- **Disable the role when terminal is reached.** Explicitly rejected
  by the review's regression principle: this would break IF
  horizontal exploration. The new design makes terminal
  per-dispatch, not per-role.
- **Use a separate event channel instead of AIMessage additional_kwargs.**
  Rejected because the AIMessage is already the return channel; adding
  a separate channel would require changes to SubAgentMiddleware and
  every consumer. The additional_kwargs approach is local to
  StreamingRunnable and backward-compatible.
