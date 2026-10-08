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

- **Transactional commit.** A per-call copy of the inner middleware validates
  the generated summary and recovery pointer before the downstream model sees
  them. A rejected candidate uses the original effective request once; it is
  never sent to the model first and then "fixed" by stripping an event.
  `_finalize` rechecks at commit and strips both event and candidate epoch when
  any gate fails, without blindly repeating an already-started model call:
  1. the summary is not the A3 error marker (existing);
  2. the offload produced a recovery reference;
  3. that reference is readable through the same engagement-scoped backend the
     worker's filesystem tools use;
  4. the summary carries the required section headers (stop-gap until C2's
     structured validator lands);
  5. the event's epoch is not stale relative to the committed `context_epoch`;
  6. the source task-state revision is unchanged between wrap start and commit.
- **Source revision.** At wrap start the proxy snapshots the task-state
  revision, KG revision, epoch and a hash of the pre-wrap effective message ids
  (with a content-based fallback for id-less messages). Changes to any captured
  source reject the candidate. The surviving
  event is stamped with that `source_revision` (replacing the Wave A
  placeholder constant).
- **Flag.** `RAPTIX_TRANSACTIONAL_COMPACTION=1` (default off). The plan's flag
  inventory does not name a C1 flag, but plan §2.4 requires every behavior that
  alters agent input to be flag-gated with current behavior as the default; the
  flag is added and recorded here. Off = Wave A behavior (error-summary strip
  only).
- **Unavailable verification.** With the transactional flag on, missing,
  corrupt or unreachable source/recovery data refuses compaction. The model
  still receives the uncompacted effective request. Verification uses bounded
  I/O, and stored stale/foreign events are rejected locally before projection.
  Flag off retains the earlier behavior.

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
- Commit an unverifiable pointer without a backend — rejected: with this flag
  enabled it would violate I-4. Keeping the effective request is the fallback.
- Validate semantics with an LLM — rejected for the gate: nondeterministic and
  not a hard gate (C2 keeps semantic fidelity advisory).
