# Quick Wins — Implementation Report

Ngày: 2026-10-23 · Nhánh: `frontend` · Tài liệu audit gốc: [README](README.md) · Phạm vi: chỉ Quick Win theo `04-implementation-roadmap.md`. Không làm Structural Improvements.

## 1. Tóm tắt

- Đã xử lý các UX-ID: **UX-01 (một phần), UX-02, UX-03 (đính chính, không phải lỗi real), UX-04 (một phần), UX-05 (một phần), UX-07, UX-12 (một phần), UX-13, UX-14, UX-19, UX-26**, cùng checklist owner (cập nhật có ghi chú).
- Real mode: đã kiểm bằng test có mode real được stub và bằng trình duyệt ở **trạng thái outage** (build production không có backend). Dữ liệu real thật **chưa kiểm** vì không có backend.
- Không đổi API, business logic, permission model hay safety control (Emergency Stop giữ nguyên). Không chạy `npm run build` vào `apps/web/dist` (ghi đè output của owner); typecheck và `vite build` được chạy vào thư mục scratchpad, cùng mã nguồn.

## 2. Kết quả theo UX-ID

| UX-ID | Trạng thái | Việc đã làm | Còn lại |
|---|---|---|---|
| UX-01 | Một phần | Settings (trang dùng chung) không còn "Acme Security (Demo)", "This is a simulation", ID demo ở real | Header switcher và Demo Tools chỉ mount ở mock (đính chính audit); không cần sửa thêm ở real |
| UX-02 | Đã xử lý | Copy "hidden in production" (không có gate) đổi thành "Demo mode only…" ở Demo Tools và login mock | Không đổi hành vi mock |
| UX-03 | Đính chính | Điều khiển demo không render ở real; xác nhận bằng code và test | Không còn là lỗi real. Giữ ở mock |
| UX-04 | Một phần | Outage real: ở build production hiện thông báo người dùng, không có lệnh dev, không có nút "Switch to demo mode". Panel "Not connected" cũng bỏ nút này và thuật ngữ nội bộ | Chuỗi kỹ thuật "The API returned a non-JSON response." từ `platform/transport.ts` vẫn hiện (ngoài ranh giới Quick Win). Nút "Switch to demo mode" trong menu tài khoản real giữ nguyên (quyết định sản phẩm) |
| UX-05 | Một phần | `scenarios`, `states`, `workspaces` chỉ đăng ký khi dev hoặc `VITE_PROTOTYPE_PAGES=true`. Prototype Home bị gate theo cùng cờ. Trang không đăng ký hiện "Page not found" | Code của `demo/pages` và `shell/system/gallery` vẫn nằm trong bundle vì `slice-a.ts` import tĩnh (cần đổi route architecture: follow-up) |
| UX-07 | Đã xử lý | Dải mờ phía dưới sidebar khi còn mục cuộn xuống; đo lại sau mỗi lần render để bắt được chuyển route | Mobile drawer dùng cùng component nhưng chưa thấy trong ảnh (không kiểm riêng) |
| UX-12 | Một phần | Note "Running binding state" → "Operations running now"; "binding state" trong thông báo → "Operation status" | 6 KPI theo checklist, aggregate running operations, định nghĩa "open/curated" trên màn hình: structural |
| UX-13 | Đã xử lý | Cột thiếu dữ liệu hiển thị "Not recorded" (tooltip giữ lý do); subtitle khớp hành vi; note Active liệt kê đủ 4 trạng thái | Chọn "Not recorded" thay vì ẩn cột: giữ schema ổn định cho real |
| UX-14 | Một phần | "1 decision awaits"; "Library" → "Skill proposals" / "Capabilities could not be read."; câu readiness rõ hơn (mock) | "Raptix" làm tên agent; "Sessions/C2/Infrastructure" (structural) |
| UX-19 | Đã xử lý | Dark primary đổi thành xanh nhạt (cùng token `--c-link` sẵn có), fill dùng chữ tối. Light neutral đậm hơn một chút. Có test validation đọc token từ `index.css` | Thay đổi thị giác: nút primary dark đổi màu. Cần owner xác nhận thiết kế |
| UX-26 | Đã xử lý | KPI "Metadata to review" hiển thị "Not recorded" khi không dự án nào ghi metadata (không còn 0 giả) | — |
| Checklist owner | Đã cập nhật | Thêm mục "Cập nhật sau Full UX Audit" vào cuối file: sai lệch đã xác minh, trạng thái từng mục, mục còn mở | File không được theo dõi bởi git; chưa commit |

