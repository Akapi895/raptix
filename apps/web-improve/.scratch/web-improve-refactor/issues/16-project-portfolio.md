# 16: Project portfolio

**What to build:** Migrate project list/search/status filters/pagination/export/pinning using the project service and Query.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Project list and basic project read/pin handlers.
**Contract:** [execution.md](../execution.md).

- [x] Search/filter/pagination/CSV/pin behavior uses accessible canonical projects, with loading/empty/error states.
- [x] Creation and pin/edit controls retain role/read-only reasons.
- [x] A legacy-created project appears in the new portfolio and a new pin mutation updates legacy project views.
- [x] Route registration is integrated serially; wizard/detail may still use bridged legacy routes.

## Implementation notes

- **Files (4 touched, net +109 runtime lines — cap 400/10 files):** `src/screens/b-portfolio.tsx` (new screen, 160 lines), `src/screens/portfolio-handlers.ts` (feature-local handler extension, 59 lines), `src/screens/b.tsx` (rewritten to a 7-line slice record; legacy inline `ProjectsPage` deleted), `src/screens/b-portfolio.test.tsx` (12 tests).
- **Handler extension approach:** `createPortfolioHandlers(svc, actor, scopeProject)` composes the representative `ProjectService` from the ticket-04 factory — no factory edits. It provides `listAccessible` (aggregate read: store scope `'all'` maps to the service's `''` token; a specific pid scopes the read), `read`, and `setPinned` (get → shared-policy `can(actor,'editScope',project)` → factory `update({pinned})`, with distinct read-only vs role refusal reasons). Request contexts are built at call time (`pf-N` corr); the factory guard registers in-flight reads under the store's scope id so the cancel bridge supersedes them on persona/project switch. Query keys reuse `consoleKeys.list('project', scope)` from shared `keys.ts` unmodified — the `'project'` kind prefix gives ChangeSet invalidation for free.
- **Route registration:** zero manifest edits needed — `projects: 'b'` already exists and slice `b` is this ticket's file; `projects` now renders the migrated screen while `project-new`/`project` keep rendering the bridged legacy wizard/detail (`b-wizard.tsx`/`b-detail.tsx`, owners 17–20). Links (`go('project', {id, tab})`, `go('project-new')`) point at those bridged legacy routes.
- **Scoped-deliberate behavior:** with a specific project active in the switcher, the portfolio reads that scope (canonical scoped read, `ctx.projectId`); the `'all'` aggregate lists every accessible project — matching `store.scoped()` semantics and making the project-switch isolation observable.
- **Known dependency (documented, not new):** the Execution Readiness column and CSV enrichment reuse the store's `eligibility` helper/op counts, which derive from operations/assets/agents owned by later tickets; the list itself (which projects appear) is fully service-served.

## Evidence

Checks (all in `apps/web-improve`, after `git merge --no-edit web-improve-refactor` at f5686b7):

- `npm run typecheck` — clean, 0 new diagnostics.
- `npm run lint` — 220 warnings (baseline 221; the rewrite removed the old `b.tsx` warning, new files contribute 0).
- `npm test -- --run` — 20 files / **217 passed** (205 baseline + 12 new in `b-portfolio.test.tsx`).
- `npm run build` — success (pre-existing chunk-size advisory only).

New tests (`src/screens/b-portfolio.test.tsx`):

- Accessible-only rendering: Riley Brooks (analyst, 014 member) sees `RT-2026-014` only; `RT-2026-015`/`PT-2026-006` hidden (non-member projects never leak).
- Search (`Northwind` → 014 + PT-2026-006), status filter (`active` → 014+015), Clear filters restore, `6 records`.
- Pagination: after legacy creates, 9 rows → `Page 1 of 2` → Next → `Page 2 of 2` with the overflow row.
- CSV export: blob captured via stubbed `createObjectURL`; header + all rows unfiltered, filtered subset after the status filter; toast count.
- **Bridge direction 1 (legacy → new):** `A.createProject` (legacy action) → the new portfolio refetches and shows the created project.
- **Bridge direction 2 (new → legacy):** pin through the new screen's service mutation → the legacy probe rendering `useStore().db` flips `RT-2026-014:true→false`, toast fires, list refetch drops the Pinned icon; then legacy `A.updateProject({pinned:true})` → the new list refetches and shows pinned again.
- RBAC gates with reasons (Casey, viewer): Create/Export disabled with role titles, `Locked` banner text, row menu Edit/Pin disabled with `Requires permission to edit scope` / `Viewers have read-only access` hints.
- Delayed-response isolation on project switch: gated aggregate read (loading skeleton visible) → `setPid('RT-2026-014')` cancels the stale `'all'` read → narrow view renders only 014 → resolving the gate late never widens the view (015/PT-2026-006 stay hidden).
- Error state: handler failure → `Could not load projects` + failure message + Retry; retry succeeds and renders rows.
- Handler unit reasons: aggregate `'all'`→6 items, scoped pid→1 item; viewer pin and closed-project pin refused `forbidden` with the matching reason and no commit; foreign-project read `not-found`; manager pin commits.

Gaps:

- Browser/preview verification of the live route (`#/projects`) was skipped per AGENTS.md § Windows Temporary Process Safety (preview HTTP check optional; avoided spawning an unbounded server). Success/refusal wiring is covered by rendered tests against the real store+Query providers; recording as a gap per execution.md.
