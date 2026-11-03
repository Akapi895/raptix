# Báo cáo hồi quy cuối (vòng 5)

Mã sản phẩm: `67ddf571` (nhánh `frontend`). Thay đổi của vòng này: 13 commit trên `692577a5` (xem `FINAL-STRUCTURAL-CLOSURE.md`).

## Gate cuối

| Kiểm | Lệnh | Kết quả |
|---|---|---|
| Typecheck web | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Typecheck server | `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| Lint web (toàn bộ) | `npx eslint .` | exit 0 |
| Boundary (strict) | `node tools/check-boundaries.mjs --strict` | 408 vi phạm; khớp baseline (exit 0) |
| Test web | `npx vitest run --maxWorkers=4` | 190 file, 1664 test, xanh |
| Test server | `npx vitest run --config vitest.config.ts` | 64 file, 623 test, xanh |
| Build mặc định | `vite build --outDir <scratchpad>` | exit 0 |
| Build bật cờ | `VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 vite build` | exit 0 |
| Route smoke mock, không cờ | `RAPTIX_VERIFY_FLAGS=` | 56/56 pass; 0 failing; 0 declared |
| Route smoke mock, bật cờ | `RAPTIX_VERIFY_FLAGS=prototype,assetMap` | 56/56 pass; 0 failing; 0 declared |
| Route smoke real (stack cô lập, HEAD) | `route-smoke --modes real` | 42 pass; 14 khai báo; **0 lỗi mới** |
| Canary actor (stack cô lập, HEAD) | `actor-canary.mjs` | 10/10 |
| Tab Team real (owner sáng/tối, viewer sáng) | `team-check.mjs` | 0 px tràn; 0 lỗi trang |

Kết quả JSON và log của smoke real: `evidence/WS-real-route-smoke-final.json|log`. Canary: `evidence/WS0-actor-canary-run2.json`.

## Smoke real: 14 khai báo

Tất cả đều thuộc baseline và có nguyên nhân môi trường đã ghi:

- `fixture-missing` (9): preflight, operation, operation-schedule, agent, ai-plan, ai-plan-review, ai-plan-compare, ai-branch, c2-channel, c2-session, c2-console. Stack không tạo runtime, nên không có operation, plan, agent hay C2 session thật.
- `api-error` (3): project, operation-new, c2. Nguyên nhân: `GET .../c2/sessions` trả 503 vì stack không có C2 server (Sliver).
- Ghi chú: route `infrastructure` không xảy ra lỗi trong lần này (đã khai báo).

So với lần trước: `asset-map` nay đạt (trước đó lỗi do harness, đã sửa, xem dưới).

## Lỗi phát hiện và sửa trong vòng này

| Lỗi | Phát hiện | Sửa | Commit |
|---|---|---|---|
| Ảnh "dark" của Overview thực ra là sáng | Đo `html.dark` và màu nền | Chụp lại bằng cách đổi theme qua menu; đính chính tài liệu | `65eb3b14` |
| Route smoke gắn lỗi API của route trước vào route `asset-map` | Probe và đọc code harness | Gắn response theo route đã phát request (không nới tiêu chí) | (harness, commit kèm tài liệu) |
| Nút thành viên disabled của viewer không có lý do | Probe trên stack | `IconButton` tôn trọng `title` của caller; nút Invite có lý do | `67ddf571` |
| Thư mục `features/c2/workspace` bị `.gitignore` bỏ qua | `git check-ignore` | Ngoại lệ hẹp cho thư mục nguồn | `01b9d0e9` |
| Test tạo dự án chậm (gần ngưỡng) | Đo thời gian khi chạy riêng | Dán thay vì gõ hai ô dài (không nới ngưỡng) | `c5714006` |
| Cờ giới hạn chung làm số decision bị đánh dấu sai | Đọc logic và test server | `limitedKinds` | `52f587aa`, `000dea15` |

## Hồi quy đã xác định

Không có hồi quy đã xác định trong full suite, smoke mock (cả hai cấu hình), smoke real (0 lỗi mới) và canary.

## Lỗi flaky

- Một lần timeout của test tạo dự án khi chạy song song (trước sửa). Sau sửa: 11/11 xanh khi chạy riêng và trong full suite.
- Một lần timeout `a11y-audit` trong lúc có lỗi import (đã sửa). Sau sửa: xanh.

## Thay đổi hành vi có chủ đích (người dùng sẽ thấy)

| Thay đổi | Ảnh hưởng | Commit |
|---|---|---|
| Số "Awaiting decisions" và "Decisions" không tính stop; số có dấu `+` khi danh sách bị giới hạn | Số có thể thấp hơn trước | `349bcbc5`, `b3195015` |
| Team tab có "Also waiting" (closure và library), và footer tới AI Workspace | Thêm khu vực mới | `000dea15` |
| Khối Severity trên Overview là disclosure đóng | Ẩn mặc định | `990c4a4b` |
| Địa chỉ `c2-console` có thông báo "không có console tương tác" | Thông báo mới | `9efa9f11` |
| Drawer mobile có nút "Close navigation" và quản lý focus | Nút mới | `b9d2b8a7` |
| Huy hiệu sidebar có nghĩa rõ ràng | Nhãn truy cập đổi | `b9d2b8a7` |
| Nút tooltip của control disabled hiện lý do thay vì nhãn | Tooltip đổi | `67ddf571` |

## Rủi ro còn lại

- Canary không bắt được mutation bỏ `key={actor}` (đã ghi, bắt bằng test đơn vị).
- Draft chat và thread: chưa có canary trình duyệt (cần runtime).
- Real: Overview, Team và sidebar đã có smoke và ảnh cho Team; Overview real chưa có ảnh.
- Mobile drawer và tablet trên real: chưa kiểm trình duyệt.