## 3. Commit và file thay đổi

Mỗi commit một mối quan tâm, đều chỉ stage đúng các file của thay đổi (không đụng các thay đổi chưa commit của owner).

| Commit | Nội dung | File chính |
|---|---|---|
| `4a354b8e` | Tài liệu audit (Phase 1) | `docs/audits/web-ux-audit-2026-10-23/**` |
| `2b28c3b0` | Settings ở real không còn chuỗi demo; copy "hidden in production" đúng; test real-mode | `features/settings/views/settings-page.tsx`, `demo/login-page.tsx`, `shell/header.tsx` (copy), `shell/real-chrome.demo-free.test.tsx` |
| `6740efbf` | Outage real: thông báo người dùng; nút demo và lệnh dev chỉ ở dev; panel "Not connected" | `shell/real-bootstrap.tsx`, `shell/not-integrated.tsx`, `shell/not-integrated.test.tsx` |
| `6cd13bb8` | Tách chuỗi theo mode của Settings ra helper (đưa view về không đọc mode, giữ ratchet boundary) | `features/settings/org-copy.ts`, `features/settings/views/settings-page.tsx` |
| `1efe7bc4` | Gate prototype và QA pages bằng cờ build; host không render gì cho key không đăng ký ở nhánh outside-shell | `router/prototype-pages.ts`, `router/prototype-pages.test.ts`, `router/routes.ts`, `router/registry.tsx`, `router/host.tsx`, `shell/header.tsx` |
| `61c4b7c5` | Dải mờ sidebar | `shell/sidebar.tsx`, `shell/sidebar-scroll.test.tsx` |
| `7ea92aad` | Đo lại dải mờ sau khi chuyển route | `shell/sidebar.tsx` |
| `b7e253bf` | Copy: số ít/số nhiều, Library → Capabilities, bỏ binding state, readiness rõ hơn | `features/overview/views/overview-blocks.tsx`, `features/overview/views/overview-page.tsx`, `features/overview/views/overview-page.test.tsx`, `demo/project-detail/project-page.tsx`, `demo/project-detail/detail.test.tsx`, `features/capabilities/views/capabilities-pages.tsx` |
| `9c91cb37` | Projects: Not recorded; KPI Metadata không còn 0 giả; note Active khớp trạng thái | `features/projects/views/portfolio-page.tsx`, `features/projects/views/portfolio-page.test.tsx` |
| `2a841c85` | Contrast: token dark primary và light neutral; test validation | `index.css`, `ui/theme-contrast.test.ts` |

Thay đổi quan trọng ngoài kế hoạch, đã ghi rõ:
- **`router/host.tsx`** (commit `1efe7bc4`): nhánh "outside shell" trước đây luôn render `Outside ? <Outside/> : null`. Với key bị gate, trang trắng hoàn toàn. Đã sửa để key không đăng ký rơi về xử lý "unknown route" bình thường. Hành vi với route đã đăng ký không đổi.
- **`features/settings/org-copy.ts`** (commit `6cd13bb8`): lần sửa Settings đầu tiên làm tăng số vi phạm ratchet `presentation-mock-plumbing` (+2). Đã đưa chuỗi theo mode ra helper, số vi phạm trở về 411 (baseline).

## 4. Giải pháp kỹ thuật và lý do

- **Gate theo build, không theo CSS:** `PROTOTYPE_PAGES_ENABLED = import.meta.env.DEV || VITE_PROTOTYPE_PAGES === 'true'`, đăng ký route theo key (cùng mẫu với cờ Asset Map). Lý do: "ẩn" bằng CSS không ngăn được truy cập theo URL. Hành vi đã được xác minh trong build production.
- **Mode không đổi cờ build:** cờ build không đọc `DATA_MODE`. Lý do: build production có thể chạy mock (mặc định), nên "production" không tương đương "real".
- **Không đọc mode trong view:** chuỗi theo mode nằm trong helper của feature. Lý do: ratchet boundary đếm các lần đọc `isRealMode` trong presentation; tăng số này là không được phép.
- **Contrast bằng đổi token, không đổi 13 chỗ dùng:** dark primary dùng cùng giá trị với `--c-link` (đã có), fill dùng chữ tối. Lý do: không có một màu nào vừa đạt 4.5:1 làm chữ trên panel dark vừa đạt 4.5:1 làm chữ trắng trên fill cùng màu (đã tính).
- **Projects dùng "Not recorded" thay vì ẩn cột:** giữ schema ổn định cho real, nơi cột có thể có dữ liệu.
- **Test validation đọc token từ `index.css`:** nếu một cặp trở lại dưới 4.5:1, test thất bại. Đã kiểm: trên token cũ, đúng 3 cặp hỏng bị bắt.

