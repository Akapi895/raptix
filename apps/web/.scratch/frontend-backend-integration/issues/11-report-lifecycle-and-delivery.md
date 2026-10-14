# 11: Draft, review and deliver real reports

**What to build:** Users create reports from recorded findings/evidence, edit
sections, obtain independent version-pinned review and record export/delivery as
distinct persistent actions.

**Blocked by:** 10 (finding lifecycle and evidence authoring).
**Status:** complete
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Catalog/templates/new/editor/preview views use persisted owned report data
  and approved finding/evidence references, not the demo dataset.
- [ ] Autosave/manual save and conflict handling preserve drafts on failure;
  report revisions and dirty navigation have authoritative outcomes.
- [ ] Review enforces independent author/reviewer identities and mandatory comments;
  approval pins a specific version and later edits require the chosen re-review
  behavior. Role/client spoofing cannot approve a report.
- [ ] Export and delivery are separate audited records with truthful completion
  and failure states. Existing engagement JSON/Markdown export is not relabeled
  as a reviewed report or a delivered artifact.
- [ ] New report formats/providers are supported only within the scope approved
  in 01; unavailable PDF/email/etc. is not simulated as success. Records survive
  refresh and satisfy the closure input contract for 17.

## Verification selection

Select report draft/save/conflict, independent review/version pin, export/delivery
and editor dirty-guard tests. Live smoke: create/edit, rejected save preserving
draft, independent review where supported, export and recorded delivery outcome.
Recheck finding references only if their contract changes; reuse unchanged
findings/auth evidence. No full suite.

## Scope boundary

Do not introduce an unrequested document/email provider. Project closure consumes
the delivery state in 17 rather than being inferred from an export click.

## Evidence (2026-10-15)

- `ReportsService` + `/report-records` routes: draft create/edit with
  expectedVersion conflicts (409 preserves the stored body and names both
  versions), post-approval edits refused (re-review required), independent
  review (`requireIndependentActor` + mandatory comment) pinning
  `approvedVersion`, and export/delivery as separate audited records with
  truthful completed/failed outcomes (the engagement export path is reused;
  it is never relabeled as a reviewed deliverable).
- Delivery is gated on approval; replay with the same requestId returns the
  recorded outcome without a duplicate row (found + fixed a real bug here:
  the replay check ran after the approval gate and misread Prisma `null`).
- Tests: `server/tests/t11-reports.test.ts` (4). Web: Reports tab in project
  detail (draft/edit, submit review, approve/request-changes, export MD,
  record delivery) with refusal surfacing.
- Named gap: PDF/email providers remain intentionally unsupported — the
  format list is only json/markdown, matching the existing export service.
