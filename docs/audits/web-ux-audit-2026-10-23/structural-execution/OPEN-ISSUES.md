# Vấn đề còn mở

Mỗi mục có mã, mức, nguyên nhân, và điều kiện đóng.

| Mã | Mức | Vấn đề | Điều kiện đóng |
|---|---|---|---|
| BL-01 | Cao (xác minh WS-0) | Canary owner → viewer trên trình duyệt chưa chạy. Không có tài khoản thứ hai trên môi trường cho phép. | Stack cô lập với hai tài khoản, hoặc người dùng cấp tài khoản canary. Không tạo tài khoản trên 3001. |
| BL-02 | Cao (WS-3) | ADR-0095/0098/0099 Proposed; thay đổi chưa commit của owner. Ownership C2 và C2Workspace chưa làm. | Owner duyệt hoặc từ chối ADR; D-03 được chốt. |
| BL-03 | Trung bình (WS-2) | Closure và library proposal chưa nằm trong `/api/tasks`. | Có contract và consumer; kiểm phân quyền từng miền (plan 02, mục 8.6). |
| NV-1 | Cao | Route smoke real và trình duyệt real chưa chạy trong vòng này (không có stack đang chạy). | Chạy `tools/verify/stack.mjs` (cần Docker) hoặc stack có sẵn. |
| DEP-1 | Cao (vận hành) | Container 3001 đang chạy `raptix-web-raptix-ui:d3225f63`. HEAD đã đi trước 9 commit. Chưa có quyết định redeploy. | Người dùng quyết định deploy; theo quy trình mục 10 của `docs/web-real-ui-implementation-plan.md`, có rollback. |
| CLEAN-1 | Thấp (vệ sinh) | Hai file tạm do lỗi đường dẫn: `D:\Program Files\Git\final-smoke-optin.log` và `D:\Program Files\Git\final-optin-exit.txt`. Lệnh xóa bị bộ kiểm tra an toàn chặn, nên chưa xóa. | Người dùng xóa tay hai file này. |
| FLAKY-1 | Thấp | `real-screens.test.tsx` (tạo dự án) timeout 5.4 s khi chạy song song một lần. | Xem timeout của test, hoặc xác định nguyên nhân chậm. Không nới ngưỡng để che. |
| TEAM-1 | Trung bình (WS-2) | Tab Team & Approvals chưa làm rõ vai trò membership và liên kết tool approval. | Plan 02 bước 8.5; chủ sản phẩm xác nhận nội dung. |
| PROV-1 | Trung bình (WS-4) | Chưa có provenance `asOf` theo từng measure; không có nguồn thời điểm đáng tin. | Server trả thời điểm nguồn cho từng số đếm (contract mới cần ADR). |
| MOCK-1 | Thấp | `MOCK_PROJECT_TABS` là danh sách id demo, song song với bảng menu. | Giữ cho demo, hoặc đưa demo vào cùng module khi tách demo khỏi production (UX-22). |
| GLOBAL-1 | Thấp | `GLOBAL_RESOURCE_PAGES` là quy tắc khả dụng riêng, chưa đưa vào `features/navigation`. | Plan 01 bước sau. |
| PSEED-1 | Thấp | Cờ planning-seed cũ (không có actor) bị bỏ qua sau deploy. | Chấp nhận; ghi trong release notes. |
| MFA-1 | Thấp (copy demo) | Thông báo mã xác thực demo có ghi "any code other than 000000". Không phải mật khẩu; để nguyên. | Chủ sản phẩm quyết định. |
| CA-1 | Thấp | Asset-map lưu vị trí xem theo actor, không xóa khi đăng xuất. Chủ ý, nhưng cần ghi cho người dùng dùng chung trình duyệt. | Quyết định sản phẩm. |
| UX-15/18/20/25 | Thấp | Các follow-up nhỏ trong mục 11 của prompt (badge, overlap chữ, primary accent, nút đóng drawer) chưa làm. | Cần kiểm trình duyệt từng mục; làm trong vòng sau. |
