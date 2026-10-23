# 07 · Đóng nghiệm thu (Acceptance Closure)

Ngày: 2026-10-23 · Mốc code: HEAD `56a29e1a` · Trạng thái: tài liệu nghiệm thu, không đổi mã.

Tài liệu này đối chiếu UX-01 đến UX-27, S-01 đến S-08 và các mục Phase A với bằng chứng. Mục nào chưa xác minh được thì ghi rõ, không gộp thành "đã đóng".

## 1. Cách đọc nhãn

| Nhãn | Nghĩa |
|---|---|
| CLOSED | Đã sửa hoặc đã xác nhận, có bằng chứng ghi kèm. |
| CLOSED (đính chính) | Phát hiện ban đầu sai. Tài liệu đã sửa; không còn việc phải làm. |
| PARTIAL | Một phần đã đóng. Phần còn lại được ghi rõ. |
| OPEN | Chưa làm. Nếu có "có kế hoạch" thì kế hoạch nằm trong `structural-plan/`; nếu có "chờ D-xx" thì cần quyết định của reviewer. |
| KEPT | Cố ý giữ nguyên. |
| NV | Không kiểm được trong môi trường này. |

## 2. Gate tại HEAD `56a29e1a`

Nguồn: `verification/results/final-acceptance/exit-codes.txt`, `smokes-exit.txt`, các file log cùng thư mục.

| Kiểm tra | Kết quả |
|---|---|
| Typecheck | exit 0 |
| Lint | exit 0 |
| Boundary | exit 0 (`boundaries.log`) |
| Full test | exit 0: 183 file, 1616 test (`test.log`) |
| Build production, mặc định | exit 0 (`vite build` vào scratchpad, không ghi `apps/web/dist`) |
| Build production, bật cờ | exit 0 |
| Route smoke mock, cờ tắt | 56/56 pass, 0 lỗi mới (`smoke-mock-default.log`) |
| Route smoke mock, bật cờ `prototype,assetMap` | 56/56 pass, 0 lỗi mới (`smoke-mock-optin.log`) |
| Route smoke real, stack có graph | 42 pass; 14 khai báo sẵn do môi trường; 1 mục "không xảy ra"; 0 lỗi mới (`smoke-real-stack.json`) |

14 mục khai báo sẵn ở real: 9 route thiếu fixture (operations, agents, AI plan, C2 channel/session/console, branch) vì stack không tạo runtime; `operation-new` 404 vì LangGraph không chạy; `c2` và `project` 503 vì không có Sliver.

## 3. Phase A (kiểm tra đầu vòng)

| Mã | Mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| A-1 | Settings real: thẻ Trusted identity hiển thị hằng số | CLOSED (`56a29e1a`) | Test `features/settings/real-sections.identity.test.tsx` (2 test). `results/acc-real.json`: owner hiện `verifier`, viewer hiện `Stack Viewer`. Ảnh `evidence/A14-real-settings-identity-owner-after.png`. Nguyên nhân và rủi ro dư: `06` mục 8. |
| A-2 | Đồng bộ tài liệu với HEAD | CLOSED | `01` (đính chính, bảng S-01..S-08), `03` (hai dòng header switcher và Demo Tools), `06` (viết lại), `QUICK-WINS-IMPLEMENTATION-REPORT.md` mục 10, `README.md`. |
| A-3 | Outage production tại HEAD | CLOSED | `verification/results/final-acceptance/prod-outage-HEAD.json`. Ảnh `evidence/P1-production-boot-outage-HEAD.png` và `P2-production-projects-outage-HEAD.png`. Tiêu đề "Raptix is unavailable right now"; không lệnh dev; không nút demo. |
| A-4 | Rà diff từ vòng 2 | CLOSED | `0c25420f..47836ed1` chỉ có tài liệu. `56a29e1a` là thay đổi mã duy nhất sau vòng 2; gate đã chạy lại tại `56a29e1a` (mục 2). |
| A-5 | Gate và artifact | CLOSED | `exit-codes.txt` (`head=56a29e1a`, mọi bước exit 0); `smokes-exit.txt` (cả ba smoke exit 0). |

## 4. Trạng thái theo UX-ID

