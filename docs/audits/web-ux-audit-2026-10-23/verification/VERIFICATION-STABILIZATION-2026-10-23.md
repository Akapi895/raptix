# Stabilization & Verification — 2026-10-23

Vòng ổn định ngắn sau Quick Win. Phạm vi theo yêu cầu gồm 7 mục: gate tại HEAD cuối; đồng bộ đính chính; route smoke theo feature flag và lỗi baseline `playbooks`; thông báo non-JSON; dark mode, sidebar mobile và đăng nhập mock; real mode trên stack có backend; đóng gói artifact và checklist.

**HEAD đã kiểm: `0c25420f`** (nhánh `frontend`). Cây làm việc sạch, trừ thư mục untracked `apps/web/.scratch/web-real-ui/` của owner (không đụng tới).

## Môi trường

- Node v24.18.0. Chromium của Playwright nằm trong `node_modules` của repo (không cài thêm dependency).
- Docker 28.3.0. Stack thật dùng `postgres:17` và `neo4j:5-community` đã có sẵn ở máy. Stack chạy có graph (mặc định của `tools/verify/stack.mjs`).
- Stack do một bản sao của `tools/verify/stack.mjs` đặt trong scratchpad điều khiển: giữ nguyên logic, chỉ thêm bước giữ stack sống để kiểm tay. Bản sao không nằm trong repo.
- Dev server của owner (cổng 5273, PID 26028) không bị dừng, không bị khởi động lại.
- Mọi server và stack do phiên này khởi động đều đã dừng. Không còn container nào mang nhãn `raptix.verification=stack`.

