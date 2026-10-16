# 43: HITL mode configuration/readiness

**What to build:** Operator thấy và cấu hình supported HITL mode có effective policy snapshot; ON readiness không inferred từ approvals endpoint tồn tại.
**Blocked by:** 18 — Language, budget và runtime settings.
**Priority / Profile:** P1 / HITL-ON.
**Status:** draft-awaiting-review.

## Steps
1. Review actual HITL producer/middleware/native migration ADR và current file-backed/Web paths; chốt one effective protocol trước implementation.
2. Define supported on/off application timing, pending-action preservation and runtime readiness contract.
3. Persist trusted mode/config version, apply through owning safety slot without weakening or bypassing it.
4. Show effective run mode/approval transport readiness; changing Settings không silently release pending action.
5. Preserve explicit default OFF and tests that distinguish unsupported producer connection from no pending approvals.

## Acceptance criteria
- [ ] Effective mode agrees between Web settings and actual runtime middleware.
- [ ] ON with missing producer/decision bridge reports blocked readiness.
- [ ] Existing pending work cannot be approved by mode toggle alone.

## Test / expected result
L18 configuration half: flip mode for new lab runs, observe producer path and off regression. No fabricated approval record used as readiness proof.

## Completion evidence
Protocol/mode decision, config/run versions, readiness failures and actual producer mode observations.
