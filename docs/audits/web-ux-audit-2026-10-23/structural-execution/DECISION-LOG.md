# Nhật ký quyết định

Mỗi quyết định ghi: phân loại (AUTO, DEFAULT-APPROVED, CONDITIONAL, BLOCKED), lý do, bằng chứng, và ảnh hưởng.

## Quyết định mặc định từ prompt (DEFAULT-APPROVED)

| Mã | Quyết định áp dụng | Ghi chú triển khai |
|---|---|---|
| D-01 | Chuẩn hóa thuật ngữ; giữ mọi alias cũ; không đổi route key hay query param chỉ vì thẩm mỹ | Tab id giữ nguyên theo từng mode. Nhãn "Sessions" → "C2 Sessions" (`b9d28f3c`) |
| D-02 | Phương án A: tool approval không nằm trong số đếm workflow decisions; Emergency Stop là Attention | Số đếm "Awaiting decisions" loại `active-stop` (`349bcbc5`). Không có aggregate server mới |
| D-03 | Infrastructure toàn cục là read-only rollup; không di chuyển Runtime agents hay Campaigns khi chưa kiểm điểm vào | Chưa thực hiện (WS-3) |
| D-04 | 4 Measures và vùng Attention; không mở rộng thành 6 KPI | Measures có trạng thái `value`, `zero`, `not-recorded`, `unavailable`, `pending` (`349bcbc5`) |
| D-05 | Production real mặc định không có shortcut sang demo; mock mode giữ nguyên | Quick win trước đã gate theo mode. Kiểm lại ở WS-4B/WS-1 nếu còn |
| D-06 | Không hiển thị mật khẩu demo trong lỗi đăng nhập | Thuộc S-03, làm như follow-up nhỏ nếu còn |

## Quyết định kỹ thuật (AUTO)

### DL-01 · WS-0 không đổi cơ chế cache; chỉ thêm namespace theo actor

- Bằng chứng: `shell/real-login.tsx` render `ActorQueries key={actor}`, tạo `QueryClient` mới cho mỗi actor, và hủy client cũ khi unmount. Cache đã được cách ly theo actor qua tầng này.
- Làm thêm namespace: hằng số `REAL_IDENTITY.id = 'local'` còn trong key project/members, vi phạm tiêu chí "không phụ thuộc hằng số local khi đã xác thực". Đây là lớp phòng thủ thứ hai, không phải lỗi đang khai thác được.
- Không làm: thay cơ chế remount, thay `clearWorkspaceRecovery`, thay authentication.

### DL-02 · Bootstrap giữ khóa deployment-level

- `['real', 'bootstrap', 'local']` nằm ngoài `ActorQueries`. Dữ liệu là `CapabilitiesDocument` (`apps/shared/web-contracts/src/capabilities.ts`), không có trường theo người dùng. Giữ nguyên.

### DL-03 · planning-seed đưa actor vào khóa

- `features/aichat/planning-seed.ts` dùng `sessionStorage` theo engagement. Đổi thành khóa theo actor để cờ do actor A đặt không kích hoạt tin nhắn tự động cho actor B trong cùng tab.

### DL-04 · Commit WS-0 có 11 file (vượt 10)

- Lý do: các file liên quan không tách được mà vẫn biên dịch. `create-page.tsx` dùng `cacheActor` cho cả key và `markPlanningSeed`; tách hai phần làm commit trung gian không typecheck.
- Thay đổi chỉ là một concern (namespace theo actor). Không có thay đổi API.

### DL-05 · Tab id chính tắc giữ nguyên theo mode

- Lý do: D-01 cấm đổi query parameter vì thẩm mỹ. Các call site dùng chung (`planning`, `team`, `close`) được alias bởi `resolveProjectTab`. Đổi id mock sang real (hoặc ngược lại) sẽ đổi URL demo và link đã lưu.
- Thay thế: một module với `key` không đổi theo mode, `tab` theo mode, `legacy` theo mode. Bảng alias viết tay bị xóa.

### DL-06 · Định nghĩa "Active projects" giữ tập đếm, đổi mô tả cho khớp

- Tập đếm: `approved`, `planning`, `active`, `running`. Contract thật (`ENGAGEMENT_STATUSES`) chỉ có `planning` và `running`; `approved`, `active` là từ vựng demo.
- Không đổi số liệu không có bằng chứng. Mô tả liệt kê đúng bốn trạng thái, ghi chú nguồn trong `measures.ts`.

### DL-07 · "Awaiting decisions" là toàn bộ decision trong phạm vi, không chỉ của người dùng

- `OverviewTask.awaitingActor` đánh dấu việc của người dùng. Số đếm vẫn là mọi decision trong phạm vi (đã là vậy trước khi sửa). Banner đổi chữ để không gọi đó là "your review". Phân tách "việc của bạn" sẽ là phần của WS-2 (read model).

