# Báo cáo cuối · Structural (vòng 4)

Mã sản phẩm đã kiểm: `ffe85384`. Base tài liệu: `d3225f63`. Nhánh `frontend`.

## A. Tóm tắt

Vòng này thực thi phần khả thi của Structural trong phạm vi đã duyệt, theo thứ tự WS-0, WS-1, WS-4A, WS-2, WS-4B, WS-3. Kết quả:

- **Đã làm và kiểm chứng (mock và đơn vị):** cách ly key theo actor (WS-0), một bảng điều hướng dự án cho hai mode (WS-1), định nghĩa measure và loại stop khỏi decision (WS-4A), một read model cho task inbox kèm cờ giới hạn ở server (WS-2, phần đọc), vùng Attention và bố cục Overview (WS-4B), sửa lỗi mật khẩu demo trong thông báo lỗi (S-03).
- **Làm một phần:** WS-2 (tab Team và closure/library chưa làm), WS-3 (chỉ kiểm mã, phần ghi và C2Workspace bị chặn bởi ADR chưa duyệt).
- **Chưa kiểm được:** canary hai tài khoản trên trình duyệt, route smoke real và trình duyệt real (cần stack).
- **Quyết định vận hành cần người dùng:** có redeploy 3001 hay không. Container đang chạy `d3225f63`, không phải HEAD.

Các thay đổi đều có test; hành vi người dùng nhìn thấy đã được ghi trong `REGRESSION-REPORT.md`.

## B. Bảng hoàn thành

| WS | Kế hoạch | Đã làm | Đã kiểm (mock/đơn vị) | Chặn | Ghi chú |
|---|---|---|---|---|---|
| WS-0 | Namespace theo actor; canary | Key project/members theo actor; planning-seed theo actor | Test đơn vị, full suite | Canary trình duyệt (BL-01) | Cách ly cache đã có sẵn qua `QueryClient` theo actor |
| WS-1 | Một bảng điều hướng; alias | Module `features/navigation`; alias sinh từ bảng; header đúng mode; "C2 Sessions" | Characterization, module test, smoke 56/56 hai cờ | Real smoke (NV) | Giữ tab id (D-01) |
| WS-4A | Measures và provenance | `measures.ts`; trạng thái đủ năm; loại stop | Test measure | Provenance asOf (PROV-1) | D-04 |
| WS-2 | Read model decisions | `features/decisions`; cờ `limited` ở server; tách stop | Server 7 test; client; full suite | Tab Team (TEAM-1); BL-03 | D-02 (A) |
| WS-4B | Bố cục Overview | Attention đầu trang; Projects; thứ tự khối | Test; Playwright 4 khung nhìn | Real (NV) | Năm khối top-level |
| WS-3 | C2 workspace | Kiểm mã: global infrastructure không có nút ghi | Route smoke mock | ADR-0095/0098/0099 (BL-02) | Không đổi code C2 |
| S-03 (D-06) | Mật khẩu demo | Bỏ khỏi thông báo | Test đơn vị | — | |

## C. Tóm tắt kỹ thuật

### Kiến trúc trước và sau

- **Cache và storage (WS-0).** Trước: key project/members có hằng số `local`. Sau: lấy actor từ phiên, `local` là dự phòng cho single-user. Cơ chế remount `ActorQueries` giữ nguyên.
- **Navigation (WS-1).** Trước: hai bảng menu viết tay, ba bảng alias, header đọc bảng mock. Sau: một bảng `SECTIONS`; menu, alias và highlight sinh từ đó.
- **Decision (WS-2).** Trước: bốn cache cho một endpoint; stop đếm như decision; giới hạn 25 dòng im lặng. Sau: một nơi gọi endpoint, một định nghĩa; cờ `limited` từ server.
- **Overview (WS-4).** Trước: định nghĩa trong JSX; banner một dòng; bố cục cũ. Sau: `measures.ts` là nguồn duy nhất; vùng Attention; Projects; thứ tự khối mới.

### Module được tạo

- `features/navigation/project-sections.ts` (+ `index.ts`, test)
- `features/decisions/{remote.ts, model.ts, index.ts}` (+ test)
- `features/overview/measures.ts` (+ test)

### Logic lặp đã loại bỏ

- Ba bảng alias viết tay (`router/aliases.ts`): đã xóa.
- Hai bảng menu viết tay: sinh từ một bảng.
- Bốn key cache và hai nơi gọi trực tiếp `/api/tasks`: còn một nơi gọi.
- Đếm stop như decision ở bốn chỗ: một định nghĩa.

### Contract đã đổi

- Server `GET /api/tasks`: thêm `limited` (bool, tương thích ngược).
- Port overview `tasks()`: trả `{ items, limited }` (nội bộ client; mock và real đã cập nhật).
- Không đổi authentication, authorization, hay endpoint ghi.

### Cải thiện navigation và UX

