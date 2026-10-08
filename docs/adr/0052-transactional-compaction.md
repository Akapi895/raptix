# ADR-0052: Transactional compaction with a source-revision check

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0045 (recoverable offload); ADR-0046 (failure semantics);
  ADR-0049 (task state); `docs/context-optimization-implementation-plan.md`
  (WP-C1, invariants I-4, I-5)

## Context

Wave A made compaction *fail-open*: a failed summary or an unreadable offload
no longer replaces live history with an error string. But deepagents still
*commits* a compaction event whenever the summarizer returns normally, even if
the recovery pointer is missing or the summary lost its required structure.
Compaction is a destructive replace of the effective message list, so committing
one without a resolvable recovery reference (I-4) or against a task-state
revision that changed mid-compaction (I-5) yields an unrecoverable, hybrid
context.

## Decision

- **Transactional commit.** `_SafeSummarizationProxy._finalize` validates a
  compaction event before it is applied and strips it (keeping the uncompacted
  request) when any gate fails:
  1. the summary is not the A3 error marker (existing);
  2. the offload produced a recovery reference;
  3. that reference is readable through the same engagement-scoped backend the
     worker's filesystem tools use;
  4. the summary carries the required section headers (stop-gap until C2's
     structured validator lands);
  5. the event's epoch is not stale relative to the committed `context_epoch`;
  6. the source task-state revision is unchanged between wrap start and commit.
- **Source revision.** At wrap start the proxy snapshots the task-state
  revision and a hash of the pre-wrap effective message ids. The surviving
  event is stamped with that `source_revision` (replacing the Wave A
  placeholder constant).
- **Flag.** `RAPTIX_TRANSACTIONAL_COMPACTION=1` (default off). The plan's flag
  inventory does not name a C1 flag, but plan §2.4 requires every behavior that
  alters agent input to be flag-gated with current behavior as the default; the
  flag is added and recorded here. Off = Wave A behavior (error-summary strip
  only).
- **Backend-unavailable degradation.** When no task-state backend can be
  resolved the readability and revision checks are skipped rather than failing
  the compaction, so library/benchmark runs without a workspace keep
  compacting. This is a deliberate gap, named in the ADR.

## Threat model

Compaction is not on the exploit path; this change only *refuses* commits, so
it cannot widen scope, egress, or tool authority. It reads through the
engagement-scoped backend (ADR-0042 fence) and never mutates raw state — the
effective projection only. No guardrail, RoE, or KG write is touched.

## Consequences

- **Easier:** a committed compaction always has a readable recovery pointer and
  a consistent source revision; the epoch is the commit token.
- **Harder:** one more gate set to reason about; a mis-structured summary can
  now block compaction (the fallback is the uncompacted request, not data loss).
- **Migration:** none. Flag off preserves Wave A behavior.

## Alternatives considered

- Always commit and rely on the pointer being best-effort — rejected: I-4/I-5
  require the commit itself to be conditional.
- Reject on unreadable pointer even without a backend — rejected: would disable
  compaction in backend-less environments; the honest gap is documented.
- Validate semantics with an LLM — rejected for the gate: nondeterministic and
  not a hard gate (C2 keeps semantic fidelity advisory).
