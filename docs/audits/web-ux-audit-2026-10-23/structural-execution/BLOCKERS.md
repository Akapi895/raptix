# Blocker

Mỗi blocker ghi: mã, workstream, bằng chứng, mức ảnh hưởng, phần còn làm được, điều kiện mở lại.

## Đang mở

| Mã | WS | Blocker | Bằng chứng | Ảnh hưởng | Phần còn làm được |
|---|---|---|---|---|---|
| BL-01 | WS-0 | Canary hai tài khoản (owner → viewer) trên trình duyệt chưa có | Stack xác minh đã dừng; 3001 chỉ có tài khoản admin; không được tạo tài khoản trên 3001 | Browser canary WS-0 = NOT VERIFIED | Test hai actor trong jsdom; thử stack cô lập nếu môi trường cho phép |
| BL-02 | WS-3 | ADR-0095, ADR-0098, ADR-0099 đang Proposed | `git status`: các file có thay đổi chưa commit của owner | Phần ghi C2 (console, lease, dispatch) bị chặn | Tổ chức presentation, read-only, route alias |
| BL-03 | WS-2 | Phạm vi aggregate Closure và Library proposal chưa có trong `/api/tasks` | Structural plan 02 mục 8.6 | Không thêm nguồn server nửa vời | Read model client cho nguồn đã có |
| BL-04 | Tất cả | Dev server owner (5273) không dùng được để kiểm trình duyệt | Ghi nhận từ audit: 504 "Outdated Optimize Dep" | Không dùng cổng 5273 | Build và serve riêng trong scratchpad |

## Đã đóng

(không có)
