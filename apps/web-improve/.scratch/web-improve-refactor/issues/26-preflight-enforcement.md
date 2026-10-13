# 26: Eight preflight checks and execution eligibility

**What to build:** Extract deterministic preflight policy and make real preflight/start eligibility use it, including the source's missing time-window enforcement and validity checks for required plan approvals.
**Blocked by:** 25, 21.
**Status:** resolved
**Owner:** Operation preflight/eligibility domain interface.
**Contract:** [execution.md](../execution.md).

- [x] Preserve the eight source check identities; each failure has an observable reason/fix link and cannot pass the execution gate.
- [x] Project/ROE/target/playbook/agent/required-approval/contact checks validate current canonical records, including cross-project or missing IDs.
- [x] Time-window tests cover allowed time and before/after boundaries in project timezone; manual planless operations remain allowed only where documented policy permits.
- [x] Linked plan approval is rejected at its recorded deadline; 39 owns assigning a new 24h deadline. Real policy tests and rendered preflight integration are separate.

## Evidence

**Policy** (`src/features/operations/preflight.ts`, new — pure, React-free domain module): the
eight canonical check identities (PRE-01..PRE-08) are re-derived from canonical records at a
calling instant (`computePreflightChecks(db, op, now)` + `preflightPass`). Every failure carries a
reason and a fix link, and no `fail`/`review` state can pass the execution gate. Real enforcement
replaces the ledger placeholders:

- **G-1 (PRE-04)** — real time-window gate: the operation's scheduled start (`scheduleAt`
  absolute instant, or the ticket-25 `schedule` projection via `scheduleInstantOf`) is checked
  against the ROE window rule (`roeWindowIssue`, Mon–Fri 9:00–17:00 Asia/Ho_Chi_Minh); a manual
  start evaluates the request instant. Boundaries: 08:59 fail / 09:00 pass / 16:59 pass / 17:00
  fail; Saturday fails; a scheduled start `<= now` fails with a Reschedule fix link
  (`#/operation-schedule/<id>`).
- **G-2 (PRE-07)** — required-plan gate: a plan-linked operation needs the plan `approved`/`executed`;
  `in_review`/`proposed` block as `review` (baseline OP-015 expectation preserved), and
  `rejected`/`expired`/`superseded`/missing plan records fail with an explicit reason. Planless
  manual operations stay allowed under policy (baseline message kept), pending only while another
  plan-type approval is open on the project.
- **Canonical record validation** — a missing project fails PRE-01 instead of crashing on the old
  non-null assertion; assets from another project fail PRE-03 (`Targets belong to another project`);
  asset/agent IDs missing from the inventory fail PRE-03/PRE-06; PRE-02/04/08 degrade fail-closed
  when the project record is gone.

The schedule/window helpers (`PROJECT_TZ_OFFSET_MS`, `scheduleInstantOf`, `scheduleLabelOf`,
`roeWindowIssue`) moved here from `service.ts`, which re-exports them so established `./service`
import sites (screens, ticket-25 tests) keep one surface.

**Execution eligibility** — `eligibility`/`EligKind`/`Reason`/`projectAgentsOnline` moved to the
same pure module; the store exports delegate. The per-row labels ticket 24 left documented are now
projected by the typed list read (`OperationListItem.eligibility = { kind, label }`, derived in
`listOperations` from canonical state); `c.tsx` renders the read's label instead of the legacy
store helper.

**Handlers** (`src/features/operations/service.ts`, appended): `operationDetail` (scope-checked
canonical bundle — op with steps, project, plan + label, playbook, plan-linked conversation,
branch groups, eligibility; non-member reads are `not-found` with no entity leak, a member reading
from a foreign specific project is pointed back via the failure entity), `runOperationPreflight`
(role/read-only/in-flight gates, checks RE-DERIVED from canonical state at the handler, atomic
commit of `preflightAt` + ready/draft + `Ran preflight` audit row — legacy result values kept —
published as one ChangeSet), and `operationStartGate` (the execution gate: re-derives the checks
and refuses with the first failing check's code/detail/fix; the start *transition* itself stays
with ticket 27). All wired into `OperationService` behind the factory's superseded-scope guard.

**Bridge** (one implementation, both entry points):

