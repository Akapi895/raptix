# 49: Hosted quotas/observability/recovery drills

**What to build:** Hosted operators/admins có actual operational limits, scoped audit/alerts và tested recovery procedure.
**Blocked by:** 31 — Notifications; 46 — Membership/RBAC; 48 — Hosted durability.
**Priority / Profile:** P2 / TEAM-HOSTED; scope activation required.
**Status:** draft-awaiting-review.

## Steps
1. Define supported per-user/project concurrency/budget/rate limits and operator/admin permission boundaries.
2. Enforce limits before reserve/dispatch, surface actual refusal/queue state; no UI-only quota counters.
3. Expose redacted service/job/recovery metrics and actionable notifications tied to real operations.
4. Document and execute DB/checkpoint/artifact/key-reference backup/restore/drill with revision/schema compatibility.
5. Verify one noisy user's work does not corrupt or starve other's accepted operation semantics under agreed capacity.

## Acceptance criteria
- [ ] Limits enforced backend and display matches observed outcome.
- [ ] Audit/notifications scoped correctly; secret payload not included in metrics.
- [ ] Restore drill satisfies accepted recovery targets and replays no uncertain dispatch.

## Test / expected result
L19/L20 hosted operational portion with two users, boundary quota/concurrency values, provider outage and isolated backup restore. Alert delivery has native evidence.

## Completion evidence
Limit/role policy, actual refused/accepted IDs, redacted metrics/alerts and measured restore drill.
