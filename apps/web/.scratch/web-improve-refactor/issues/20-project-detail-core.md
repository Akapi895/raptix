# 20: Project overview, scope and team panels

**What to build:** Migrate project detail shell and overview/scope/team reads using project services; retain secondary panels through adapters until 23.
**Blocked by:** 19.
**Status:** resolved
**Owner:** Project detail composition and core panels.
**Contract:** [execution.md](../execution.md).

- [x] Overview readiness/completion and scope/team metadata use typed canonical reads; membership edits are permission-gated.
- [x] Direct detail URLs select the correct project; forbidden/not-found states expose no record content.
- [x] Tab/search state and old aliases survive back/forward, scope changes and dirty guards.
- [x] Unmigrated panels remain functional via adapters; governance is delegated to its dedicated owners.

## Evidence

- `src/screens/project-detail/service.ts` (new): one typed canonical read per detail URL — `detailFor` reuses `aggregateFor` plus the dashboard's pure `readiness`/`completion`/`eligibility` (no duplicated math); `readProjectDetail` goes through `services.forScope(actor, id).get(...)` so unknown and out-of-scope projects collapse into the same `not-found` failure (no existence leak).
- `src/screens/project-detail/use-project-detail.ts` (new): Query key embeds the request scope with the **route's** project id, so the switcher sync cannot refetch an identical view while the ChangeSet/ScopeCancel bridges keep working.
- `src/screens/b-detail.tsx`: shell + overview consume `ProjectDetail`; header pin runs through the typed project write (`createPortfolioHandlers(...).setPinned`) with its policy reason; blocked/pending/read-failure states are fail-closed; the rules-of-hooks site in EvidenceTab (conditional `useStore()` in JSX) is fixed by hoisting `me`. Secondary panels (objectives, activity, operations, findings, reports, evidence, audit, plans, sessions) keep their bridged legacy reads for ticket 23.
- `src/screens/b-detail2.tsx`: `ScopeTab`/`TeamTab` render from the canonical aggregate slices (`ds: DashboardAggregate`); `RoePanel` receives approvals as a prop; `CREATE_OR_SCOPE` typed array replaces both `as any` casts.
- Shell-loading hazard found and fixed: Detail's legacy switcher sync called the guarded `setPid`, whose `setLoading(true)` unmounts the whole page through the Shell loading gate, dropping the fetched detail (`gcTime: 0`) and refetching after the 450 ms timer — flaky under full-suite load. Entry sync now uses the raw project-store write once per mount (`useProjectStore.getState().setPid`), pinned by a regression test asserting exactly one canonical read.
- Checks: `tsc --noEmit` 0 errors; lint 207 warnings / 0 errors (ratchet 217 → 207; `b-detail.tsx` now contributes 0 warnings, `b-detail2.tsx` keeps its 2 pre-existing `useSubmitApproval`/`useReopen` refresh warnings for ticket 21); vitest 610/610 across three consecutive full-suite runs (16 new tests in `src/screens/project-detail/detail.test.tsx`); `vite build` passes.

Deviations (intentional, aligned with the typed contract): out-of-scope deep links render the not-found blocked state instead of the legacy "You do not have access to this project" banner; the pin button is disabled for any actor without the manager/admin role with its policy reason (legacy only disabled viewers).
