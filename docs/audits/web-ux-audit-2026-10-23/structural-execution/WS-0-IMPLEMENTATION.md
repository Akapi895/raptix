# WS-0 · Cách ly theo actor (Trạng thái: IMPLEMENTED; canary trình duyệt BLOCKED)

## Trước

- Cache real của project và members khóa bằng hằng số `REAL_IDENTITY.id = 'local'` (`features/projects/query.ts`).
- Mỗi actor đã có `QueryClient` riêng (`shell/real-login.tsx`, `ActorQueries key={actor}`), nên rò rỉ cache không xảy ra qua đường này. Phần dư là key không phản ánh actor.
- `planning-seed` (cờ một lần, `sessionStorage`) khóa theo engagement: cờ do actor A đặt có thể khiến actor B gửi brief trong cùng tab.

## Sau

- Key project (`list`, `detail`) và members lấy actor từ phiên đã xác thực qua `useProjectCacheActor()`. Khi không có phiên (single-user), giữ `local`.
- Cờ planning-seed khóa theo actor và engagement.
- Không đổi authentication, authorization, API contract, `clearWorkspaceRecovery`, hay cơ chế remount `ActorQueries`.

## Yếu tố UX

Không có UX-ID trực tiếp. Liên quan S-items: không có. Đây là củng cố dữ liệu.

## File đã đổi (commit `d67d2665`, 11 file)

- `features/projects/query.ts`, `query.test.tsx` (mới), `detail-query.ts`, `index.ts`
- `features/projects/views/create-page.tsx`, `features/planning/query.ts`, `features/aichat/conversation-query.ts`
- `features/aichat/planning-seed.ts`, `planning-seed.test.ts`, `views/workspace.tsx`, `views/workspace.test.tsx`

Vượt 10 file: xem DECISION-LOG DL-04.

## Quyết định

DL-01 (giữ cơ chế remount, chỉ đổi key), DL-02 (bootstrap giữ khóa deployment-level), DL-03 (planning-seed theo actor), DL-04 (11 file).

## Kiểm thử

- Test mới đỏ trên mã cũ, xanh sau sửa: 2 trường hợp actor trong `query.test.tsx`; 1 characterization single-user xanh.
- `planning-seed.test.ts`: thêm test actor khác không thấy cờ.
- Đã có sẵn và vẫn xanh: `real-login.test.tsx` (lịch sử in-flight của actor khác không lộ; bản nháp plaintext bị xóa khi đổi actor).
- Full suite: 184 file, 1620 test sau commit (mốc này); sau đó các vòng khác: 188 file, 1650 test.

## Đã xác minh

- Đọc mã: mọi đường đăng xuất/hết hạn/đổi phiên (`RealLoginGate`, `RealLogin`, `header.tsx`, `raptix:session-change`) đều đi qua `clearWorkspaceRecovery` và hủy/xóa query real.
- Kiểm kê storage: chat, findings, capture, asset-map đều theo actor; findings và capture nằm trong danh sách dọn dẹp.
- Bootstrap (`['real','bootstrap','local']`) trả `CapabilitiesDocument` cấp deployment, không có trường theo người dùng (`apps/shared/web-contracts/src/capabilities.ts`).

## Chưa xác minh

- Canary trình duyệt owner → viewer trên stack: **NV** (BL-01). Không có tài khoản thứ hai trên môi trường cho phép, và không tạo tài khoản trên 3001.

## Rủi ro hồi quy

- Thấp. Thay đổi key chỉ đổi định danh cache trong một `QueryClient` đã theo actor.
- Cờ planning-seed cũ (khóa không có actor) bị bỏ qua sau khi deploy. Hệ quả: một brief chưa gửi trước khi deploy có thể cần gửi tay. Chấp nhận được; ghi vào OPEN-ISSUES.

## Còn tồn tại

- `features/team/query.ts` đọc members với key không có actor. Vẫn an toàn nhờ `QueryClient` theo actor; để nguyên, không mở rộng phạm vi.
- Asset-map lưu vị trí xem theo actor và không xóa khi đăng xuất. Đây là tiện ích theo người dùng, không lộ giữa các actor (module đã ghi chú).