| UX | Trạng thái | Bằng chứng và phần còn lại | Xử lý ở đâu |
|---|---|---|---|
| UX-01 Demo chrome không gắn theo mode | CLOSED | Mock: switcher và Demo Tools chỉ mount ở mock (`shell/shell.tsx:168`). Real dùng `RealTopbar` (`shell/real-chrome.tsx`). Real: menu không có Demo Tools (`R02`); Settings không còn "Demo" (`R03`); thẻ identity đúng (A-1). Nút "Switch to demo mode" còn lại, xem UX-04. | — |
| UX-02 Copy "hidden in production" | CLOSED | Copy theo mode. Bundle mặc định không có "Prototype Home", "npm run dev:api", "non-JSON response" (`VERIFICATION-STABILIZATION` mục 1). Còn: thông báo sai mật khẩu ở mock in mật khẩu demo (S-03). | D-06 |
| UX-03 Demo controls chỉ ở mock | CLOSED (đính chính) | Không phải lỗi ở real. Đã đính chính đầu `01`. | — |
| UX-04 Outage real lộ lệnh dev | CLOSED cho outage; OPEN cho menu | `prod-outage-HEAD.json`: outage production không có lệnh dev và không có "Switch to demo mode". Dev vẫn hiện lệnh có chủ đích (`R-E0`). Còn: nút "Switch to demo mode" trong menu tài khoản real (`R02`). | D-05 (S8) |
| UX-05 Trang prototype/QA trong bản build | PARTIAL | Route bị gate: cờ tắt thì "Page not found" (56/56). Chunk `gallery` vẫn chứa "Universal state set" (S-06). | L3; S-06 |
| UX-06 Hai mô hình sidebar dự án | OPEN (có kế hoạch) | Đã đồng bộ `routes.json` và baseline (`playbooks` → `capabilities`, S-04). Bảng mục sidebar chưa đổi. | WS-1; D-01 |
| UX-07 Sidebar dự án cuộn không có dấu hiệu | CLOSED | Drawer mobile trong project: 16 mục, có `data-scroll-fade` ở cuối (`VERIFICATION-STABILIZATION` mục 5). | — |
| UX-08 Tasks & Approvals không có mục sidebar | OPEN (có kế hoạch) | Chưa đổi. Kế hoạch: bốn bề mặt đọc `/api/tasks` chuyển về một `features/decisions`. | WS-2; D-02 |
| UX-09 Trùng bề mặt AI và kế hoạch | OPEN (chưa có kế hoạch) | Chưa quyết định Ask AI và Plans. | S5 (roadmap) |
| UX-10 Cùng danh sách findings, ba bố cục | OPEN (chưa có kế hoạch) | Chưa gộp. | S3 (roadmap) |
| UX-11 C2 ở ba nơi, alias `c2` → Infrastructure | OPEN (có kế hoạch) | Kế hoạch `C2Workspace`, alias `c2-*`, Infrastructure toàn cục chỉ là rollup. | WS-3; D-03 |
| UX-12 Overview toàn cục mâu thuẫn với dự án | PARTIAL | Vòng 1 đã đổi "Running binding state" thành "Operations running now". Còn: chú thích "Active projects" trên Overview là "Planning or running", nhưng tập trạng thái có `approved`. Định nghĩa KPI chưa hiện trên màn hình. | WS-4; D-04 |
| UX-13 Cột thiếu dữ liệu "—"; chip và KPI "Active" lệch | CLOSED (phần Projects) | Projects: "Not recorded" thay "—"; KPI Metadata không hiện 0 giả (UX-26); chú thích Active khớp tập trạng thái (vòng 1). Còn: cột TARGET/METADATA lấy từ source thật. | S6 (chưa lập kế hoạch) |
| UX-14 Copy và thuật ngữ | PARTIAL | Đã sửa số ít/số nhiều và "Library" → "Capabilities". Còn: "Raptix" làm tên agent; "Sessions" và C2 chưa thống nhất. | `05-terminology.md` |
| UX-15 Nhận diện và trùng lặp | OPEN (chưa có kế hoạch) | Chưa xử lý; một phần nằm trong thuật ngữ. | — |
| UX-16 Mật độ Overview và Project Overview | OPEN (có kế hoạch) | Overview có khoảng 10 vùng đọc cùng lúc. Kế hoạch: vùng attention, bốn measure, chuyển khối findings đi. | WS-4 |
| UX-17 Thanh severity đơn sắc; đếm lặp | OPEN | Ba cách đếm findings trên cùng trang. Phần chuyển khối findings nằm trong WS-4. | WS-4 (một phần) |
| UX-18 Nhãn "Findings" và chú thích chồng nhau | OPEN (chưa có kế hoạch) | Chưa xử lý. | — |
| UX-19 Contrast | PARTIAL | Cặp token đã sửa và có test (`ui/theme-contrast.test.ts`). Còn: 14 dòng dùng `text-primary` (12 file trong `apps/web/src`) chưa kiểm contrast từng vị trí ở dark. Màu nút primary dark đổi (`rgb(37,99,235)` → `rgb(96,165,250)`), cần duyệt thiết kế. | L1; duyệt thiết kế |
| UX-20 Hai hệ accent không có quy tắc | OPEN (chưa có kế hoạch) | Chưa có quy tắc trong design. | L1 |
| UX-21 Primitive KPI/Chip/Pill trùng lặp | OPEN (chưa có kế hoạch) | Chưa gộp. `MeasureCard` trong WS-4 là một bước nhỏ theo hướng này. | L2 |
| UX-22 Build: chunk lớn, demo trong bundle | OPEN | Còn chunk lớn và code demo (S-06). | L3 |
| UX-23 Đăng nhập mock | CLOSED (đính chính) | Luồng hoạt động: Continue → "Verifying…" khoảng 700 ms → chọn tổ chức → "Enter workspace" → System Overview. Phát hiện ban đầu sai. Mục S7 trong roadmap bỏ. | — |
| UX-24 Emergency Stop | KEPT | Giữ nguyên theo quyết định của audit. Luồng thật NV (không thực hiện theo yêu cầu). Kiểm E-stop với C2 session là canary của WS-3. | Canary |
| UX-25 Mobile drawer và hit target | PARTIAL | Đóng bằng Escape, overlay và khi chọn mục (`[B]`). Hit target: 1–5 nút dưới 32 px trên 12 trang mobile; không có nút dưới 24 px. Còn: nút đóng có nhãn chưa xác nhận; keyboard-only, focus visible và screen reader (NV). | L5 |
| UX-26 KPI "Metadata to review" hiển thị 0 | CLOSED | Hiển thị "Not recorded" khi nguồn không ghi nhận metadata. Ảnh trước: `B07`. Ảnh sau: xem `QUICK-WINS-IMPLEMENTATION-REPORT.md`. | — |
| UX-27 Settings cam kết áp dụng cho mọi project | NV | Chưa kiểm consumer. | L6 |

