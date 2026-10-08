# ADR-0054: Context manifest and deterministic masking

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0052 (transactional compaction); ADR-0053 (structured
  summaries); `docs/context-optimization-implementation-plan.md` (WP-C3, defect
  C6)

## Context

The audit measured historical tool content as the dominant share of recurring
request characters (bash text 40.45% overall; 73.9–85.8% in the largest
requests), alongside fixed system-prompt overhead. There is no per-request
accounting of what each block costs, and old large tool results are re-shipped
verbatim every turn. The plan splits the fix into C3a (observe, no mutation),
C3b (mask old tool results), and C3c (assembly unification, explicitly gated on
C3a/C3b data because it is the largest and most invasive change).

## Decision

- **C3a — manifest (observational).** `intelligence/context/manifest.py`
  enumerates each request's system block and messages, hashes them, estimates
  chars/tokens and records `context_epoch`/`active_objective_id`. A
  `ContextManifestMiddleware` in the new `context-manifest` slot (just outside
  RECORD, so it observes the fully assembled request) logs the rendered
  manifest. It never mutates the request. Flag `RAPTIX_CONTEXT_MANIFEST=1`.
- **C3b — masking.** `intelligence/context/masking.py` replaces an old, large
  `ToolMessage` content with a compact observation plus an artifact reference,
  offloading the full text to `/workspace/.scratch`. Status-bearing markers,
  `<system-reminder>`, `<UNTRUSTED_TOOL_OUTPUT>` and halt/background markers are
  never masked (guardrail wrappers and control signals stay intact). Fail-safe:
  an offload failure leaves the message untouched, so masking never silently
  drops content. Flag `RAPTIX_CONTEXT_MASK=1`; thresholds
  `RAPTIX_CONTEXT_MASK_AFTER_TURNS` (default 10) and
  `RAPTIX_CONTEXT_MASK_MIN_CHARS` (default 4000) are validated at build time and
  fail the engagement, naming the env, on an invalid value.
- **Slot.** `MiddlewareSlot.CONTEXT_MANIFEST`, in the base set, factory returns
  None unless a flag is on, so default runs assemble an identical stack.
- **C3c deferred.** Assembly unification (declaring block ownership via the
  manifest API and migrating overlay injections to budgeted emission) is gated
  by the plan itself on C3a/C3b measurement data and is the largest PR; it is
  not implemented here. This ADR is the manifest/masking half.

## Threat model

Observational + masking only. Masking never enters guardrail envelopes and
never removes control markers; it rewrites only old, large, non-error
`ToolMessage` bodies and always leaves a readable recovery reference. No
guardrail, RoE, HITL, egress, or KG write is touched; masking reads/writes
through the engagement-scoped backend (ADR-0042 fence).

## Consequences

- **Easier:** per-request cost is observable; old tool spam stops recurring.
- **Harder:** masking is another request-rewriting seam (flag-gated, fail-safe);
  thresholds are policy that must be tuned from synthetic fixtures, never the
  Silentium export.
- **Migration:** none. Both flags off preserve current behavior.

## Alternatives considered

- Mask-by-default — rejected: changes agent input; plan §2.4 requires a flag.
- Ask the model to summarize old tool output — rejected: nondeterministic and
  costs another call; C3a/C3b must be LLM-free.
- Implement C3c now — rejected: the plan gates it on C3a/C3b data and warns it
  is the largest PR; forcing it now is the opposite of "bám sát plan".
