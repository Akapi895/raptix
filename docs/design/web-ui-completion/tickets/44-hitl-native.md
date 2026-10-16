# 44: Native HITL allow/deny/recovery

**What to build:** Actual runtime producer chờ approval; operator allow/deny từ Web điều khiển pending action một lần, survive reload/recreate.
**Blocked by:** 11 — Core live acceptance; 43 — HITL mode/readiness.
**Priority / Profile:** P1 / HITL-ON.
**Status:** draft-awaiting-review.

## Steps
1. Run owned lab action that triggers real producer policy; map approval request to tool/action/thread/run identity.
2. Wire actual decision protocol consumption and post-decision native resume; UI ACK separate from observed execution result.
3. Complete allow/deny/pending/expired/conflict/recovery states with identity guard and audit.
4. Reconcile lost decision ACK, duplicate/stale/foreign decision và recreated runtime/checkpoint.
5. Compare denied action not executed, allowed authorized action executed once, plus HITL-off supported regression.

## Acceptance criteria
- [ ] Pending action waits; deny prevents it, allow permits authorized work once.
- [ ] Reload/recreate retains approval and no duplicate/replayed decision bypass.
- [ ] Approval target/action info matches actual producer; foreign/stale request refused.

## Test / expected result
L18 with native producer, observable lab action marker and real audit. Test runner never writes approval to simulate a producer and call it live acceptance.

## Completion evidence
Producer/approval/decision/run IDs, executed/not-executed observation, replay/recreate results and OFF regression.
