# WS-3 · Hoàn thành (Trạng thái: PARTIAL; phần ghi BLOCKED)

## Ownership (D-03), dùng cho presentation

| Miền | Sở hữu | Ghi chú |
|---|---|---|
| Provider, Listener, Profile | C2 infrastructure | Đọc trong tab C2 và trong Global Infrastructure (rollup chỉ đọc) |
| Session, Access | C2 operations (phiên và quyền tạm thời) | Session active không có nghĩa là có Access |
| Command ledger | C2 operations | Trạng thái `uncertain` không phải `succeeded` |
| Runtime agent | Miền runtime riêng | Không chuyển sang C2 |
| Campaign | Miền campaign riêng | Không chuyển sang C2 |

Không đổi runtime contract. Không đổi lease, dispatch hay ledger.

## Đã hoàn thành

| Mục | Commit | Kiểm chứng |
|---|---|---|
| Ánh xạ địa chỉ `c2`, `c2-session`, `c2-channel`, `c2-console` sang một view (`features/c2/workspace/view.ts`) | `9efa9f11` | `view.test.ts` (4 test) |
| Địa chỉ `c2-console` nói rõ không có console tương tác; danh sách session giữ nguyên | `9efa9f11` | `provider-tab.test.tsx` |
| Fallback của địa chỉ chi tiết không có id giữ nguyên | `9efa9f11` | `view.test.ts` |
| Ngoại lệ `.gitignore` để thư mục nguồn không bị bỏ qua | `01b9d0e9` | `git check-ignore` |
| Global Infrastructure: rollup chỉ đọc, không có nút ghi | Đã kiểm mã (không đổi) | `global-resource.tsx`: chỉ điều hướng |

## Chưa làm và lý do

| Mục | Lý do | Điều kiện mở lại |
|---|---|---|
| Thực thi command, listener, lease, dispatch | ADR-0095, 0098, 0099 Proposed; file có thay đổi chưa commit của owner | Owner duyệt hoặc từ chối ADR |
| Interactive PTY console | ADR-0095 Proposed | Như trên |
| Gom toàn bộ view C2 vào một component duy nhất | Các view đã dùng chung; gom sẽ là refactor lớn không cần thiết cho mục tiêu hiện tại | Khi có quyết định về ADR |
| Kiểm provider thật (503, session active/inactive, command state) | Không có C2 server (Sliver) trong stack | Stack có provider giả hoặc môi trường C2 cô lập |

## Rủi ro

- Địa chỉ `c2-console` có thể gây hiểu nhầm nếu owner đổi thông báo mà không cập nhật `view.test.ts`.
