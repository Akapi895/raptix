# Báo cáo hồi quy

Trạng thái tại HEAD `ffe85384`. Mọi kết luận dựa trên lệnh đã chạy (xem `VERIFICATION-LOG.md`).

## Kết quả

| Hạng mục | Kết quả |
|---|---|
| Lỗi hồi quy đã xác định (test đỏ do thay đổi) | Không còn. Các test đỏ trong quá trình là test mới viết trước khi sửa, hoặc test đã cập nhật có chủ đích (xem bên dưới). |
| Test web (full suite) | 188 file, 1650 test, xanh |
| Test server (full suite) | 64 file, 622 test, xanh |
| Typecheck, lint, boundary | Xanh; boundary 408 (baseline khóa lại sau giảm) |
| Route smoke mock, không cờ và bật cờ | 56/56 cả hai |
| Route smoke real | NV |
| Trình duyệt real, canary hai actor | NV |

## Lỗi flaky quan sát được

- `projects/views/real-screens.test.tsx > POSTs exactly the contract fields and navigates to the created engagement`: một lần timeout 5409 ms khi chạy full suite song song. Chạy riêng 11/11 xanh; lần full suite kế tiếp xanh. Không sửa ngưỡng timeout (không nới để che lỗi). Theo dõi trong OPEN-ISSUES.
- `shell/a11y-audit.test.tsx`: một lần timeout 5011 ms khi chạy cùng nhóm test trong khi có lỗi thiếu import (đã sửa). Sau sửa, xanh.

## Thay đổi hành vi có chủ đích (không phải hồi quy, nhưng người dùng sẽ thấy)

| Thay đổi | Commit | Tác động | Đã cập nhật test |
|---|---|---|---|
| Nhãn "Sessions" → "C2 Sessions" trong menu dự án | `b9d28f3c` | Mock và real | `nav.test`, `shell.test`, `app-routing.real.test`, characterization |
| Ask AI trong real mode đọc đúng menu real | `b9d28f3c` | Nhãn ngữ cảnh đổi (ví dụ `c2`: "Infrastructure" → "Sessions") | Không có test khẳng định nhãn cũ |
| "Awaiting decisions" không đếm stop; có dấu `+` khi giới hạn | `349bcbc5`, `b3195015` | Số có thể thấp hơn | `measures.test`, `overview-page.test` |
| "Active projects" caption khớp tập đếm | `349bcbc5` | Chỉ chữ | `measures.test` |
| Banner: "pending in your projects" thay "await your review" | `b3195015` | Chữ | `overview-page.test` |
| Hàng đợi decision không chứa stop; stop ở vùng Attention | `b3195015`, `837e1d9d` | Danh sách ngắn hơn | `overview-page.test`, `approval-inbox.test` |
| Bố cục Overview: Attention đầu trang, Projects mới, Severity xuống cuối | `837e1d9d` | Vị trí khối | `overview-page.test` (không đổi tiêu đề) |
| Project overview: KPI Decisions không đếm stop; Attention không cộng hai lần | `b3195015` | Số KPI | `project-overview.test` |
| Mật khẩu demo không hiện trong lỗi đăng nhập mock | `ffe85384` | Chữ lỗi | `auth.test` (test mới) |
| Planning-seed theo actor | `d67d2665` | Cờ cũ bị bỏ qua sau deploy | `planning-seed.test` |
| Server `/api/tasks` có thêm trường `limited` | `76826809` | Thêm trường (tương thích) | `t15-inbox` |

## Rủi ro đã biết, chưa có test bảo vệ

- Cờ planning-seed đặt trước deploy (khóa cũ) không được đọc sau deploy. Một brief chưa gửi có thể cần gửi tay.
- Thứ tự khối Overview thay đổi: cần kiểm tay trên real mode với dữ liệu thật.
- Sidebar real chưa có smoke trình duyệt trong vòng này (NV).

## Không làm (ngoài phạm vi, không phải hồi quy)

- Không redeploy 3001 trong vòng này. Container đang chạy vẫn là `d3225f63` (xem OPEN-ISSUES).
