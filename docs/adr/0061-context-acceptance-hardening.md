# ADR-0061: Close context acceptance gaps with composed regression tests

- **Status:** Proposed
- **Date:** 2026-10-09
- **Related:** ADRs 0044–0060; context optimization implementation plan

## Decision

Preserve public re-exports while resolving middleware, mission and agent package
exports lazily. Importing a state contract must not construct all agents or depend
on test collection order. Add cold-process import checks and a compiled pipeline
that combines accounting, leases, structured compaction, assembly, recording and
history-wipe recovery. Fix demonstrated type errors in test fixtures rather than
weakening type checks. Runtime workspace dumps are outputs, not Python source;
exclude those generated paths consistently with the repository's artifact rules.

Runtime package exports are also lazy so signal/shutdown imports do not load
recording and the model stack. Full-lane fixes retain the canonical TASK_BUDGET
slot snapshot, explicitly initialize boot/compat in boot smoke tests, and reuse
the registry's availability evaluator in adapter resolution. Unavailable
capabilities remain unavailable rather than being re-probed with different rules.

Keep the guardrail stack and replay hash unchanged. New behavior remains opt-in.
The completion profile records its flags explicitly; it does not invent provider
capacity or enable automatic handoff, pruning or response caching.

## Threat model

The hardening adds ownership checks, bounded observers and redaction; no guardrail
is disabled or replaced. Test-generated credentials are synthetic. Live route
measurement logs numeric usage and model attribution, never access keys or prompts.
