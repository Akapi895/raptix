# 49: Agent assignment and groups

**What to build:** Migrate assignment/unassignment/group actions with canonical conflict checks and approval behavior.
**Blocked by:** 48, 21.
**Status:** resolved
**Owner:** Agent allocation/group write handlers.
**Contract:** [execution.md](../execution.md).

- [x] Real actions check actor/project/role, existing reservations and conflicting assignments; pending approval does not silently allocate.
- [x] Group create/edit/remove and project/pool views stay coherent after commit.
- [x] Destructive actions confirm reasons and publish audit/notices; independent assignment review uses 21's approval interface.
- [x] Both legacy operations and migrated agent views observe assignments; agent feature no longer needs direct Context data.

## Evidence

Implementation (branch `wi/49-agentassign`, worktree `49-agentassign`, base `ad6b647`):

- `src/features/agents/writes.ts` (new) — the four typed transactions over the
  one database authority (ADR-0067). Every write captures actor/project at
  call time and binds to the addressed agent/group, so a persona or project
  switch never retargets it; the aggregate scope is allowed and the write
  binds to the explicit target. Eligibility enforced at the handler, never
  the screen; refusals commit nothing; audit + notice commit atomically with
  the change.
  - **Eligibility map (assignment, `assignAgentTransaction`):** agent exists /
    its project accessible → `not-found` (no existence leak); target project
    exists + accessible → `not-found` (cross-project refusal without leak);
    specific context ≠ target → `forbidden`; read-only target (closed/
    cancelled/viewer) → `forbidden`; role without `editScope` → `forbidden`
    (role named, request path offered); target not active/approved →
    `validation` (request-only project); agent already assigned → `conflict`
    with its owning project; agent disconnected → `validation` (status +
    last seen, "never available or auto-assigned"); agent reserved (`op`) →
    `conflict` with the operation id; a pending `Agent assignment` approval
    → `conflict` ("pending approval does not allocate"). Success commits the
    assignment, audit row (`Assigned agent to project`, note as reason) and
    an `agents` project notice in one ChangeSet.
  - **Unassignment (`unassignAgentTransaction`):** pool agent → `validation`;
    owning project inaccessible → `not-found`; cross-context → `forbidden`
    with the owning project; read-only/`editScope` role gates with reasons;
    empty reason → `validation`; reserved → `conflict` until the operation
    ends. Success clears `projectId` (group kept — orthogonal), audits
    `Released agent to shared pool` and notifies the project.
  - **Groups (`saveGroupTransaction`):** name required; project accessible
    (`not-found`), read-only/`editScope` gated with reasons; duplicate name
    per project → `conflict`; member must exist, be free of another group
    (`conflict`) and be pool-or-same-project (`validation` with the owning
    project — cross-project membership refused); removing an in-use agent
    without the confirm reason → `validation`; pool members are auto-assigned
    to the group's project (legacy parity); rename syncs members' `group`
    field; audits `Created/Updated agent group` + `Removed in-use agent from
    group`.
  - **Membership removal (`removeFromGroupTransaction`):** group accessible
    → `not-found`; cross-context → `forbidden`; read-only/role gated;
    non-member → `validation`; in-use removal requires the reason; audited.
- `src/features/agents/service.ts` — `AgentService` gains `assign`/`unassign`/
  `saveGroup`/`removeFromGroup` (append-style) delegating to the transactions;
  reads unchanged. `src/domain/service-factory.ts` passes the clock (one line).
- `src/features/agents/query.ts` — `useAssignAgent`/`useUnassignAgent`/
  `useSaveGroup`/`useRemoveFromGroup` mutations capturing the scope at call
  time; committed writes publish the `agent`/`agent-group` ChangeSet, so the
  48 key namespaces refetch fleet + detail without a reload.
