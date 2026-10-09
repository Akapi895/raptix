# ADR-0045: Private channel isolation at the sub-agent streaming seam

- **Status:** Accepted (2026-10-10)
- **Date:** 2026-10-08
- **Related:** ADR-0040; ADR-0042;
  `docs/context-optimization-implementation-plan.md` (WP-A1, defect C1);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md` §1.1, §10

## Context

Specialist sub-agents run the same middleware stack as the orchestrator,
including the summarization slot. deepagents' summarization middleware keeps
its compaction bookkeeping in a state channel declared with
`PrivateStateAttr` (`_summarization_event`) — and deepagents' task tool
forwards every child state key that is not in its own `_EXCLUDED_STATE_KEYS`
into the parent's `Command.update`. Because the parent declares the same
private channel, a child's compaction event silently overwrites the parent's:
the observed effect (Silentium run 2026-10-06/08, reproduced offline) is the
parent's effective context collapsing to `[child summary]` with
"cutoff_index 162 exceeds message count 148".

`StreamingRunnable` is the raptix-owned seam: it is the last code that sees
the child's internal state before deepagents builds the parent update.

`create_agent` resolves a separate public output schema before compiling the
graph. Its `get_output_schema()` works on the installed stack and excludes
private fields. An earlier probe used a raw `StateGraph(SummarizationState)`
without that schema resolution; its Pydantic error did not establish that
the agent factory's output schema was unusable. Real-agent regression tests
reproduced private-channel leakage when only a named-key blacklist was used.

## Decision

1. `StreamingRunnable` unwraps bindings and projects onto the compiled graph's
   public output schema. Raw graphs whose schemas cannot be rendered use
   their declared `output_channels`. Resolved output-private annotations are
   also withheld. Sync/async success, partial failure and no-stream-channel
   paths all use this projection; `messages` remains present.
2. `DispatchMiddleware` strips `_summarization_event` and `context_epoch` in
   both directions: before supplying parent state to a fresh child, and
   before merging the child's result into the parent.
3. The summarization proxy declares a private `context_epoch` state channel.
   Successful compaction persists the next epoch in both that channel and
   the event. Each proxy has a unique build identity; child events also name
   their dispatch/attempt generation (implementation in WP-A3).
4. No change to deepagents sources; both layers live at the raptix seam.

## Threat model

No guardrail, executor, or sandbox behavior changes. The threat addressed is
a confidentiality/integrity defect inside one process: a child's compaction
event destroying the orchestrator's effective context, observed to abort whole
engagements. Dropping private state at the seam cannot hide evidence from the
operator — transcripts, checkpoints and the record are untouched.

## Consequences

- **Easier:** parent context corruption from child compaction is structurally
  prevented; both layers are unit-testable with plain fakes.
- **Harder:** custom graphs must declare channels intended for parent output;
  consuming a values stream no longer implicitly exports their internal state.
- **Migration:** none. Behavior change is defect removal; no flags introduced.
- **Given up:** nothing observable — `_summarization_event` never carried
  cross-agent meaning today, only contamination.

## Alternatives considered

- Only blacklist `_summarization_event`: rejected because other private fields
  still cross the boundary and parent state can still contaminate a fresh child.
- Patch deepagents' `_EXCLUDED_STATE_KEYS` at import time — rejected: processwide
  monkey-patching of a vendored dependency is invisible to readers and breaks
  on upgrade; the seam fix has the same effect at the raptix boundary.
