# ADR-0055: Cross-dispatch budget accounting

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0049 (durable task state); ADR-0050 (execution receipts);
  ADR-0051 (dispatch handoff); ADR-0052 (transactional compaction);
  `docs/context-optimization-implementation-plan.md` (WP-D1, invariant I-6)

## Context

Task state carries a `budget` section, but nothing fills it automatically: the
dispatch fold only accepts counters the model chooses to report, so a worker
can silently consume an unbounded number of tokens and no one — the operator,
the orchestrator, or a successor worker — sees it. The final-acceptance test
I-6 ("retry/handoff preserves counters") is only meaningful if counters are
recorded in the first place. Hard stops are explicitly out of scope until the
D-gate benchmark; this WP records and surfaces, it does not enforce.

A naive "bump the revision on every write" accounting path would break ADR-0052:
transactional compaction snapshots `state_revision` and refuses to commit if it
changed during the summary model call. If a usage fold ran in that window and
bumped the revision, every compaction would be rejected.

## Decision

- **Automatic accounting.** A `TASK_BUDGET` middleware (base slots, ADR-0055)
  wraps every model call. Its post-hook reads the response's latest
  `usage_metadata` and folds `model_calls`, `input_tokens` and `output_tokens`
  into the active objective's task state via `fold_task_budget`. The active
  objective is resolved from the dispatch context first, then
  `active_objective_id`. Flag `RAPTIX_TASK_BUDGET` (default off).
- **Revision-neutral writes.** `fold_task_budget` updates the `budget` section
  in place and leaves `state_revision` unchanged, so compaction's source
  revision stays valid. This required a dedicated writer rather than
  `advance_task_state`, which advances the revision. The read/modify/write runs
  under the same per-document lock OPPLAN transitions use, so the two writers
  cannot lose an update.
- **Soft limits, never a hard stop.** Optional `RAPTIX_TASK_BUDGET_TOKENS`
  (input + output tokens) and `RAPTIX_TASK_BUDGET_CALLS` are soft thresholds.
  Crossing one appends a single `budget_exhausted:tokens` /
  `budget_exhausted:calls` decision entry (deduped by action) and injects a
  bounded `<system-reminder>` on subsequent calls. Unset (0) means no reminder.
  Invalid values fail agent build, naming the env var. No execution is
  refused, delayed, or truncated.
- **Failure is invisible to the model loop.** Reads, writes and marker
  insertion are best-effort and bounded (4 s, two writer slots); any failure is
  logged at debug and the original model response is returned unchanged. Only
  token counters are stored — never prompts, parameters, or credentials.
- **Byte-identical when off.** `_make_task_budget` returns `None` unless the
  flag is truthy, so the assembled stack and the response path are unchanged
  for default runs.

## Threat model

The middleware reads only the response's usage metadata and writes only integer
counters plus a fixed reminder string. It cannot widen RoE or egress, and it
does not alter or suppress any message the model would otherwise see. The
reminder is a fixed, non-attacker-influenceable string. Writes go through the
engagement-scoped backend and inherit the ADR-0042 fence. The counters are
engagement-local and follow the same retention rules as the rest of task state.

## Consequences

- **Easier:** token and call consumption are visible and survive handoff; a
  successor worker inherits real counters (I-6); operators get a soft signal
  before spend becomes pathological.
- **Harder:** budget accounting and work-state transitions now use different
  write paths (revision bump vs. revision-neutral), which must stay separate.
- **Given up:** automatic enforcement. A hard stop, if ever wanted, needs the
  D-gate sign-off and benchmark and is a new decision.
- **Migration:** none. Flag off preserves today's behavior; existing task-state
  documents parse because `output_tokens` defaults to 0.

## Alternatives considered

- **Bump `state_revision` per fold** — rejected: it would make transactional
  compaction always self-reject.
- **Fold inside the existing execution-ledger middleware** — rejected: receipts
  and usage accounting are separate concerns; one deliberately flags every
  call, the other is model-call scoped.
- **Hard-stop on exhaustion** — rejected for this WP: it is an execution-path
  change requiring sign-off and a before/after benchmark (AGENTS.md).
