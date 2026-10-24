# Nhật ký xác minh

Ghi theo thời gian. Mỗi mục có HEAD, lệnh, kết quả. Kết quả chưa chạy được ghi NV kèm lý do.

Thư mục kết quả smoke của vòng này (ngoài repo): `scratchpad/ws1/` trong phiên Claude. Đường dẫn đầy đủ ghi ở từng mục.

## Baseline trước khi sửa (HEAD `d3225f63`, mã `56a29e1a`)

- Test đích WS-0 (`real-login`, `session`, `planning-seed`, `projects`): 13 file, 89 test, xanh.

## WS-0 · commit `d67d2665`

- Test mới đỏ trên mã cũ, xanh sau sửa: `src/features/projects/query.test.tsx` (2 đỏ → 0, 1 characterization xanh).
- Typecheck: `tsc --noEmit -p tsconfig.json` exit 0.
- Test liên quan: `aichat`, `projects`, `shell/real-login` xanh (18 file, 156 test).
- Full suite: 184 file, 1620 test, xanh.
- Boundary (strict): 411 vi phạm, bằng baseline từng nhóm.
- Lint file đã đổi: exit 0.
- Canary trình duyệt hai actor: **NV** (BL-01).

## WS-1 · commit `b9d28f3c`

- Characterization `src/shell/project-nav.characterization.test.ts`: viết trước khi refactor, xanh trên mã cũ (16 test chung với `nav.test.ts` và `aliases.test.ts`), xanh sau refactor.
- Typecheck exit 0; lint file đã đổi exit 0.
- Nhóm navigation, shell, router, demo, projects: 33 file, 252 test xanh (trước đổi nhãn). Sau đổi nhãn: 22 file, 171 test xanh; `app-routing.real.test.tsx` xanh sau khi cập nhật nhãn.
- Boundary (strict): 411 vi phạm, không đổi.
- Grep `MOCK_TAB_ALIASES|REAL_TAB_ALIASES|SHARED_TAB_ALIASES` trong `src` và `tools`: rỗng.
- Route smoke mock (build trong scratchpad, server tĩnh 127.0.0.1:5295 mặc định, 5296 bật cờ):
  - Mặc định (`RAPTIX_VERIFY_FLAGS=` rỗng): 56/56 pass, 0 failing, 0 declared. Kết quả: `scratchpad/ws1/smoke2-mock-default.json`.
  - Bật cờ (`prototype,assetMap`): 56/56 pass. Kết quả: `scratchpad/ws1/smoke2-mock-optin.json`.
- Route smoke real: **NV**. Cần stack có PostgreSQL và graph (`tools/verify/stack.mjs`); không có stack đang chạy và không tạo container trong vòng này. Các nhãn và alias real đã được test bằng unit test.

## WS-4A · commit `349bcbc5`

- `src/features/overview/measures.test.ts`: 9 test (trạng thái pending/unavailable/not-recorded/zero/value; loại `active-stop`; bốn trạng thái active project; findings mở).
- Nhóm overview: 6 file, 27 test xanh (trước khi nối view), 20 file, 111 test xanh (nhóm overview, shell, app-routing real).
- Typecheck exit 0; lint file đã đổi exit 0.
- Smoke mock: 56/56 cả hai cấu hình (bản build cuối gồm WS-1 và WS-4A).

## Full suite trên mã cuối vòng (trước commit WS-4A, sau mọi thay đổi WS-0/WS-1/WS-4A)

- Lần 1: 187 file xanh, 1 fail. `projects/views/real-screens.test.tsx > POSTs exactly the contract fields and navigates to the created engagement` — timeout 5409 ms khi chạy song song. Chạy riêng: 11/11 xanh.
- Lần 2: 187 file, 1639 test, xanh.
- Kết luận: flaky do thời gian dưới tải, không phải hồi quy. Chưa sửa ngưỡng test; ghi vào OPEN-ISSUES để theo dõi.

## WS-2 · commit `76826809` (server) và `b3195015` (client)

- Server: `t15-inbox` 7 test xanh (thêm 1 test cờ giới hạn). `tsc` server exit 0. ESLint hai file đã đổi exit 0.
- Client: typecheck exit 0; test nhóm overview, team, tasks, projects, decisions, shell, app-routing: 37 file, 239 test xanh; full suite 187 file, 1639 test xanh (lần 2).
- Grep `'/tasks'` trong `src`: một nơi duy nhất, `features/decisions/remote.ts`.
- Boundary: lần đầu 411 → 408 (hai nhóm giảm). Khóa baseline bằng `check:boundaries:write` (reviewed reduction).

## WS-4B · commit `837e1d9d` và ảnh `304df2e8`

