# ADR-0051: Dispatch handoff contract (WorkerInput / WorkerResult)

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0049 (task state); ADR-0050 (receipts);
  `docs/context-optimization-implementation-plan.md` (WP-B3, invariants I-3,
  I-6)

## Context

A dispatch starts a fresh worker with only the task description. It does not
carry the objective's acceptance criteria, the current task-state revision, the
evidence already collected, or the remaining budget. Completion is judged from
what the worker says, not from persisted evidence (I-3), and a retry or handoff
cannot inherit counters because nothing durable holds them (I-6).

## Decision

Completion review: spell out EvidenceRef objects in WorkerInput, accept a single
JSON fence without relaxing WorkerResult validation, and persist explicitly typed
tool artifacts after scoped read-back/hash verification. Evidence therefore does
not disappear when a worker's final prose is malformed. This records execution
evidence, not canonical findings or objective completion. Owned assembly refreshes
the bounded task working set on each request, including after compaction.

- **WorkerInput block.** When ``RAPTIX_DISPATCH_HANDOFF=1`` and the objective
  resolves, ``DispatchMiddleware._prepare`` appends a deterministic,
  character-bounded ``<WORKER_INPUT>`` block to the child's description:
  objective title + phase, acceptance criteria, task-state revision, bounded
  evidence refs, continuation (next steps / blockers / awaiting), and budget
  consumed counters read from persisted task state, prior decisions and unknown
  receipts. Remaining budget cannot be computed until D1 supplies limits, so
  this wave explicitly labels consumption rather than inventing remaining caps.
  Empty sections are omitted; lists/fields are capped and the whole block is
  capped at 4000 chars while retaining its closing delimiter and result contract.
- **WorkerResult fold.** After a dispatch, ``_finish`` best-effort folds the
  outcome into the objective's task state: a ``decision_record`` entry
  (``dispatch:<id>`` → success/failed, with a retry condition on failure) and
  the attempt counter. A valid final JSON `WorkerResult` from the worker carries
  bounded evidence references, continuation and budget deltas; the worker slot
  emits a declared `worker_result` channel, which dispatch consumes and strips
  before updating the parent. Foreign-objective or malformed results are not
  merged. Existing dispatch error reporting is unchanged; context failures take
  precedence even when the streaming wrapper returned normally. Objective status
  still comes from OPPLAN, never from a tool or dispatch success alone.
- **Counter continuity (I-6).** Budget counters are read from persisted task
  state; each distinct dispatch/attempt increments consumed attempts, and valid
  worker deltas accumulate. Applied-dispatch identities make repeated folds
  idempotent. The local striped lock prevents concurrent folds from losing an
  update. Model-provided deltas are advisory; automatic usage accounting is D1.
- **Flag off is byte-identical.** With the flag unset, the child description is
  exactly what it is today (replay green). The dispatch fingerprint is always
  computed from the *original* description, so the handoff block never changes
  dispatch identity.
- **Task-state backend.** Reuse the supplied backend (or explicit test backend)
  and the filesystem middleware's per-run rebind/workspace mapping; thread-only
  config never replaces a valid backend with a default HTTP sandbox.
  when unresolvable the block degrades to objective metadata and the fold is
  skipped.
  Both the input read and finish fold use bounded I/O, including sync dispatch.

## Threat model

The handoff block injects persisted, engagement-local work state into the child
prompt. Objective notes and continuation text remain engagement data with the
same access/retention rules; no tool arguments are copied from execution receipts.
It cannot widen the RoE or egress: it is text handed to a worker whose tools
are still governed by the same guardrails. The fold writes through the
engagement-scoped backend, inheriting the ADR-0042 fence.

## Consequences

- **Easier:** a fresh worker reconstructs objective + completed work + next
  actions from persisted state (the plan's final-acceptance test gets its first
  pass); retries inherit attempts.
- **Harder:** the child description is no longer byte-identical when the flag
  is on; tests pin both modes.
- **Migration:** none. Flag off preserves today's behavior.

## Alternatives considered

- Put WorkerInput in a separate message/channel — rejected: the task tool's
  contract is a description string; a new channel would need a deepagents
  change.
- Fold the whole child transcript into task state — rejected: task state is
  bounded work state, not a transcript store; the conversation checkpoint
  already holds the transcript.
- Require the model to call an OPPLAN tool to record outcomes — rejected:
  completion must not depend on the model remembering to write.
