# 43: Branch groups, timelines and actions

**What to build:** Migrate fanout/branch views and retry/reassign/cancel requests through scoped branch services.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Branch handlers and fanout surfaces.
**Contract:** [execution.md](../execution.md).

- [x] Groups/branches show canonical status, timeline and evidence; missing outcomes are not inferred as success.
- [x] Retry/reassign preserve approval/preflight waiting states from the source; requesting them does not silently execute a branch.
- [x] Real handlers enforce role, actor/project and eligible-agent checks; cancel requires confirmation/reason and audit.
- [x] Plan/trace links can use bridged legacy routes; this ticket does not rewrite plan or operation services.

## Evidence

Implementation (branch `wi/43-fanout`, commits 2fabb9b + 45bd3bf):

- `src/features/branches/service.ts` — feature-local branch handlers over the one
  database authority (ADR-0067). Scope-checked reads: `listBranchGroups`
  (group overview + counts + overall rollup; degraded/Partially Completed is
  never reported as Completed; missing outcomes are counted, never inferred),
  `getBranchGroup` (per-branch rows with observed agent state + replacement
  proposals + timelines), `getBranchDetail` (inspector joins: tool event,
  facets, audits, reassign candidates). Writes: `requestBranchRetry`,
  `requestBranchReassign`, `cancelBranch` — every write captures actor/project
  at call time and binds to the addressed branch's own projectId, so a
  persona/project switch never retargets it; handlers re-enforce membership
  (`not-found`, no existence leak), cross-context (`forbidden` + owning
  project), read-only context, the `run` role action, branch state and — for
  reassign — agent eligibility (exists, connected, assigned to the branch's
  project; shared pool refused). Retry/reassign only set
  `pendingRequest`/`approval: pending` and an audit row (result `Pending`);
  branch state is untouched, so approval + preflight must pass again. Cancel
  requires a non-empty reason, refuses terminal branches and writes the audit
  row in the same commit.
- `src/domain/service-factory.ts` — append-style `branches(actor, projectId)`
  wiring; reads share the factory's superseded-scope guard (cancel-on-switch),
  writes are never cancelled mid-flight.
- `src/features/branches/query.ts` — feature-local key namespace
  (`['branch-group', scope, 'list']`, `['branch', scope, 'group', id]`,
  `['branch', scope, id]`) with scope at position 1; `useBranchGroups`/
  `useBranchGroup`/`useBranch` reads and `useRetryBranch`/`useReassignBranch`/
  `useCancelBranch` mutations that capture the scope at call time.
- `src/screens/g-fanout.tsx` — execution graph, branch table, inspector
  (drawer + page) and the retry/reassign/cancel modals run on the typed
  service/Query; fan-in rollup comes from the service counts. RBAC gating with
  reasons preserved (`Gated`); retry/reassign copy still states they never
  bypass approval or preflight. All raw `location.hash`/`window.location.assign`
  writers on the surface (route-inventory items at the old lines 31/204–207 and
  the vestigial `/view=table/` read at 396) are replaced with router
  navigation (`go`); keyboard operation on the graph nodes is unchanged
  (native buttons with aria-labels). FanOutCard/AllocationView/AiTeamView keep
  their signatures and legacy seams for their consumers (tickets 39–44).

Checks (all run in `apps/web-improve`):

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — 218 warnings, 0 errors (baseline 218; no new diagnostics).
- `npm test -- --run` — 29 files, 359 tests passed (347 baseline + 12 new).
  Baseline flakiness note: `shell.test.tsx`/`routes.test.tsx`/
  `operations/write.test.tsx`/`agents/query.test.tsx` failed intermittently on
  a loaded machine before my changes and pass in isolation and in the final
  full run; no failures attributable to this ticket.
- `npm run build` — succeeds (pre-existing >500 kB chunk advisory only).
- New tests: `src/features/branches/branches.test.tsx` — retry transitions a
  failed branch into a pending approval request with an unchanged execution
  shape (operations/tool events/approvals byte-identical); retry refusal edges
  (finished branch, duplicate pending request); cancel reason/terminal rules;
  viewer read-only and analyst role refusals with reasons; reassign
  eligible-agent edges (pool/other-project/disconnected) plus the success path
  with assignment-log entry; cross-project action refused without content leak
  and non-member reads `not-found` without project/name leaks; writes bind to
  the addressed branch after a project switch; overview renders the scoped
  group with per-branch states and drawer timelines; the retry UI flow lands
  through the service and refetches the inspector; a legacy `A.cancelBranch`
  write publishes a ChangeSet and the Query-backed view refetches (legacy →
  Query bridge proof); View Trace navigates via the router (no raw hash
  writer).
- Grep evidence: no `location.hash`/`location.assign`/`history.replaceState`
  remains in `src/screens/g-fanout.tsx`.
- Browser verification: not exercised in a live preview (process-safety rule);
  recorded as a gap. Coverage of the routes is via the component tests above.

Deviations:

- Runtime budget: ~477 net non-test code lines (300 service, 98 query, ~22
  factory, ~57 screen net) against the ≤400 cap. Kept as one concern (the
  branch feature slice) and split into two commits per dispatch guidance
  rather than cutting the handler enforcement or the screen migration.
- Plan/trace links now navigate to the bridged legacy `ai-trace`/`ai-plan`
  routes via the router; their screens' own migrations stay with their
  tickets, as the ticket allows.
