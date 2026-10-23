# WS-2 · Decisions và Approvals (Trạng thái: PARTIAL)

UX-ID: UX-08 (chính). Phần của UX-09 không thuộc vòng này.

## Kiểm kê nguồn quyết định (đã xác minh bằng mã)

| Nguồn | Loại | Trong `/api/tasks` | Ghi chú |
|---|---|---|---|
| `scope-revision` | Workflow decision | Có | Tối đa 25 dòng |
| `business-plan` | Workflow decision | Có | |
| `c2-grant` | Workflow decision (yêu cầu truy cập C2) | Có | |
| `report-review` | Workflow decision | Có | |
| `finding-review` | Workflow decision | Có | |
| `active-stop` | Attention (D-02), không phải decision | Có | |
| Tool approval (HITL, runtime) | Runtime tool approval | Không | Không nằm trong inbox (D-02 A) |
| Closure, library proposal | Workflow decision | Không | BL-03: chưa có trong aggregate; không tạo aggregate nửa vời |
| Notification (chuông) | Feed sự kiện | Không (`/api/notices`) | Không đổi trạng thái decision (A5) |

## Trước

- Bốn nơi đọc cùng endpoint, bốn key cache: overview port, `['real','tasks']` (command center và search), key approval inbox, và overview của project.
- Approval inbox gọi `fetchTasks` trực tiếp.
- Số "Awaiting decisions" và "Decision queue (N)" đếm cả `active-stop`.
- `/api/tasks` giới hạn 25 dòng mỗi loại mà không báo; số đếm có thể thiếu im lặng.
- Banner: "N decision(s) await your review", nhưng số đếm gồm việc của người khác.

## Sau

- `features/decisions/`: `remote.ts` là nơi duy nhất gọi `GET /api/tasks` (A3); `model.ts` có `splitTasks` (stop tách khỏi decision) và `countText` (cận dưới có dấu +); `index.ts` là public surface.
- Server: `TasksView.limited` (true khi một loại đạt cap). Client đọc như `limited?: boolean` (thiếu thì là false, tương thích server cũ).
- Overview port `tasks()` trả `{ items, limited }`; mock trả `limited: false`.
- Measure "Awaiting decisions", "Decision queue", approval inbox và "Decisions" của project dùng cùng định nghĩa. Stop hiển thị ở vùng Attention, không ở danh sách decision.
- Project overview: stop không cộng hai lần trong "Attention" (đã có `activeStops`).
- Approval inbox có vùng "Decisions" và "Attention" riêng, và cảnh báo khi danh sách bị giới hạn.
- Boundary: khóa baseline mới sau khi giảm deep import (411 → 408).

## Commit

- `76826809` feat(web-server): cờ `limited` (1 test mới, `t15-inbox`).
- `b3195015` feat(web): read the task inbox through one decisions model (19 file; DL-08 giải thích vượt 10 file).
- Liên quan: `837e1d9d` (vùng Attention trên Overview, WS-4B) và `349bcbc5` (measures, WS-4A).

## Quyết định

- D-02 (A): tool approval không trong số đếm; stop là Attention.
- DL-07: "Awaiting decisions" là toàn bộ decision trong phạm vi; "việc của bạn" tách ở read model sau này.
- DL-08: commit client vượt 10 file vì kiểu endpoint, kiểu port và consumer đổi cùng lúc.

## Kiểm thử

- Server: `t15-inbox` 7 test (thêm 1: đầy cap → limited; thiếu một dòng → không limited). Server full suite: 64 file, 622 test xanh.
- Client: `decisions/model.test.ts` (3); `measures.test.ts` (thêm test limited); `approval-inbox.test.tsx` (thêm stop ở Attention; cảnh báo limited); `overview-page.test.tsx` (thêm stop không vào hàng đợi); `mock.test.ts` và `project-overview.test.tsx` cập nhật hình dạng mới.
- Full suite: 188 file, 1650 test xanh (trên HEAD `ffe85384`).

## Chưa làm (còn trong WS-2)

- Tab Team & Approvals: làm rõ vai trò membership và liên kết tới tool approval theo ngữ cảnh (plan bước 8.5). Chưa làm; nhãn giữ nguyên (D-01).
- Closure và library proposal trong inbox: BL-03 (server).
- Resolved/Unavailable/Truncated như trạng thái riêng trong một bảng số đếm: chỉ có "+" và "unavailable" ở measure; chưa có bảng đếm đầy đủ.
- Chưa có liên kết từ Ask AI tới tool approval theo ngữ cảnh.

## Đã xác minh / chưa xác minh

- Đã: typecheck, lint, test, boundary, route smoke mock (56/56 cả hai cờ), chụp Overview (WS-4B).
- Chưa (NV): trình duyệt real với backend; quyền reviewer khác author (cần fixture hai vai trò, không có tài khoản thứ hai).

## Rủi ro hồi quy

- Số đếm đổi: stop không còn trong số decision; số có thể thấp hơn trước. Mô tả đã nêu rõ phạm vi.
- Banner đổi chữ. Test đã cập nhật.
- Port overview đổi kiểu: mọi consumer đã cập nhật (typecheck xác nhận).
