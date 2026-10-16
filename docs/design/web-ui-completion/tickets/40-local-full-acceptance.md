# 40: Complete 13-page LOCAL-FULL acceptance

**What to build:** Chứng minh mọi local supported workflow hoạt động trên cùng deployment/revision, không gom bằng chứng từ các bản build khác nhau.
**Blocked by:** 11,13,14,18,19,20,21,24,25,28,29,30,31,32,33,35,36,37,38,39 — toàn bộ local workflows/bootstrap.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Freeze candidate revision/image/config/migration identities and final 13-page control matrix.
2. Run deterministic, mock/real-fixture regression and browser live local procedures L01–L17.
3. Execute error, reload, provider native replay/restart and retention scenarios on dedicated resources.
4. Verify findings/reports consume real generated/analyst evidence, downloads parse and provider states agree natively.
5. Record blockers without hiding failures; rerun affected gate after fix, not whole suite indefinitely without reason.

## Acceptance criteria
- [ ] Every LOCAL-FULL control has success/failure/persistence evidence.
- [ ] No required native provider gate skipped or replaced by fixtures.
- [ ] No manual file/env repair required during normal post-bootstrap business flow.

## Test / expected result
All local TEST-PLAN procedures and UI matrix pass on exact candidate. This ticket excludes hosted claims and HITL-on claim unless T44 evidence also supplied.

## Completion evidence
Revision-frozen acceptance matrix, commands/exit codes, live traces/native IDs/artifact digests and cleanup report.