## 1. Gate tại HEAD cuối

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npm run typecheck --workspace=@raptix/web-raptix` | Exit 0 |
| Lint | `npm run lint --workspace=@raptix/web-raptix` | Exit 0, không lỗi |
| Boundary | `node tools/check-boundaries.mjs --strict` | 411 vi phạm, bằng baseline 411 |
| Full test | `npm run test --workspace=@raptix/web-raptix` | **182 file, 1614 test: pass**, exit 0, 177 s |
| Build production (mặc định) | `vite build --outDir <scratchpad>` (cùng mã nguồn) | Exit 0 |
| Build production (bật cờ) | `VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 vite build --outDir <scratchpad>` | Exit 0 |

Ghi chú về build: `npm run build` ghi vào `apps/web/dist`, là output của owner. Vì vậy build được chạy trực tiếp bằng `vite build` vào scratchpad. Chuỗi là typecheck + vite build, giống script, nhưng không ghi đè `dist/`.

Kiểm tra bundle (build mặc định):
- Không có "Prototype Home", "npm run dev:api", "non-JSON response".
- Có "Universal state set" trong một chunk `gallery`. Trang này không truy cập được (route bị gate), nhưng code vẫn nằm trong bundle. Đây là follow-up S-06.
- Bản bật cờ có "Prototype Home".

## 2. Đồng bộ đính chính và commit inventory

- `03-optimization-matrix.md`: hai dòng header switcher và Demo Tools đã đổi theo đính chính. Đây là hai dòng còn sai trước vòng này.
- `01-full-audit-report.md`: đính chính UX-01 và UX-03 có sẵn từ vòng trước. Vòng này bổ sung đính chính UX-23 (luồng đăng nhập mock hoạt động) và cập nhật UX-25 (đã xác minh đường đóng drawer). Thêm bảng S-01 đến S-08.
- `06-verification-gaps.md`: các dòng real mode đã xác minh được đổi trạng thái.
- Commit inventory đầy đủ: xem `QUICK-WINS-IMPLEMENTATION-REPORT.md`, mục 10.

## 3. Route smoke theo feature flag và lỗi baseline `playbooks`

### Nguyên nhân lỗi baseline `playbooks`

Lỗi không phải hồi quy sản phẩm. Hai điểm trong inventory đã lệch khỏi router:
- Entry `playbooks` mong đợi tiêu đề "Skill library". Đó là tên cũ của trang Library, đã đổi thành Capabilities. Key `playbooks` không còn trong `router/routes.ts`.
- Trang Capabilities (một mục điều hướng) không có trong `routes.json`, nên không được kiểm.

Xử lý: thay entry `playbooks` bằng `capabilities` (mock "Capabilities"; real "Capabilities", đã đo trên stack).

### Thay đổi route smoke

- `tools/verify/routes.json`: entry có `flag` (`prototype` cho `states`, `scenarios`, `workspaces`; `assetMap` cho `asset-map`). Entry asset-map mới. Mô tả đã sửa cho đúng số lượng.
- `tools/verify/route-smoke.mjs`: đọc `RAPTIX_VERIFY_FLAGS` (mặc định `prototype`, khớp dev server; chuỗi rỗng = build production không cờ). Route có cờ tắt được kiểm là "Page not found". Mỗi dòng kết quả ghi `flag` và `flagOn`.
- `tools/verify/baseline.json`: bỏ `real:scenarios` (không còn xảy ra). `real:project` cập nhật sang lỗi thật: `c2/sessions` 503 do stack không có Sliver.

### Kết quả

| Build | Môi trường | Cờ | Kết quả |
|---|---|---|---|
| Production mặc định | mock | rỗng | **56/56 pass**, 0 lỗi |
| Production bật cờ | mock | `prototype,assetMap` | **56/56 pass**, 0 lỗi |
| Dev, stack có graph | real | `prototype` (mặc định) | **42 pass**, 14 khai báo sẵn (lý do môi trường), **0 lỗi mới** |
| Trước vòng này (production) | mock | — | 1 lỗi: `playbooks` |

Chi tiết 14 mục khai báo sẵn ở real: 9 route thiếu fixture (operations, agents, AI plan, C2 channel/session/console, branch) vì stack không tạo runtime; `operation-new` 404 vì LangGraph không chạy; `c2` và `project` 503 vì không có Sliver. Đây là giới hạn môi trường đã ghi trong baseline từ trước.

### Lỗi phát hiện và sửa trong quá trình kiểm

- **S-01** (`828cd7bc`): Asset Map bật cờ vẫn "Page not found" trong mock. Khai báo nằm ở slice hệ thống tĩnh, không có mục cho nó. Đã đưa vào slice riêng `am`, theo đúng mẫu của các feature khác. Trước sửa: `FAIL mock:asset-map`. Sau sửa: pass.
- **S-02** (`bd0f47a6`): real mode hiển thị panel "Not connected in real mode" cho địa chỉ không đăng ký. Đã đổi sang trang không tìm thấy, giống mock. Kiểm bằng route smoke real: `asset-map` (cờ tắt) pass với "Page not found".

## 4. Thông báo kỹ thuật (non-JSON và các lỗi khác)

Phạm vi rà soát: mọi chỗ tạo `ApiTransportError` trong `platform/transport.ts`, vì `failureFrom` (`platform/adapter-shared.ts`) đưa `error.message` nguyên văn vào mọi màn hình. Phía server, lỗi 5xx đã là "Internal server error" chung chung; client là nơi lộ.

| Tình huống | Trước | Sau (người dùng thấy) | Kỹ thuật (trường `reason`, không hiển thị) |
|---|---|---|---|
| Phản hồi không phải JSON | "The API returned a non-JSON response." | "Raptix returned a response it could not read. Try again; if it continues, contact your administrator." | "the response body is not JSON" |
| Lỗi 500 từ server | "Internal server error" | Cùng thông điệp trên | "Internal server error" |
| Không kết nối được | "The Raptix API is unreachable. Verify the server is running and reachable." | "Raptix could not be reached. Check your connection and try again." | "the server did not answer" |
| Hết thời gian | "The Raptix API timed out…" | "Raptix did not respond in time. Try again." | "the request timed out" |
| Shape không đúng hợp đồng | "The API returned a response with an unexpected shape." | Thông điệp chung | "the response shape does not match the contract" |
| Tiêu đề màn hình khởi động | "Cannot reach the Raptix API" | "Raptix is unavailable right now" | — |

Xác minh:
- Test đơn vị: `platform/transport.test.ts` có test mới (thông điệp không chứa "JSON" hay "API", `reason` được đặt; lỗi 500 được thay thế; thông điệp do server viết cho lỗi 4xx vẫn giữ nguyên).
- Stack thật, với phản hồi bị làm giả qua Playwright (`real-messages-final.txt`): E1 không phải JSON, E2 500, E3 mất kết nối đều hiện thông điệp người dùng ở Projects. E4 (finding không tồn tại) và E5 (project không tồn tại) hiện nội dung bình thường.
- Build production không có backend (`prod-outage`): màn hình khởi động hiện thông điệp người dùng; không có lệnh dev, không có nút "Switch to demo mode", không có chuỗi "non-JSON".

Còn lại (không sửa trong vòng này): thông điệp 4xx do Fastify tạo, ví dụ "Route GET … not found" cho địa chỉ không khớp, vẫn đi nguyên văn vì đó là văn bản do server viết. Ghi làm follow-up.

## 5. Dark mode, sidebar mobile và đăng nhập mock

### Dark mode trước và sau

Cùng bốn màn hình (overview, project, findings, settings), chụp ở desktop 1440×900 sau khi chuyển sang Dark qua menu tài khoản.
- Ảnh trước: `evidence/A09-desk-dark-overview-before.png`, `A10-desk-dark-project-before.png`, `A11-desk-dark-settings-before.png`, `A07-desk-dark-primary-before.png`.
- Ảnh sau: `evidence/A09-…-after.png`, `A10-…-after.png`, `A11-…-after.png`, `A07-desk-dark-primary-after.png`.
- Thay đổi duy nhất đo được: nút primary dark. Trước: nền `rgb(37,99,235)`, chữ trắng. Sau: nền `rgb(96,165,250)`, chữ `rgb(11,17,32)`. Các màu khác không đổi, trừ neutral sáng đậm hơn một chút.
- Kết luận: chữ đọc được trên cả bốn màn hình. Thay đổi màu nút primary là quyết định thiết kế, cần owner duyệt.

### Sidebar mobile (390×844)

Kết quả từ `results/mobile-and-mock-login.json`, chạy trên build production mặc định:
- Nút "Open menu" có một; drawer (dialog "Navigation") mở, rộng 280 px.
- Trong project: 16 mục điều hướng, có dải mờ (`data-scroll-fade`) ở cuối.
- Đóng bằng Escape: có. Đóng bằng chạm ra ngoài overlay: có.
- Chọn "Findings" trong drawer: điều hướng đúng (`#/project/RT-2026-014?tab=findings`) và drawer tự đóng.
- Tràn ngang sau điều hướng: 0.
- Nút đóng có nhãn: chưa xác nhận. DOM có một phần tử khớp từ khóa "close", nhưng ảnh không cho thấy nút X. Đường đóng rõ ràng duy nhất đã kiểm là overlay và Escape. Ảnh: `evidence/A12-mobile-390-drawer-project-after.png`.

