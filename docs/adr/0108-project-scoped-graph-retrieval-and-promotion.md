# 0108. Connect reference retrieval and project findings through bounded graph APIs

- **Status:** Proposed
- **Date:** 2026-11-03
- **Related:** [Architecture proposal](../proposals/2026-11-02-graph-architecture-optimization.md), [Technical design](../design/2026-11-03-graph-technical-design.md), ADR-0094, ADR-0106

## Context

The approved four-graph direction requires a reference reader and a project-scoped
bridge between runtime observations and persistent findings. Neither arbitrary
Cypher nor a second copy of the entire runtime graph is an appropriate boundary.

## Decision

Use fixed, bounded query templates exposed by agent tools and an internal runtime
HTTP route. The BFF authenticates operators and derives engagement from the stored
project; the runtime authenticates the BFF with the existing runtime bearer token.
The service token authorizes the BFF across projects, not individual browser users.

Reference nodes share Neo4j with AKG and Skillogy, using Krg labels only. The
loader uses the existing YAML corpus and a manifest, never the observation writer.
Cover the corpus's existing group/software/campaign/ATLAS-tactic types as well as
the labels illustrated in the design; unsupported records are reported as errors.

Promotion reads Neo4j and commits the fact, bounded immutable evidence snapshots,
and verification history atomically in Postgres. Compare-and-set revisions reject
concurrent edits and state transitions. No Neo4j write participates in promotion.

## Threat model

Scanner content and model-authored claims remain untrusted data. Parsing proves
shape, not truth. Runtime write channels are server-owned; lower-trust writes cannot
overwrite tool-derived nodes or relationships. Reserved labels, identity fields,
raw output and credential values are protected. Returned graph text is data, never
system instructions. Queries scope every traversed node and relationship and bound
depth, result size and transaction time. Evidence snapshots retain the exact reviewed
version after AKG deletion; a newly created node with the same key has a different
observation identity. Existing RoE and execution guards remain authoritative for
actions. AutoIngest and TriedEdges remain opt-in. Cross-project learning is excluded.

## Consequences

- New HTTP and persistence boundaries have focused functional tests.
- Additive Neo4j and Postgres migrations must be deployed before using the feature.
- A missing/unavailable graph is an explicit error, not an empty successful import.
- Small graph context is reconstructed per model request, including resume and
  compaction; detailed retrieval is on demand.

## Alternatives considered

- Free Cypher: rejected because result limits alone do not bound scope or work.
- Runtime-to-Postgres dual writes: rejected because promotion needs one durable owner.
- Revision-only injection suppression: rejected because system messages do not persist.
