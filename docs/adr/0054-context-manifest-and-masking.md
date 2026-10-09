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

Completion review: assembly refreshes a bounded, JSON-escaped task working set
from persisted state after compaction. Verified machine artifact refs are visible
without relying on final worker prose. Request-local ownership is scoped to the
dispatch invocation, and model-runtime config falls back to the runnable config
only when explicit config is absent. Safety-owned blocks remain fixed barriers.

- **C3a — manifest (observational).** `intelligence/context/manifest.py`
  enumerates each request's individual system blocks, messages/tool calls and
  tool schemas, hashes them, estimates chars/tokens and records source ownership,
  revisions, `context_epoch`, task-state revision and objective identity. A
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
  Age counts later human/assistant turns, not batches of tool messages. Scratch
  references are content-addressed and verified by exact read-back, so reused
  message IDs cannot point to a different payload. Work is bounded by time,
  eight candidate messages and one megabyte per request. The manifest observes
  the final request after masking/assembly; raw checkpoint history stays intact.
- **Slot.** `MiddlewareSlot.CONTEXT_MANIFEST`, in the base set, factory returns
  None unless manifest, masking or assembly is on. With all off, default runs
  assemble an identical stack.
- **C3c — request-scoped assembly.** OPPLAN, KG and Skillogy declare owned
  blocks through a request-local registry. Provenance never becomes provider
  parameters or raw graph state. An innermost assembly pass preserves block
  order, removes duplicate owned blocks and emits a final, per-block manifest.
  Engagement and safety-critical injections remain unchanged and unbudgeted.
- **Operator policy.** `RAPTIX_CONTEXT_ASSEMBLY=1` enables this pass;
  `RAPTIX_CONTEXT_BUDGET_TOKENS=0` is the default and means no C3c size limit.
  Positive values are a per-request token-estimate budget, not an engagement
  spend/call cap. Only declared reducible overlays can use their adapter's
  compact representation, and only after full text is offloaded and verified.
  OPPLAN retains the active objective, acceptance criteria and dependencies;
  KG/Skillogy retain retrieval guidance. Required/safety blocks and message
  history are never cut to satisfy the budget. If these exceed the target,
  report overflow instead of blocking or silently dropping necessary context.
- **Evidence gate.** `benchmarks/context_eval/overlay_probe.py` exercises the
  actual renderers on synthetic fixtures (2 and 120 objectives). Before C3c,
  Skillogy contributed 12,570 chars; OPPLAN 4,049/11,633; KG 713/3,663. These
  counts justify the selected adapters; they do not calibrate a production
  limit. Masking and assembly comparisons use the final request and content
  hashes. The default remains unlimited; Silentium is not used for tuning.

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
- Cut unknown system text to meet a token limit — rejected: only adapter-owned
  reducible overlays may be compacted; guardrails retain their original bytes.
