# ADR-0046: Preserve error semantics at the model-call and compaction seams

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0044; ADR-0045;
  `docs/context-optimization-implementation-plan.md` (WP-A3, defect C3);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md` §1.4, §10

## Context

Three failure paths corrupted context semantics (defect C3):

1. `_reraise_with_actionable_message` (`intelligence/llm/factory.py`)
   translated every 400 into `RuntimeError`. Context-overflow rejections are
   400s, and deepagents' summarization middleware recovers from overflow by
   catching `ContextOverflowError` and compacting. After translation the
   recovery branch could never fire — an over-budget call killed the run.
2. langchain's summary helper returns the literal
   ``"Error generating summary: ..."`` as the *summary text* on failure.
   deepagents then builds a compaction event around it; applied, that event
   replaces live history with an error string and the recovery pointer is
   meaningless.
3. `_SafeSummarizationProxy` re-invoked the downstream handler on *any*
   exception. If the exception came from the handler's own model call
   (already started), the proxy masked a real provider failure as
   "summarization failed" and issued a second model call.

## Decision

- **Overflow typing.** The translator follows cause/context chains with cycle
  detection and preserves the concrete `ContextOverflowError` subtype. It
  redacts the message and provider `message` attribute in place; a wrapped
  overflow is re-raised without exposing its raw wrapper in the traceback.
- **Failed summary never becomes context.** The proxy recognizes both of
  deepagents' summary envelopes (with and without an offload pointer). It
  rejects an error summary before entering the downstream model handler and
  falls back to the original request only if no downstream call has started.
  `_finalize` additionally strips failed events from command updates returned
  by other inner implementations, preserving unrelated message tails.
- **No blind re-invocation.** The proxy wraps the handler it passes to the
  inner hook in a tracker. On exception it re-raises when the handler had
  already started (a downstream model failure) and only falls back to
  `handler(request)` when the failure happened before the handler ran
  (summary generation itself failed).
- **Event identity (carried from WP-A1 step 3).** A surviving event is stamped
  with additive `thread_id`, `worker_instance_id`, monotone `context_epoch`,
  `source_revision` and best-effort `covered_message_ids`. deepagents reads
  only `cutoff_index`/`summary_message`/`file_path`, so the extra keys are
  inert upstream while letting later waves validate event provenance. The
  epoch also has its own private state channel, so dropping an event does not
  reset the counter. Worker identity includes a unique proxy build id and,
  during dispatch, the dispatch id and attempt.

## Threat model

No guardrail, provider-retry policy, or LiteLLM fallback config changes. The
defect is semantic: a recoverable over-budget call became fatal, and a failed
compaction could overwrite context with an error string. Preserving the base
exception type cannot widen what is retried — deepagents only retries by
compacting and re-issuing the same request; retry policy for the provider
call itself is untouched.

## Consequences

- **Easier:** overflow recovery works end to end; failed summaries are inert;
  a real model-call failure surfaces unchanged to model-fallback.
- **Harder:** the proxy now has two exception paths to reason about (tracked
  handler state), covered by unit tests.
- **Migration:** none. Flag inventory (plan §11) lists no flag for A3.
- **Given up:** the previous "always fall back" convenience — intentionally,
  because it masked real downstream failures.

## Alternatives considered

- Detect overflow by string matching ("context length") — rejected: brittle
  and provider-specific; the base exception type is the contract deepagents
  itself uses.
- Drop error-marker events in deepagents — rejected: vendored-source edit.
- Keep re-invoking the handler but dedupe model calls downstream — rejected:
  duplicates the provider call and hides the real error.
