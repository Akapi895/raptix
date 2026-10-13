# 14: Command Center

**What to build:** Migrate the home dashboard to typed aggregate service reads, Query and real shared scope: KPIs, readiness, completion, activity and quick actions.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Dashboard feature and aggregate read service.
**Contract:** [execution.md](../execution.md).

- [x] All-project and selected-project dashboards use only accessible data and update after shared-authority mutations.
- [x] Readiness/completion computations leave the component and retain their baseline expectations.
- [x] Quick actions and KPI links reach the correct scoped routes; loading/empty/error states work.
- [x] No dashboard consumer needs the legacy store/data path; verify persona/project switch and a new-project update.

## Evidence

- `src/screens/dashboard/domain.ts` — pure domain: `DashboardAggregate`, `readiness`, `completion`, `eligibility`, `dashboardKpis`, `attentionItems`, `openFindings`, `opProgress`, `canDo` (over shared `projectAccessible`/policy) and grant countdowns (`grantMinutesLeft`/`formatCountdown` via `parseDemoInstant` + factory clock).
- `src/screens/dashboard/service.ts` — feature-local aggregate read: `aggregateFor(db, actor, projectId)` projects the one database authority per explicit scope (`''` = all-projects view; workspace-level `projectId: ''` rows only in all-mode; c2 nodes included iff serving an accessible project; a selected inaccessible project yields an empty aggregate — no leak). `readDashboard` honors the Query abort signal (superseded reads resolve `unavailable`); `dashboardForScope` binds actor/project so a request context can never retarget the read.
- `src/screens/dashboard/use-dashboard.ts` — `useDashboard()` keyed `consoleKeys.view('dashboard', scope)` (ticket 05): persona/project switch reads a different cache entry, ScopeCancelBridge cancels the superseded fetch, ChangeSetBridge refetches after committed mutations; `useConsoleGo()` navigates via the active data router (ticket 07).
- `src/screens/a-dashboard.tsx` — `Dashboard` + `ProjectPanels` now read only `useDashboard()` + domain functions; loading skeleton, error notice (with Try again), stale-content error banner, empty state for inaccessible selected projects. `MyTasks`/`useCC` stay on the legacy path for ticket 15.
- `src/screens/dashboard/dashboard.test.tsx` — 20 tests: domain baselines (readiness 5/6 gates on RT-2026-014 with r4 '2/3 connected' failing; draft 0/6; completion 29%/42% objPct; draft closure 4/5 vacuous; eligibility active/locked/ready/eligible/closed; KPI + attention ordering + countdown formats), aggregate scoping (Riley sees only RT-2026-014 data; selected-project narrowing; inaccessible project → empty aggregate; aborted read → unavailable; scope-bound read ignores a foreign request context), and the mounted dashboard (loading → data pending probe, attention entries, persona switch re-read with no inaccessible data and no stale cache entry, project switch + no stale scope restoration, readiness/completion panels, inaccessible-project empty state, legacy `createProject` refreshes the aggregate through the ChangeSet bridge, quick actions/KPI links reach `#/project-new`, `#/operations`, `#/agent/AG-009`, authority failure → error state → Try again recovery).
- Checks: `npm test -- --run` 225/225 (205 baseline + 20 new), `npm run typecheck` clean, `npm run lint` 0 errors / 218 warnings (≤ 221 baseline; old dashboard carried 3), `npm run build` ok.

## Notes

- `readiness`/`completion`/`eligibility`/`closureChecklist` are re-derived in the feature domain instead of `src/store.tsx` (left untouched for legacy screens b-detail/b-detail2 until tickets 20/22/65).
- Invalidation rides the ChangeSetBridge projectId predicate like ticket 06's `project-memberships` view key; commits touching several projects at once remain a platform limitation, unchanged here.
- Multi-button text ('OP-014' in IdLink + activity feed, '1 accessible' in header sub + KPI sub) is asserted with `getAllByText`/fully-anchored regexes.
