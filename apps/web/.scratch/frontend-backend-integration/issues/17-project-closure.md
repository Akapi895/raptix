# 17: Enforce real engagement closure

**What to build:** An authorized user requests engagement closure only when actual
operation, session, finding, report and approval state satisfies the checklist,
and an independent permitted actor confirms or refuses that request.

**Blocked by:** 09 (operation lifecycle), 11 (reports), 12 (C2 sessions/grants).
**Status:** complete (2026-10-15)
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Closure checklist reads authoritative operation/stop, provider session,
  finding disposition, report delivery and outstanding approval state. Unknown
  outcomes are not treated as closed or stopped.
  (`ClosureService.checklist` reads `webRequestLedger` in-flight holds,
  unresolved `emergencyStop` outcomes, live approved `c2Grant` rows (with the
  server-owned expiry sweep first), findings left in `review`, undelivered
  `reportRecord` rows and the workspace approval service; every source error
  becomes `unavailable`, which blocks — never passes.)
- [x] Request/confirm/reject actions are persisted, scoped and audited with reason,
  version and trusted actor. Independent confirmation is enforced according to
  the identity scope approved in 01/implemented by 07.
  (`EngagementClosure` row per engagement; request needs operator+ and a
  reason; confirm/reject need reviewer+ via `requireEngagementAccess` and
  `requireIndependentActor` against the persisted requester; cancel is the
  requester's withdrawal only; every transition writes a `closure.*` audit
  row and a durable notice.)
- [x] The server rechecks prerequisites atomically or through the approved
  concurrency boundary at the final transition; a new run/session or unresolved
  approval cannot slip through a stale checklist.
  (`decide('confirmed')` recomputes the full checklist through the transaction
  client inside the same `$transaction` that flips the status to `closed`; a
  ledger row inserted after the request fails the confirm with
  "no longer satisfied".)
- [x] Closed/cancelled read-only semantics are enforced by relevant mutation/
  execution entrypoints, not only the project-detail UI. Refresh retains the
  authoritative closure state and its decision history.
  (`assertEngagementOpen` refuses 409 at: run execution via the
  `RuntimeContextService.resolve` gate (every create-thread/submit/resume),
  C2 grant request AND the dispatch command gate, scope submit/import/
  classify, plan save/propose/bind, finding create/import/update/transition/
  evidence, report create/update/review/deliver, vault create/reveal (revoke
  stays allowed) and member invite. GET /closure re-reads the persisted row.)
- [x] Unsupported closure dependencies remain explicit blockers. A local-only
  identity cannot manufacture an independent reviewer to satisfy the checklist.
  (A missing approval service is a checklist `unavailable` blocker with its
  reason; the confirm refuses the requesting actor even in single-user local
  mode because `requireIndependentActor` compares persisted actor ids.)

## Verification (selected per ticket)

- `apps/web/server/tests/t17-closure.test.ts` (3 tests): the blocked request
  names each failing authoritative source (estop/c2/findings/reports) and
  creates no record, with unreadable and absent approval services blocking as
  `unavailable`; the permitted path persists request → same-actor confirm
  refused → independent confirm with a mid-flight ledger row failing the
  atomic recheck → closed state survives re-read and refuses a second request,
  with `closure.requested`/`closure.confirmed` projected in the audit view;
  post-close representative mutations from the C2/scope/finding/report/vault
  entrypoints answer 409 "closed and read-only" while reads still work, and
  the cancel → re-request → reject cycle keeps the engagement open.
- `apps/web/src/real/screens/closure-panel.test.tsx` (3 tests): the blocked
  refusal surfaces the server message, the pending request renders its
  checklist and decision actions, and the closed state renders read-only
  without mutation controls.
- Existing tickets' suites still pass unmodified (327 server tests): the
  post-close gate tolerates only closure-store-less legacy fakes, never a
  live deployment.
- `npm run typecheck/lint --workspace=@raptix/web-raptix(-server)` clean;
  web real suite 19 files / 105 tests.

## Named gap

- No live runtime round-trip was exercised (no running LangGraph runtime in
  this environment); the execution gate is verified through the same
  `RuntimeContextService.resolve` choke point the runtime tests use, with the
  live probe belonging to ticket 18's deployment verification.
