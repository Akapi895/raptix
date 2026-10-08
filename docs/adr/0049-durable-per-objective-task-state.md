# ADR-0049: Durable per-objective task state

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0040 (orchestration ownership); ADR-0041 (middleware is
  cross-cutting); `docs/context-optimization-implementation-plan.md` (WP-B1,
  defects C7, invariant I-2);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md`

## Context

A new worker cannot reconstruct what an objective has already done without
reading the conversation history: the only durable state today is the OPPLAN
status (`/workspace/plan/opplan.json`), which records *where* an objective is
but not *what was tried, what it proved, or what comes next*. If the
model-visible history is compacted or wiped at a valid checkpoint, the work
state goes with it (defect C7, invariant I-2).

The plan's "Task State Store" is deliberately **not** adopted as a standalone
platform. Task state is *task/execution* state, not a second source of truth
for findings — the KG stays canonical for engagement knowledge and the OPPLAN
stays the plan of record. Task state persists through the same scoped backend
OPPLAN already uses.

## Decision

- **Per-objective document.** `<workspace>/plan/task-state/<objective_id>.json`
  with `schema_version`, `objective_id`, monotonic `state_revision`,
  `saved_at`, `updated_by`, provenance (`last_event_id`,
  `observed_opplan_revision` as a content hash, `observed_kg_revision` as the
  existing opaque KG revision token when present), and the sections `work_state`
  (`pending|running|blocked|completed|exhausted` + reason), `evidence_refs`,
  `decision_record`, `continuation`, `budget`.
- **Writer.** OPPLAN objective mutations refresh task state through the same
  backend plumbing (`opplan._persist_opplan_to_backend`), *not* the same file.
  A validated OPPLAN transition bumps `state_revision` and stamps
  `saved_at`/`updated_by`; persistence is best-effort with the OPPLAN failure
  policy (never raise into the LLM loop; the next mutation retries).
  Only a successful OPPLAN persistence triggers this refresh. Corrupt,
  inaccessible or foreign-objective files are never replaced by an empty state.
  Bounded striped locks serialize local writers; revision checks reject stale
  direct writes, and exact-old-content edits surface backend conflicts. This
  is not a cross-process lease or a distributed transaction with OPPLAN/KG;
  ownership transfer remains D3 work.
- **Reader.** Missing file degrades to an empty bundle (no crash). A malformed
  file returns an explicit error and no state rather than raising.
- **Bounded.** `evidence_refs` and `decision_record` are capped (most recent
  kept); continuations, field lengths and document bytes are bounded too.
  Invalid IDs are rejected rather than rewritten to collision-prone filenames.
  Negative counters, unknown schema versions and invalid reference hashes fail
  validation. `cancelled` maps to `exhausted`, not to successful completion.
- **Flag.** `RAPTIX_TASK_STATE=1` (default off). Flag off changes no behavior
  and writes no files, so default replay stays green.
- **Ownership.** The schema lives in `raptix`
  (`orchestration/mission/task_state.py`), not `raptix-core`; it reuses the
  core `ObjectiveStatus` enum rather than forking OPPLAN types.

## Threat model

Task state is non-authoritative, fail-safe, and flag-gated off by default. It
writes only under `/workspace/plan/task-state/` through the
engagement-scoped backend, so it inherits the ADR-0042 workspace fence and
cannot widen egress or touch the exploit path. No guardrail, RoE check, or
KG canonical write is modified.

## Consequences

- **Easier:** B2 (receipts) and B3 (handoff) read a durable work record;
  the final-acceptance test (§4 of the plan) can start from persisted state.
- **Harder:** one more document to keep schema-compatible; the OPPLAN
  persistence hook now does two writes (bounded, best-effort).
- **Migration:** none. Flag off preserves today's behavior.

## Alternatives considered

- A single engagement-wide task-state file — rejected: contention and merge
  ambiguity across concurrently-dispatched objectives.
- Persist task state in the KG — rejected: task/execution churn would pollute
  the canonical engagement graph and couple B to the KG backend.
- Store it in the OPPLAN JSON — rejected: the OPPLAN is the plan of record and
  is model-visible; work/execution state is deliberately separate.
