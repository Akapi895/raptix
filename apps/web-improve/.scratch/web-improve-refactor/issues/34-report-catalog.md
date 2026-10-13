# 34: Report catalog, templates and draft creation

**What to build:** Migrate report inventory/template/delivery-history reads and validated draft creation from eligible confirmed findings.
**Blocked by:** 32b.
**Status:** resolved
**Owner:** Report catalog/template reads and create handler.
**Contract:** [execution.md](../execution.md).

- [x] Search/filter/pagination/templates and history are scoped, with loading/empty/error states.
- [x] Creation is role-gated; suggested/unreviewed findings cannot be included; selected evidence/finding IDs belong to the project.
- [x] Independent reviewer selection is validated; the draft opens in the bridged editor until 35.
- [x] Created report appears in legacy and migrated inventories; failed creation cannot leave partial records.

## Evidence

Feature-local module `src/features/reports/` (service + Query bindings, ADR-0067 pattern per `features/findings/`), wired into the factory as `services.reports(actor, projectId)` with the shared superseded-scope guard. Screens: `ReportsPage`/`ReportList`/`Templates`/`Exports` in `src/screens/f.tsx` and `ReportNew` in `src/screens/f-report.tsx` run on the typed reads/writes.

- Scope: specific-project reads verify membership; a non-member's read is `not-found` (no existence leak); the aggregate folds in only accessible projects. Templates are organization assets (global read); delivery history is scoped to accessible reports (EX-090 invisible to a non-member of RT-2026-009). Verified by `listReports`/`listDeliveries` handler tests and the operator screen test.
- Catalog: KPI counts/filter options derive from the scoped base (stay live while filters narrow rows); search/status/project/template/author filters + pagination run in the read. Loading skeleton, retryable error state (`Could not load reports`) and the empty/filtered-empty states are rendered per tab; tab badges come from the typed reads.
- Creation gate at the handler (`createReportDraft`): aggregate context → forbidden "Select a specific project…", read-only project → forbidden, missing `editReport` → forbidden with the role reason (matches the legacy copy), non-member → `not-found`. Field validation: title, template existence, independent reviewer (not the author, must hold the Reviewer role). Findings: every id must belong to the report's project and be confirmed-or-later — AI-suggested (`FD-012`) and cross-project (`FD-015`) selections are refused. Validation precedes the single atomic commit, so a refused create leaves counters/reports/audit untouched. The screen renders the handler-computed gate (`draftOptions.canCreate`/`createReason`) and surfaces create failures as a banner that keeps the form contents.
- Independent reviewer validated; success navigates to the legacy editor route `report` (bridged until 35) via the store's router-backed `go` with the dirty flag cleared.
- Bridge both directions: legacy `A.createReport` refetches the typed catalog view (key `['report', scope, 'list', …]`, kind-aligned prefix invalidation); the typed create publishes the ChangeSet the legacy context observes (`store.db === authority.snapshot()`). Export commits invalidate the `report-export` keys; finding commits (a reviewer confirming) invalidate the draft-options key (`['finding', …, 'report-draft-options']`).
- Hash-write fix (ticket 07 route-inventory concern): the `hardGo` helper in `f-report.tsx` now writes through the active data router (`router.navigate(toHref(...))`); the remaining `window.location.hash` line is only the router-less mount fallback, mirroring the store's `navRaw`. `ReportNew` no longer uses `hardGo` at all. Verified by the router test: post-create navigation lands on `#/report/<id>` with `router.navigate` observed as the writer. No raw hash writes remain in the migrated surface (`f.tsx`, `features/reports/`); `g-*.tsx` writers belong to ticket 43's surface.
- Checks (app dir): `npm run typecheck` 0 errors; `npm run lint` 218 warnings / 0 errors (= baseline, no new diagnostics); `npm test -- --run --maxWorkers=2` 363 passed (347 baseline + 16 new in `src/features/reports/query.test.tsx`); `npm run build` succeeds. The unrestricted full-parallel `npm test -- --run` run shows ~18 environment-contention timeouts in this sandbox that also fail on the untouched baseline; every affected file passes in isolation and the full suite passes at `--maxWorkers=2`.
- Gap: browser exercise of the real dev server was not performed (preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety — no temp server lifecycle). Coverage of the routes comes from the rendered screen tests above (`#/reports` tabs, `#/report-new` gate + create, router navigation).