- `src/store.tsx` — legacy `A.assignAgent`/`A.saveGroup`/`A.removeFromGroup`
  delegate to the same transactions (typed refusals surface through the `Res`
  bridge); assignment REQUESTS keep going through ticket 21's
  `submitApprovalTransaction` (the AssignDrawer request path is unchanged),
  and 21's decision path re-checks pool-only before allocating.
- `src/screens/d-agents.tsx` — allocation/groups portions run the typed
  writes: GroupModal (create/update incl. the in-use confirm flow),
  AssignDrawer's "Assign immediately" (refusal reasons surface as toasts),
  GroupsTab unlink, and a new "Return to pool" row action in the fleet
  (confirm + reason required; disabled while reserved). FailurePanel
  (operation agent swap/replacement) deliberately stays on the legacy
  operation actions — that is the execution-reservation surface coordinated
  with ticket 27, not console allocation.

**Commands and results (all in `apps/web-improve`):**

- `npm run typecheck` — 0 errors (0 new).
- `npm run lint` — 203 warnings / 0 errors; identical to the pre-change
  baseline (verified via stash + re-run): 0 new.
- `npm test -- --run` — 50 files / 718 tests passed (694 baseline + 24 new in
  `src/features/agents/writes.test.tsx`).
- `npm run build` — succeeds (pre-existing >500 kB chunk advisory only).

**Required tests (all green in `src/features/agents/writes.test.tsx`):**

- Assign eligibility: disconnected (`validation`), reserved (`conflict`,
  nothing commits), cross-project target for a non-member (`not-found`, no
  existence leak), already-assigned (`conflict` + owning project), draft
  target (`validation`, request-only), analyst/viewer role gates with the
  role named, cross-context specific-project write (`forbidden`), pending
  request (`conflict`, APR id named — pending approval never silently
  allocates), and the success path (assignment + audit + `agents` notice in
  one commit).
- Unassign: pool-agent validation, reserved conflict, cross-context
  forbidden with the owning project, viewer read-only + analyst role + non-
  member `not-found`, reason required, success (project cleared, group kept,
  audit + notice).
- Groups gated: viewer/analyst refusals with reasons; duplicate-name
  `conflict`; foreign project `not-found`; cross-project member refused with
  its owning project; agent in another group `conflict`; create/rename with
  membership sync; in-use removal requires the confirm reason and audits
  while the operation keeps running; membership removal edges + success.
- ChangeSet → fleet + detail refetch: legacy `A.assignAgent` flips the Query-
  backed pool-agent detail to assigned without a reload; a legacy `A.saveGroup`
  membership commit refetches the fleet (pool badge 2→1, AG-012 re-renders as
  an assigned row).
- Bridge both directions: legacy actions commit through the typed handlers and
  Query views refetch (above); the typed UI paths (fleet "Return to pool",
  AssignDrawer immediate, GroupModal create, GroupsTab unlink) publish the
  ChangeSet that the legacy store projection observes (db assertions + audit
  rows + toasts).

**Baseline adjustments (setup only, assertions unchanged):** two preflight
tests used the operator persona to run `A.assignAgent` as setup while the
legacy action was ungated; the role gate now lives at the handler (this
ticket's requirement), so those setups run the assignment as the manager
persona (`src/safety/preflight.test.tsx`, `src/features/operations/
preflight.test.tsx` — the latter via the typed transaction directly).

**Route exercised:** the `agents` (project/pool/groups tabs, GroupModal,
AssignDrawer, confirm flows) and `agent` detail routes render through
`src/screens/d.tsx` in the mounted tests with success and refusal outcomes.
Browser verification: **gap** — per AGENTS.md § Windows Temporary Process
Safety no preview server was started; route-level rendering, RBAC, bridge and
refetch behavior are covered by the mounted-screen tests above.

**Budget:** ~388 net non-test lines (272 new `writes.ts`, +58 query, +21
service, ~0 factory, +7 store, +30 screen net) across 9 touched files — one
concern (agent allocation/groups write-side), under both caps.
