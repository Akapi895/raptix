# 05: Run reconnect, lost ACK và idempotent recovery

**What to build:** Reload/retry/cancel giữ đúng operation identity; không dispatch lại vì mạng mất sau submit.
**Blocked by:** 04 — Planning Q&A và effective waiting status.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Trace client request-ID lifetime và existing ledger/reconcile path cho thread/run/resume; tìm đoạn tạo fresh identity khi retry uncertain.
2. Retain pending intent/identity across reconnect theo accepted storage policy; scope state theo engagement/thread.
3. Recover by ledger/native inspection before enabling retry; distinguish rejected, accepted, uncertain and terminal.
4. Handle transport/SSE cursor loss, late ACK after route switch, cancel races và duplicate user clicks.
5. Surface Recovery/Reconcile UI with actual errors; never auto-replay unknown dispatch as new work.

## Acceptance criteria
- [ ] Same identity/same intent recovers same request/run; changed intent conflicts.
- [ ] Reload/network loss không thêm thread/run/resume dispatch.
- [ ] Cancel settles actual state; late ACK không hijack another project.

## Test / expected result
L04 with cut connection at reserve/dispatch/ACK boundaries; B-lane deterministic fault server. Count real native operations, not POST attempts. Unknown outcomes retain active ownership until authoritative reconciliation.

## Completion evidence
Request/native ID mapping, before/after dispatch counts, race/fault results and browser recovery trace.
