# 15: My Tasks and approval inbox

**What to build:** Migrate the tasks inbox to aggregate service reads and canonical action dispatch, grouping project/scope/closure/plan/access/report/finding work by role and project.
**Blocked by:** 14.
**Status:** resolved
**Owner:** Tasks feature; legacy dashboard-source edits are sequenced after 14.
**Contract:** [execution.md](../execution.md).

- [x] All/mine filters, counts and task links match accessible canonical records; empty/loading/error states work.
- [x] Role and self-review restrictions remain visible; action requests go to their owning service or compatibility bridge.
- [x] Creating/deciding an approval in either migrated or legacy UI updates the inbox without reload.
- [x] No tasks consumer reads the legacy database directly; late results cannot restore the previous project's tasks.

## Evidence

Feature-local module `src/screens/tasks/` (sibling of ticket 14's dashboard
modules; no dashboard logic reworked — the inbox reuses the ticket 14
aggregate read):

- `domain.ts` — pure projection of a `DashboardAggregate` into the scoped
  `TasksSummary`: pending project/scope/closure approvals, plans in review,
  pending session access requests, report/finding reviews. Each row carries
  the shared policy's allow/deny decision (`policyCan` via `canDo`), the
  reason a role cannot decide (read-only rows stay visible), the
  self-review restriction (plan requester cannot decide — four-eyes kept
  visible), and the 24h plan-approval expiry normalized with
  `parseDemoInstant` at the service boundary.
- `service.ts` — `readTasks`/`tasksForScope`: scope-bound aggregate read
  reusing `dashboardForScope` (membership via `projectAccessible`; abort
  signal honored so the ScopeCancelBridge supersedes stale reads).
- `use-tasks.ts` — Query hook keyed `consoleKeys.view('tasks', scope)`; the
  ChangeSetBridge refetches after every committed mutation (legacy or
  service) touching the scope's project or the aggregate view.
- `a-dashboard.tsx` — `MyTasks` now reads services/Query only (legacy
  `useCC` database projection removed; no consumer reads the legacy db).
  Mutations dispatch through the legacy actions (compatibility bridge:
  `decideApproval`/`decidePlan`/`decideSessionRequest`), navigation through
  the active data router (`useConsoleGo`), 24h countdown displayed from the
  shared clock (`formatCountdown(minutesLeft(expiresAt, now))`, warn when
  expired). Loading (PageSkeleton), empty ("all caught up" / "nothing
  assigned to your role"), error (Banner + retry, both before and after data
  exists) states implemented.

Commands and results (`apps/web-improve`, Node ≥22.12):

- `npm run typecheck` — clean (0 errors, 0 new).
- `npm run lint` — 217 warnings (baseline 218; 0 in the touched files).
- `npm test -- --run` — 36 files, 490 passed (467 baseline + 23 new in
  `src/screens/tasks/tasks.test.tsx`), 0 failures.
- `npm run build` — succeeded (pre-existing chunk-size warning only).

Targeted coverage (`src/screens/tasks/tasks.test.tsx`):

- Per-persona rows only: Alex (manager) sees 4 rows with 3 read-only +
  reasons; Riley (analyst, RT-2026-014 member) sees only AR-012 — APR-061
  (PT-2026-006), PL-022 and REP-015 (RT-2026-015) never leak; Pat (reviewer)
  can decide all 4. Persona switch re-reads the new scope and the stale
  Query entry is dropped (gcTime 0); project switch narrows and a late stale
  response cannot restore the previous scope (canceled keys verified).
- Self-review restricted: the requesting reviewer's own plan row is
  read-only with "You requested this plan. Another reviewer must decide."
- Countdown/expiry: seeded expiry normalized (`planExpiry` → absolute
  instant, 1363 min from the anchor); mounted row renders the 24h countdown
  from the shared clock and an expired window renders "expired" (warn).
- Scoped links: task titles navigate to `#/c2-session/SS-042`,
  `#/ai-plan-review/PL-022`, `#/project/PT-2026-006`; scope/closure rows
  link with `?tab=scope` / `?tab=close`.
- Bridge both directions without reload: legacy `submitApproval` appears in
  the inbox (`All (5)`); deciding (Return) from the inbox commits through
  the legacy action and the row leaves without reload; legacy
  `requestPlanApproval` appears with its 24h countdown.
- Superseded reads resolve `unavailable`; a scope-bound read never retargets
  with a foreign request context; failing reads surface the error state and
  recover on retry; empty state on a closed project with no decisions.

Gap: interactive browser verification of the live route (`#/tasks`) and
768–1440px visual pass was not performed — preview HTTP checks are optional
per AGENTS.md § Windows Temporary Process Safety and no preview session was
available; recorded as a gap, not a pass.
