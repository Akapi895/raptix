# ADR-0057: Safe handoff policy (lease + reconciliation)

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0049 (task state); ADR-0050 (execution receipts);
  ADR-0051 (dispatch handoff); ADR-0055 (budget); ADR-0056 (progress signals);
  `docs/context-optimization-implementation-plan.md` (WP-D3, invariant I-7)

## Context

A mid-flight handoff — moving an objective from one worker/dispatch to another
— is the only way to recover an objective that exhausted its budget or stalled,
without losing work. It is also the riskiest bit of the plan: a handoff can
overlap a side-effecting tool call whose outcome is unknown, and it must not
allow two owners to run the same objective concurrently, nor let a stale owner
overwrite the successor's state. The plan therefore gates D3 behind explicit
sign-off and a threat model, and forbids automatic handoff.

## Decision

### Completion review (2026-10-09)

Each invocation has a unique lease token. An enabled lease must be durably claimed
before dispatch; missing, busy, failed or timed-out storage refuses that dispatch.
Ownership is checked inside the document transaction by every dispatched writer,
including accounting. Work-state writes preserve newer accounting and lease state.
Filesystem transactions use OS file locks across processes; other backends retain
the existing process-local transaction lock and exact edit/read-back checks.
Distributed remote-backend locking is not assumed: overlapping processes require
a backend-provided task-state transaction. Unsupported distributed deployments
must not enable handoff. Triggers are surfaced as advisory readiness in WorkerInput,
never as automatic mid-flight interruption or implicit execution retry.

- **Owner lease.** `TaskState` gains an optional `owner_lease`
  (`token`, `owner`, `expires_at`). A dispatch claims the objective's lease
  before continuing: a different, unexpired lease refuses the claim; an expired
  lease is replaceable; a repeated claim by the same token renews it. The lease
  is cleared on finish only by the current token, so a stale owner's release is
  a no-op. Lease mutations are revision-neutral via `mutate_task_state`, so they
  do not invalidate transactional compaction (ADR-0052).
- **No stale-owner writes.** The dispatch task-state fold checks lease ownership
  first; after a handover a detached old owner skips the fold instead of
  clobbering the successor's state.
- **Resume reconciliation, never re-run.** `pending_executions` reads the
  execution ledger, marks every dangling `started` receipt `outcome_unknown`
  (via ADR-0050's `reconcile_receipts`), and lists them in the WorkerInput
  bundle. Unknown executions are surfaced for a deliberate decision; they are
  never silently retried.
- **Triggers are evaluated, not executed.** `handoff_reason` ranks operator
  request > budget-exhausted (ADR-0055 marker) > stall (ADR-0056 signal) >
  phase transition. This WP exposes readiness; it performs **no automatic
  handoff** and default-off runs are byte-identical.
- **Flag.** `RAPTIX_TASK_HANDOFF` (default off). Lease enforcement only runs
  when it is truthy and the task-state backend resolves; an unavailable backend
  degrades to today's behavior rather than blocking dispatch. When off, no
  lease is read, written, or checked.

## Threat model

Mid-flight handoff with side-effecting tool gaps is the core hazard. The design
contains it structurally: (1) single-owner lease prevents concurrent writers for
one objective; (2) an unknown-outcome receipt is never assumed successful and
never silently re-executed — it is handed to the successor as an explicit
reconcile item; (3) a stale owner cannot release the lease or fold into task
state, so it cannot overwrite the successor's decisions; (4) the lease is
engagement-local (ADR-0042 fence) and stored through the scoped backend. The
lease does not widen RoE, egress, or tool capabilities, and it cannot start a
worker on its own. Residual risk: a genuinely side-effecting action with an
unknown outcome still requires an operator or successor to decide correctness;
the system's contract is to make that gap visible, not to guess. Trigger
evaluation is observational and grants no execution authority.

## Consequences

- **Easier:** an objective can be handed off without two owners racing, and a
  successor sees exactly which executions need reconciliation (I-7).
- **Harder:** lease lifecycle (claim/renew/release, expiry) is state that must
  stay consistent with task-state revisions and the engagement backend.
- **Given up:** automatic handoff. Even with the flag on, a human or the
  orchestrator must initiate the next dispatch.
- **Migration:** none. Flag off preserves today's behavior; `owner_lease`
  defaults to `None`, so existing task-state documents parse unchanged.

## Alternatives considered

- **Advisory lock only in memory** — rejected: handoffs cross processes/threads,
  so ownership must be durable.
- **Hard process kill on budget exhaustion** — rejected: an execution-path
  change requiring its own sign-off and benchmark; D3 surfaces, it does not
  enforce.
- **Auto-retry unknown executions** — rejected: violates I-7 ("unknown ≠ did
  not run"); a side-effecting action may have succeeded, so re-running risks
  duplication.