### Đăng nhập mock

Kiểm trên build production mặc định (`mockSignIn`):
1. Email và mật khẩu được điền sẵn.
2. Bấm "Continue": nút chuyển sang "Verifying…" (có quan sát được).
3. Sau khoảng 700 ms, chuyển sang bước chọn tổ chức ("Enter workspace").
4. "Enter workspace" đưa vào "System Overview".

Kết luận: luồng hoạt động. Phát hiện UX-23 trong audit gốc là **sai**: bước kiểm ban đầu chỉ xem chuyển trang ngay lập tức và bỏ qua bước giữa. Đã đính chính trong `01-full-audit-report.md`.

Ghi chú: thông báo sai mật khẩu hiển thị mật khẩu demo ("in this demo the password is …"). Đây là copy của chế độ demo, nhưng nằm trong mọi build chạy ở mock. Ghi làm follow-up S-03, cần quyết định sản phẩm.

## 6. Real mode trên stack có backend

Stack: PostgreSQL 17, graph seeded, API từ source (`apps/web/server`), Vite dev, một owner (`verifier`, Admin) và một viewer (`viewer`) được tạo qua API. Kết quả: `results/real-mode-checks.json`, ảnh `evidence/R0*`.

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Đăng nhập owner | Pass. Có nhãn "Real mode"; overview "System Overview"; không có tên demo | `R01-real-overview-owner-after.png` |
| Menu tài khoản | Pass. Không có Demo Tools, Reset demo, Prototype Home, danh sách persona. Có "Switch to demo mode" (quyết định mở) | `R02-real-account-menu-after.png` |
| Settings | Pass. Tiêu đề "Organization Settings"; phụ đề bản real ("Settings that apply across this workspace."); không có "Acme Security (Demo)", "This is a simulation", RT-2026-014/017; 5 tab (Organization, Integrations, Policies, Retention, Audit log) | `R03-real-settings-after.png` |
| Phân tách mock/real | Pass. Projects real không có tên demo. Route smoke real dùng dữ liệu của stack (`stack-host-01…`) và mock dùng dữ liệu demo | Smoke: `results/smoke-real-graph-stack.json` |
| Viewer | Đăng nhập được; Settings render theo vai trò | `R05-real-viewer-settings-after.png` |
| Lỗi: không phải JSON | Pass. Thông điệp người dùng | `R-E1-real-non-json-projects-after.png` |
| Lỗi: 500 | Pass. Thông điệp người dùng | `real-error-messages.txt` |
| Lỗi: mất kết nối | Pass. "Raptix could not be reached." | `R-E3-real-network-projects-after.png` |
| Lỗi: finding không tồn tại | Pass. "… does not exist or is not available for your account." | `real-error-messages.txt` |
| Lỗi: không có lỗi trang | Pass. Số lỗi trang JS: 0 ở mọi lần chạy | `real-mode-checks.json` |
| Emergency Stop | **Không thực hiện** (theo yêu cầu) | — |

