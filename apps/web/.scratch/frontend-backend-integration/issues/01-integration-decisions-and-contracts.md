# 01: Resolve integration decisions and freeze contracts

**What to build:** An approved implementation map that makes each later flow
unambiguous: deployment identity, domain bindings, write ownership, real feature
scope and preservation of existing backend-only UI workflows.

**Blocked by:** None (can start immediately).
**Status:** in-progress (reopened by precommit verification, 2026-10-14)
**Requirements:** R03, R05, R08, R09; decisions D1-D6 in [spec.md](../spec.md).
**Contract:** [execution.md](../execution.md).

## Acceptance

The [precommit review](../verification-01-06.md) supersedes the completion
claim: D1-D6 are recorded, but ADR-0069 states a schema-design intention rather
than freezing the required models, relationships and concurrency rules.

- [ ] Resolve D1-D6 with the requester and record decisions in the spec.
  (spec.md section 8, resolved 2026-10-14: single-user until R06 with
  multi-user implemented in 07; runtime threads/runs as the operation model;
  full lifecycle schema designed up front per ADR-0069; staged scope to 18
  tickets; campaigns/vault/members UI excluded now, placed in 12/16/07; new
  AI workspace planning flow.)
- [x] Record IDs, cardinality and lifecycle mapping for engagement, business
  operation, thread, run, plan, approval and provider session. (Outcome table
  below; tool HITL, graph interrupts and business approvals kept distinct.)
- [x] For each required Gap/Partial surface, identify its read/write/event
  contract, owning authority and extension needed. (coverage.md sections 2-4
  tabulate contracts per surface; shared semantics frozen in the outcome
  section: ISO-8601 UTC timestamps, revision/updatedAt concurrency on new
  lifecycle records, stable client-generated command request IDs reconciled
  through the existing request ledger, web-contracts error envelope; new URLs
  are proposed per ticket in ADR-0068's transport, not assumed.)
- [x] Approve a specific placement or exclusion for campaigns, vault and
  members. (D5: UI excluded now; campaigns -> 12, vault -> 16, members -> 07;
  APIs and data retained; old consumers retire with the old app in 02.)
- [x] Record Proposed ADRs for newly introduced public API/subsystem
  boundaries. (docs/adr/0068-web-frontend-real-mode-data-boundary.md,
  docs/adr/0069-web-workflow-lifecycle-storage.md — both Proposed until first
  implementation.) Coverage updated with parity vs staged exclusions and
  owning tickets (sections 4 and 7). Existing runtime safety boundaries
  untouched.
- [ ] Confirm a bounded delivery plan for each work package. (execution.md
  sections 3/5/8 govern patch size, targeted test selection and evidence
  reuse; no extra tracker leaves created.)

## Verification evidence

Documentation/source checks only, per the ticket's verification selection:
mapping compared against registered routes (coverage.md section 2), server
services (identity-provider, members-service, approvals-service, export,
campaign/vault routes), runtime thread/run/SSE contracts and the 53-key UI
inventory (router registry MANIFEST). All links resolve; dependency graph
unchanged and acyclic. No application test run needed or performed.

## Entity/lifecycle mapping (frozen for later tickets)

| Entity | ID and owner | Cardinality / lifecycle |
|---|---|---|
| Engagement | Server-generated Prisma engagement ID; display name and workspace slug are distinct fields | 1 engagement : N threads, N plan documents, N workflow records; archived at closure (17) |
| Business operation | **No persisted record** (D2). UI operation views project engagement + thread + run state | Runtime-owned state only; business lifecycle records arrive with 09+ from the ADR-0069 schema |
| Thread | Runtime thread ID (checkpoint-owned); binding row (engagement, kind planning/execution, assistant) persisted server-side via the existing binding API | 1 thread : N runs; browser cannot choose workspace paths or retarget bindings |
| Run | Runtime run ID + request-ledger entry with stable client request ID for retry/reconcile | Run belongs to one thread; SSE stream scoped per run with cursor; terminal states authoritative |
| Plan (documents) | OPPLAN/plan documents are runtime/workspace artifacts read through existing plan-doc/opplan APIs | An OPPLAN is never relabeled as business plan approval; governed plans come with 09 |
| Approval | Three distinct kinds kept separate: tool HITL allow/deny (approvals-service, workspace-backed), graph-interrupt pending questions (runtime, answered via resume), business approvals (09+, persisted) | No UI state may translate one kind into another |
| Provider session | C2 provider session + command ledger (12) | Connected does not imply authorization; no timed per-user grants from sessions |
| Identity | Server-fixed local identity for R06 milestone; browser never asserts persona/role as authorization | Multi-user identity implemented in 07 before any approver workflow enables (D1) |

## Verification selection

Documentation/source checks only: compare the mapping against current registered
routes, DTOs, storage, runtime controls and the 53-key UI inventory. Check links
and dependency consistency. No application test run, dependency installation or
live execution is needed merely to publish this decision record.

## Scope boundary

No feature implementation or folder cutover. Required unresolved decisions keep
this ticket open and block affected implementation; unsupported controls are not
implicitly excluded just because a capability flag can hide them.
