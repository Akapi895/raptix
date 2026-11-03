# 0109. Manage the existing reference corpus through Knowledge

- **Status:** Proposed
- **Date:** 2026-11-03
- **Related:** ADR-0106, ADR-0108

## Context

The Knowledge page reads operator-authored Postgres KnowledgeItem records. The
normalized YAML corpus is a different source, indexed by knowledge/reference into
Neo4j KrgReference nodes. Scan and indexing endpoints still return 501, and Compose
does not mount the corpus into the runtime. Empty Postgres results therefore hide
usable reference data. Neither this document library nor the reference corpus is
the project-scoped operational attack graph or Skillogy.

## Decision

Expose authenticated runtime catalog, discovery, ingestion, status and retrieval
history operations through the BFF. Reuse read_corpus, ingest_corpus and the closed
reference query templates. Publish paginated projections rather than copying the
corpus into Postgres. Manual Markdown records retain their existing owner and CRUD.
Source files remain read-only. Discovery is cached and asynchronous; indexing is
explicit, idempotent and serialized. Missing documents are preserved; the existing
loader softly retires obsolete relationships only for successfully validated
present documents. Partial imports do not retire data. No automatic rebuild occurs.
Report partial writes and source validation errors without claiming success.

Persist the Web's graph-assistance preference with AppConfig compare-and-set.
The default preserves existing enabled behavior. Send the saved snapshot on every
new Web execution; disabling it removes graph read-assistance tools and injected
graph context, preserving manual writes, per-project capture choices, execution
authorization and Skillogy. CLI executions without this snapshot keep their current
behavior. Availability and reference initialization are reported independently.

Record bounded, sanitized reference retrieval events, not raw tool output or
credentials. Keep runtime event history durable and map runtime thread IDs to Web
conversation names server-side. Manual library search is not an agent retrieval;
an explicit reference retrieval test is labeled as an operator event.

## Threat model

Only the runtime service token may invoke corpus operations. Browsers cannot choose
filesystem roots or send Cypher. Catalog identifiers resolve through validated
records; reject paths escaping the configured root and do not follow source symlinks.
Markdown is rendered by the existing sanitizer. Graph settings change assistance,
not authorization; no RoE, egress, HITL or engagement boundary is weakened. Preserve
existing data and indexes on errors. Indexing never writes operational graph data.

## Consequences

The page distinguishes discovered, indexed, changed and unavailable content. The
existing Neo4j query implementation remains the retrieval backend, not a new
embedding engine. The corpus needs a read-only runtime mount in container deployments.
The implementation crosses runtime, BFF and UI boundaries and should be reviewed
in dependent PR slices before merge; no automatic commit or deployment is implied.
