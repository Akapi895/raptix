# ADR-0048: Scope skill-load dedupe to the conversation

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0008; ADR-0044;
  `docs/context-optimization-implementation-plan.md` (WP-A5, defect C5);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md` §5, §10

## Context

`load_skill` suppresses a repeated body by returning a short "already in your
context" pointer. The suppression set (`loaded_keys`) is a closure on the tool
factory, i.e. one set per compiled middleware instance. A shared LangGraph
worker reuses that compiled graph across dispatches and threads, so the cache
outlives the conversation that actually saw the body. A fresh dispatch can then
receive a pointer to content that is not in its context at all — and after a
compaction dropped the body, the pointer is actively wrong. Defect C5.

## Decision

Completion review: thread-scoped cache identity also includes the injected
runtime's context epoch. A committed compaction can therefore reload a skill
whose body left the working set; runtime injection stays hidden from the public
tool schema. The explicit legacy instance mode remains unchanged.

- Add `RAPTIX_SKILL_DEDUPE_SCOPE=instance|thread`. `instance` keeps the legacy
  per-middleware set; `thread` keys the cache by the conversation
  (`langgraph.config` `thread_id` plus the active dispatch id and attempt).
  Different child dispatches inherit the same parent thread id but have fresh
  message histories, so thread id alone is insufficient. Retries also get a
  fresh scope; repeated loads within one dispatch generation still dedupe.
  Outside dispatch the thread id scopes the cache; without a thread id a
  per-call session id prevents stale suppression.
- The thread cache is a bounded dict (`_SKILL_DEDUPE_MAX_THREADS`, FIFO
  eviction) so a long-lived server cannot grow without bound.
- `force=true` continues to bypass and refresh the entry.
- **Default is `instance`** in this PR: the dedupe reply is agent input, and
  the wave's ground rules make default-off the norm for input changes. The
  intended flip to `thread` ships in a later release PR — stated here per
  plan §12.4 — after replay compatibility is confirmed (a `thread`-default
  run changes the recorded load_skill replies, so its recorded fixtures must
  be updated deliberately).

This is the *minimal* fix. The complete answer is Wave C3's context manifest,
which reports skill visibility from the actual model-visible context instead
of a cache.

## Threat model

No ACL, phase-block rendering, or backend change (ADR-0008 untouched). The
defect is a context-correctness bug: the tool asserted content was present
when it was not. Scoping to the conversation can only under-suppress
(re-emit a body), never over-suppress a body that is absent.

## Consequences

- **Easier:** with `thread`, a fresh dispatch gets the body it needs; stale
  pointers disappear.
- **Harder:** thread scope re-emits bodies the instance cache suppressed
  (intended — that suppression was the defect); callers relying on the legacy
  behavior can pin `instance`.
- **Migration:** none; default unchanged in this PR.
- **Given up:** nothing at default; the future flip intentionally trades a
  small token saving for correctness.

## Alternatives considered

- Flip the default to `thread` in this PR — deferred (plan §12.4) to keep the
  change replay-neutral and reviewable as a pure addition.
- Key the cache by `objective_id` — rejected: the model-visible context is the
  conversation, not the objective; a new dispatch reuses the same thread but
  starts a clean child message list.
