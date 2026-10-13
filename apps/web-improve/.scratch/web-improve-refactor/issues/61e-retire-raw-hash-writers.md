# 61e: Retire the last raw hash-location writers

**What to build:** Convert the two remaining out-of-router location writes (route-inventory "Known raw reads/writes outside the router" — the owning tickets 35–37/41–42 are resolved but two writers remain) to the single-writer navigation seam, in the screens that still carry them:
- `src/screens/f-report.tsx:25` — `hardGo` writes `window.location.hash = toHash(...)` directly (report preview/review flows).
- `src/screens/g-common.tsx:201` — `useTraceLink` writes `window.location.hash = '#/ai-trace/<id>'` directly.
Both must navigate through the store's guarded `go`/router (the dirty-guarded single writer) or be deleted if their callers are already on `go`. These are live single-writer violations, not wrappers: contraction batch B (66) must not delete or rewrite them blindly, so this leaf blocks 66.
**Blocked by:** 61 (discovered by ticket 61's route-coverage closure; the two writers post-date the resolved f/g feature tickets).
**Status:** resolved
**Owner:** Route single-writer closure; flagged by the ticket 61 coverage audit.
**Contract:** [execution.md](../execution.md).

- [x] No screen module writes `window.location.hash` / `location.assign` / `history.replaceState` outside `src/router/`; the route inventory's raw-reads list is empty.
- [x] The affected report/trace flows still navigate with the addressed entity identity preserved (rendered regression at the call site).
- [x] Diff fits the cap; typecheck/lint/test/build stay green.

## Evidence

- `src/screens/f-report.tsx` — the `hardGo` helper (router.navigate primary + raw `window.location.hash` fallback, duplicating the store's `navRaw` seam) is deleted. All three call sites navigate through the store's guarded `go`: editor submit → `go('report-review', { id })`, preview submit → same, review return → `go('report', { id })`. The editor submit first realigns the draft store (`setDrafts({})`) and clears the dirty state (`setDirty(false)`) — the same "dirty cleared first, the unsaved guard must not hold the redirect" rule `ReportNew` documents; `src/store.tsx` `setDirty` now updates the guard's ref synchronously so that rule holds from a dirty screen (otherwise a submit typed seconds earlier would be held behind the unsaved-changes modal even though the submit just committed those bodies).
- `src/screens/g-common.tsx` — `useTraceLink` returns `(id) => go('ai-trace', { id })` instead of a guarded raw hash write; the guard semantics are unchanged (it was already `guarded(...)`) and `go` serializes to the identical `#/ai-trace/<encodeURIComponent(id)>` URL.
- URL-outcome proof (rendered, through the real route host):
  - `src/features/reports/review.test.tsx` "report post-write navigation through the guarded seam (ticket 61e)": a dirty editor submit lands on `#/report-review/REP-014` with `route === { page: 'report-review', id: 'REP-014' }`, no unsaved modal and the review screen rendered ("Only a Reviewer can approve or return reports"); the preview submit lands on the same route/addressed entity; the reviewer return lands on `#/report/REP-015` with the editor rendered.
  - `src/features/trace/trace.test.tsx` "trace link through the guarded seam (ticket 61e)": the proposal card's View in Trace yields `#/ai-trace/TL-03`, and an id with reserved characters (`TL 09/2`) yields `#/ai-trace/TL%2009%2F2` — byte-identical to the retired raw write's encoding.
- Single-writer grep: `src/router/routes.test.tsx` "no module outside the router seam writes the location" walks `src/` (excluding `src/router/`, test files and the seam's own `store.tsx` router-less fallback) and fails on any `location.hash =` / `location.assign(` / `history.replaceState(` / `history.pushState(` writer — the route inventory's raw-reads list is now empty and stays that way.
- Checks (app-local): `npm run typecheck` 0 errors; `npm run lint` 0 errors / 198 warnings (baseline); `npm test -- --run` 902 passed (896 prior + 6 new) across 66 files; `npm run build` succeeds (pre-existing chunk-size warning only).
- Browser exercise not run (preview HTTP check optional per AGENTS.md § Windows Temporary Process Safety) — recorded as a gap; the rendered router-host regressions above cover the navigation outcomes.
