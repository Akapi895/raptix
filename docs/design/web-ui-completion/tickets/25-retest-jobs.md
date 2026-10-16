# 25: Controlled retest job through Web

**What to build:** Operator yêu cầu retest scoped từ finding và nhận actual verification output/job state qua Web.
**Blocked by:** 03 — Handoff; 05 — Run recovery; 24 — Finding workflow.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define typed retest intent from existing runtime/capability interfaces; Proposed ADR if new job boundary needed.
2. Validate owned finding/target, current confirmed plan and allowed action; persist request identity before dispatch.
3. Start actual runtime verification work and retain outcome/evidence reference; reuse uncertain/recovery behavior.
4. Show job detail/progress/cancel/outputs and explicit criteria for verified/contradicted/inconclusive result.
5. Apply eligible finding transition only after observed verification, preserving review/audit and prior evidence.

## Acceptance criteria
- [ ] Double-click/replay produces one actual job/dispatch.
- [ ] Timeout/error/inconclusive output never automatically verifies a claim.
- [ ] Unconfirmed/stale/out-of-scope intent denied; retained output survives reload.

## Test / expected result
L12 actual benign lab verification for success/contradiction/nonzero/timeout/interruption. Corroboration uses real producer lineage, not two copies of same capture.

## Completion evidence
Request/job/run IDs, accepted plan revision, actual captures/verification records and transition outcomes.