## 5. Phát hiện S-01 đến S-08 (bảng trong `01`)

| Mã | Trạng thái | Ghi chú |
|---|---|---|
| S-01 Asset Map bật cờ vẫn "Page not found" trong mock | CLOSED (`828cd7bc`) | Smoke bản bật cờ: 0 lỗi. |
| S-02 Real hiện "Not connected" cho địa chỉ không đăng ký | CLOSED (`bd0f47a6`) | Real hiện "Page not found", giống mock. |
| S-03 Thông báo sai mật khẩu ở mock in mật khẩu demo | OPEN | Chờ quyết định D-06. |
| S-04 Inventory route smoke lệch router | CLOSED (`3bc6cf84`) | `routes.json` và `baseline.json` đã đồng bộ. |
| S-05 Thông báo kỹ thuật hiện nguyên văn cho người dùng real | CLOSED (`b5b7f188`, `0c25420f`) | Đo bằng `real-messages` và `prod-outage`. |
| S-06 Mã trang "Universal state set" còn trong bundle | OPEN | Cần đổi kiến trúc route (UX-05, UX-22). |
| S-07 Test responsive audit quá 5 s khi tải cao | OPEN (ghi nhận) | Flaky. Chạy riêng: 11/11 đạt. |
| S-08 Emergency Stop thật ở real | NV | Không thực hiện theo yêu cầu. |

