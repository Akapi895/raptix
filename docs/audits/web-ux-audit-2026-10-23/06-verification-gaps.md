# 06 · Verification Gaps — Những gì chưa được kiểm chứng

Nguyên tắc: không đưa kết luận chưa xác minh thành sự thật. Mỗi mục dưới đây ghi lý do và cách đóng khoảng trống.

## 1. Real mode và backend (quan trọng nhất)

| Hạng mục | Trạng thái | Lý do | Cách đóng |
|---|---|---|---|
| Đăng nhập real | NV | Không có API tại `127.0.0.1:5280` | Chạy stack thật (`make infra` hoặc `tools/verify/stack.mjs`), rồi kiểm login và redirect |
| Header và Settings trong real (UX-01) | C (code) | Không đăng nhập được real, nên không chụp được chrome real | Kiểm bằng unit test với mode mock đã stub; kiểm trình duyệt khi có backend |
| Demo Tools ẩn trong real (UX-03) | C (code) | Như trên | Như trên |
| Persona switch vô hiệu trong real | C (code) | Như trên | Như trên |
| Reset demo ném lỗi trong real | C (code) | Như trên | Như trên |
| Emergency Stop thật (xác nhận, kết quả, trạng thái) | NV | Luồng ghi và điều phối runtime; không chạy vì an toàn | Chạy trên canary có runtime; không dùng trên dự án thật |
| Overview real (KPI thật, aggregate) | NV | Cần API `overview` | Như trên |
| Findings global real (có phải chỉ là đếm không) | NV | Checklist G-03 nói là đếm; chưa xác minh | Như trên |
| Projects real (cột target, metadata, filter) | NV | Dữ liệu real khác mock | Như trên |
| Sidebar real (18 mục, đếm DOM) | C | Đếm theo source, chưa đếm DOM | Đếm DOM khi có đăng nhập real |
| Live AI runtime, tool approval, agent stream | NV | Cần LangGraph và sandbox | Checklist runtime-prelab |
| C2 (Sliver), session, grants | NV | Provider config-gated | Checklist J-09 |
| Deployed `http://127.0.0.1:3001` | NV | Không kiểm; không có credential | `apps/web/tools/verify/deployed-checklist.mjs` khi có môi trường |

## 2. Các trạng thái và luồng

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Form tạo project, finding, report: submit và validation đầy đủ | NV | Ghi dữ liệu; không thực hiện trong audit |
| Export PDF/DOCX; delivery | NV | Ghi file; không thực hiện |
| Trạng thái empty, denied, conflict, stale version từng trang | NV | Chỉ kiểm outage real và một số trang mock |
| Conflict và recovery của form | NV | Cần dữ liệu có version |
| Settings tab mock (Users, Templates, Detection, Policies, Retention, Audit...) | NV | Chỉ quan sát tên tab trong source |
| Reports 27 thao tác (owner báo đã pass) | NV | Không chạy lại |
| WebShell/PTY | NV | Chưa có parity (ADR-0095 Proposed) |

## 3. Truy cập và thiết bị

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Keyboard-only đầy đủ | NV | Chỉ kiểm tự động tên và nhãn |
| Screen reader | NV | Không có công cụ |
| Focus visible | NV | Không kiểm |
| Đường đóng mobile drawer | NV | Ảnh không cho thấy nút đóng; overlay chưa thử |
| Tablet ở 768 px và 1024 px | NV | Chỉ kiểm 834 px |
| Trình duyệt khác (Firefox, Safari, Edge) | NV | Chỉ Chromium |
| Hit target đầy đủ | Một phần | Đo bằng script trên 12 trang mobile |

## 4. Vai trò và quyền

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Vai trò khác Red Team Manager (viewer, reviewer, analyst, admin) | NV | Chỉ dùng một persona |
| Foreign project, cross-tenant | NV | Cần dữ liệu nhiều tổ chức |

## 5. Phân tích tĩnh và tự động

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Typecheck, lint, test, build | Xem báo cáo giai đoạn 2 | |
| `npm run check:boundaries` (ratchet 411 vi phạm đã được baseline) | Xem báo cáo giai đoạn 2 | |
| `npm run verify:routes` (route smoke) | NV hoặc xem báo cáo | Script cần server đang chạy và baseline riêng |
| Tỉ lệ contrast trong dark mode của mọi `text-primary` | Một phần | Chỉ tính cặp token; chưa kiểm từng vị trí dùng |

## 6. Số liệu của owner

| Hạng mục checklist | Trạng thái | Ghi chú |
|---|---|---|
| "6 KPI theo đề xuất" (G-01) | Sai theo quan sát | Thấy 4 KPI `[B]` |
| "Project sidebar 13 / 17" (§2.2) | Sai theo quan sát | Thấy 14 mock `[B]`, 18 real `[C]` |
| "Assets chưa có mục sidebar" (§2.2) | Sai | `nav.ts` có "Assets" ở cả hai mode `[C]` |
| "X-03: #E5484D / #F87171" | Không còn đúng | Token hiện tại khác `[C]` |
| "Settings real còn Acme Security (Demo)" (G-07) | Đúng theo source | `[C]`; chưa thấy trong trình duyệt real |
| "Library" (G-05) | Đúng trong copy | `[C]` |
