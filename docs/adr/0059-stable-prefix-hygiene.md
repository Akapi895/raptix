# ADR-0059: Stabilize owned prefixes without a billing claim

- **Status:** Proposed
- **Date:** 2026-10-09
- **Related:** ADR-0054; WP-E2/E3 in the context optimization plan

## Decision

The measured GLM upstream exposes no cache buckets. E3 therefore ships the
plan's stable-prefix-hygiene branch, not cache tuning. Behind
`RAPTIX_CONTEXT_PREFIX_ORDER=1`, assembly orders static before dynamic blocks
inside contiguous adapter-owned spans. Unknown and safety-owned blocks are
fixed barriers: their contents and positions relative to other barriers never
change. Every request rebuilds dynamic blocks from current state. Tool schema
order remains the assembler's canonical order.

No cache flags are added to provider requests, and no billing saving is claimed.
E2 captures explicit bucket presence and boundary-specific usage rather than
inferring cache hits from latency. Missing proxy/provider access is recorded as
unavailable evidence, not as a zero cache hit.

## Verification

Test static-first ordering, unchanged guardrail barriers, current dynamic state,
flag-off identity, and replay. Measure the real route separately from synthetic
mechanism tests.