## Quyết định của phiên tiếp theo (vòng 5)

### DL-09 · Commit `000dea15` vượt 10 file

- Lý do: giới hạn `inboxLimits`, consumer của nó và phần Team tab (closure, library, liên kết tool approval) đổi cùng lúc; phần Team dùng export mới của closure và capabilities. Tách commit sẽ để lại commit không biên dịch.

### DL-10 · Closure và library được đọc theo từng project, chưa vào số đếm Overview

- Bằng chứng: `GET /api/engagements/:id/closure` và `GET /api/engagements/:id/library-proposals` đã có và đã có consumer. Aggregate `/api/tasks` không có hai loại này (BL-03).
- Quyết định: Team tab của project hiển thị hai loại đang chờ, ghi rõ "chưa tính trên Overview". Không thay đổi server aggregate, vì cần đánh giá phân quyền từng miền và consumer (điều kiện trong plan 02, mục 8.6).

### DL-11 · `limitedKinds` bổ sung cho cờ giới hạn

- Lý do: cờ `limited` chung làm số decision bị đánh dấu là cận dưới khi chỉ danh sách stop đạt trần. Trường mới chỉ cho biết loại nào đạt trần; `limited` giữ nguyên nghĩa cũ.

### DL-12 · `GLOBAL_RESOURCE_PAGES` thuộc module navigation

- Lý do: đây là một quy tắc khả dụng thứ hai bên cạnh bảng menu (GLOBAL-1). `routes.ts` re-export để import của host không đổi.

### DL-13 · Ngoại lệ `.gitignore` cho thư mục nguồn `features/c2/workspace`

- Lý do: quy tắc `workspace/` dành cho dữ liệu runtime, và không neo gốc vì kết quả benchmark dựa vào nó. Một ngoại lệ hẹp mở lại đúng thư mục nguồn. Không tracked file nào bị ảnh hưởng.

### DL-14 · Địa chỉ `c2-console` nói rõ không có console tương tác

- Bằng chứng: không có nhánh riêng cho `c2-console` trong tab C2 real; trước đây hiển thị danh sách session như thể có console.
- Quyết định: thông báo trung thực, giữ danh sách session. ADR-0095 vẫn Proposed, không triển khai PTY.

### DL-15 · Khối Severity trên Overview đưa vào disclosure đóng mặc định

- Bằng chứng: trang Findings toàn cục đã có thẻ mức độ và thanh phân bố (`all-findings.tsx`). Dữ liệu và đánh giá rủi ro giữ nguyên.

### DL-16 · Sửa harness route smoke: gắn response theo route đã phát request

- Bằng chứng: route `asset-map` báo `api-error` do request treo của route `project` (đã khai báo) hoàn tất trong lúc route `asset-map` đang chạy. Mở trực tiếp `asset-map` không gọi C2 (đo bằng probe).
- Quyết định: chỉ tính lỗi cho route đã phát request. Không nới tiêu chí; route của chính nó vẫn bị kiểm đầy đủ.

### DL-17 · Canary không bắt được mutation bỏ `key={actor}`; test đơn vị bắt được

- Bằng chứng: canary đăng xuất trước khi đổi actor, nên `ActorQueries` unmount và xóa client. Mutation chỉ lộ khi actor đổi mà không unmount. `real-login.test.tsx` (test in-flight history) đỏ với mutation. Đã khôi phục file.
- Quyết định: giữ cả hai; ghi giới hạn của canary trong báo cáo.

### DL-18 · FLAKY-1: dán thay vì gõ từng ký tự ở hai ô dài của form tạo dự án

- Bằng chứng: phần test chiếm ~2.5 s của ~4 s khi chạy riêng. Sau khi dán: ~1 s.
- Quyết định: không nới ngưỡng timeout. Khẳng định về payload giữ nguyên.

### DL-19 · Drawer điều hướng mobile có nút đóng và quy tắc focus

- Bằng chứng: drawer chỉ đóng bằng nền hoặc Escape (UX-25). Quyết định: thêm nút "Close navigation", focus vào drawer khi mở, trả focus khi đóng.

### DL-20 · Huy hiệu số trên sidebar nêu rõ nó đếm gì

- Bằng chứng: huy hiệu chỉ có "N pending" (UX-15). Quyết định: ghi nghĩa cụ thể cho mục Projects và Infrastructure. Không sửa lặp tên project (lựa chọn bố cục).

### DL-21 · Quy tắc màu primary và accent ghi vào `AGENTS.md`

- Bằng chứng: quy tắc chỉ nằm trong comment token (UX-20). Quyết định: ghi lại đúng nội dung comment; không đổi giá trị token.
