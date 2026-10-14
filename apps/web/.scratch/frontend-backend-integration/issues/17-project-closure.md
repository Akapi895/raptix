# 17: Enforce real engagement closure

**What to build:** An authorized user requests engagement closure only when actual
operation, session, finding, report and approval state satisfies the checklist,
and an independent permitted actor confirms or refuses that request.

**Blocked by:** 09 (operation lifecycle), 11 (reports), 12 (C2 sessions/grants).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Closure checklist reads authoritative operation/stop, provider session,
  finding disposition, report delivery and outstanding approval state. Unknown
  outcomes are not treated as closed or stopped.
- [ ] Request/confirm/reject actions are persisted, scoped and audited with reason,
  version and trusted actor. Independent confirmation is enforced according to
  the identity scope approved in 01/implemented by 07.
- [ ] The server rechecks prerequisites atomically or through the approved
  concurrency boundary at the final transition; a new run/session or unresolved
  approval cannot slip through a stale checklist.
- [ ] Closed/cancelled read-only semantics are enforced by relevant mutation/
  execution entrypoints, not only the project-detail UI. Refresh retains the
  authoritative closure state and its decision history.
- [ ] Unsupported closure dependencies remain explicit blockers. A local-only
  identity cannot manufacture an independent reviewer to satisfy the checklist.

## Verification selection

Select closure/recheck/concurrency and changed project-close UI tests. Exercise
one blocked checklist and one permitted decision path, then attempt a relevant
post-close mutation/run. Reuse completed operation/report/C2 tests; use bounded
real prerequisites rather than rerunning their full suites. No full suite.

## Scope boundary

Closure is not engagement DELETE, export success or frontend status editing.
Deletion/retention semantics remain under their approved owning contracts.
