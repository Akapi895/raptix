# WS-2 · Hoàn thành (Trạng thái: PARTIAL, còn một điều kiện server)

## Đã hoàn thành

| Mục | Commit | Kiểm chứng |
|---|---|---|
| Một read model cho task inbox (`features/decisions`), một nơi gọi `GET /api/tasks` (A3) | `b3195015` | Test model, consumer, `grep` một nơi gọi |
| Cờ `limited` và `limitedKinds` từ server; số đếm theo từng loại | `76826809`, `52f587aa` | `t15-inbox` 8 test; typecheck server |
| Stop không vào decision count; có vùng riêng "Attention" | `b3195015`, `837e1d9d` | Test overview, test approval inbox |
| Trạng thái: pending (đang đọc), unavailable (không đọc được), limited (cận dưới), empty (đã đọc, không có) | `349bcbc5`, `b3195015`, `000dea15` | Test measure và banner |
| Team tab: membership và decisions tách hai khu vực; chú thích phân biệt quyền xem và quyền quyết định | `000dea15` | Test approval inbox |
| Liên kết tới tool approval trong AI Workspace khi ngữ cảnh là project | `000dea15` | Test approval inbox (dòng "Runtime tool approvals…") |
| Closure đang chờ và library proposal đang chờ, đọc theo project qua endpoint có sẵn | `000dea15` | Test approval inbox (mục "Also waiting") |

## Còn lại và lý do

| Mục | Trạng thái | Lý do |
|---|---|---|
| Closure và library trong số đếm Overview | BL-03, CONDITIONAL | Cần đổi server aggregate. Điều kiện mở lại: consumer, đánh giá phân quyền từng miền, test tương thích, và đồng bộ với contract (plan 02, mục 8.6). Không tạo aggregate nửa vời. |
| "Resolved" trong số đếm | Không có nguồn | `/api/tasks` chỉ trả mục đang chờ. Không tự suy ra số đã xử lý. |
| Điều kiện "viewer chỉ xem" trên trang Team | Đã có một phần | Nút quản lý thành viên do server cho phép (`canManage`). Kiểm trên stack bằng trình duyệt: xem `WS-4-UX-VERIFICATION.md`. |

## Ràng buộc đã giữ

- Tool approval không nằm trong workflow decisions (D-02).
- Stop không nằm trong decision count (D-02).
- Notification không đổi trạng thái decision (A5).
- Không endpoint ghi mới; không đổi quyền backend.