## 6. Phase B: kế hoạch Structural (chỉ tài liệu)

- `structural-plan/00` đến `06`: WS-0 đến WS-4. Không có code Structural nào được viết.
- Có kế hoạch: WS-0 (actor scope, tiên quyết, `06` mục 1); WS-1 (UX-06); WS-2 (UX-08); WS-3 (UX-11); WS-4 (UX-12, UX-16).
- Chưa có kế hoạch: S3 (UX-10), S5 (UX-09), S6 (UX-13 cột thật), L1 đến L8 (accessibility, token, primitive, tách demo khỏi bundle), và phần lớn UX-14, UX-15, UX-17, UX-18, UX-20, UX-21, UX-22.
- Ứng viên ADR (`06` mục 8): ownership C2 infrastructure và sessions; phạm vi decision aggregate; provenance của measure. Chưa tạo ADR nào.

### Quyết định chờ reviewer

| Mã | Câu hỏi | Ảnh hưởng | Gợi ý trong kế hoạch |
|---|---|---|---|
| D-01 | Nhãn và ID chính tắc của mục dự án | WS-1, WS-3 | — |
| D-02 | Tool approval: không ưu tiên, nhãn phạm vi, hay aggregate có ADR | WS-2, WS-4 | Lựa chọn A (nhãn "excluding tool approvals") |
| D-03 | Infrastructure có chứa Runtime agents và Campaigns không | WS-3, WS-1 | — |
| D-04 | Overview: bốn measure và vùng attention, hay sáu measure theo checklist | WS-4 | Lựa chọn A (bốn measure) |
| D-05 | Nút "Switch to demo mode" trong menu tài khoản real | WS-1 (nhỏ) | — |
| D-06 | Mật khẩu demo trong thông báo sai mật khẩu ở mock (S-03) | Ngoài workstream | — |

## 7. Chưa kiểm (NV và Mở)

Danh sách đầy đủ và lý do ở `06`. Các mục chính:

- Luồng ghi real (tạo, sửa, duyệt, xuất) và Emergency Stop thật: chưa chạy. Cần canary riêng.
- Viewer bị từ chối quyền; reviewer, analyst, operator; foreign project và cross-tenant.
- KPI Overview real (số liệu) và nội dung chi tiết từng tab Settings real.
- LangGraph runtime và Sliver C2 trên stack: route tương ứng là khai báo sẵn.
- Bản deploy tại `http://127.0.0.1:3001`: không có credential và không có môi trường deploy.
- Keyboard-only đầy đủ, screen reader, focus visible, tablet 768 và 1024 px, trình duyệt khác (chỉ Chromium).
- Cache theo actor (WS-0): query key và key lưu trữ dùng `local`. Đã giảm nhờ xóa khi đăng nhập (`real-login.tsx`), nhưng chưa kiểm trong trình duyệt rằng chuyển người dùng trên cùng trình duyệt không lộ dữ liệu cũ.

## 8. Điều kiện để đóng các mục còn mở

1. WS-0: trên stack, đăng nhập owner, tạo bản nháp, đăng xuất, đăng nhập viewer. Bản nháp và dữ liệu cache của owner không được hiện. Xác nhận đường đăng xuất gọi `clearWorkspaceRecovery`.
2. Luồng ghi real với canary và một reviewer khác author. Hiện chỉ có owner (Admin) và viewer; cần thêm tài khoản thứ ba.
3. Keyboard-only, screen reader, tablet 768 và 1024 px, và một trình duyệt khác.
4. LangGraph và Sliver để kiểm các route đang khai báo sẵn.

## 9. Artifact

- Thư mục audit: `docs/audits/web-ux-audit-2026-10-23/`
- Kế hoạch Structural: `docs/audits/web-ux-audit-2026-10-23/structural-plan/`
- Nghiệm thu: `docs/audits/web-ux-audit-2026-10-23/verification/results/final-acceptance/`
- Ảnh: `evidence/A14-real-settings-identity-owner-after.png`, `evidence/P1-production-boot-outage-HEAD.png`, `evidence/P2-production-projects-outage-HEAD.png`
- Gói chia sẻ: `docs/audits/web-ux-audit-2026-10-23.zip` (không commit)
