# 51: Local/HITL release readiness ledger

**What to build:** Shipped local/HITL feature claims khớp exact-release evidence, known limits và operator workflow docs.
**Blocked by:** 42 — Release lifecycle.
**Priority / Profile:** P1 / Distribution + HITL-ON.
**Status:** draft-awaiting-review.

## Steps
1. Replace stale implementation-status/readiness prose with versioned profile/control acceptance ledger; local closure không chờ HITL-on nếu profile đó chưa được tuyên bố shipped.
2. Link each 13-page interaction tới owning ticket, exact revision/native test evidence and supported mode.
3. Update health/capability/UI copy to configured/reachable/exercised semantics; preserve unavailable errors.
4. Document post-bootstrap Web-only workflows, backup/update/recovery and provider scope limits.
5. Verify documentation commands/paths against current manifests and release assets; prototype/demo views clearly segregated.

## Acceptance criteria
- [ ] LOCAL-FULL claims supported by exact release tests, not historical mixed revisions; HITL-ON chỉ được claim completed sau actual T44 evidence.
- [ ] No hosted/team/Windows/beacon/interactive-shell claim inferred from local Linux gates.
- [ ] Runbook accurately distinguishes setup prerequisites from normal browser workflows.

## Test / expected result
Review readiness matrix against T40/T42 actual evidence và T44 khi tuyên bố HITL-ON supported; otherwise ghi profile đó chưa nghiệm thu. Rerun documented clean-install/core smoke. Health 200 alone cannot close any operation claim.

## Completion evidence
Versioned readiness ledger, release links, supported/unsupported control inventory and verified runbook commands.
