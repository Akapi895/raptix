# 06 · Verification Gaps — trạng thái sau Round 2 (cập nhật 2026-10-23)

Nguyên tắc: không đưa kết luận chưa xác minh thành sự thật. Mỗi mục ghi nhãn: **Đã kiểm** (có bằng chứng trong `verification/`), **Không áp dụng** (đã chứng minh không tồn tại ở phạm vi đó), **Mở** (chưa kiểm, có lý do và cách đóng), **NV** (không kiểm được trong môi trường này).

Mốc đối chiếu: HEAD code `56a29e1a` (sau sửa identity Settings); gate ghi ở `verification/results/final-acceptance/`. Chi tiết CLOSED/OPEN/NOT VERIFIED theo UX-ID nằm ở `07-acceptance-closure.md`.

## 1. Real mode và backend

Kiểm trên stack thật: PostgreSQL 17, graph seed từ skill graph, API từ source (`apps/web/server`), Vite dev, owner `verifier` (Admin) và viewer `viewer` tạo qua API.

| Hạng mục | Nhãn | Bằng chứng và ghi chú |
|---|---|---|
| Đăng nhập owner | Đã kiểm | Có nhãn "Real mode", overview "System Overview", không có tên demo. `results/real-mode-checks.json` |
| Menu tài khoản real | Đã kiểm | Không có Demo Tools, persona, Reset demo, Prototype Home. Có "Switch to demo mode" (quyết định mở, xem mục 8) |
| Settings real (header, note) | Đã kiểm | Không có "Acme Security (Demo)", "This is a simulation", RT-2026-014/017. 5 tab |
| Settings real: thẻ Trusted identity | Đã kiểm (sau sửa `56a29e1a`) | Hiển thị actor của phiên (`verifier` / `Stack Viewer`), chế độ Multi-user. Trước sửa hiển thị hằng số `Local Operator / local / local-single-user`. `results/acc-real.json` |
| Phân tách mock/real | Đã kiểm | Projects real không có tên demo; route smoke real dùng dữ liệu của stack, route smoke mock dùng dữ liệu demo |
| Sidebar project real | Đã kiểm | 18 mục điều hướng (đếm DOM). Checklist ghi 17: lệch 1, đã đính chính trong checklist |
| Viewer | Đã kiểm (một phần) | Đăng nhập được; Settings render; thẻ identity hiển thị đúng viewer. Chưa kiểm các màn hình bị từ chối |
| Trạng thái lỗi real | Đã kiểm | Không phải JSON, HTTP 500, mất kết nối: thông điệp người dùng. Đối tượng không tồn tại: thông điệp không tìm thấy. `results/real-error-messages.txt` |
| Boot outage production (không backend) | Đã kiểm | Thông điệp người dùng, không lệnh dev, không nút demo. Ảnh: `evidence/P-*` tại HEAD cuối |
| Emergency Stop thật | NV | Không thực hiện theo yêu cầu (luồng ghi và điều phối runtime) |
| Luồng ghi real (tạo, sửa, duyệt, xuất) | Mở | Không chạy trong Round 2. Cần kế hoạch canary riêng |
| KPI Overview real (số liệu) | Mở | Chưa đối chiếu số liệu với dữ liệu stack |
| Nội dung từng tab Settings real | Mở | Route smoke chỉ kiểm heading và text. Chưa kiểm nội dung chi tiết |
| LangGraph runtime (agent, thread, fleet) | NV | Stack không khởi động runtime. Các route phụ thuộc báo khai báo sẵn (`results/smoke-real-graph-stack.json`) |
| Sliver C2 (listener, session, grant) | NV | Stack không có Sliver. Route C2 báo 503 khai báo sẵn |
| Deployed `http://127.0.0.1:3001` | NV | Không có credential và không có môi trường deploy |
| Viewer: quyền bị từ chối | Mở | Cần dữ liệu có viewer không thuộc engagement |
| Cache key theo actor (query và storage dùng id `local`) | Mở (rủi ro) | Xem mục 8 và `01-full-audit-report.md`, phần phát hiện Phase A |

## 2. Các luồng và trạng thái

| Hạng mục | Nhãn | Ghi chú |
|---|---|---|
| Form tạo project, finding, report: submit và validation đầy đủ | NV | Ghi dữ liệu; không thực hiện |
| Export PDF/DOCX; delivery | NV | Ghi file; không thực hiện |
| Empty, denied, conflict, stale version từng trang | Mở | Chỉ kiểm outage và lỗi mạng trên Projects |
| Settings tab mock (Users, Templates, Detection, Policies, Retention, Audit...) | NV | Chỉ quan sát tên tab trong source |
| Reports 27 thao tác (owner báo đã pass) | NV | Không chạy lại |
| WebShell/PTY | NV | Chưa có parity (ADR-0095 Proposed) |

## 3. Truy cập và thiết bị

