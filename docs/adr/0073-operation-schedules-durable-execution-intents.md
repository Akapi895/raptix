# ADR-0073: Operation schedules are durable execution intents

Status: Proposed

## Context

The web console exposes governed plans and operation bindings, but starting
work still requires a human to press "run" at the right moment. Operators need
to start an operation at a future time (maintenance windows, agreed ROE
windows) without keeping a browser tab open, and without creating a second
path to execution authority that bypasses the governance gates.

## Decision

Add an `OperationSchedule` record: a durable execution intent tied to an
existing engagement, owned execution thread and approved plan. Creation
validates the same preconditions as a manual start (approved plan with
expiry, current scope pin, owned execution thread, open engagement) and
carries a client-generated `requestId` as its durable identity — re-submitting
the same `requestId` is idempotent, and the runtime ledger can reconcile it.

A server-side worker claims due intents atomically (conditional update, so
exactly one worker wins), re-runs the full execution gate
(`assertExecutionAuthorized`: binding, plan TTL, scope pin, emergency stop,
closure, preflight) at due time, and only then dispatches through the runtime
request ledger. Refusals are recorded with the gate's reason; a lost dispatch
acknowledgement keeps the intent `uncertain` instead of re-dispatching. A due
intent unclaimed for a grace period becomes `missed`; a claim that outlives
its worker (restart recovery) becomes `uncertain`. Operators cancel or
reschedule scheduled intents with a version CAS.

The schedule never grants authority by itself: every dispatch passes the same
gates as a manual start, and no browser timer participates in scheduling.

## Consequences

- **Easier:** operations start inside authorized windows without a human
  present; every scheduled start is auditable and reconcilable through the
  request ledger identity.
- **Harder:** an `uncertain` intent requires an operator decision before any
  retry — the system refuses to guess whether the runtime received the start.
- **Given up:** no automatic retry of refused or missed intents; no generic
  pause/resume semantics for running work (the runtime has no such contract).
- **Migration:** additive table; none for existing data.

## Alternatives considered

- **Browser timers that submit the run at the chosen time:** rejected — the
  plan explicitly forbids browser-driven scheduling; a closed tab silently
  drops the intent and nothing records the miss.
- **Auto-retry uncertain/missed intents:** rejected — re-dispatching when the
  previous acknowledgement is unknown can double-start work; the request
  ledger's `reconcile` is the explicit recovery path instead.
