# 0060. Project recorded claims through the existing KG summary

- **Status:** Proposed
- **Date:** 2026-10-11
- **Related:** ADR-0049; `docs/structure-review.md` P2;
  `knowledge/graph/summary.py`; `middleware/kg.py`

## Context

The analyst prompt already writes `Hypothesis` nodes, and the scanner writes
`Candidate` nodes. Neither appears in the revision-cached summary consumed by
`KGMiddleware`. A node's existence or agent-authored status does not establish
verification; P1's raw-evidence traceability remains incomplete.

## Decision

Add a read-only recorded-claims section to `build_summary`, enabled by
`RAPTIX_KG_CLAIM_CONTEXT=1` (default off). Set the flag before starting the
agent/thread so the existing revision cache builds the selected projection.
Rollback uses the flag off and a fresh thread, without a schema migration.

- Read only the current engagement's `Candidate`/`Hypothesis` nodes; exclude
  ADR-0014's reserved `tried::` keys. The existing tried-edge middleware owns
  attempt context.
- Select at most five claims, newest graph update first with stable key/kind
  tie-breaks. Render bounded JSON fields in an untrusted block capped at 2400
  characters. Select identity, label, writer and episode attribution only;
  exclude credential nodes and arbitrary props/content.
- Treat every row as unverified. Writer/episode identify the latest KG write,
  not independent evidence, resolved artifacts, or proof of the claim. Do not
  infer an "open" lifecycle from a status vocabulary that is not defined.
- Preserve the existing summary when the optional query fails. Use the current
  middleware revision refresh and injection hooks; no additional state owner.

## Consequences

The live consumer gains bounded claim context without another planner or
evidence model. Selection is engagement-wide, not objective-relevance ranking;
P1 verification, corroboration and raw-artifact retrieval remain separate work.
No RoE, dispatch, authorization, or graph-write behavior changes. Enabling this
flag changes agent input and requires evaluation before default activation.

## Alternatives considered

- A new graph-context service: unnecessary for one query at an existing seam.
- Calling the section verified state or open hypotheses: unsupported semantics
  until the corresponding evidence/lifecycle contracts exist.
