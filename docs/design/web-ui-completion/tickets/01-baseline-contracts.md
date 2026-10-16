# 01: Baseline contracts và regression lane

**What to build:** Có một baseline exact-revision đáng tin để phân biệt regression UI/API với dependency/provider chưa cấu hình.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Record HEAD/dirty-tree, dependency versions, generated contracts/Prisma state và test topology.
2. Rerun deterministic gates và real-mode fixture lane; phân loại từng failure theo brief/handoff DTO, fixture stale, actual bug hoặc environment.
3. Update fixture producers/callers theo contract đã chốt; giữ validator strict, không thêm optional defaults để che drift.
4. Reproduce actual bugs bằng regression test; sửa trong slice sở hữu, không xóa/skip test failing để làm baseline xanh.
5. Verify UI/API smoke với project DTO thật và failure response; lưu baseline inventory và mapping sang tickets còn lại.

## Acceptance criteria
- [ ] Fresh build/typecheck/unit/mock-browser/real-fixture commands có kết quả và exit code rõ.
- [ ] Mọi required fixture regression pass; unexplained failures phải có owner và block gate tương ứng.
- [ ] Không gọi API fixture lane là native full-stack acceptance.

## Test / expected result
Run TEST-PLAN §3 lanes A–C, positive/negative DTO checks. Missing mandatory field must fail validation; corrected fixture passes. Historical 27 failures are re-counted and explained, not assumed still present.

## Completion evidence
Exact revision, command results, failure inventory, before/after sensitive assertions. No dependency on other tickets because baseline đo behavior hiện tại.
