# 47: HTTP/stream/artifact cross-user isolation

**What to build:** Team identity/permissions áp dụng nhất quán tới event streams, checkpoints, exports, evidence và providers, kể cả sau revocation.
**Blocked by:** 06 — Durable tool replay; 46 — Membership/RBAC.
**Priority / Profile:** P2 / TEAM-HOSTED; scope activation required.
**Status:** draft-awaiting-review.

## Steps
1. Inventory all public read/mutation/download/stream/probe/provider paths and durable event cursors.
2. Apply effective membership/permission checks before dispatch and replay, scope retained event/artifact lookup.
3. Define revocation policy for already-open streams/download tokens; revalidate/terminate where contract requires.
4. Ensure cached UI/query/history state evicts on identity/project switch and late ACK does not cross principals.
5. Verify private graph fields/secret DTOs remain withheld under team access; preserve source identity without leakage.

## Acceptance criteria
- [ ] Foreign user cannot access event cursor/artifact/report/Vault/provider request by guessed ID.
- [ ] Revoked member loses stream/subsequent operation access under explicit policy.
- [ ] Auth switch does not retain another user's private records in UI.

## Test / expected result
L19 complete transport matrix with two browsers and open stream/download during revocation. Negative cursor/foreign ID tests fail before fix and pass deny behavior afterward.

## Completion evidence
Transport inventory, revocation timing/policy, actual denied/terminated responses and browser cache-isolation trace.
