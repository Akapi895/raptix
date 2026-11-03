# 02: Canonical workspace cho planning và tools

**What to build:** File agent ghi và file validator/Web đọc là cùng tài liệu của engagement, không cần copy sang một thư mục plan khác.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Trace trusted workspace from project binding qua runtime configurable, filesystem tools, sandbox backend và planning validator; reproduce mismatch hiện tại.
2. Review pinned mount/shared-dev modes và ADR workspace status. Nếu cần thay public boundary, viết Proposed ADR trước code.
3. Chốt một normalization rule: pinned root dùng root một lần; shared mode nối engagement slug một lần; request/model input không chọn root.
4. Propagate same trusted context vào nested/subagent tool calls; align API đọc canonical storage qua owning interface.
5. Expose actionable binding/path-identity error và read-only readiness diagnostics, không lộ host secret paths.

## Acceptance criteria
- [ ] Marker/document hash match tại runtime, sandbox, validator và Web read.
- [ ] Tám docs do planner ghi validate được mà không manual filesystem repair.
- [ ] Foreign engagement, symlink escape và false isolated declarations vẫn bị từ chối theo policy.

## Test / expected result
L01/L07: real planner write → validator read. Exercise pinned and supported shared-dev modes. Negative double-slug/mismatched mount case fails explicitly; corrected binding passes, không weakening RoE/container isolation.

## Completion evidence
Trusted topology, sanitized binding identity, document digests và live validation trace.
