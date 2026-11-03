# 06 · Thứ tự, phụ thuộc, rủi ro và nghiệm thu cho Structural

Trạng thái: **đề xuất để duyệt**. Không có code Structural nào được viết trong giai đoạn này.

## 1. WS-0 (điều kiện tiên quyết, phát hiện trong Phase A)

### Hiện trạng đã xác minh bằng mã

- Query key của real dùng hằng số `REAL_IDENTITY.id = 'local'`, không gắn actor: `features/projects/query.ts` (dòng 16–17, 56), `shell/real-bootstrap.tsx` (dòng 25, khóa bootstrap, không phụ thuộc người dùng).
- Khi đăng nhập, `shell/real-login.tsx` (dòng 38) xóa mọi query real trừ session và bootstrap. Khi unmount, `client.clear()` và `cancelQueries()` (dòng 21).
- Lưu trữ cục bộ của chat đã theo actor (khóa `raptix.real.*.v2` gồm `actorId`), gồm lựa chọn thread, yêu cầu chờ và bản nháp (`features/aichat/session.ts`, dòng 25–26, 100). Khóa `raptix.real.local.*` là bản song song trước thời kỳ actor, chỉ dùng cho dọn dẹp.
- `clearWorkspaceRecovery()` (xóa lựa chọn, yêu cầu chờ và bản nháp, gồm khóa `local`) được gọi ở hai vị trí trong `real-login.tsx` (dòng 98, 129).

Kết luận: rủi ro rò dữ liệu giữa hai người dùng trên cùng trình duyệt đã có biện pháp giảm thiểu. Phần còn lại là **rủi ro dư**, chưa được kiểm trong trình duyệt:
- Query key không gắn actor (chỉ được bảo vệ bởi việc xóa khi đăng nhập).
- Việc xóa khi đăng xuất chưa được kiểm từ đầu đến cuối với hai tài khoản thật.

### Đề xuất

- Lấy actor id từ phiên (nếu có) làm namespace cho query key và khóa lưu trữ. Không có phiên thì giữ `local` (chế độ single-user).
- Kiểm tra bằng trình duyệt trên stack: đăng nhập owner, tạo bản nháp, đăng xuất, đăng nhập viewer; bản nháp và dữ liệu cache của owner không được xuất hiện.
- Xác nhận đường đăng xuất gọi `clearWorkspaceRecovery`.

| Mục | Giá trị |
|---|---|
| Kích thước | S–M |
| Rủi ro | Trung bình (bảo mật); thay đổi nhỏ về khóa cache |
| Thay đổi không đổi | Authentication, authorization, server |

## 2. Phụ thuộc giữa các workstream

```
WS-0 (actor scope) ───────────────┐
                                   ▼
WS-1 (navigation) ──────► WS-2 (decisions) ──────► WS-4 (overview measures)
        │                        ▲                          ▲
        │                        │                          │
        └─────────► WS-3 (C2 workspace) ───────────────────┘
```

- WS-1 không phụ thuộc WS-2 để đổi bảng mục, nhưng nhãn "Team & Approvals" chỉ đổi nội dung sau WS-2.
- WS-2 cần D-02 trước khi chốt số đếm; WS-4 dùng số đếm từ WS-2.
- WS-3 cần D-03 và trạng thái ADR-0095/0098/0099; WS-4 phần "Active sessions" (D-04 lựa chọn B) cần WS-3.

## 3. Thứ tự đề xuất

| Bước | Workstream | Đầu ra | Điều kiện vào |
|---|---|---|---|
| 1 | WS-0 | Namespace theo actor; test trình duyệt owner→viewer | Không |
| 2 | WS-1 (bước 0–2) | Kiểm kê tab id; bảng mục; test characterization | D-01 cho nhãn; không cần cho kiểm kê |
| 3 | WS-1 (bước 3–7) | Alias và sidebar sinh từ bảng | Bước 2 |
| 4 | WS-4 (bước 1–3) | `measures.ts`, `MeasureCard`, định nghĩa và provenance | Không (định nghĩa đọc từ port hiện có) |
| 5 | WS-2 (bước 1–2) | `features/decisions` chỉ đọc; bốn bề mặt chuyển sang | Characterization danh sách hiện có |
| 6 | WS-2 (bước 3–5) | Nhãn "excluding tool approvals"; Team tab; chuông | D-02 cho nhãn cuối |
| 7 | WS-4 (bước 4–7) | Vùng attention; chuyển khối findings | Bước 5 |
| 8 | WS-3 (bước 0–2) | Xác nhận ADR; `C2Workspace`; tab dự án | D-03; ADR |
| 9 | WS-3 (bước 3–7) | Alias c2-*; Infrastructure toàn cục là rollup | Bước 8 |
| 10 | WS-2 (bước 6–7) | Tool approval aggregate (ADR nếu chọn B); closure và library proposal vào inbox | Review server |

Nguyên tắc: mỗi bước là một PR có một mối quan tâm, theo giới hạn diff của repo (≤ 400 dòng mã runtime, ≤ 10 file, `CONTRIBUTING_AGENT.md`). Bước nào vượt giới hạn phải chia nhỏ.

## 4. Ma trận rủi ro tổng hợp

