# Kế hoạch tiếp tục (vòng 5)

## Mục tiêu đã xác nhận

Hoàn thành phần Structural còn dang dở bằng implementation và kiểm chứng: P0 (xác minh), P1 (WS-2), P2 (WS-4B), P3 (WS-3 phần an toàn), P4 (follow-up nhỏ).

## Thứ tự đã thực hiện

1. Đọc `RESUME.md` và trạng thái git; xác nhận HEAD và working tree.
2. P0.1: kiểm cơ chế theme, sửa bằng chứng dark (script sai), chụp lại.
3. P0.2: dựng stack cô lập từ `stack.mjs` (không đổi repo), chạy canary 10/10; mutation và đối chiếu test đơn vị.
4. P0.3: smoke real trên stack; sửa harness gắn lỗi sai; kiểm tab Team; phát hiện và sửa lý do của control disabled.
5. P1: `limitedKinds`; giới hạn theo từng số; Team tab với closure, library và liên kết tool approval.
6. P2: severity thành disclosure.
7. P3: resolver C2 và thông báo console; sửa `.gitignore` cho thư mục nguồn.
8. P4: GLOBAL-1, UX-25, UX-15 (một phần), UX-18, UX-20, FLAKY-1.
9. Gate cuối, báo cáo, gói chia sẻ.

## Không làm (ràng buộc)

- Không đổi authentication, authorization, hay runtime; không endpoint ghi mới.
- Không chạy C2, listener, Emergency Stop, payload.
- Không deploy 3001; không dùng 5273; không sửa dev server của owner.
- Không stage thay đổi của owner.
- Không thêm `Co-Authored-By`.

## Việc còn lại (xem `FINAL-STRUCTURAL-CLOSURE.md` mục 7)

- BL-03: closure và library trong aggregate Overview (cần server).
- BL-02: ADR C2 (cần owner).
- PROV-1: provenance asOf (cần contract server).
- NV: smoke Overview real, drawer mobile real, draft chat với runtime.
- DEP-1 và CLEAN-1: cần người dùng.