## 5. Kết quả kiểm tra

### 5.1 Typecheck, lint, boundary, test

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck --workspace=@raptix/web-raptix` | Exit 0 (trước và sau) |
| `npm run lint --workspace=@raptix/web-raptix` | Exit 0 (trước và sau; không lỗi mới) |
| `check:boundaries --strict` | 411 vi phạm = baseline 411 (sau lần sửa đầu tăng +2, đã sửa) |
| Test có liên quan trong từng nhóm | Pass trong từng commit |
| Full suite `npm run test --workspace=@raptix/web-raptix` | **182 file, 1611 test, pass**, exit 0 (chạy sau commit `7ea92aad`) |

Test mới hoặc sửa: `real-chrome.demo-free.test.tsx` (2), `not-integrated.test.tsx` (2), `prototype-pages.test.ts` (3), `sidebar-scroll.test.tsx` (1), `theme-contrast.test.ts` (26), `portfolio-page.test.tsx` (+1, sửa 1), `overview-page.test.tsx` và `detail.test.tsx` (cập nhật copy). Một regression test được kiểm: test Settings real **fail** trên file gốc và **pass** sau sửa; test contrast **fail** trên token cũ đúng ở 3 cặp.

### 5.2 Build production

- `vite build` vào `scratchpad/dist-after`: exit 0. Cảnh báo không đổi so với baseline (chunk > 500 kB, import tĩnh/động trùng).
- Build với `VITE_PROTOTYPE_PAGES=true`: exit 0 (kiểm đường opt-in).

### 5.3 Playwright (build production, mock mode và outage real)

| Kiểm tra | Trước | Sau |
|---|---|---|
| Crawl 55 route key (desktop 1440×900) | Mọi route render, 0 lỗi trang | Giống trước; ba route gate hiện "Page not found" (có chủ đích). 0 lỗi |
| `#/states`, `#/scenarios`, `#/workspaces` | Render trang QA/prototype | "Page not found" (build mặc định); render lại khi bật cờ |
| Menu profile mock: Prototype Home | Có | Không có (build mặc định) |
| Menu profile mock: Demo Tools copy | "Prototype only, hidden in production." | "Demo mode only. Switching persona changes…" |
| Overview: nhãn decision | "1 decision await your review." | "1 decision awaits your review." |
| Project readiness | "Can reach 100% before anything runs." | "Finish the remaining checks before an operation runs." |
| Projects: ô "—" | 12 (6 hàng × 2 cột) | 0; hiện "Not recorded" |
| Projects: KPI Metadata | 0 | "Not recorded" |
| Sidebar dự án: dải mờ | Không có | Có khi trong project (đã đo: `data-scroll-fade` = 1; nav 964px nội dung trong 771px hiển thị) |
| Dark primary (Create Operation) | nền `rgb(37,99,235)`, chữ trắng | nền `rgb(96,165,250)`, chữ `rgb(11,17,32)` |
| Outage real (không backend, build production) | Lệnh `npm run dev:api`, nút "Switch to demo mode" | Thông báo người dùng, không lệnh, không nút |
| Mobile 390 (overview) | Không tràn ngang | Không tràn ngang |
| Projects render errors | 0 | 0 |

### 5.4 Route smoke (`tools/verify/route-smoke.mjs`, mock mode)

| Build | Kết quả |
|---|---|
| Baseline (trước thay đổi) | 1 lỗi: `mock:playbooks [heading]` |
| Hiện tại (mặc định) | 4 lỗi: `playbooks` (cũ), `states`, `scenarios`, `workspaces` (do gate, có chủ đích) |
| Hiện tại với `VITE_PROTOTYPE_PAGES=true` | 1 lỗi: `playbooks` (như baseline) |

`playbooks` không phải key trong `router/routes.ts` (chỉ có `playbook`), và `tools/verify/routes.json` có key `playbooks`. Đây là lỗi có từ trước, không do Quick Win. Không sửa `routes.json` (là hợp đồng của owner); ghi làm follow-up.