| Rủi ro | Workstream | Mức | Giảm thiểu | Kiểm bằng |
|---|---|---|---|---|
| Rò dữ liệu giữa hai người dùng trên cùng trình duyệt | WS-0 | Trung bình | Namespace actor; kiểm owner→viewer | Trình duyệt trên stack |
| Deep link bị hỏng (`?tab=`, `#/c2-*`, thông báo) | WS-1, WS-3 | Cao | Kiểm kê; alias; test từng địa chỉ | `routes.json`, test alias |
| Tool approval bị hiểu là đã xử lý | WS-2 | Cao | Nhãn phạm vi; liên kết tới hội thoại | Test nhãn; trình duyệt |
| Số đếm đổi làm mất niềm tin vào KPI | WS-2, WS-4 | Trung bình | Định nghĩa đi kèm; ghi chú thay đổi | Test định nghĩa |
| Hiển thị kết nối như thể là quyền truy cập | WS-3 | Cao | Hai trạng thái riêng | Test |
| Command `uncertain` bị coi là thành công | WS-3 | Cao | Giữ trạng thái ledger | Test từng trạng thái |
| Phân quyền hiển thị hành động sai | WS-2, WS-3 | Cao | Hành động lấy từ phản hồi server | Test với viewer, reviewer khác author |
| Mock lệch real | Tất cả | Trung bình | Test song song | Test; route smoke |
| Mất thông tin severity cho chủ dự án | WS-4 | Thấp | Chuyển sang Findings, liên kết rõ | Kiểm trang Findings |
| Vượt ngân sách read tổng hợp | WS-2, WS-4 | Trung bình | Giới hạn `truncated`; đo độ trễ | Đo trước và sau |

## 5. Điều kiện trước khi bắt đầu triển khai

1. Reviewer duyệt các quyết định D-01 đến D-06 (`00-README.md`).
2. Owner xác nhận trạng thái ADR-0095, 0098, 0099 và ADR-0097 (đang có thay đổi chưa commit hoặc là untracked).
3. Môi trường kiểm có đủ: stack có graph (đã có), provider C2 giả hoặc trạng thái 503 được kiểm, runtime LangGraph (cần cho hội thoại và tool approval, hiện không có).
4. Bộ characterization cho mỗi workstream được viết trước khi đổi mã.
5. Dữ liệu canary cho luồng ghi (tạo, duyệt, dừng) và hai tài khoản khác vai trò. Hiện có owner (Admin) và viewer; cần thêm reviewer khác author.

## 6. Tiêu chí nghiệm thu tổng hợp

| Mã | Tiêu chí | Đo bằng |
|---|---|---|
| A1 | Không còn bảng alias viết tay (WS-1) | `grep` |
| A2 | Mọi tab id từng xuất hiện đều resolve (WS-1) | Test bảng |
| A3 | Chỉ `features/decisions` gọi `/api/tasks` (WS-2) | `grep` |
| A4 | Số "Awaiting decisions" bằng tổng của `DecisionInbox` và nhãn nêu phạm vi (WS-2, WS-4) | Test; trình duyệt |
| A5 | Thông báo không đổi trạng thái decision (WS-2) | Test |
| A6 | Mỗi thực thể C2 có một chủ sở hữu (WS-3) | `grep` |
| A7 | Bốn địa chỉ c2-* resolve và giữ tham số (WS-3) | Test; trình duyệt |
| A8 | Infrastructure toàn cục không có nút ghi (WS-3) | Test; trình duyệt |
| A9 | Mỗi measure có định nghĩa; chú thích trùng định nghĩa (WS-4) | Test |
| A10 | Vùng attention đứng đầu; số khối top-level ≤ 6 (WS-4) | DOM |
| A11 | Không có rò dữ liệu giữa hai actor trên cùng trình duyệt (WS-0) | Trình duyệt owner→viewer |
| A12 | Route smoke mock và real không có lỗi mới (tất cả) | `route-smoke` |
| A13 | Typecheck, lint, boundary, full test, build production đều exit 0 (tất cả) | `final-gate.sh` |
| A14 | Không đổi authentication, authorization và API contract ngoài các thay đổi có ADR | Diff |

## 7. Quyết định cần reviewer (tổng hợp)

| Mã | Câu hỏi | Ảnh hưởng |
|---|---|---|
| D-01 | Nhãn và ID chính tắc của mục dự án | WS-1, WS-3 |
| D-02 | Tool approval: không ưu tiên, nhãn phạm vi, hay aggregate có ADR | WS-2, WS-4 |
| D-03 | Infrastructure có chứa Runtime agents và Campaigns hay không | WS-3, WS-1 |
| D-04 | Overview: 4 measure + vùng attention, hay 6 measure theo checklist | WS-4 |
| D-05 | "Switch to demo mode" trong menu tài khoản real | WS-1 (nhỏ) |
| D-06 | Mật khẩu demo trong thông báo sai mật khẩu ở mock (S-03) | Ngoài workstream |

## 8. Đề xuất ADR (ứng viên, chỉ khi đủ ba điều kiện của skill domain-modeling)

1. **Ownership của C2 infrastructure và C2 sessions** (WS-3): khó đảo ngược, người đọc sau sẽ hỏi vì sao tách như vậy, và có đánh đổi thật (gộp một màn hình hay tách theo miền).
2. **Phạm vi của tổng hợp quyết định (decision aggregate)** (WS-2, D-02 lựa chọn B): ảnh hưởng hiệu năng và phân quyền, khó đảo ngược sau khi có client dùng.
3. **Provenance của measure trên trang tổng quan** (WS-4): nếu chọn đưa định nghĩa và as-of vào contract port, đây là thay đổi contract cần ghi lý do.

Không đề xuất ADR cho đổi nhãn, đổi tab id hay đổi bố cục: các thay đổi đó dễ đảo ngược và không có đánh đổi đáng ghi.

## 9. Việc không làm trong giai đoạn này

- Không sửa code Structural (theo yêu cầu).
- Không sửa `GLOSSARY.md`, ADR, hay tài liệu có thay đổi chưa commit của owner.
- Không thêm sub-agent cho `design-it-twice` (chưa được yêu cầu).
- Không thay đổi authentication, authorization, hay API contract.
