# 67-test-migration: Final-interface regression harness

**Status:** in-progress; parent 67 retains its outgoing blockers.
**Owner:** `wi/67-tests`, base `b46ce97`; all existing tests, test helpers,
test-only fixtures and bounded deletion of `src/store.tsx`.
**Contract:** ../execution.md; ../spec.md; ADR-0067.

## Split leaves

- T1: canonical services/Query harness and read-only feature suites.
- T2: feature transaction integration/refetch suites, in batches of at most
  nine test files plus evidence.
- T3: safety, auth/router, shell and audit suites on final interfaces.
- T4: replace bridge-duality suites with observable integration, isolation,
  notification, reset and teardown assertions.
- T5: delete zero-caller Store sections in commits of at most 400 runtime
  changed lines and ten files; no relocated Store or compatibility action bag.
- T6: full typecheck/lint/test (`--maxWorkers=2`)/build, residual census and
  evidence. Parent completion awaits concurrent generic-read migration.

Each leaf may have multiple bounded commits. Tests do not count toward the
runtime-line budget; file caps still apply. Runtime screens/features/state
are owned by the concurrent worker and are outside this branch's edits.

## Baseline

- `npm install` in `apps/web-improve`: exit 0, 256 packages installed,
  audit reports zero vulnerabilities.
- `src/store.tsx`: 762 lines; runtime contraction evidence is in
  `67-final-runtime.md` and parent 67. Existing tests still import the bridge.
- Verification and exact final counts will be appended after execution.

## T1/T2 first batches

- Canonical `mountServices` mounts ServicesProvider + ConsoleProviders and
  exposes explicit services, Query client, authority snapshots and persona
  selection; it has no action compatibility bag. The old helper remains only
  for bounded continuation batches.
- Workers/results/attack-path/operation-write suites: 45 tests pass, focused
  exit 0; typecheck exit 0. Removed an unused worker persona fixture.
- Coverage/evidence/session-detail/copilot: 46 tests pass, focused exit 0.
- Asset catalog/branches: 33 tests pass, focused exit 0. Branch cancellation
  now invokes the final service, checks acceptance and preserves refetch.
- Accessibility/dark/responsive route audits: 21 tests pass, focused exit 0.
- The nine files in the second batch lint with zero diagnostics; typecheck
  exit 0 after the six feature migrations. No runtime files edited.

## T3/T4 state and safety batch

- Router epoch isolation now captures the actual navigation epoch. State
  suites assert real selector subscription updates, save-callback clearing,
  ordered toasts, DOM theme effects, chat busy/log events and remount reset.
- Console assertions pin seeded policy outcomes and committed identity-role
  overrides rather than comparing two compatibility projections.
- RBAC retains all 6 × 19 decisions and membership/context boundaries through
  canonical policy functions. Emergency-stop retains every delayed outcome,
  scope and no-auto-resume assertion through the actual demo runtime.
- Focused state/router run: 36 passed, one failed from an incorrect new
  literal membership list; corrected against the seeded six-project fixture.
  Console/UI/system rerun: 45 passed. Safety/RBAC: 17 passed. Earlier session,
  shared-store and router cases passed (30 tests).
- Typecheck exit 0; all nine touched code files lint with zero diagnostics.

## T2 plan/library/fleet/trace and Query batch

- Plan compare/history, fleet, library and operations inventory: 70 tests
  pass (five files), typecheck exit 0, zero touched-file lint diagnostics.
- Trace/HITL/domain authority: 41 tests pass (three files), typecheck exit 0.
  Removed the existing unused `seed` import in the HITL suite.
- Query teardown migration exposed a harness ordering regression: six tests
  pass, teardown test fails (`offs.length` 0, expected 1). The harness mounted
  Query bridges before mounting the observing test component, preventing its
  subscribe instrumentation from observing attachment. The next bounded
  helper fix restores initial child mounting before effects; the teardown
  assertion remains intact. This is test setup, not a runtime change.

Harness ordering fix: Query teardown rerun 7/7, exit 0; full
`npm run test -- --maxWorkers=2`: 959 tests / 74 files, exit 0 (85.60s).
Typecheck exit 0; helper and Query suite lint clean. Full output retains the
existing Vite config-loader warning and two jsdom document-navigation notices.

