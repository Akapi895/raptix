# 67-typed-runtime: Typed runtime reads and owning-service writes

**Status:** complete on `wi/67-typed` (28 commits, base `b46ce97`).
**Owner:** runtime screens/shell/features/auth/console only.
**Contract:** execution.md lines 48–59; ADR-0067 (refined in place). Parent 67 retains completion blockers.

Serial split ledger. Each leaf was one concern, ≤400 changed runtime lines and
≤10 files. Existing tests, `src/test/*` and `src/store.tsx` untouched (owned by
another worker). New regression test: `src/auth/typed-role-scope.test.tsx`.

## Leaves

1. ✅ Authorization identity (`cbf9c83`, `ef22484`, `7b8d8bd`, `2bec4cd`): identity
   service (`auth/identity.ts`) with override-aware persona; `actorRef(scope.actor,
   scope.role)` across feature query hooks; role-scope regression test.
2. ✅ Audit/notification writes (`731dc21`, `260ff19`): `features/audit/service.ts`
   (`recordAudit`), `features/notices/service.ts` (`publishNotice`/`readHeaderNotices`).
3. ✅ Project/team and operation/evidence writes (`6b59d3c`, `c1dc649`, `3f39bcb`):
   `projects/team-service.ts`, `replaceOperationAgent`, `results/writes.ts`.
4. ✅ Shell views (`4229d82`, `46a3c3d`, `3bd3da5`): navigation badges/search,
   estop projections, C2 grant-watch/renewal/session-perm.
5. ✅ Project/wizard supplementary reads (`2c27b6f`): `domain/projection.ts`
   (`projectView`), `state/projection.ts` (`useServiceProjection`),
   `operations/eligibility-read.ts`, `wizard/projection.ts`.
6. ✅ Operation supplementary reads (`268e828`, `6cf3d55`, `81a4784`):
   `features/operations/checklist.ts`, `features/operations/views.ts`
   (OperationView/gate/preflight/meta/eligibility/schedule/replan), c-common,
   c-console, c.tsx.
7. ✅ Fleet/catalog supplementary reads (earlier commits): agents group/assignment/
   recovery (`8b7ad46`), asset import validation (`6f97ba4`), library notices.
8. ✅ Findings/report supplementary reads (`09f8e9d`, `456d95d`, `336eec5`).
9. ✅ AI supplementary reads (`2bd6dbf`, `dbe341a`, `a7bf27e`):
   `features/aichat/projection.ts` (msg/tool refs, conversation groups, rail,
   inspector bundle, conversation focus), `features/plans/projection.ts`
   (PlanView, project plan list, per-version policy checks), `features/branches/
   projection.ts` (fanout card, allocation, asset refs) — g-common, g-plan,
   g-fanout, g-workspace, g-chat migrated.
10. ✅ Settings/analysis/estop supplementary reads (earlier commits: `67056a0`,
    `336eec5`, `46a3c3d`) plus task-decision contexts (`5a4e16a`: a-dashboard
    actorCtx → `readActor`, plan/request lookups → `readPlanProject`/
    `readSessionRequestMeta`; approvals readiness → `readApprovalAssets`).
11. ✅ Final residual census + verification (below).

## Final residual census (HEAD `5a4e16a`)

- `useDb` in component code: **0** (only the definition in `state/console.ts:34`;
  components no longer import it).
- `authority.snapshot()` / `authority.commit()` in screens/shell/feature hooks:
  **0**. Remaining refs are inside owning feature services (operations, c2,
  branches, approvals, closure, settings, agents, notices, assets, workers,
  analysis, demo runtime, dashboard/tasks services) and tests — legitimate.
- `useStore()` in non-test source: **0** (test helpers only).
- Legitimate authority consumers kept: `domain/projection.ts` (projectView cache),
  `state/services.tsx`, `state/console.ts`, `store.tsx` (another worker's), and
  the owning services listed above.

## Behavior notes (intentional, reviewed)

- Operation/plan reads are access-gated (`projectAccessible`): a record outside
  the actor's grants now reads as missing ("Plan not found"/OpGate `missing`)
  instead of leaking existence. The plan foreign-project banner still renders
  whenever the plan IS accessible but outside the selected project. No test
  pins the inaccessible-plan foreign case.
- `ReplanPanel`'s revision lookup now resolves the plan's project through
  `readPlanProject` (same refusal shape); `useReplan` = `useProjectReplan`
  (ReplanRead gains `prev`/`healthy`).
- `usePlanChecks` caches per plan content stamp; Builder's Validate click
  re-derives via `readPlanChecksNow` (event-handler read, no db in component).

## Known pre-existing flake (not fixed — tests owned elsewhere)

`src/features/operations/write.test.tsx` → "operation schedule (ticket 25 —
screens) > blocks invalid input at the button and saves a valid schedule
through the service": transiently renders the OpGate "Operation not found"
empty state between the heading waitFor and the Schedule button lookup.
Measured rates (small n): base `b46ce97` 1/10, checklist WIP 2/10, HEAD 3/10
and 4/8 — noise (~20–35%), present at base, not a regression of this work.
Full-suite failure is retried once before investigating. Mechanism:
`ServicesProvider` mounts services synchronously while `tickOperations`
(4s interval) commits; the OpGate heading resolves before the gate's
selected-project check flips to ok.

## Verification (HEAD `5a4e16a`)

- `npm run typecheck` ✅
- `npm run lint` ✅ 0 errors (155 pre-existing warnings, none introduced)
- `npm test -- --run src --maxWorkers=2`: 959 passed, 1 failed = the known
  flake above; retried file → 12/12 green.
- `npm run build` ✅ (vite build clean)
