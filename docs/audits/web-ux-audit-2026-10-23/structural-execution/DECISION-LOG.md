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
