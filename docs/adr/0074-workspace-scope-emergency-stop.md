# ADR-0074: Workspace-scope emergency stop authority

Status: Proposed

## Context

An emergency stop can be requested with `scope: 'workspace'`, but the record
lived inside a single engagement and only ever cancelled that engagement's
runs: a workspace stop executed from one engagement never touched any other
engagement. The scope string implied an authority that did not exist — a
global kill switch minted by whichever engagement happened to host the panic.

A workspace stop must not borrow global authority from one engagement, and it
must not blanket-latch engagements that are not doing anything: an active stop
latch blocks every work start (preflight, bind, closure) in that engagement
until it is explicitly resolved (ADR-0071), so latching quiet engagements
would freeze the portfolio for no safety gain.

## Decision

A workspace stop is implemented as an enumerate-and-contain loop over the
requesting actor's real authority:

1. The **anchor engagement** (where the stop was requested) latches and
   cancels first — the requester's own engagement is contained immediately.
   Its stop record is the response's primary view.
2. The service then enumerates the engagements where the actor holds
   ownership (engagement creator) or an `owner`/`operator` membership. Each
   candidate is asked, through a runtime observation bridge
   (`hasActiveRuns`), whether work is actually running there. Only
   engagements with observed active work are latched (each with its own
   `EmergencyStop` row, same reason, scope `workspace`) and cancelled; quiet
   engagements — and engagements whose runtime state cannot be observed — are
   left untouched.
3. Every latch is an ordinary engagement-scoped stop: it is resolved
   independently through the existing resolve endpoint, per ADR-0071, and
   resolution never resumes anything. The response carries the sibling latches
   as `related[]` so the console can surface per-engagement outcomes.
4. Cancellation runs per engagement with the existing truthful-outcome
   contract: `stopped`/`acknowledged` on report, `unknown` when the runtime
   cannot prove a terminal state. One engagement failing (advisory-lock
   contention, runtime outage) never blocks containment of the rest; the
   anchor latch always records.

Resolution of a stop is additionally guarded by an optimistic
`concurrencyVersion` on the `EmergencyStop` row: a resolver acting on a stale
stop list gets 409 instead of silently overwriting a newer outcome, and the
version increments on every resolve.

## Consequences

- **Easier:** a workspace stop now means what it says — every engagement the
  actor is authorized to control and that is actually running work gets
  stopped and latched; the portfolio view can render per-engagement outcomes.
- **Harder:** authority enumeration makes the stop's blast radius explicit and
  auditable; operators see latches appear in other engagements (inbox + audit)
  and must resolve each engagement separately.
- **Given up:** one-latch workspace semantics ("workspace" as a single global
  record) and the pretense that a stop issued inside one engagement carries
  global authority.
- **Migration:** `EmergencyStop.concurrencyVersion` column (default 1) via
  `20261019000000_estop_concurrency_version`.

## Alternatives considered

- **Single global latch row referenced by every engagement:** rejected — it
  re-creates the borrowed-authority problem and makes per-engagement
  resolution impossible without shared mutable state.
- **Latch every owned engagement unconditionally:** rejected — latching quiet
  engagements freezes them behind an explicit resolution with no safety gain;
  ADR-0071 makes resolution a deliberate human act, so the latch must only
  exist where there is something to contain.
- **Resolve without a concurrency guard:** rejected — two operators resolving
  from stale lists could overwrite each other's outcome trail; the versioned
  CAS matches the findings-transition contract (W19).
