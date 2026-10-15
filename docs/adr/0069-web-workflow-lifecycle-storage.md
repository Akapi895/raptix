# 0069. Store web workflow lifecycle records in a designed-up-front Prisma schema

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** requester (D3 integration decision, ticket 01)
- **Related:** apps/web/.scratch/frontend-backend-integration/spec.md (R08, R09), ADR-0068

## Context

The demo UI persists business lifecycles (business plans with approval expiry,
reports with review/delivery states, notifications, audit entries, closures) in
an in-memory `Db`. The real system keeps evidence and knowledge in the runtime,
workspace artifacts and the engagement knowledge graph; the Fastify server owns
PostgreSQL via Prisma. Existing web tables cover engagements, plan documents,
threads/runs bindings, campaigns, jobs, vault secrets and settings — not web
business lifecycles.

Decision D3 chose a full lifecycle schema now, rather than discovering tables
ticket by ticket. Unclear ownership risks copying the demo `Db` wholesale or
duplicating runtime-owned state (thread/run/checkpoint, findings, KG assets).

## Decision

Design the complete web workflow lifecycle schema up front as the storage
target for web business records — including business plans and revisions,
plan/approval state with expiry fields, reports and review/delivery states,
notifications with unread state, audit entries for web workflow actions, and
closure records — while runtime checkpoints, workspace artifacts and the
engagement knowledge graph remain the producers of evidence and execution
state. Migrations land incrementally per owning ticket from that frozen
design; the demo `Db` is never migrated or used as a wire DTO.

## Consequences

### Storage and concurrency contract

The concrete storage target is `apps/web/server/prisma/schema.prisma` and the
incremental SQL migration history under `prisma/migrations/`. Cardinalities:

| Record | Identity / relationship | Concurrency and lifecycle |
|---|---|---|
| WebUser / WebSession | User ID; sessions belong to one user | Opaque cookie token stored hashed; absolute expiry; per-session CSRF |
| WebMembership | Unique engagement + user | Persisted owner/operator/reviewer/viewer role; server checks every scoped action |
| ScopeRevision | Unique engagement + version | Pending -> independently approved/rejected; submission invalidates earlier scope |
| WebAsset | Unique engagement + identifier | Versioned managed classification, separate from observed KG assets |
| BusinessPlan | Unique engagement + version | Draft -> proposed -> independently approved/rejected; pins ROE; absolute 24h expiry |
| OperationBinding | ID, engagement, plan, runtime thread | No duplicate runtime operation store; binding authorization rechecked on dispatch |
| FindingRecord / EvidenceLink | Finding ID; links belong to finding and engagement | Expected-version updates; producer lineage separate from curated claim |
| ReportRecord / ReportDelivery | Report ID; deliveries belong to report + engagement | Conditional version/status updates; independent review pins version; unique report + request ID |
| WebNotice / WebAuditEntry | ID; actor and optional engagement | Durable read/dismiss state; redacted consequential-action audit |
| WorkspaceSetting | Unique key | Compare-and-set version; configured policy outages fail closed |
| EngagementClosure | Unique engagement | Requested -> independent decision; checklist rechecked at confirmation; mutation fence |

Report export is not engagement export. `GET
/api/engagements/:id/report-records/:reportId/export?format=json|markdown`
returns the exact report version, content, media type and SHA-256 capture digest.
An export record retains this snapshot in `ReportDelivery.detail`; delivery is a
separate explicit manual acknowledgement with recipient and receipt, not inferred
from producing bytes or clicking Export. A retry reuses the original request ID.
No PDF/email provider is implied. Conditional version/status predicates reject
concurrent edits and approvals rather than overwriting a competing commit.

Evidence uploads use `POST /api/engagements/:id/artifacts/captures` with bounded
base64 bytes. The artifact authority generates the path, retains the bytes without
overwriting producer files, and computes SHA-256. Artifact evidence links resolve
that owned path and compute/compare its digest server-side; caller-supplied hashes
without bytes remain external claims, never verified capture integrity.

- **Easier:** later lifecycle tickets (09-11, 15-17) add mapped tables instead
  of redesigning storage mid-flow; concurrency/revision columns are consistent
  from the start.
- **Harder:** the design must be reviewed before the first lifecycle migration;
  unused tables may exist briefly before their owning ticket lands.
- **Given up:** ad-hoc per-ticket schema discovery, and any web table that
  duplicates runtime-owned state.
- **Migration:** owning tickets add migrations from the frozen design; no
  backfill of demo data.

## Alternatives considered

- **Minimal additive storage per ticket:** rejected by requester decision D3;
  accumulates redesign risk across 09-17.
- **Copy the demo `Db` schema:** rejected because it mixes mock fixtures,
  persona data and runtime-owned state into PostgreSQL (R04, spec section 3).
