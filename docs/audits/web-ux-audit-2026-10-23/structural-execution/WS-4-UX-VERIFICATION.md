# WS-4 · Kiểm chứng UX (Trạng thái: VERIFIED cho mock và real trên stack; một số màn hình NV)

## Phạm vi và phương pháp

- Trình duyệt: Chromium của Playwright, từ `node_modules` của repo.
- Mock: build production trong scratchpad, phục vụ tĩnh ở 127.0.0.1 (cổng riêng). Chuyển theme qua menu tài khoản, không qua `colorScheme` (ứng dụng không đọc `prefers-color-scheme`).
- Real: stack cô lập (xem `WS-0-CANARY-REPORT.md`), dev server của stack.
- Không dùng 3001 hay 5273.

## Overview (mock) — sáng và tối, desktop và mobile

Ảnh trong `evidence/`:

| File | Khung | Theme | Kiểm |
|---|---|---|---|
| `WS4B-overview-after-desktop-light.png` | 1440×900 | Sáng | Thứ tự vùng đúng; không tràn |
| `WS4B-overview-after-desktop-dark.png` | 1440×900 | Tối | `html.dark`, nền `rgb(11,17,32)`, chữ sáng; không tràn |
| `WS4B-overview-after-tablet-light.png` | 834×1112 | Sáng | Không tràn |
| `WS4B-overview-after-mobile-light.png` | 390×844 | Sáng | Không tràn; attention đầu trang |
| `WS4B-overview-after-mobile-dark.png` | 390×844 | Tối | Không tràn; thẻ KPI đọc được |

Đính chính: ảnh "dark" trước đó là ảnh sáng (lỗi script); đã sửa, xem `VERIFICATION-LOG.md`.

## Sidebar của project (mock)

`evidence/WS1-project-sidebar-after-desktop-light.png`: "Planning", "C2 Sessions", nhóm OPERATIONS và RESULTS đúng.

## Tab Team & Approvals (real, stack)

Ảnh trong scratchpad (`canary2/out/team2/`): owner sáng và tối, viewer sáng.

| Kiểm | Owner | Viewer |
|---|---|---|
| Tiêu đề "Waiting for a decision" và caption phân biệt quyền xem và quyền quyết định | Có | Có |
| Trạng thái rỗng nêu closure và library | Có | Có |
| Footer "Runtime tool approvals wait in the AI Workspace" và nút mở AI Workspace | Có | Có |
| Nút thành viên | Bật (Invite, Remove) | Disabled, có lý do ở tooltip (sau sửa `67ddf571`) |
| Không tràn ngang | 0 px | 0 px |
| Lỗi trang | Không | Không |

Trước khi sửa: nút disabled của viewer không có lý do (tooltip bị thay bằng nhãn). Đã sửa trong `IconButton` và nút Invite.

## Tab Team: số liệu từ server

`GET /api/tasks` trên stack (owner): khóa `limited` và `limitedKinds` có mặt; stack trống nên mảng rỗng.

## Chưa kiểm trên trình duyệt real

- Overview real với dữ liệu: smoke route `overview` đạt; chưa chụp ảnh real vì stack có ít dữ liệu. Ghi NV ảnh.
- Mobile drawer trên real: chưa chụp. Kiểm mock và test đơn vị (`sidebar-drawer.test.tsx`).
- Tablet và dark real: NV.

## Rủi ro thị giác

- Caption mới trên Team dài hơn trước; kiểm trên desktop không gây xuống dòng xấu. Trên mobile chưa kiểm ảnh.