| Hạng mục | Nhãn | Ghi chú |
|---|---|---|
| Keyboard-only đầy đủ | Mở | Chỉ kiểm tự động tên và nhãn |
| Screen reader | NV | Không có công cụ |
| Focus visible | Mở | Không kiểm |
| Đường đóng mobile drawer (Escape, overlay) | Đã kiểm | Đóng bằng Escape và overlay; chọn mục thì đóng. Nút đóng có nhãn: chưa xác nhận (DOM có một phần tử khớp "close", không thấy X trong ảnh) |
| Tablet 768 và 1024 px | Mở | Round 1 chỉ kiểm 834 px |
| Trình duyệt khác (Firefox, Safari, Edge) | NV | Chỉ Chromium |
| Hit target đầy đủ | Đã kiểm (một phần) | Đo trên 12 trang mobile: 1–5 nút dưới 32 px; không có nút dưới 24 px |

## 4. Vai trò và quyền

| Hạng mục | Nhãn | Ghi chú |
|---|---|---|
| Vai trò khác Red Team Manager | Mở | Owner (Admin) và viewer đã đăng nhập; reviewer, analyst, operator chưa |
| Foreign project, cross-tenant | NV | Cần dữ liệu nhiều tổ chức |
| Ghi quyết định về authorization | Không áp dụng | Round 2 không đổi authentication hay authorization. Thay đổi duy nhất là hiển thị thẻ identity |

## 5. Phân tích tĩnh và tự động

| Hạng mục | Nhãn | Ghi chú |
|---|---|---|
| Typecheck, lint, boundary, full test, build production | Đã kiểm | Exit code tại HEAD cuối: `verification/results/final-acceptance/exit-codes.txt` |
| Route smoke mock: bản mặc định (cờ tắt) | Đã kiểm | 56/56 pass |
| Route smoke mock: bản bật cờ (`prototype,assetMap`) | Đã kiểm | 56/56 pass |
| Route smoke real trên stack có graph | Đã kiểm | 0 lỗi mới; 14 khai báo sẵn do môi trường |
| `npm run verify:routes` | Đã kiểm (tương đương) | Script được gọi trực tiếp với `RAPTIX_VERIFY_APP` và `RAPTIX_VERIFY_FLAGS`; không chạy qua npm |
| Tỉ lệ contrast của mọi `text-primary` ở dark | Mở | Đã đo cặp token (`ui/theme-contrast.test.ts`); chưa kiểm từng vị trí dùng |
| Bundle mặc định chứa code trang QA | Mở | "Universal state set" còn trong chunk `gallery`; route không truy cập được |

## 6. Số liệu và khẳng định của owner (checklist 2026-10-22)

| Khẳng định | Trạng thái | Bằng chứng |
|---|---|---|
| "6 KPI theo đề xuất" (G-01) | Sai theo quan sát; còn mở | Overview có 4 KPI |
| "Project sidebar mock 13 / real 17" (§2.2) | Sai | Mock 14 (đếm DOM); real 18 (đếm DOM) |
| "Assets chưa có mục sidebar dự án" (§2.2) | Sai | Có mục ở cả hai mode (`nav.ts`) |
| "X-03: #E5484D / #F87171" | Không còn đúng | Token hiện tại khác; cặp hỏng đã sửa |
| "Settings real còn Acme Security (Demo)" (G-07) | Đã sửa | Đã kiểm trên stack (mục 1) |
| "Library" (G-05) | Đã sửa trong copy | Heading "Skill proposals"; nav "Capabilities"; semantics vẫn mở (D-02) |
| Thẻ identity Settings hiển thị hằng số | Đã sửa (`56a29e1a`) | Mục 1 |

## 7. Việc tiếp theo để đóng khoảng trống

1. Canary real: luồng ghi (tạo project, duyệt, xuất) với viewer và reviewer khác author. Đây là điều kiện để đóng các mục mục 1 và 4 ở mức "luồng".
2. Kiểm cache theo actor trước khi nhận thêm người dùng trên cùng trình duyệt (xem mục 8).
3. Tablet 768 và 1024 px; keyboard-only; drawer có nút đóng có nhãn (nếu có).

## 8. Rủi ro mở do kết quả kiểm tra identity

- Hai lớp identity (đã xác minh bằng code): phiên của máy chủ (`/api/auth/session`) là actor tin cậy trong multi-user; hằng số `REAL_IDENTITY` (`id: 'local'`) là placeholder single-user, và còn được dùng làm namespace cho query key (`['real', 'projects', 'local']`, `['real', 'members', 'local', …]`), key lưu trữ cũ (`raptix.real.local.*`) và `REAL_PERSONA`.
- Hệ quả: query key không gắn với actor. `real-login` xóa mọi query real (trừ session và bootstrap) khi đăng nhập, nên kết quả hiện tại chặn được rò rỉ đa người dùng trong luồng đăng nhập thông thường. Chưa kiểm được trong trình duyệt rằng chuyển đổi người dùng trên cùng trình duyệt không hiển thị dữ liệu cũ.
- Không thay đổi trong Round 2: đây là thay đổi kiến trúc cache và định danh, cần review (xem `07-acceptance-closure.md` và đề xuất Structural WS-0).