Ghi chú về khối lỗi boot ở dev: `R-E0-boot-outage.png` hiện lệnh `npm run dev:api` và nút "Switch to demo mode". Đây là hành vi dev có chủ đích. Bản production đã kiểm riêng (mục 4).

Chưa kiểm trong vòng này: số liệu KPI overview real; nội dung chi tiết từng tab Settings real (smoke chỉ kiểm heading và text); luồng ghi (tạo, sửa, duyệt) trên real.

## 7. Đóng gói và checklist

- `docs/audits/web-ui-completion-checklist-2026-10-22.md` là file **untracked** của owner, đã được chỉnh sửa (mục cập nhật cuối file). Để tránh mất khi git không theo dõi, bản snapshot đã được đưa vào gói audit và commit: `checklist-snapshot/web-ui-completion-checklist-2026-10-22.snapshot-2026-10-23.md`. File gốc vẫn untracked. Owner quyết định có `git add` hay không.
- ZIP chia sẻ: `docs/audits/web-ux-audit-2026-10-23.zip`, gồm toàn bộ thư mục audit kể cả `verification/`. ZIP không được commit.

## 8. Chưa làm và còn mở

- S-03: thông báo sai mật khẩu hiển thị mật khẩu demo (cần quyết định).
- S-06: code của trang QA vẫn nằm trong bundle dù route bị gate (cần đổi kiến trúc route).
- Thông điệp 4xx do server viết (Fastify) vẫn đi nguyên văn (follow-up).
- Nút đóng drawer có nhãn: chưa xác nhận.
- Màu nút primary dark: cần duyệt thiết kế.
- Real mode: Emergency Stop không thực hiện; LangGraph và Sliver không chạy trên stack, nên các route tương ứng là khai báo sẵn.
- Structural Improvements: không làm trong vòng này (theo yêu cầu).

## 9. Nghiệm thu cuối tại HEAD `56a29e1a` (2026-10-23)

Vòng này thêm thay đổi identity Settings (`56a29e1a`) và chạy lại gate. Chi tiết CLOSED, OPEN và NV theo UX-ID: `07-acceptance-closure.md`.

| Hạng mục | Kết quả | Nguồn |
|---|---|---|
| Typecheck, lint, boundary, full test, build mặc định và bật cờ | Exit 0 (test: 183 file, 1616 test) | `results/final-acceptance/exit-codes.txt` |
| Route smoke mock, cờ tắt và bật cờ | 56/56 pass, 0 lỗi mới | `smokes-exit.txt`, `smoke-mock-default.log`, `smoke-mock-optin.log` |
| Route smoke real, stack có graph | 42 pass, 14 khai báo sẵn, 0 lỗi mới | `results/final-acceptance/smoke-real-stack.json` |
| Thẻ identity Settings real | Owner hiện `verifier`; viewer hiện `Stack Viewer` | `results/acc-real.json`; `evidence/A14-real-settings-identity-owner-after.png` |
| Outage production, không backend | Thông điệp người dùng; không lệnh dev; không nút demo | `results/final-acceptance/prod-outage-HEAD.json`; `evidence/P1-…`, `P2-…` |

Dừng hạ tầng: stack do phiên này khởi động đã dừng bằng file STOP. Các container của stack đã xóa (kiểm bằng `docker ps -a`). Hai server tĩnh (cổng 5290, 5291) đã dừng sau khi xác minh dòng lệnh. Dev server của owner (cổng 5273) không bị dừng hay khởi động lại.

Chưa kiểm: luồng ghi real, Emergency Stop thật (theo yêu cầu), LangGraph runtime và Sliver C2. Cache theo actor chưa kiểm trong trình duyệt (WS-0). Xem `07-acceptance-closure.md` mục 7.