Route smoke không chạy với dev server của owner (cổng 5273) vì server đó có dependency cache cũ.

## 6. Ảnh chụp Before / After

Thư mục: `docs/audits/web-ux-audit-2026-10-23/evidence/`

| Trước (B) | Sau (A) | Ghi chú |
|---|---|---|
| `B01-desk-overview-before.png` | `A01-desk-overview-after.png` | Nhãn "awaits" (nhãn decision chỉ hiện khi có quyết định chờ) |
| `B02-desk-project-overview-before.png` | `A02-desk-project-overview-after.png` | Dải mờ sidebar; readiness copy |
| `B07-desk-projects-before.png` | `A03-desk-projects-after.png` | "Not recorded"; KPI Metadata |
| `B07` (chip và KPI Active) | `A03` | Note Active liệt kê 4 trạng thái |
| `B06-desk-dark-demo-tools-menu-before.png` | `A08-desk-mock-menu-demo-tools-after.png` | Copy Demo Tools; không có Prototype Home |
| `B-dark-primary-before` (`A07-desk-dark-primary-before.png`) | `A07-desk-dark-primary-after.png` | Nút primary dark |
| `B10-real-mode-no-backend-outage-before.png` | `A06-real-mode-outage-after-prod-build.png` | Outage real |
| `B08-mobile-390-nav-drawer-before.png` | `A05-mobile-390-overview-after.png` | Mobile (ghi chú: ảnh after là overview, không phải drawer) |
| `B12-desk-prototype-home-scenarios-before.png` | (không có ảnh after riêng; `Page not found` đã đo trong 5.3) | Gate |

Ghi chú: ảnh "after" của Settings real không có vì không đăng nhập được real. Thay đổi Settings được kiểm bằng test real-mode.

## 7. Vấn đề còn tồn tại

1. **Chuỗi kỹ thuật outage:** "The API returned a non-JSON response." (`platform/transport.ts:70`) vẫn hiện ở outage real. Cần thông điệp người dùng ở tầng platform.
2. **Bundle còn code demo:** route bị gate nhưng `demo/pages` và `shell/system/gallery` vẫn nằm trong bundle vì `slice-a.ts` import tĩnh và `registry.tsx` import động. Đường loại bỏ: đưa import sau cờ build trong `slice-a` và `registry`, kiểm bằng `grep` trên bundle.
3. **Nút "Switch to demo mode" trong menu tài khoản real:** giữ nguyên (chủ đích). Quyết định sản phẩm.
4. **Dark primary đổi màu:** nút primary dark giờ là xanh nhạt với chữ tối. Cần owner duyệt về thị giác.
5. **`playbooks` trong `routes.json`:** key không tồn tại trong router. Cần sửa hợp đồng route smoke (owner).
6. **UX-23 (đăng nhập mock "Continue"):** chưa xác định nguyên nhân, chưa sửa.
7. **UX-25 (đường đóng mobile drawer):** chưa xác minh bằng tương tác.
8. **Cảnh báo jsdom "Not implemented: navigation to another Document"** xuất hiện trong log của full suite. Chưa điều tra; không rõ có từ trước hay không.

## 8. Điểm chưa thể xác minh

- **Mọi luồng real dữ liệu thật** (overview, projects, findings, Settings tabs có dữ liệu, Emergency Stop, runtime, C2): cần backend. `[NV]`.
- **Real Settings trong trình duyệt:** kiểm bằng test có mode real được stub. Không chụp được trang thật.
- **Persona/Reset demo ở real:** không tồn tại ở real (đã kiểm bằng source và layout shell). Không kiểm trong trình duyệt real.
- **Mobile drawer đóng và tablet sau thay đổi:** tablet không chụp lại sau các thay đổi; sidebar được dùng chung desktop và drawer, đã kiểm overflow ở mobile.
- **Keyboard và screen reader:** không kiểm lại.
- **Tuyên bố "Every change is audited" và "apply to every project"** trong Settings: chưa xác minh consumer (UX-27).

## 9. Đề xuất chuyển sang Structural Improvements

- Một từ vựng và một cây điều hướng cho mock và real (UX-06, UX-08, UX-11).
- Một inbox quyết định, hợp nhất approvals và chuông thông báo (UX-08).
- Findings: một component list (UX-10).
- Overview: định nghĩa KPI và nguồn; aggregate running operations (contract mới, cần trace theo `AGENTS.md`); 6 KPI hoặc cập nhật acceptance; giảm mật độ (UX-12, UX-16).
- Quyết định Ask AI và Plans/Planning (UX-09).
- Loại code demo khỏi bundle production (mục 7.2).
- Chuỗi kỹ thuật outage ở tầng platform (mục 7.1).
- Đăng nhập mock (UX-23) và đường đóng mobile drawer (UX-25).

