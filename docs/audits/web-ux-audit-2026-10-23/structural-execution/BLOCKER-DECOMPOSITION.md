# Phân rã blocker

Phiên tiếp nối (vòng 5). Mỗi blocker của vòng trước được tách thành subtask. Phân loại: READY, TESTABLE_WITH_FIXTURE, READ_ONLY_SAFE, CONDITIONAL, TRULY_BLOCKED. Cột "Kết quả" ghi những gì đã làm trong vòng này.

## BL-01 · Canary actor trên trình duyệt

| Subtask | Loại | Kết quả |
|---|---|---|
| Owner → viewer trên một browser context, stack cô lập có viewer thật | TESTABLE_WITH_FIXTURE | Đã làm: 10/10 kiểm tra đạt (`WS-0-CANARY-REPORT.md`) |
| Danh sách project của viewer không chứa dữ liệu owner, cả khi cache cũ còn | TESTABLE_WITH_FIXTURE | Đã làm: không xuất hiện trong 4 giây sau đăng nhập viewer |
| Storage của session không chứa khóa định danh owner sau đăng xuất | TESTABLE_WITH_FIXTURE | Đã làm: không còn khóa nào chứa định danh owner hay project riêng |
| Thay phiên ở tab thứ hai, tab thứ nhất bỏ dữ liệu owner | TESTABLE_WITH_FIXTURE | Đã làm: đạt |
| Bản nháp chat (`raptix.real.draft.v2`) và lựa chọn thread | TRULY_BLOCKED cho end-to-end | Cần thread runtime; stack không có LangGraph. Phần cô lập đã có unit test (`session.test.ts`, `real-login.test.tsx`). |
| Mutation: bỏ `key={actor}` của `ActorQueries` | TESTABLE | Test đơn vị `real-login.test.tsx` đỏ (đã xác nhận). Canary không đỏ vì đường này không đi qua đăng xuất; ghi rõ trong báo cáo |

## BL-02 · ADR-0095/0098/0099 và C2

| Subtask | Loại | Kết quả |
|---|---|---|
| Ownership C2 trong tài liệu và code (Provider, Listener, Profile, Session, Access, Command) | READY | Kế hoạch: cập nhật khi xong (`WS-3-COMPLETION.md`) |
| C2Workspace read-only: danh sách session, chi tiết, trạng thái access, trạng thái command | READ_ONLY_SAFE | Kế hoạch: cập nhật khi xong (`WS-3-COMPLETION.md`) |
| Alias c2-channel/c2-session/c2-console giữ tham số | READY | Kế hoạch: kiểm bằng test |
| Trạng thái provider unavailable/empty/loading | TESTABLE_WITH_FIXTURE | Kế hoạch: kiểm bằng test |
| Ghi command, lease, dispatch | TRULY_BLOCKED | ADR-0098/0099 Proposed; owner chưa duyệt. Không làm. |
| Interactive PTY console | TRULY_BLOCKED | ADR-0095 Proposed |

## BL-03 · Closure và library proposal chưa có trong aggregate `/api/tasks`

| Subtask | Loại | Kết quả |
|---|---|---|
| Đọc closure request đang chờ theo project qua `GET /api/engagements/:id/closure` (contract có sẵn) | READY | Kế hoạch: Team tab của project (`WS-2-COMPLETION.md`) |
| Đọc library proposal đang chờ review theo project qua `GET /api/engagements/:id/library-proposals` (trạng thái `proposed`) | READY | Kế hoạch: cùng mục trên |
| Đưa hai loại vào số đếm overview | CONDITIONAL | Cần đổi server aggregate: phân quyền từng miền, consumer, test. Không làm trong vòng này; ghi điều kiện mở lại. |
| Endpoint ghi mới | TRULY_BLOCKED | Không được tạo theo prompt |

## NV-1 · Real route smoke và real flows

| Subtask | Loại | Kết quả |
|---|---|---|
| Route smoke real trên stack cô lập | TESTABLE_WITH_FIXTURE | Đang chạy trên stack của vòng này (kết quả trong `P0.3` của `VERIFICATION-LOG.md`) |
| Real overview/projects/team/settings bằng trình duyệt | TESTABLE_WITH_FIXTURE | Chụp và kiểm trên stack |

## TEAM-1 · Tab Team & Approvals

| Subtask | Loại | Kết quả |
|---|---|---|
| Phân biệt membership/roles và decision list | READY | Kế hoạch |
| Liên kết tới tool approval trong AI Workspace | READY | Kế hoạch (chỉ liên kết, không đưa tool approval vào decision) |
| Phân biệt quyền xem và quyền thực hiện | READY | Chú thích trên danh sách; quyền thực tế do server kiểm trên trang từng quyết định |

## PROV-1 · Provenance `asOf` theo measure

| Subtask | Loại | Kết quả |
|---|---|---|
| Hiển thị thời điểm đọc (đã có "Read at") | READY | Có sẵn |
| Thời điểm nguồn theo từng số | CONDITIONAL | Cần contract server trả thời điểm nguồn; không tự tạo timestamp. Ghi điều kiện mở lại. |

## DEP-1 · Redeploy 3001

TRULY_BLOCKED: thao tác production, cần quyết định của chủ hệ thống. Không làm.

## CLEAN-1 · Hai file tạm ngoài repo

TRULY_BLOCKED bởi bộ kiểm tra an toàn: cần người dùng xóa tay.

## FLAKY-1 · Timeout `real-screens`

READY: điều tra nguyên nhân (khởi tạo nặng trong test), không nới ngưỡng.

## Follow-up nhỏ (mục 8 prompt)

| Mã | Loại | Ghi chú |
|---|---|---|
| UX-15, UX-18, UX-20, UX-25 | READY (theo từng mục có ảnh trước/sau) | Xử lý trong vòng này khi có bằng chứng |
| GLOBAL-1 | READY | Đưa `GLOBAL_RESOURCE_PAGES` vào `features/navigation` |
| MOCK-1 | READY | Đồng bộ danh sách tab demo với module, không phá route mock |

## Kết quả vòng 5

- BL-01: canary 10/10 trên stack cô lập; draft/thread NV (cần runtime).
- BL-02: thực thi C2 và PTY vẫn BLOCKED (ADR Proposed). Phần đọc, ownership, route và thông báo console đã làm.
- BL-03: đọc closure và library theo project đã làm; aggregate Overview vẫn có điều kiện (server).
- NV-1: smoke real đạt (0 mới); Overview/drawer/tablet real NV.
- TEAM-1: đã làm.
- PROV-1: vẫn có điều kiện (server).
- DEP-1, CLEAN-1: cần người dùng.
- FLAKY-1: đã làm (dán thay gõ).
- UX-15/18/20/25, GLOBAL-1: đã làm; MOCK-1 giữ có chủ đích.
