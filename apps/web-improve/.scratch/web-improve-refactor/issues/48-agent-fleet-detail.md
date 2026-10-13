# 48: Agent fleet and health detail

**What to build:** Migrate agent status/allocation reads and detail health/capability/connection/history presentation through typed services.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Agent read services and fleet/detail views.
**Contract:** [execution.md](../execution.md).

- [x] Fleet search/status/project filters and pagination distinguish pool, allocated, unavailable and busy agents.
- [x] Detail sparklines/capabilities/history describe observed health rather than guaranteed execution ability.
- [x] Scope/permission and closed/read-only states apply; legacy assignment actions remain bridged until 49.
- [x] Operation updates from either architecture refresh the fleet without stale or cross-project data.

## Evidence

All checks run in `apps/web-improve` on `wi/48-agents` (worktree `48-agents`), base `da97219` + `web-improve-refactor` (already up to date at start).

**Commands and results**

- `npm run typecheck` — 0 errors (0 new).
- `npm run lint` — 219 warnings / 0 errors; identical to the pre-change baseline count (verified by stashing the diff and re-running): 0 new.
- `npm test -- --run` — 24 files / 289 tests green (268 baseline + 21 new in `src/features/agents/query.test.tsx`).
- `npm run build` — succeeds (pre-existing 500 kB chunk warning only).

**Required tests (all green in `src/features/agents/query.test.tsx`)**

- Fleet scoping: Riley Brooks (analyst, RT-2026-014 member) sees only RT-2026-014 agents plus the shared pool in both tabs; CLOUD-LAB-01/RETAIL-LAB-01 never render; connectivity-tab sparklines (24-sample inline SVG, kept feature-local) render for the scoped base with the "heartbeat missing" label for AG-009.
- Pool vs project: tab badges show live counts (7 assigned / 2 pool aggregate; 3 assigned in RT-2026-014, pool always 2); the Available-in-pool KPI pill filters reserved vs available rows after a legacy `assignAgent` commit.
- Detail: AG-007 shows connection vs assignment, reservation OP-014, identity (host/IP/version/connection type), heartbeat sparkline + latency, active session SS-041, operation history OP-014/OP-013; pool agent AG-012 readable in a specific-project scope with the pool banner and eligible projects; health copy everywhere states "most recent observation … does not guarantee".
- Scoping denials: non-member specific-project list read → `not-found` (no existence leak); assigned agent outside the active project context → `forbidden` with the owning project on the entity ref and a "View all projects" switch; agent in an ungranted project → `Agent not found`.
- RBAC gates with reasons: Viewer gets Disable Agent disabled with "The Viewer role has read-only access."; Analyst gets "Only Admins can disable or enable agents.".
- Bridge: legacy `A.loseAgent('AG-007')` flips the Query-backed detail to Disconnected + health-failure panel + audit/history entries + missing-heartbeat sparkline without reload; `A.restoreAgent` restores it. Legacy `assignAgent` updates the pool KPI rows. Both flows invalidate via the `agent` entity-kind ChangeSet (operation start/stop/complete updates agent reservations in the same commit, so operation updates refresh the fleet).
- Late-response isolation: a gated `'all'`-scope fleet read superseded by `setPid('RT-2026-014')` never restores cross-project data; the stale cache entry stays undefined.

**Handler tests:** `listAgents` (non-member denial, pool/project modes, busy-vs-avail KPI filters, session + pending-assignment decoration scoped to the request context, page clamping) and `getAgent` (cross-project audit entries excluded from history, forbidden entity ref, pool readability, not-found for ungranted projects).

**Route exercised:** `agents` (list/pool/connectivity tabs) and `agent` (overview/connectivity/operations/log tabs) through `src/screens/d.tsx` routes in the test renderer, success and refusal outcomes. Browser verification: **gap** — the environment's pre-running server on port 8443 serves 404 (not this worktree) and per AGENTS.md Windows Temporary Process Safety no new server was started; route-level rendering, RBAC, bridge and isolation are covered by the mounted-screen tests above instead.

**Ownership notes:** `src/screens/d-agents.tsx` rewritten for reads only — `FleetList`, `HealthTab`, `AgentDetail` + tab badges consume `useAgentList`/`useAgentDetail` (feature-local keys `['agent', scope, …]` so both bridge paths reach them). `GroupModal`/`AssignDrawer`/`GroupsTab`/`FailurePanel` keep the bridged legacy actions for ticket 49 (assignment/groups/replace). The 24-sample heartbeat sparklines stay in this file (plan §1.8). `src/domain/service-factory.ts` change is append-style (ticket 48 comment block + `agents()` wiring), mirroring tickets 24/31.