## 10. Ổn định và xác minh (vòng 2, 2026-10-23)

Kết quả chi tiết, lệnh và số liệu: `verification/VERIFICATION-STABILIZATION-2026-10-23.md`. Tóm tắt:

- **Gate tại HEAD `0c25420f`:** typecheck và lint exit 0; boundary 411 (bằng baseline); full test 182 file / 1614 test pass; build production mặc định và build bật cờ đều exit 0 (vào scratchpad, không ghi đè `dist/`).
- **Route smoke theo cờ:** production mặc định 56/56; production bật cờ 56/56; stack real có graph 42 pass, 14 khai báo sẵn do môi trường, 0 lỗi mới. Lỗi baseline `playbooks` là inventory lệch router, đã thay bằng `capabilities`.
- **Thông báo kỹ thuật:** người dùng thấy thông điệp không kỹ thuật (non-JSON, mất kết nối, lỗi 500, hết thời gian); chi tiết kỹ thuật chuyển sang trường `reason` không hiển thị.
- **Dark mode, sidebar mobile, đăng nhập mock:** chụp trước và sau; drawer mobile đóng bằng Escape và overlay; đăng nhập mock hoạt động (đính chính UX-23).
- **Real mode trên stack có backend** (PostgreSQL 17, graph, API từ source): đăng nhập owner, menu tài khoản, Settings, phân tách mock/real, viewer, và các trạng thái lỗi đều đạt. Emergency Stop không thực hiện.

### Commit inventory đầy đủ (từ kiểm toán đến HEAD)

| Commit | Loại | Nội dung |
|---|---|---|
| `4a354b8e` | docs | Tài liệu kiểm toán UX (giai đoạn 1) |
| `2b28c3b0` | fix | Settings real không còn chuỗi demo; copy "hidden in production" đúng sự thật; test real-mode |
| `6740efbf` | fix | Outage real: thông báo người dùng; không lệnh dev và nút demo ở production |
| `6cd13bb8` | refactor | Chuỗi Settings theo mode tách ra helper (giữ ratchet boundary) |
| `1efe7bc4` | fix | Gate trang prototype/QA bằng cờ build; host xử lý key không đăng ký |
| `61c4b7c5` | fix | Dải mờ sidebar dự án |
| `7ea92aad` | fix | Đo lại dải mờ sau khi chuyển route |
| `b7e253bf` | fix | Copy: số ít/số nhiều, Library → Capabilities, bỏ "binding state" |
| `9c91cb37` | fix | Projects: "Not recorded" thay "—"; KPI Metadata không còn 0 giả |
| `2a841c85` | fix | Contrast: dark primary và light neutral; test validation |
| `a893e6e0` | docs | Báo cáo Quick Win; đính chính audit |
| `b5b7f188` | fix | Thông điệp kỹ thuật không hiện cho người dùng (transport) |
| `bd0f47a6` | fix | Real mode: trang không tìm thấy cho địa chỉ không đăng ký |
| `3bc6cf84` | test | Route smoke theo cờ; sửa inventory `playbooks` → `capabilities`; baseline |
| `828cd7bc` | fix | Asset Map có slice riêng (lỗi S-01 phát hiện bởi smoke) |
| `0c25420f` | fix | Bỏ lặp lời khuyên trên màn hình khởi động |
| (vòng 2, docs) | docs | Xác minh ổn định, đính chính matrix và audit, snapshot checklist |

Các commit này chỉ thêm và sửa file của thay đổi, không đụng vào thay đổi chưa commit của owner.

### Mục còn mở (ngoài phạm vi, chuyển sang Structural hoặc quyết định)

- S-03: thông báo sai mật khẩu ở mock in mật khẩu demo.
- S-06: code trang QA còn trong bundle dù route bị gate.
- Thông điệp 4xx do Fastify tạo vẫn đi nguyên văn.
- Nút đóng drawer có nhãn: chưa xác nhận.
- Quyết định thiết kế: màu nút primary dark.
- Quyết định sản phẩm: nút "Switch to demo mode" trong menu tài khoản real.
