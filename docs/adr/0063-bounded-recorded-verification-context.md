# 0063. Bounded recorded verification context on the existing KG summary

- **Status:** Proposed
- **Date:** 2026-10-12
- **Related:** ADR-0049, ADR-0060, ADR-0062; `docs/structure-review.md` P2

## Context

The workspace verifier now retains proof/control captures and a deterministic
bridge writes their reference onto a Finding. The planner's revision-cached
summary exposes Candidate/Hypothesis assertions but not these verification
references. Repeated model assertions must not become independent evidence,
and an outcome recorded yesterday must not imply current verification.

## Decision

Supersede ADR-0062 while preserving its capture layout, retention flag and
differential policy. Tighten its workspace-to-KG boundary: only a `supported`
recheck may be recorded by the bridge. Contradicted and inconclusive checks stay
readable from the workspace; failure does not delete an older graph observation
or make its historical snapshot current. Both consumers bind the retained ID:
workspace JSON `vuln_id` and the KG node's canonical `finding::<id>` key. Unbound,
foreign and missing-execution records cannot produce a supported finding.
The bridge uses its injected tool-call ID for write attribution. The producer
uses its callback manager's actual tool-run ID, carried into the graph as
`verification_invocation_id`; no tracing ID is fabricated when absent.

Extend `build_summary` with an independent, default-off
`RAPTIX_KG_EVIDENCE_CONTEXT=1` section. Use the existing KGMiddleware refresh
and injection hooks. Start a fresh thread when enabling or disabling the flag.

- Select the current engagement's Finding nodes with a canonical `finding::`
  key and a well-formed workspace evidence reference. Consider the twenty most
  recently written rows; choose at most five distinct references, newest first
  with deterministic key tie-breaks. Aliases sharing a reference count as one
  retained lineage, not independent corroboration. This is a bounded recent
  window, not a complete engagement inventory or objective relevance ranking.
- Render finding/node identity, reference, recorded outcome, producer invocation
  and latest write attribution only. No arbitrary props, credentials, commands
  or raw captures. Unknown outcome vocabulary renders as `unknown`.
- Bound the untrusted JSON section to 3200 characters. Mark every outcome as a
  historical, untrusted snapshot, not current verification. Direct the consumer
  to `recheck_workspace_verification` or `inspect_evidence` before relying on it.
- Query failure preserves the baseline summary. This projection performs no
  artifact HTTP requests, graph writes, lifecycle inference or OPPLAN changes.

## Threat model

KG props are agent-authored and may contain misleading outcomes or instructions.
Escape role/envelope delimiters, whitelist fields and scope queries by engagement.
Presence of a valid-looking reference does not authenticate execution. Rechecks
still enforce descriptor/content integrity, finding binding and execution status.
Flag-gate the agent-input change; default activation requires model evaluation.

## Consequences

P2 gains evidence-informed context through an existing consumer without a second
planner, state store or schema. Correctness fixtures exercise scope, lineage
deduplication, bounds, contradiction and stale bytes independently of targets.
The section cannot claim verified state, freshness or model-quality improvements.
P3 decision-policy evaluation remains the next experiment; P4 stays evidence-gated.

## Alternatives considered

- Resolve captures on every prompt refresh: adds network work and failure coupling
  to a bounded context query; explicit recheck tools already own this operation.
- Add another graph-context service or Finding lifecycle enum: no consumer need
  beyond the existing summary and differential evidence contract.