- Header không còn đọc menu mock trong real mode.
- "C2 Sessions" tránh nhầm với phiên đăng nhập.
- Overview có vùng Attention đầu trang; số đếm có dấu `+` khi giới hạn; "Not recorded" và "Unavailable" không hiện là 0.
- Approval inbox tách stop khỏi decision.

## D. Kết quả kiểm thử

| Hạng mục | Kết quả |
|---|---|
| Typecheck web / server | exit 0 / exit 0 |
| Lint web (toàn bộ) | exit 0 |
| Boundary (strict) | 408 vi phạm; baseline khóa lại (giảm từ 411) |
| Test web | 188 file, 1650 test, xanh |
| Test server | 64 file, 622 test, xanh |
| Build mặc định | exit 0 (scratchpad) |
| Build bật cờ | exit 0 (scratchpad) |
| Route smoke mock, không cờ | 56/56 |
| Route smoke mock, bật cờ | 56/56 |
| Route smoke real | NV |
| Playwright Overview | 4 khung nhìn, không tràn, không lỗi trang |
| Canary hai actor | NV |

Chi tiết lệnh và kết quả: `VERIFICATION-LOG.md`.

## E. Rủi ro còn lại

### Lỗi đã xác minh

- Không có lỗi hồi quy đã xác định trong full suite và smoke mock.
- Flaky timeout một lần (`real-screens`), đã theo dõi (FLAKY-1).

### Rủi ro tiềm ẩn

- Số "Awaiting decisions" có thể thấp hơn trước (stop bị loại). Đã ghi trong caption.
- Thứ tự khối Overview thay đổi; người dùng quen vị trí cũ cần thời gian làm quen.
- Cờ planning-seed cũ bị bỏ qua sau deploy (PSEED-1).

### Thiếu môi trường

- Stack real (Docker) không chạy trong vòng này: real smoke và trình duyệt real là NV.
- Không có tài khoản thứ hai để canary: BL-01.

### Thiếu ADR hoặc quyết định

- ADR-0095/0098/0099 Proposed (BL-02); D-03 chờ chủ sản phẩm.
- Provenance asOf cần contract server (PROV-1; cần ADR theo plan 06 mục 8).
- Tab Team (TEAM-1) cần xác nhận nội dung.

### Cải tiến tương lai

- Bảng đếm đầy đủ Pending/Resolved/Unavailable/Truncated.
- Liên kết Ask AI tới tool approval theo ngữ cảnh.
- Nhóm follow-up nhỏ (mục 11 prompt): UX-15, 18, 20, 25.

## F. Lịch sử git

Base: `d3225f63`. Các commit của vòng này (cũ đến mới):

| Commit | Workstream | Nội dung |
|---|---|---|
| `d67d2665` | WS-0 | Key project/members và planning-seed theo actor |
| `b9d28f3c` | WS-1 | Bảng điều hướng một nguồn; "C2 Sessions" |
| `349bcbc5` | WS-4A | Measures; loại stop khỏi decision |
| `76826809` | WS-2 (server) | Cờ `limited` của task inbox |
| `b3195015` | WS-2 (client) | Read model decisions; consumer |
| `837e1d9d` | WS-4B | Attention đầu trang; Projects |
| `304df2e8` | WS-4B | Ảnh bằng chứng Overview |
| `ffe85384` | S-03 | Mật khẩu demo không trong lỗi |
| (commit tài liệu cuối) | — | Thư mục `structural-execution/` và ảnh WS-1 |

HEAD cuối: xem `git log -1` (commit tài liệu, sau `ffe85384`).

## G. Đề xuất giai đoạn tiếp theo

Các mục nằm ngoài Structural, không tự triển khai ở vòng này:

1. **AI Workspace duplication.** Hai bề mặt (`mock-workspace`, `workspace`) cùng ý định; cần chốt ai là nguồn chính trước khi hợp nhất.
2. **Findings presentation.** Đưa phân tích từ Overview sang Findings đầy đủ, rồi bỏ khỏi Overview.
3. **Plans/Planning.** Thống nhất ở tầng business logic sau khi chốt D-01 cho mock.
4. **Design system.** Gom primitive KPI/chip/pill vào `ui/` (UX-21); gate contrast trong CI (UX-19, UX-20).
5. **Demo bundle separation.** Tách code demo khỏi bundle production (UX-22, UX-05); hiện chỉ gate route.
6. **Accessibility.** Pass keyboard và screen reader; focus; hit target (UX-25).
7. **Real runtime validation.** Chạy stack, canary hai tài khoản, route smoke real; kiểm cả Overview real với dữ liệu thật.
8. **C2 (WS-3).** Sau ADR và D-03: C2Workspace, alias c2-*, rollup Infrastructure.

## Gói chia sẻ

`docs/audits/web-ux-audit-2026-10-23.zip` đã được tạo lại từ thư mục audit. Gói không được commit (quy ước của dự án). Gói có version và HEAD ghi trong `README.md`; bằng chứng trước vòng này không được coi là bằng chứng của HEAD mới.
