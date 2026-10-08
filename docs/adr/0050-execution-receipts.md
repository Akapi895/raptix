# ADR-0050: Fail-safe execution receipts

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0049 (task state); ADR-0041 (middleware cross-cutting);
  `docs/context-optimization-implementation-plan.md` (WP-B2, invariant I-7);
  `raptix/middleware/tried_edges.py`, `raptix/middleware/kg_autoingest.py`

## Context

Limits bound how many steps a run takes, not what those steps achieved. When a
run is interrupted, there is no durable record that a probe *started* and never
finished — a resumed worker cannot tell "did not run" from "ran, outcome
unknown" (invariant I-7). Today only OPPLAN status and the KG exist, and neither
records per-action execution history.

## Decision

- **Receipt lifecycle.** A fail-safe hook writes ``planned`` and ``started`` receipts
  before the tool runs and a ``succeeded``/``failed`` receipt after. Interrupted
  ``started`` receipts are converted to ``outcome_unknown`` by
  ``reconcile_receipts`` at resume time (consumed by D3) — never silently
  assumed successful.
- **Fail-safe contract** (mirrors ``tried_edges``/``kg_autoingest``): the hook
  always returns the original tool result unchanged; a write failure is logged
  at debug and never raised into the tool path; work is bounded (≤4 s,
  semaphore 2). Sync and async use the same bounded two-writer pool. Each
  recording phase waits at most two seconds; a stuck writer retains its slot
  until it exits, so timeouts cannot create an unbounded thread backlog.
  Tool exceptions propagate unchanged; nonzero exit markers are failures and
  background acknowledgements are `outcome_unknown`, not completed executions.
- **Storage.** An append-only JSONL sibling of the task-state document,
  ``<workspace>/plan/task-state/<objective_id>.ledger.jsonl``, rewritten with a
  rolling cap (200 entries) so the task-state document stays small. Updates
  serialize locally and surface backend errors. Rolling eviction removes whole
  terminal receipt groups, never silently discarding unfinished actions. A full
  pending ledger or corrupt file skips recording; it never blocks execution.
- **Idempotency key.** ``sha256(role, tool, canonical-args, objective_id)``.
  Only the hash is stored — never raw parameter values, credentials, tokens, or
  individual secret values. The action hash fingerprints the complete call;
  the ledger also carries receipt identity, timestamps, tool and objective IDs.
- **Slot.** ``MiddlewareSlot.EXECUTION_LEDGER`` in ``_BASE_SLOTS`` so every
  role carries it, but the factory returns ``None`` unless
  ``RAPTIX_EXECUTION_LEDGER=1`` (default off). B3 also uses this slot to project
  a validated final JSON `WorkerResult` into a declared output channel when
  `RAPTIX_DISPATCH_HANDOFF=1`; receipt writes remain separately gated. With both
  flags off, the original stack is unchanged. Backend resolution reuses the
  filesystem middleware's per-run routing and fails closed on resolution error.

## Threat model

Observational only: the hook never blocks, alters, or re-invokes a tool, and
does not touch the exploit path, RoE, HITL, or egress. It writes only under the
engagement-scoped workspace, inheriting the ADR-0042 fence. Hashing the complete
action avoids storing parameters but is not a sanitizer for arbitrary artifacts;
the existing engagement-data access policy still applies.

## Consequences

- **Easier:** a resumed worker can list attempted actions and their outcomes;
  D3 reconciles unknown outcomes instead of re-running side effects.
- **Harder:** one more bounded write per tool call when the flag is on; the
  ledger is not a canonical fact source.
- **Migration:** none. Flag off is a no-op.

## Alternatives considered

- Record receipts in the KG — rejected: execution churn would pollute the
  canonical engagement graph and couple the hook to the KG backend.
- Record only terminal outcomes — rejected: a crash between start and finish
  would leave no trace at all, which is the exact gap I-7 names.
- Store raw arguments for debuggability — rejected: violates the standing
  no-secrets-in-telemetry rule.