## T2 finding/report/C2/allocation batch

- Nine test files migrated: finding inventory/writes, agent writes, playbook
  review, report catalog/editor/review, C2 overview and session command UI.
- Finding migration first failed because the final transaction correctly
  refuses AI-suggested → review and drafts without evidence. Tests now assert
  both refusals, import through the actual suggestion transaction, upload
  human verification evidence, then submit through the final transition.
  All original review/refetch assertions remain; focused finding run 40/40.
- C2/allocation: 45/45 passed during the four-file run. Playbook/report
  catalog/editor: 45/45 passed during the five-file run. Report-review and
  session-console final rerun: 26/26, exit 0; delivery actor remains Alex
  with independent report approval by Pat.
- Typecheck exit 0, all nine touched tests lint with zero diagnostics.

## T2 auth/estop/grant + approval/notice batches

- Committed 376dd28: harness accepts ComponentType | ReactNode UI; auth
  probes, estop service/ui and safety grants/closure-facets migrated to
  mountServices + demo runtime + final transactions. 63 tests pass (five
  files); typecheck exit 0; all six touched files lint clean. Gated screen
  controls (aria-disabled wrapper) are asserted through the mounted UI plus
  the direct handler refusal.
- Committed e77a52e: safety isolation/preflight, notices service, approvals
  service (four-eyes confirmState asserted on useSessionStore). 26 tests
  pass (four files); typecheck exit 0; lint clean on all four.

## T2 operations/assets/grants batch (Batch C)

- Operations lifecycle/preflight/workspace and asset writes migrated:
  65 tests pass (five files, including c2 grants with the legacy-action
  bridge proof restated through the final request transaction). Workspace
  persona bug fixed (mountServices takes the persona as its second argument);
  the workspace viewer case now asserts the Gated read-only control plus the
  direct orbidden handler refusal; pending-asset selection is asserted as
  an upfront draft-creation refusal followed by success after approval.
- Typecheck exit 0; all five touched test files lint with zero diagnostics.

## T2 closure/plan batch (Batch D)

- closure/service.test.tsx migrated: the completion-percentage probe now
  folds the canonical snapshot; the console/governance cases mount
  CloseTab/TeamTab through useDb/useMe and assert the four-eyes
  confirm dialog via useSessionStore; the bridge case restates the legacy
  store observation as the canonical snapshot (typed request observed by
  the authority, direct confirmation closes the project). 15/15 pass.
- plans/bridge.test.tsx migrated: console-entry and idempotence cases run
  createOperationFromPlanTransaction; MyTasks/console refetch proof runs
  through the hash router inside mountServices; selectProject replaces
  setPid. 7/7 pass.
- plans/service.test.tsx migrated: the approval-expiry execution gate is
  asserted through createOperationFromPlanTransaction (returns the pinned
  OP-014 before the deadline, refuses with ailure.message containing
  expired at/after it); the admin decision runs through plans.decide with
  an explicit Dana actor. 11/11 pass (33 across the three-file run).
- Typecheck exit 0; all three touched files lint with zero diagnostics.

## T2 router/screens inbox batch (Batch E)

- router/routes.test.tsx migrated: mountApp is mountServices +
  esetNavStores + setActiveRouter with a bare RouteHost; authed,
  pid, dirty and route reads use the auth/project/session stores and
  currentRoute; the single-writer closure test drops its store.tsx
  carve-out ahead of the deletion. 12/12 pass.
- screens/tasks and screens/dashboard migrated: PendingProbe stays in the
  router tree; persona/project switches use the auth store and
  selectProject; the inbox approval cases run
  equestPlanReviewTransaction (Taylor: the typed boundary correctly
  refuses reviewer-initiated review requests, so the persona restates to a
  plan-capable member � the countdown assertions are unchanged) and
  submitApprovalTransaction; dashboard creation runs
  createProjectTransaction and reselects the created project (the legacy
  action's setPid is restated explicitly). 23/23 and 20/20 pass
  (55 across the three-file run).
- Typecheck exit 0; all three touched files lint with zero diagnostics.
