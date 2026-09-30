# 0018. Normalize reconnaissance into a KG surface inventory

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Raptix maintainers
- **Related:** `docs/adr/0007-ai-surface-technology-node.md`, `docs/adr/0013-fail-safe-kg-autoingest.md`, `summary/impl-plan-recon.md`

## Context

Initial Foothold needs a deterministic handoff from reconnaissance to the
parameterized `surface_exploit` phase. Existing Recon output was primarily
Markdown and legacy graph writes, while the canonical KG middleware only
exposed scanner ingestion for infrastructure and findings.

Adding Endpoint and Parameter labels changes the graph contract. The
contract must remain bounded, engagement-scoped, provenance-preserving, and
safe to replay without executing a live scanner or exploit action.

## Decision

Recon and the passive `osint_operator` lane use the canonical KG middleware.
Structured Katana and Arjun output is normalized into bounded `Host`,
`Endpoint`, and `Parameter` observations. `Form` and `AuthModel` are reserved
contract labels for subsequent structured adapters. Surface containment uses
`HAS`; technology fingerprinting reuses the existing `Technology` node and
`RUNS` relationship.

Recon remains mapping-only. It records evidence and stops at the first useful
signal; vulnerability classification, payloads, and exploitation remain the
responsibility of `surface_exploit`. Parallel Recon and OSINT runs use
separate sessions and output paths.

## Consequences

- **Easier:** `surface_exploit` can build a deterministic endpoint/parameter
  coverage matrix from canonical KG observations.
- **Harder:** Scanner adapters must emit bounded structured fields instead of
  dumping raw output into the graph.
- **Given up:** Recon no longer performs exploit confirmation or payload
  iteration as part of surface mapping.
- **Migration:** V005 adds engagement-scoped constraints for the new labels;
  existing Technology constraints remain in V004.

## Alternatives considered

- **Markdown-only handoff:** Rejected because downstream coverage planning
  cannot reliably consume or deduplicate free-form reports.
- **Legacy graph tools:** Rejected because they bypass the canonical
  engagement-scoped KG middleware and replay/provenance path.
- **Unbounded raw-output ingestion:** Rejected because it inflates KG state and
  allows scanner output to become an instruction channel.