- `store.tsx` `computePreflight`/`eligibility` delegate to the feature policy with the legacy
  wall-clock instant; `A.confirmPreflight` and `A.startOp` delegate to
  `runOperationPreflight`/`operationStartGate` (the start mutation stays legacy for 27). The
  baseline invariants (`safety/preflight.test.tsx`, `safety/isolation.test.tsx` — including the
  scope-revision "waiting for re-approval" refusal) stay green unchanged.
- Both directions proven on the real screens: a legacy `A.confirmPreflight` refetches the typed
  detail read (Draft → Ready without reload), and a typed `runOperationPreflight` is observed by
  the legacy store projection (test: "bridge: a legacy preflight run reaches the typed detail
  read; a typed run reaches the legacy store").

**Screens** (`src/screens/c.tsx`): the detail route reads the canonical bundle through
`useOperationDetail` (key `['operation', scope, 'detail', id]` — scope-embedded so persona/project
switches never collide) with skeleton/denial/switch states and the handler's safe messages; tabs
and the live console keep receiving the same canonical `op` (their internal reads belong to
owners 27/29/30). `PreflightPage`'s run goes through `useRunPreflight` — refusals surface the
typed reason; the snapshot it records is re-derived display state, and the authoritative gate is
the handler re-derivation (a stale snapshot can never admit a start). List rows render the
canonical eligibility label.

**Re-derivation proof** (test: "re-derives after a scope revision"): handler preflight run →
Ready; `reviseScopeTransaction` (ticket 21) invalidates at submission → Draft with `preflightAt`
cleared; `operationStartGate` refuses naming PRE-02; a fresh preflight run still fails
("waiting for re-approval") until the ROE is re-approved. Delayed-response isolation: a gated
aggregate-scope detail read superseded by a persona switch never pollutes the switched view, and
the stale cache entry stays undefined (test mirrors ticket 24's pattern).

**Tests** (`src/features/operations/preflight.test.tsx`, 20): PRE-04 window pass/boundaries/past/
manual-outside with fix links; PRE-07 review/rejected/expired/missing/approved/pending-other;
cross-project and missing asset/agent/project validation; eligibility labels (project + list
rows); run-preflight atomic pass/fail commits + audit + ChangeSet; run/start-gate refusals
(viewer/analyst/non-member/in-flight) committing nothing; scope-revision re-derivation; start
gate ok/refused; detail read bundle + no-leak denials; screen bridge both directions; row
eligibility label; superseded-scope isolation.

**Checks** (in `apps/web-improve`):

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors (0 new) |
| `npm run lint` | 204 warnings / 0 errors — identical to the integration base; touched files carry exactly their baseline counts (`service.ts` 1, `c.tsx` 11, `store.tsx` 27), new files contribute 0 |
| `npm test -- --run` | 658 passed (638 baseline + 20 new), 46 files. Note: with default worker parallelism in this worktree environment the suite intermittently starves (`Test timed out in 5000ms` across unrelated files); `--maxWorkers=2` is green and the failures reproduce on the untouched base — environment, not code |
| `npm run build` | success |

**Budget:** new runtime file 131 (preflight.ts, non-blank/non-comment) + net diffs
`query.ts` +43, `service.ts` +121, `c.tsx` +35, `store.tsx` −47 ≈ **283 net runtime lines** (≤400);
6 touched files (≤10); one concern.

**Gaps / deviations:**

- Browser verification of the real routes (success/refusal outcomes at 768/1024/1280/1440) was
  not run — preview HTTP lifecycle checks are optional per AGENTS.md § Windows Temporary Process
  Safety and were skipped rather than risk an unbounded server. Screen behavior is covered by the
  mounted-screen tests; recorded as a gap, not a pass.
- The PreflightPage's rendered refusal path is only reachable when the disabled-button gate
  already blocks the click (defense in depth); refusal reasons are asserted at the handler level,
  and the wizard/schedule screens keep their existing rendered-refusal coverage.
- `estop` behavior untouched (owned by 28; the emergency-stop suite stays green unmodified).
- The start *transition* (session creation, agent reservation, plan execution) remains the legacy
  `A.startOp` mutation, gated by the new handler — ticket 27 owns the control-transition handlers.
