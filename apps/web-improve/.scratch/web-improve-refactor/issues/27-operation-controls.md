# 27: Start, pause, resume and normal stop

**What to build:** Implement canonical operation control transitions with current preflight/approval checks, confirmation/reasons and audited outcomes. Emergency stop has a separate owner.
**Blocked by:** 26.
**Status:** resolved
**Owner:** Operation control API.
**Contract:** [execution.md](../execution.md).

- [x] Real handlers reject invalid states, unauthorized actors and failed current gates; UI reasons match refusals.
- [x] Start/pause/resume/stop require deliberate confirmation/reasons as specified; stopped/estop operations never resume automatically.
- [x] Start/session creation, agent reservations and normal-stop cleanup commit coherently to the shared authority.
- [x] Test policy changes between render and click, expired linked approval and both legacy/new control consumers.

## Evidence

**Handlers** (`src/features/operations/service.ts`, appended ticket-27 section): `startOperation`,
`pauseOperation`, `resumeOperation`, `stopOperation`, `completeOperation` — each returns
`ServiceResult<OperationTransitionRead>` and is wired into `OperationService` (`start`/`pause`/
`resume`/`stop`/`complete`) behind the factory scope. Every transition re-derives its gate at the
handler — nothing is trusted from a rendered snapshot:

- `startOperation` runs ticket 26's `operationStartGate` first: the eight checks are re-derived
  from canonical records, so a start without a currently passing preflight (e.g. PRE-02 with the
  ROE pending) or an **expired/rejected/missing linked plan approval** (PRE-07) is refused with the
  failed check's code/detail and commits nothing. Role/read-only gates carry the same reasons.
- The start **transition** is ONE atomic `authority.commit`: run state + first-step dispatch + the
  **agent reservations** (`agent.op = <op>`, policy: one agent, one operation) + project
  activation + the first C2 session (the store's `newSession` moved here) + the linked plan's
  `executed` flip + the audit row. One ChangeSet — a partial start is impossible.
- `stopOperation` (reason required, audited) and `completeOperation` (refuses while a step is
  still running — baseline invariant) release the reservations and terminate the linked sessions
  in the SAME atomic commit as the terminal state. Legacy session-state parity kept ('awaiting'
  terminated by stop, left open by completion).
- `pauseOperation` requires an audited reason and refuses non-running operations;
  `resumeOperation` enforces the rechecks the resume dialog previewed — connected agents,
  approved/executed plan, only `paused` resumes: **stopped and emergency-stopped operations never
  resume automatically** (refused with reasons).
- Shared `lifecycleGate`: scope without existence leak (non-member → `not-found`), membership,
  read-only and `can('run')` role gates with reasons for every control.

**Bridge (one implementation, both entry points):** legacy `A.startOp`/`A.pauseOp`/`A.resumeOp`/
`A.stopOp`/`A.completeOp` (`store.tsx`) delegate to the same handlers; the store keeps only the
demo live-log mirrors (pushLog). The step auto-advance simulation stays in the store — it is the
demo's execution outcome engine, not a control. The stop/complete UI (`c-console.tsx` `OpControls`,
owner 29) therefore runs the typed handlers unmodified.

**Screens** (`src/screens/c.tsx`): the preflight screen's Start control is the typed mutation
(`useStartOperation`) — the handler re-derives the gate at click time, a refusal surfaces its
reason through the toast channel and the operation stays unstarted; a pending start disables the
button. Pause/resume/stop/complete Query hooks (`usePauseOperation`/`useResumeOperation`/
`useStopOperation`/`useCompleteOperation`) are exported for owner 29's console migration.

**Reservation atomicity proof** (`src/features/operations/lifecycle.test.tsx`, 13 tests):
start commits exactly ONE ChangeSet containing `operation` + `agent` + `session` + `audit`
(corr of the request) with the reservation asserted on the agent row; stop/complete likewise
publish exactly one ChangeSet with the released reservation, terminated sessions and audit row;
the linked plan flips to `executed` in the same commit. Refusals (failed check, expired plan,
viewer/analyst, non-member, missing reason, non-active states, running step) leave operations,
agents and audit untouched. Late-response isolation follows the established pattern: writes
capture the scope at call time and are never cancelled mid-flight; the superseded-scope guard
covers the feature reads (ticket 26's suite stays green).

**Policy-change-between-render-and-click proof:** ROE revised after the screen's snapshot → the
control renders the invalidation (disabled + "Snapshot invalidated" banner) AND the gate the click
invokes (`svc.operations(...).start`) refuses with PRE-02 committing nothing; a service-level
refusal renders through the toast channel with no silent start.

**Both control consumers proof:** the typed Start control (screen click) starts through the
handler and the agent-fleet read (`useAgentList`, ticket 48's `kpis.busy`) refetches from the same
ChangeSet (2→3 busy) without reload; the legacy `A.stopOp` releases the reservation and the typed
fleet read observes it (3→2) — both directions on mounted screens.

**Checks** (in `apps/web-improve`):

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors (0 new) |
| `npm run lint` | 203 warnings / 0 errors (baseline 204; one legacy warning retired with the migrated `newSession`). Touched files: `c.tsx` 11 and `store.tsx` 27 — exactly their baseline counts; `service.ts`/`query.ts`/new files contribute 0 |
| `npm test -- --run` | 707 passed (694 baseline + 13 new), 50 files, default parallelism |
| `npm run build` | success |

**Budget:** net runtime diffs `service.ts` +151, `query.ts` +51, `c.tsx` +12, `store.tsx` +40/−46
≈ **208 net runtime lines** (≤400); 5 touched files (≤10); one concern.

**Gaps / deviations:**

- Browser verification of the real routes (success/refusal at 768/1024/1280/1440) was not run —
  preview HTTP lifecycle checks are optional per AGENTS.md § Windows Temporary Process Safety and
  were skipped rather than risk an unbounded server. Mounted-screen tests cover the behaviors;
  recorded as a gap, not a pass.
- Emergency-stop behavior untouched (owned by 28; its suite stays green unmodified). The estop
  reservation release remains ticket 28's finalize.
- `OpControls` (pause/resume/stop/complete buttons, `c-console.tsx`) keeps its legacy demo
  orchestration (stopping delay, resume recheck dialog) — owner 29's surface. Its actions now run
  the typed handlers; the exported Query hooks are ready for that migration.
