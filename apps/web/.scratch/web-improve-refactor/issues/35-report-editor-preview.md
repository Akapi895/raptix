# 35: Section editor and report preview

**What to build:** Migrate report sections, eligible finding selection, per-section save/dirty guard and formatted preview to typed handlers/read models.
**Blocked by:** 34.
**Status:** resolved
**Owner:** Report authoring and section-save handlers.
**Contract:** [execution.md](../execution.md).

- [x] Save/cancel/error behavior preserves section drafts; navigation warns before losing unsaved edits.
- [x] Invalid finding selections and editing locked approved content are rejected by handlers as well as UI.
- [x] Preview represents selected version/sections accurately and adds no report-preview checksum feature.
- [x] Editor/preview route tests cover failures and role/read-only states; review/delivery remain bridged for later owners.

## Evidence

All in `apps/web-improve` on `wi/35-reporteditor` (base 4f00b2d = integration tip).

**Implementation** (4 files, +429/−62 runtime lines, one concern):

- `src/features/reports/service.ts` — `readReportEditor` (editor/preview read model: report aggregate + project summary + handler-computed `editReport`/status gate with reasons + project finding rows with linked/reportable flags + linked findings with opaque evidence references and redaction markers) and five validated writes: `saveReportSection`, `addReportSection`, `removeReportSection` (refuses the last remaining section), `reorderReportSections` (order must be a permutation), `setReportFindings` (same-project + confirmed-or-later for adds; unlinking always allowed). Every write resolves scope via one `resolveReport` helper (missing/out-of-scope → `not-found` with no existence leak; member scoped to another project → `forbidden` with the owning project on the entity ref) and enforces the read-only gate (`sectionWriteFailure`: closed/cancelled project → forbidden, missing `editReport` → forbidden, non-draft status → conflict) at the handler, never only in the screen. Structural writes add audit rows; plain body saves stay audit-silent (matches the legacy action). `createReportService` exposes `editor`/`saveSection`/`addSection`/`removeSection`/`reorderSections`/`setFindings` under the same superseded-scope read guard — no factory edits needed.
- `src/features/reports/query.ts` — `reportKeys.editor(scope, id)` keyed under the owning `report` kind (reuses 34's kind-aligned invalidation prefixes, so a typed section write or a legacy report mutation refetches the editor/preview and the catalog/delivery views from one ChangeSet), `useReportEditor` (one read consumed by both screens), and `useReportWrites` extended with the five writes (context captured at call time).
- `src/screens/f-report.tsx` — `ReportEditor`/`ReportPreview` mount the typed read behind a shared `ReportReadGate` (pending skeleton; not-found → "Report not found" with back action; forbidden → "belongs to another project" with a switch button derived from the failure's entity ref). `EditorInner` drops the local `order` state (order is server state; moves/adds/removes commit and the bridge refetches), saves sections through the service (1.5 s autosave + manual Save Draft), keeps sparse local drafts (only user-edited sections diverge, so refetches flow through to clean sections), and toggles linked findings through `setFindings`. Section add ("New section title" + Add) and remove (confirm dialog with danger/label) live in the outline; reorder keeps the ▲▼ buttons. `PreviewInner` renders the committed sections/linked findings strictly read-only (no editing, no checksum feature); submit/export stay with the review/delivery owner (tickets 36/37).

**Checks** (commands run in `apps/web-improve`):

- `npm run typecheck` — 0 errors, 0 new diagnostics.
- `npm run lint` — 0 errors, 218 warnings (= pre-change baseline; no new).
- `npm test -- --run` (`npx vitest run --maxWorkers=2`) — 33 files, **433 passed** (417 pre-existing + 16 new), 0 failed.
- `npm run build` — succeeds.

**Required tests** (`src/features/reports/editor.test.tsx`):

- Section add/remove/reorder persists — handler tests commit + refuse non-permutations/last-section removal; screen test drives Add → `Move up` → confirm-Remove and asserts the one database (`store.db`) and the refetched outline.
- Editor gates with reasons — handler: viewer role → forbidden "cannot edit reports", delivered report in a closed project → forbidden "read-only", In Review status → conflict; screen: Casey sees the Read-only banner with the handler reason, readOnly textarea, disabled Save Draft, no add-section affordance.
- Preview read-only — renders cover/sections/linked findings (`FD-011`, `EV-014-02 [redacted]`) with the DRAFT watermark and no `textbox` role.
- Dirty guard — typing marks `store.dirty`; `go('reports')` sets `store.unsaved` with a save callback whose save persists through the service.
- Bridge, both directions — typed autosave is observable in the legacy store (`store.db` section body); legacy `A.saveReportSection` invalidates the editor key (`isInvalidated=true`) and the refetched textarea shows the legacy edit.
- Scoped reads — Riley (RT-2026-014 member only) opening `#/report/REP-015` gets the not-found state with no project-name leak; Taylor scoped to RT-2026-015 opening REP-014 gets the switch affordance (`entity.projectId`).
- Refusal keeps the draft — a mocked `saveSection` refusal renders "Could not save" + message and the textarea keeps the typed text.

**Gaps**

- No live browser session: the preview HTTP check is optional per root AGENTS.md § Windows Temporary Process Safety and was skipped; route exercise is covered by the jsdom deep-link mounts (`#/report/REP-014`, `#/report-preview/REP-014` as multiple personas), not a manual browser pass.
- Review/approval/export/delivery screens and actions (`ReportReview`, `A.submitReport`, `A.exportReport`, `A.deliverReport`, no-findings variant, version snapshots) intentionally remain legacy/bridged for tickets 36/37.
