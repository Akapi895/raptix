# ADR-0056: Observational progress and loop signals

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0014 (observational tried-edge ledger); ADR-0049 (task state);
  ADR-0050 (execution receipts); ADR-0055 (budget accounting);
  `docs/context-optimization-implementation-plan.md` (WP-D2, defect C8)

## Context

Step, recursion and spend limits bound how much an agent *runs*, not whether it
*makes progress*. The existing tried-edge hook (ADR-0014) records coarse attempt
outcomes in the KG but never answers "did the last N actions change anything?"
so the agent can retry a failing command indefinitely, changing nothing, while
technically staying within every limit. The plan ships only the observational
half of C8: surface the signal, never block. Blocking/pruning (L7-blocking)
requires explicit sign-off and a before/after benchmark.

## Decision

- **Extend the existing observer.** `TriedEdgesMiddleware` (the L7-obs hook)
  gains a bounded, in-memory window of per-action fingerprints. Ring buffer per
  `(thread_id, objective_id)`, at most `_STALL_WINDOW = 12` entries, at most 64
  windows per process (FIFO eviction).
- **Fingerprint.** Each observed tool result contributes
  `(action_hash, input_version, result_hash, technique)`:
  `action_hash` is the same parameter-free hash the receipts use,
  `input_version` is the objective's durable task-state revision at action time
  (the environment/persisted-state proxy), `result_hash` hashes a bounded view
  of the tool result, and `technique` is the coarse tool/binary name. Raw
  parameters are never stored.
- **Soft reminder only.** `RAPTIX_PROGRESS_OBSERVE` (default off) gates the
  behavior. When the entire window is one repeated fingerprint, the next model
  call gets a single bounded `<system-reminder>` naming the repeated technique
  and suggesting a different approach. A different `result_hash` (legitimate
  polling), or a changed `input_version` (a valid retry after state moved),
  breaks the equality and suppresses the reminder; the emitted marker resets so
  a genuinely new stall is surfaced again.
- **Zero blocking.** The observer never vetoes, rewrites, dedupes, or delays a
  tool call or model response; it only appends one reminder to the outgoing
  request. Tool results are returned by identity. Observation runs off-loop,
  bounded by the existing 4 s / two-slot guard; any failure is logged at debug.
- **Progress can run without the KG.** The slot builds when either
  `RAPTIX_KG_TRIED_EDGES` or `RAPTIX_PROGRESS_OBSERVE` is truthy; when the KG
  store is unavailable the middleware still observes progress with
  `store=None` and skips KG writes. This changes neither default behavior nor
  the KG-enabled async path.
- **Sync parity.** `wrap_tool_call` / `wrap_model_call` observe and inject on
  synchronous runs too (progress only); KG tried-edge writes remain
  async-only, exactly as before.

## Threat model

The reminder is a fixed, non-attacker-influenceable string plus the coarse
technique name, so hostile tool output cannot smuggle instructions through it.
The window holds only hashes and an integer revision in process memory; it is
never persisted and never sent to the model. The observer cannot alter RoE,
egress, or any tool result, and the blocking half of L7 is explicitly out of
scope. A privacy note: bounded result content is hashed transiently to compute
`result_hash` and is not stored or logged.

## Consequences

- **Easier:** operators and the agent can see an unproductive loop before a
  budget is consumed; the signal is deterministic and testable without an LLM.
- **Harder:** `TriedEdgesMiddleware` now has two responsibilities (KG attempt
  ledger, progress window); they remain independently gated and must stay so.
- **Given up:** automatic intervention. The plan's blocking/pruning mode is a
  separate, sign-off-gated decision with a before/after benchmark.
- **Migration:** none. Both flags default off; the assembled stack and the KG
  path are unchanged for existing runs.

## Alternatives considered

- **A new middleware module** — rejected: the plan names the existing L7-obs
  hook, and duplication would split the "one observer" story.
- **Persist fingerprints to task state** — rejected: a process-local stall
  window is enough for a reminder, and persisting hashes/state per tool call is
  cost without benefit.
- **Block or prune repeated actions** — explicitly deferred: AGENTS.md requires
  sign-off plus a before/after benchmark for L7-blocking/pruning.
