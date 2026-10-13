# 36: Report review and immutable approved versions

**What to build:** Move report submit/approve/return and version snapshots into real handlers, preserving independent review and approved-content pinning.
**Blocked by:** 35.
**Status:** resolved
**Owner:** Report review/version policy.
**Contract:** [execution.md](../execution.md).

- [x] Real actions reject author self-approval, wrong role/state and missing mandatory decision comments.
- [x] Approval pins content/version; later edits create a new draft, never mutate the approved snapshot.
- [x] Return/resubmit produces a traceable revision with reviewer notes and canonical history.
- [x] Tests call real handlers for refusals/pinning and rendered review for explanatory gating; migrated baseline assertions stay intact.

## Evidence

- Handlers in `src/features/reports/service.ts` (one owner, ticket 36 review + delivery chain):
  `readReportReview` (read model: report/project/checklist/linked findings with redaction markers/exports +
  handler-computed gates), `submitReportVersion` (atomic: status, version bump on resubmit, review entry, version
  snapshot, audit, reviewer notice), `decideReport` (four-eyes: author can never decide; `approveReport` reviewer
  role; In Review state; mandatory decision note; approval creates-or-pins the version snapshot), `exportReportVersion`
  (approved versions only, baseline export-record shape + checksum on the record), `deliverReportVersion` (exact-version
  export required; handover record stamped on the export records; recipient validation), `acknowledgeDelivery`
  (idempotent). Gate order mirrors the baseline: read-only project → state → role → validation.
- Version snapshots moved out of UI state (`persistFilters.repSnaps` deleted) into the shared database
  (`Report.snapshots` + `ReportSnapshot` in `src/domain/entities.ts`); approval pins; later edits start a new draft
  and never mutate pinned content (handler-refused with conflict).
- Screens: `src/screens/f-report.tsx` Review/Editor/Preview use the typed writes (`submit`, `decide`,
  `exportVersion`, `deliver`, `acknowledge`) and render the handler gate reasons verbatim; the legacy checklist
  exports stay available for `f.tsx`. Legacy store actions are untouched (bridge both directions verified).
- Tests: new `src/features/reports/review.test.tsx` (16 tests) covers handler refusals (role/state/four-eyes/missing
  comments, scope without a leak), snapshot pinning and immutability, export record shape/checksum, delivery gating +
  handover stamping, acknowledgement idempotency, screen gating with reasons, the approve→export→deliver chain through
  typed writes observed by the legacy store, legacy→new refetch bridge, and editor submit pinning.
- Checks: `npm test -- --run` 562 passed (41 files; baseline 546 + 16 new) · `npm run typecheck` clean ·
  `npm run lint` 217 warnings (baseline, 0 errors) · `npm run build` ok.
- Gaps: preview HTTP smoke skipped per Windows temporary-process safety allowance (dev server lifecycle not
  managed from this session); baseline-faithful export role gate implemented as a local `EXPORT_ROLES` constant
  (`admin|manager|reviewer`) instead of new shared-permission actions, since the 19-action vocabulary is frozen.