- Test overview: 9 file (overview page), 36 test cùng nhóm shell a11y xanh; thêm test "emergency stop không vào hàng đợi, số giới hạn là cận dưới".
- Playwright (build mock production trong scratchpad, server tĩnh 127.0.0.1:5295), `shots.mjs`:
  - 1440×900 sáng và tối, 834×1112 sáng, 390×844 sáng: không tràn ngang (0 px), không lỗi trang, thứ tự vùng: Needs attention, Decision queue, Operations queue, Projects, Severity distribution.
  - Ảnh: `structural-execution/evidence/WS4B-overview-after-*.png`.
- Không kiểm trình duyệt ở real mode (cần stack, xem NV).

## S-03 · commit `ffe85384`

- `auth.test.tsx`: test mới "a wrong password is refused without revealing the demo password" xanh; 22 test trong file xanh.

## Gate cuối trên HEAD `ffe85384` (mã sản phẩm)

| Kiểm | Lệnh | Kết quả |
|---|---|---|
| Typecheck web | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Typecheck server | `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| Lint web (toàn bộ) | `npx eslint .` | exit 0 |
| Lint server (hai file đã đổi) | `npx eslint` | exit 0 |
| Boundary (strict) | `node tools/check-boundaries.mjs --strict` | 408 vi phạm, không vượt baseline (exit 0) |
| Test web | `npx vitest run --maxWorkers=4` | 188 file, 1650 test, xanh |
| Test server | `npx vitest run --config vitest.config.ts` | 64 file, 622 test, xanh |
| Build mặc định | `npx vite build --outDir <scratchpad>/build-default` | exit 0 |
| Build bật cờ | `VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 npx vite build --outDir <scratchpad>/build-optin` | exit 0 |
| Route smoke mock, không cờ | `RAPTIX_VERIFY_FLAGS=` | 56/56 pass, 0 failing, 0 declared |
| Route smoke mock, bật cờ | `RAPTIX_VERIFY_FLAGS=prototype,assetMap` | 56/56 pass, 0 failing, 0 declared |
| Route smoke real | cần stack | NV (không có stack đang chạy; không tạo container trong vòng này) |
| Canary hai actor trên trình duyệt | — | NV (BL-01) |

Kết quả JSON và log ở `scratchpad/ws1/final-smoke-*.json|log` (ngoài repo).

## Ghi chú

- Lần smoke song song đầu tiên lỗi vì đường dẫn tương đối; chạy lại đúng đường dẫn cho 56/56. Lỗi này không liên quan mã.
- Hai file tạm do lỗi đường dẫn nằm ở `D:\Program Files\Git\` (`final-smoke-optin.log`, `final-optin-exit.txt`). Yêu cầu xóa đã bị bộ kiểm tra an toàn chặn; cần người dùng xóa tay. Xem OPEN-ISSUES.

## Đính chính (phiên tiếp theo, P0.1)

- Ảnh `WS4B-overview-after-desktop-dark.png` trước đó là ảnh **sáng**. Nguyên nhân: script đặt `colorScheme: 'dark'` của Playwright, nhưng ứng dụng không đọc `prefers-color-scheme`. Theme mặc định là `light`, chỉ lưu trong bộ nhớ, và đổi qua menu tài khoản (`Account menu` → `Dark`).
- Mục WS-4B ở trên ghi "1440×900 sáng và tối" và commit `304df2e8` ghi "light and dark": **sai với ảnh dark**. Đã kiểm lại như sau:
  - Theme tối thật: `<html>` có class `dark`, `color-scheme: dark`, nền body `rgb(11,17,32)` (sáng: `rgb(246,247,249)`).
  - Ảnh thay thế: `evidence/WS4B-overview-after-desktop-dark.png`, `evidence/WS4B-overview-after-mobile-dark.png`. Script: `structural-execution/verify-scripts/theme-shots.mjs`.
  - Kết quả: 4 khung nhìn (desktop/mobile × sáng/tối), không tràn ngang, không lỗi trang, menu đã đóng trước khi chụp.

## Vòng 5 · gate cuối trên HEAD `67ddf571`

| Kiểm | Kết quả |
|---|---|
| Typecheck web, server | exit 0, exit 0 |
| Lint web (toàn bộ) | exit 0 |
| Boundary (strict) | 408 vi phạm, khớp baseline |
| Test web | 190 file, 1664 test, xanh |
| Test server | 64 file, 623 test, xanh |
| Build mặc định và bật cờ | exit 0, exit 0 (scratchpad) |
| Smoke mock không cờ / bật cờ | 56/56; 56/56 (0 lỗi mới) |
| Smoke real (stack cô lập) | 42 đạt; 14 khai báo; 0 mới (`evidence/WS-real-route-smoke-final.json`) |
| Canary actor (stack cô lập) | 10/10 (`evidence/WS0-actor-canary-run2.json`) |
| Tab Team real (owner sáng, tối; viewer sáng) | Không tràn; không lỗi trang; nút disabled có lý do |
| `/api/tasks` (server mới) | Có `limited` và `limitedKinds` |

Ghi chú: hai lần đầu của smoke song song lỗi do đường dẫn tương đối (không liên quan mã). Lần chạy lại đúng đường dẫn.
