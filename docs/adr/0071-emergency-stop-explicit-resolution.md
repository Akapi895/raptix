# ADR-0071: Emergency stop explicit resolution

Status: Proposed

## Context

The web governance model persists an emergency-stop record as a latch before
cancelling runs, and the work-start preflight, plan bind and closure checklist
block while the latch is active. Until now the blocker had no exit path: once a
stop outcome landed in the active set (`requested`, `acknowledged`, `stopped`,
`failed`, `unknown`) the engagement stayed frozen, because resolution was
assumed to happen implicitly when runs reported a terminal state. That
assumption fails for partial stops (provider timeout, cancel ACK not yet
terminal) where the latch must stay until a human confirms the runtime is
actually quiet — but never offers a way to say so.

Resolution must also not silently resume anything: a stop is a safety action,
so restarting work must remain an explicit, separately authorized sequence
through the existing preflight/bind gates.

## Decision

Add `resolved` as an explicit terminal outcome of an engagement emergency stop,
set only through a new engagement-scoped endpoint
`POST /api/engagements/:id/estops/:stopId/resolve`. Resolution requires a
reason, records the resolver in the audit log and inbox, and returns 409 if the
stop is already terminal. The work-start gate blocks on the unified active set
(`requested | acknowledged | stopped | failed | unknown`) and clears only when
the outcome is `resolved`. The closure checklist keeps blocking on the same
active set, so closure still needs the stop acknowledged by evidence, not just
resolved.

Resolution never resumes, restarts or re-dispatches anything, and never
restores an expired plan approval. It only clears the blocker; any subsequent
work start re-runs preflight and bind in full.

The emergency-stop request validates the operation thread before creating any
latch: the thread must exist inside the same engagement and be of kind
`execution`, otherwise the request fails with 404/400 and no stop record or run
cancellation happens.

## Consequences

- **Easier:** operators can unfreeze an engagement after a partial stop with
  an auditable human decision; preflight, bind and closure share one
  definition of "active stop" (`ACTIVE_STOP_OUTCOMES`).
- **Harder:** every stop now needs an explicit resolution act before work can
  restart — an operator cannot rely on cancel completion alone.
- **Given up:** implicit auto-unblocking when all runs reach a terminal state;
  auto-resume of interrupted runs after resolution.
- **Migration:** none — `EmergencyStop.outcome` is an untyped string column, so
  `resolved` needs no Prisma migration; existing rows stay valid.

## Alternatives considered

- **Auto-resolve when every cancelled run reports a terminal state:** rejected
  because "no live run" is not evidence the runtime is quiet (workers outside
  the cancel scope, missed ACKs); the plan requires observe-and-confirm
  semantics with human judgment for `unknown`.
- **Separate `resume` endpoint that clears the latch and re-dispatches
  interrupted plans:** rejected because resume is a work-start decision that
  already exists as preflight + bind; a second dispatch path would bypass
  those gates.
