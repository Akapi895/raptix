# ADR-0047: Capacity-aware summarization thresholds

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0045; ADR-0046;
  `docs/context-optimization-implementation-plan.md` (WP-A4, defect C4);
  `benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md` §1.2, §10

## Context

The summarization slot builds its thresholds with deepagents'
`compute_summarization_defaults`, which uses fraction-based thresholds only
when the model exposes `profile.max_input_tokens`; otherwise it falls back to
a fixed `("tokens", 170000)` trigger. On the factory path the model profile is
absent, so every model — regardless of real capacity — is summarized at the
same 170K guess. There is no operator override and, when the request model is
rebound for a tenant, the thresholds were never re-derived (the rebind copied
the helper and swapped only `model`). Defect C4: an unknown capacity plus a
one-way clamp with no downward correction or operator control.

## Decision

1. **Optional capacity profile.** `RAPTIX_LLM__MAX_INPUT_TOKENS` (positive
   integer) stamps `max_input_tokens` onto the summarization model's profile,
   so `compute_summarization_defaults` selects its 85%/10% fractions. Unset →
   today's fallback, unchanged. (`RAPTIX_LLM__*` is the existing settings
    namespace; the value is read here rather than re-plumbed through settings.)
    The operator-supplied capacity is retained on request-model rebinds using
    a request-local model copy, including tenant-key overrides.
2. **Explicit operator overrides.**
   `RAPTIX_SUMMARIZATION_TRIGGER_TOKENS` and
   `RAPTIX_SUMMARIZATION_KEEP_MESSAGES` pin one dimension without restating
   the other; invalid values fail agent build naming the variable (same
   discipline as `_make_record`).
3. **Rebuild on rebind.** LangChain compiles `_trigger_clauses` in its
   constructor; assigning `.trigger` leaves the actual behavior unchanged.
   The factory and each model rebind therefore construct a new helper with
   explicit trigger/keep values. Pins are recorded independently per dimension,
   including values equal to the old default. Unpinned dimensions use the
   request model's defaults. The shared middleware/model is not mutated.

This is a threshold fix, **not** a tokenizer fix; chars/token estimator bias
is calibrated separately (Wave E1). No accuracy claim is made here.

## Threat model

No provider routing, retry policy, or guardrail changes. The defect is a
correctness/efficiency one: summarizing on a wrong capacity either wastes
context (too early) or risks overflow (too late). Overrides are operator-set
environment values, not model/tool input.

## Consequences

- **Easier:** a deployment that knows its model's capacity sets one variable;
  threshold tuning no longer requires a code change; a profiled fallback model
  is summarized on its own terms.
- **Harder:** two new envs to document; a bad value fails the build loudly
  (intended).
- **Migration:** none; all defaults preserved when the envs are unset.
- **Given up:** nothing — the override path is strictly additive.

## Alternatives considered

- Invent a capacity constant for GLM-5.3-Flash — rejected (plan §12.6): the
  real capacity is a deployment fact, not a value to hardcode.
- Always use fraction thresholds — rejected: without a known capacity the
  fractions are meaningless and would change default behavior.
