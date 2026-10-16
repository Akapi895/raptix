# 50: TEAM-HOSTED full-stack acceptance

**What to build:** Team product operates all chosen workflows through real identities, native providers và crash-durable deployment.
**Blocked by:** 40 — LOCAL-FULL; 44 — Native HITL; 46 — RBAC; 47 — Transport isolation; 48 — Durability; 49 — Hosted operations.
**Priority / Profile:** P2 / TEAM-HOSTED; scope activation required.
**Status:** draft-awaiting-review.

## Steps
1. Freeze hosted candidate auth/provider/runtime/images/schema/config and permission/recovery matrix.
2. Execute local full workflows under at least two real team identities and role permutations.
3. Run L19 and hosted L20, HITL-on cases and revocation while stream/provider/report work is active.
4. Verify downloads/native operations/audit contain only authorized retained records after crashes/restores.
5. Record unmet platform/provider/capacity claims as explicit gaps, not inherited historical lab pass.

## Acceptance criteria
- [ ] All chosen team workflows pass actual UI/API/provider/auth stack.
- [ ] Cross-user denial/revocation/crash recovery meet accepted matrices.
- [ ] No unexplained failing required gate or fixture-only provider/auth evidence.

## Test / expected result
L01–L20 applicable to TEAM deployment; compare original request/native IDs and source report/evidence after crash. Hosted acceptance cannot use local operator identity for both users.

## Completion evidence
Exact candidate matrix, two-user/browser/native fault traces, artifact/audit identities and cleanup results.
