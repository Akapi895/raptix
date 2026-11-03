# Plan document drafts with digest-preconditioned publish

**Status: Proposed** — 2026-10-16

## Context

O06 of the mock-to-operational plan requires persistent document editing over
the Scope & Planning surfaces. Today the nine planning documents live only as
runtime-owned files at `<workspace>/<slug>/plan/<name>.json`, written by
Soundwave/agents; the Web API reads them read-only through a hardened
projection (`readPlanningView`), and the only workspace write path is capture
upload into `findings/`. The mock document workspace already specifies the
editor UX (drafts, invalid-JSON retention, compare) but renders a demo-only
empty state in real mode pending this API.

Two ROE representations already exist: `ScopeRevision.roe` (Postgres, the
governance authority behind `roeWindowAllows`/`targetInScope`) and the
runtime's `plan/roe.json` (the machine-enforcement authority hot-reloaded by
`middleware/roe.py`). A Web write path to the runtime file would create a
third, competing authority.

## Decision

- **Drafts live in Postgres, never in the workspace.** A `PlanDocumentDraft`
  row is keyed by engagement + allowlisted document name and stores the edited
  text plus the `baseDigest` it was loaded from. The published file stays the
  single authority the runtime reads; drafts are invisible to agents until
  publish.
- **Opaque document identity.** Routes address documents as
  `/api/engagements/:id/documents/:name` with `name` restricted to
  `PLANNING_DOCUMENTS`; no filesystem path ever crosses the API. The server
  resolves the engagement's workspace slug itself.
- **Reader contract.** `GET .../documents/:name` returns one view of the
  published file with both faces: `source` (raw bounded text) and `readable`
  (the existing public-field projection), plus `digest` (sha256 of the raw
  bytes), `updatedAt`, `state`, schema `validation` errors and the actor's
  saved `draft`.
- **Digest precondition.** `PUT .../draft` and `POST .../publish` carry the
  `baseDigest` the editor loaded (`null` = document absent). A mismatch
  answers 409 with the current digest — this covers two-browser conflicts and
  a model rewriting the document while a human draft is open. Save validates
  JSON + Ajv schema and answers 400 with structured errors while keeping the
  previously stored draft; a failed save never destroys work.
- **Publish is an atomic, preconditioned file write** (temp file + rename
  inside the hardened plan directory), revalidated against the document
  schema, clearing the draft row and auditing `document.published`. The
  runtime consumes it as an ordinary file change; readiness is re-derived on
  the next planning read.
- **ROE is never publishable from the Web.** Publishing `roe` answers 409
  with a pointer to the Scope & ROE revision workflow. ScopeService remains
  the single governance authority; the runtime file remains the machine
  authority written only by the runtime plane. The approved-scope→runtime
  synchronization continues to flow through the ADR-0072 read bridge, not
  through file writes.

## Consequences

- Additive Prisma model + migration, additive routes and contract types; the
  planning projection contract is unchanged.
- Conflict detection is content-addressed (digest), not timestamp-based, so
  workspace backup/restore does not create false conflicts.
- `unavailable` documents (symlink/junction rejection, oversized) cannot be
  published over — the precondition cannot be proven, so the write refuses
  closed.
- Publishing `opplan` is allowed but the precondition is what protects
  in-flight runtime objective edits; operators editing a live OPPLAN will hit
  conflicts rather than silently clobbering agent state.
