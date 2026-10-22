# Kết luận tái cấu trúc apps/web

- **Ngày:** 2026-10-22
- **Trạng thái:** Chủ dự án đồng ý với đề xuất (2026-10-22). Triển khai phase 0 → 4 theo mục 4. Tiến độ và commit ở mục 8.
- **Liên quan:** `plan.md` (audit S1–S15, quyết định D1–D9), ADR-0084 (điểm 2 được thay thế bởi ADR-0096), ADR-0096 (mới), proposal 2026-10-21 §6.
- **Hiện trạng đo tại HEAD `fb71c24c`:** typecheck 0 lỗi; lint 5 lỗi có sẵn ở `src/screens/f.tsx`; test 161 file, 1.473 test đều pass (91 giây); `route-manifest-check.mjs` lỗi ENOENT.

## 1. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| Q1 | Adapter đi từ `real/service-adapter/<domain>.ts` vào `features/<domain>/remote.ts`, chuyển theo slice. ADR-0096 thay thế điểm 2 của ADR-0084. |
| Q2 | Giữ `router/`, `state/`, `shell/`, `ui/`, `domain/`, `App.tsx`, `main.tsx`. Thêm `platform/` (transport, session, streaming) và `demo/` (seed, clock, mock authority, runtime demo, persona). |
| Q3 | Không xóa panel real khi presentation dùng chung chưa đạt parity. Parity = route smoke đạt ở real mode, luồng xác minh của slice đạt, và không mất năng lực đã liệt kê cho slice. |
| Q4 | Ba route chỉ có mock (`states`, `scenarios`, `workspaces`): màn hình chuyển vào `demo/`. Real mode vẫn hiển thị `RealNotIntegrated` như hiện nay. |
| Q5 | Kiểm tra ranh giới bằng script trong repo (`apps/web/tools/check-boundaries.mjs`, npm script `check:boundaries`). Không đổi cấu hình lint. |
| Q6 | Tách commit chuyển file (pure move, không đổi hành vi) khỏi commit đổi hành vi. Mỗi commit có đủ test. |
| Q7 | `apps/web/server/` và `apps/shared/web-contracts/`: ngoài phạm vi, không đổi API. |
| Q8 | Script route smoke và luồng xác minh stack thật đưa vào `apps/web/tools/verify/`, không chứa đường dẫn cá nhân. |

**Quy tắc commit (chủ dự án, 2026-10-22):** sau mỗi phase (trừ phase 0) phải chạy đủ test trước khi commit. Commit trên nhánh `asset-map`. Không push, không tạo PR, không thêm dòng đồng tác giả AI (CLAUDE.md của repo).

## 2. Mục tiêu cấu trúc `apps/web/src`

```text
src/
├── App.tsx, main.tsx, index.css   composition root: chọn mock/real đúng một lần
├── router/                        một khai báo cho mỗi route key (gộp MANIFEST, route-table, REAL_PAGES)
├── state/                         mode (từ real/mode.ts), identity phía view, Query provider, store, feature-services
├── shell/, ui/                    khung giao diện và design system, không biết domain
├── domain/                        kiểu và quy tắc dùng chung nhiều feature (entities, permissions, clock interface)
├── platform/                      hạ tầng browser: transport, session, streaming (từ real/)
├── demo/                          seed, demo clock, mock authority, service factory mock, runtime demo, persona
└── features/<domain>/
    ├── index.ts                   entry duy nhất cho caller ngoài feature
    ├── service.ts                 port: interface và ServiceResult
    ├── mock.ts                    hiện thực mock (đọc từ demo/ khi cần)
    ├── remote.ts                  hiện thực backend: endpoint và mapping (thay real/service-adapter/)
    ├── query.ts                   hook react-query dùng chung hai mode
    ├── views/                     presentation dùng chung hai mode
    └── *.test.*                   test cạnh hành vi
```

Quy tắc (kiểm tra bằng `check:boundaries`):
- **R1.** Presentation (`views/`, `pages/`, `screens/` trước khi xóa) chỉ gọi hook của feature. Không dùng `isRealMode`, `DATA_MODE`, `useServices`, `.authority`, `MockClock`, `demo-clock`.
- **R2.** Chọn mock hay remote ở một chỗ: composition root (`state/`).
- **R3.** Caller ngoài feature chỉ import `features/<x>` (qua `index.ts`), không import file nội bộ.
- **R4.** `platform/` không biết domain. `demo/` không được import từ đường production; mock code trong `features/<x>/mock.ts` được phép import `demo/`. Real mode không fallback sang demo (ADR-0068).
- **R5.** Không tạo file mới trong `screens/`, `real/screens/`, `real/service-adapter/`. Tên file kebab-case theo domain, không dùng a–h hay ID ticket.
- **R6.** Mỗi route key (trừ 5 route hệ thống) có đúng một presentation cho cả hai mode.
- **R7.** Không thêm `eslint-disable`. Không đổi cấu hình lint.

Sau khi xong, các thành phần sau không còn tồn tại: `src/screens/`, `src/real/screens/`, `src/real/` (chia vào `platform/` và từng feature), `REAL_PAGES`, `RealNotIntegrated`, `REAL_INTEGRATED_ROUTES`, `FEATURE_ROUTE_SURFACES`, `src/data.ts`, `src/domain/demo-clock.ts`, `src/features/demo/`, `src/auth/`, `src/ui.tsx` và `src/shell.tsx` (gộp vào thư mục).

## 3. Phạm vi

**Trong phạm vi**
- 28 route chỉ có real, chuyển sang presentation dùng chung theo slice (mục 5).
- 19 route đã dùng chung nhưng còn tàn dư (`f-report`, `d-assets`, `f-settings`, `f.tsx` có nhánh `isRealMode`; màn hình nằm ngoài feature).
- Tách `real/api.ts` (1.747 dòng) theo domain về `features/<x>/remote.ts` và `platform/`.
- Ranh giới: `index.ts` cho 33 feature; gỡ `useServices`, `.authority`, `isRealMode`, `demo-clock`, `data.ts` khỏi presentation và feature.
- Test: di chuyển theo module, giữ tên test.
- Tài liệu: `AGENTS.md`, ADR-0084, ADR-0096, tracker `.scratch/web-improve-refactor/`, `plan.md`.

**Ngoài phạm vi**
- PTY và Access/Console (ADR-0095 còn Proposed). C2 transcript chờ ADR này.
- `apps/web/server/`, `apps/shared/web-contracts/`, package Python, và cấu hình lint.
- Tính năng sản phẩm mới.

## 4. Phase và tiêu chí hoàn thành

| Phase | Nội dung | Tiêu chí hoàn thành |
| --- | --- | --- |
| 0 | Ghi kết luận (file này), ADR-0096, sửa gate route, lập baseline | Tài liệu và gate hợp lệ; typecheck, lint không đổi so với baseline |
| 1 | Vệ sinh không đổi hành vi: `real/mode.ts` → `state/mode.ts`; bỏ import ngược `real→screens` (3 file) và `features→screens` (4 file); gỡ import giá trị từ feature service trong adapter; gộp `ui.tsx`, `shell.tsx`; `auth/` → `domain/`; chuyển test `safety/` | Test đầy đủ xanh; `check:boundaries` ghi nhận số vi phạm giảm |
| 2 | Tách demo và port: `demo/`; clock inject qua factory; `data.ts` tách thành `demo/seed` và `domain/catalog`; types chuyển sang `domain/`; `real/api.ts` chia theo domain về `features/<x>/remote.ts` | Test đầy đủ xanh; không còn `data.ts`, `demo-clock`; `real/api.ts` không còn |
| 3 | Presentation dùng chung theo slice (mục 5). Mỗi slice: chuyển màn hình vào `features/<x>/views`, đổi `useServices` sang hook của feature, hoàn thiện `remote.ts`, đăng ký `MIGRATED`, xóa panel real khi đạt parity | Mỗi slice: test đầy đủ xanh, route smoke ở cả hai mode đạt, flow xác minh của slice đạt |
| 4 | Dọn cây cũ: xóa `src/screens/`, `src/real/screens/`, `REAL_PAGES`, route single source, tách file lớn còn lại, gate route mới, `check:boundaries` bằng 0 | Mọi tiêu chí mục 6 đạt |

**Tiêu chí tổng thể (đo được):**
1. Không còn `src/screens/`, `src/real/`, `src/data.ts`, `src/features/demo/`.
2. `router/` có một khai báo mỗi route; route hệ thống là ngoại lệ được ghi rõ.
3. `check:boundaries`: 0 vi phạm.
4. 33/33 feature có `index.ts`; không có import sâu từ ngoài feature.
5. Typecheck, lint (không tăng lỗi), test, build đạt.
6. Route smoke ở mock và real: không có trang lỗi, trừ các route đã ghi nhận gap.

## 5. Slice presentation (phase 3)

| Slice | Route | Nguồn hiện tại (dòng, xấp xỉ) | Ghi chú |
| --- | --- | --- | --- |
| S-A Reports | reports, report-new, report, report-preview, report-review | features/reports 1.191; f-report 951; adapter 462 | Route đã dùng chung; dọn tàn dư và nhánh `isRealMode` |
| S-B Assets/Library | assets, asset, asset-new, asset-scope, playbooks, playbook, technique, playbook-review | features/assets 736, library 525; d-assets 660 | Đã dùng chung; dọn tàn dư |
| S-C Settings/Team/Audit | settings | features/settings 1.155, team 429, audit 172; f-settings 803 | Đã dùng chung; dọn tàn dư |
| S-D Projects/Overview | overview, command-center, tasks, projects, project, project-new | real 1.022; mock 2.142 | Cần adapter projects |
| S-E Operations/Governance/Scope | operations, operation, operation-new, preflight, operation-schedule | features 4.181; mock 1.979 | Adapter `runtime-operations`, `governance`, `scope` có sẵn. Operations chưa có flow stack thật mới |
| S-F Agents/Fleet | agents, agent, ai-fanout, ai-branch | features 1.578; mock 1.537 | Cần adapter agents |
| S-G Analysis | analysis | features 708; mock 912 | Adapter `analysis` có sẵn |
| S-H AI operator và plans | ai-operator, ai-history, ai-trace, ai-plan, ai-plan-review, ai-plan-compare | real 1.529; features 2.441; mock 2.169 | Workspace có streaming và điều khiển run. Cần adapter workspace |
| S-I C2 | c2, c2-channel, c2-session, c2-console | features 1.669; mock 898; real 294 | Transcript chờ ADR-0095 |
| S-J Infrastructure và mock-only | infrastructure; states, scenarios, workspaces | real 93; mock 81 + 423 | Mock-only chuyển vào `demo/` (Q4) |

Thứ tự slice theo design doc và độ phụ thuộc: S-A → S-B → S-C (dọn các route đã dùng chung trước), rồi S-D, S-G, S-E, S-F, S-H, S-I, S-J. Slice có adapter đầy đủ làm trước để giảm rủi ro.

## 6. Quy trình kiểm chứng

- **Mỗi phase (trừ 0):** typecheck; lint không tăng lỗi so với baseline; `npm run test` toàn bộ; `npm run build`; `check:boundaries`.
- **Route smoke** (`apps/web/tools/verify/route-smoke.mjs`): mở từng route key ở mock và real mode, ghi lỗi trang và trang "failed to render". Chạy trước phase 3 (baseline) và sau mỗi slice.
- **Luồng stack thật** theo slice: owner và viewer; findings dùng `flow-r4` (dismiss, restore, add-to-report, tab Evidence); reports và settings thêm luồng tương ứng.
- **Stack thật:** container PostgreSQL riêng (không đụng container khác), API chạy từ source, Vite. Dừng tiến trình theo PID đã xác minh bằng command line và cổng; giới hạn 5 giây cho mỗi lệnh dừng (AGENTS.md).

## 7. Rủi ro và biện pháp

| Rủi ro | Biện pháp |
| --- | --- |
| Hạ năng lực real khi hợp nhất presentation | Q3: không xóa panel real trước parity; mỗi slice liệt kê năng lực cần giữ |
| Thiếu adapter (agents, projects, workspace) | Viết `remote.ts` theo port hiện có; gap không thể nối thì gắn control-gap rõ ràng, không fallback demo |
| Vòng import khi chuyển file | Chuyển theo thứ tự phụ thuộc; `check:boundaries` và typecheck phát hiện ngay |
| Vỡ test do đổi đường dẫn | Pure move trong commit riêng; chạy đủ test sau mỗi commit |
| Repo phình (quá nhiều file, thư mục tạm) | Ghi tài liệu vào `.scratch/`; script tạm ở scratchpad; xóa file cũ ngay trong phase tương ứng |
| Lệch tài liệu (ADR, AGENTS.md) | Cập nhật tài liệu trong cùng phase với thay đổi cấu trúc |

## 8. Tiến độ

| Phase | Trạng thái | Commit | Ghi chú |
| --- | --- | --- | --- |
| 0 | Hoàn thành | 18c6732c | ADR-0096 Accepted; ADR-0084 ghi nhận điểm 2 được thay thế; gate route sửa; `check:boundaries` và `verify:routes` thêm vào |
| 1 | Hoàn thành | 561de192, bb48df69 | Mode, policy, dashboard, AI card và ui/shell/safety về owner; Findings và fan-out có module riêng; các unavailable service dựng qua một helper |
| 2 | Hoàn thành | be2c2f61, d35bb8c7, 793515a5, cbf06696 | real/api.ts chia về features/<x>/remote.ts và platform/; data.ts tách thành domain/catalog.ts và demo/seed.ts; demo/ gồm display-clock, authority, runtime, persona, services; service factory tách thành domain/console-services.ts và demo/services.ts; mock service đóng dấu thời gian qua clock của authority. check:boundaries: 842 (từ 808 ở phase 0), tăng vì adapter import remote.ts theo đường dẫn, xử lý ở phase 3 |
| 3 | Đang làm: S-A Reports đạt parity theo checklist (còn phần mock-only); S-B: Assets đạt cả hai mode, Library chờ knowledge graph trong stack | 031f8a19, c9454b10, d0d53476, 794f808b (S-A); 811dbc5f, e9ca0797, 47d00cde (S-B); ce789b22 (S-J) | Chi tiết ở mục 8.5 |
| 4 | Chưa bắt đầu | — | |

### 8.1 Phase 2: chia file đã hoàn thành

- `real/api.ts` đã chia về `features/<x>/remote.ts` và `platform/` (`be2c2f61`).
- `data.ts` tách thành `domain/catalog.ts` và `demo/seed.ts` (`d35bb8c7`).
- `demo-clock`, `database`, `features/demo/runtime` và `auth/persona` về `demo/` (`display-clock`, `authority`, `runtime`, `persona`). Service factory tách thành `domain/console-services.ts` (kiểu) và `demo/services.ts` (factory) (`793515a5`).
- Mock service đóng dấu thời gian qua clock của authority; `features/` không còn import `demo-clock` (`cbf06696`).
- `screens/demo/` (route chỉ có ở mock: `states`, `scenarios`, `workspaces`) về `demo/` (`ce789b22`).

### 8.2 Phase 2: ownership còn đang làm

Số vi phạm theo `check:boundaries`, khóa tại `tools/boundaries-baseline.json` (tổng 866):

| Rule | Số | Ý nghĩa |
| --- | --- | --- |
| production-imports-demo | 52 | import giá trị từ `demo/` ngoài ngoại lệ |
| production-type-imports-demo | 77 | import kiểu từ `demo/`; chuyển kiểu sang `domain/` |
| production-imports-composition | 46 | code ngoài composition root import `state/services` |
| presentation-imports-real | 63 | presentation import `real/` |
| presentation-imports-adapter | 33 | presentation import `remote.ts` hoặc `mock.ts` |
| presentation-mock-plumbing | 135 | presentation dùng `useServices`, `MockClock`, `.authority` |
| real-imports-features | 112 | `real/` import `features/` |
| deep-feature-import | 348 | import sâu vào feature khác |

Ownership chưa đóng:
- `features/*/service.ts` còn chứa implementation mock (ví dụ `reports/service.ts`, 926 dòng): port và mock chưa tách. 30 feature còn import `demo/`.
- Adapter còn ở `real/service-adapter/` (36 file), chưa về `features/<x>/remote.ts`.
- Presentation còn ở `screens/` (42 file) và `real/screens/` (33 file), chưa gộp theo route.
- `auth/identity.ts` (identity persona) và `auth/membership.ts` chưa có owner.

Phase 2 đóng ở mức chia file. Ownership đóng theo slice trong phase 3.

### 8.3 Ngoại lệ và quy tắc import (có hiệu lực từ commit này)

- **Composition root** (`state/services.tsx`, `App.tsx`, `main.tsx`): chọn mock hoặc real; được import `demo/` lúc chạy. Không module nào khác trong production được import `state/services`.
- **Demo side** (`demo/**`, `features/<x>/mock.ts`): được import `demo/` và mock; không import `remote.ts` hay `real/`.
- **Adapter và platform** (`features/<x>/remote.ts`, `platform/**`): không import `demo/`, mock hay `state/services`.
- **Presentation** (`features/<x>/views/`, `screens/`, `shell/`): chỉ import `index.ts` của feature, hoặc `service.ts` (port) để lấy kiểu; không import `remote.ts`, `mock.ts`, `real/` hay `demo/`.
- **Import kiểu từ `demo/` trong production** được đếm riêng (`production-type-imports-demo`). Không cấm ngay, nhưng phải chuyển sang `domain/`. Import giá trị từ `demo/` trong production đếm là `production-imports-demo`.
- **Route chỉ có demo trong real mode** (`states`, `scenarios`, `workspaces`) hiển thị panel "Not connected in real mode" (`RealNotIntegrated`, role `status`). Không mount màn hình demo, không dùng dữ liệu demo (ADR-0068). Route smoke kiểm tra đúng marker này.

### 8.4 Gate trước khi mở rộng migration

- `npm run typecheck`, `npm run lint` (5 lỗi cũ, không tăng), `npm run test`, `npm run build`.
- `npm run check:boundaries`: ratchet. Thất bại khi một rule vượt baseline. `npm run check:boundaries:write` khóa mức giảm đã được xem xét.
- `npm run verify:routes`: `tools/verify/route-smoke.mjs` kiểm tra từng route theo kỳ vọng riêng cho mỗi mode (heading của `main` hoặc text hiển thị). Mock đăng nhập một persona; real đăng nhập bằng form và xác nhận `/api/auth/session`. Lỗi ngoài `tools/verify/baseline.json` làm exit khác 0.
- `tools/verify/stack.mjs`: dựng stack cách ly (PostgreSQL container riêng, mật khẩu ngẫu nhiên, API từ source, Vite, owner bootstrap một lần, fixture qua API), chạy smoke, rồi dừng và xóa mọi thứ đã tạo.
- Phần chưa kiểm chứng được ghi trong `baseline.json` kèm lý do. Không tính là parity.

### 8.5 Phase 3: tiến độ slice (có bằng chứng)

**S-A Reports: đạt parity theo checklist; còn một phần chỉ có ở mock.**
- Commit: `031f8a19` (port khai báo rõ ràng; mock tách khỏi service; adapter gộp vào `remote.ts`; endpoint ở `endpoints.ts`; helper adapter về `platform/`), `c9454b10` (presentation về `features/reports/views/`, pure move), `d0d53476` (capability thay `isRealMode()`), `794f808b` (checklist và seed).
- Bằng chứng: checklist real (`flows-reports.json`) đạt 27/27 thao tác qua adapter trong trang đang chạy: capabilities, list, templates, deliveries, draftOptions, editor, review, createTemplate, createDraft, saveSection, addSection, removeSection, reorderSections, setFindings với finding đã xác nhận, submit, decide approve bởi reviewer độc lập, exportVersion PDF, exportArtifact markdown, deliver, acknowledge, revise. Route smoke: năm route báo cáo đạt ở mock và real.
- Đã xóa: `real/service-adapter/reports.ts`; `screens/f-report.tsx` và phần báo cáo của `screens/f.tsx`; mọi `isRealMode()` trong view báo cáo.
- Chưa đạt: `SimulatedTemplates` trong `features/reports/views/list.tsx` (chi tiết mẫu, phê duyệt, dùng mẫu, nhật ký kiểm toán mô phỏng) chỉ có ở mock. Port chưa có thao tác tương ứng và real không có; cần thêm thao tác port trước khi hợp nhất. View này còn một `useServices()`. `screens/f.tsx` còn giữ route settings đến khi S-C.
- Chưa kiểm chứng: thao tác bằng giao diện (click-through). Route smoke xác nhận màn hình hiển thị; checklist xác nhận thao tác qua adapter.

**S-B Assets/Library: Assets đạt ở cả hai mode; Library chưa đạt vì stack không có knowledge graph (Neo4j).**
- Commit: `811dbc5f` (hai lỗi real `asset-new`, `asset-scope`), `e9ca0797` (chuyển mock, adapter và view của assets và library vào feature; `screens/d-shared.tsx` thành `ui/d-shared.tsx`), `47d00cde` (công cụ kiểm chứng).
- Cấu trúc: Assets gồm `features/assets/mock.ts`, `remote.ts` (adapter), `endpoints.ts`, `views/asset-pages.tsx`. Library gồm `features/library/mock.ts`, `remote.ts`, `endpoints.ts`, `views/library-pages.tsx`. View assets không còn `useServices()` hay `isRealMode()`; khác biệt theo mode đi qua `AssetCapabilities` (`scopeApprovalRequests`, `observedGraph`).
- Bằng chứng Assets: checklist `tools/verify/flows/assets-library.mjs` 12/12 thao tác khớp kỳ vọng qua adapter thật (list, get, scope, importRows gồm trùng và dòng sai, changeScope, requestScopeApproval bị từ chối ở real đúng như port khai báo; observedGraph bị từ chối vì không có Neo4j). Route `assets`, `asset`, `asset-new`, `asset-scope` đạt ở mock và real, không có lỗi trang.
- Library chưa đạt: `/api/library` và các route proposal chỉ đăng ký khi có knowledge graph. Stack không khởi động Neo4j, nên checklist library ghi là NOT RUN và route `playbooks` real hiện "Skill library unavailable", được khai báo trong baseline. Code đã tách xong (`e9ca0797`) nhưng chưa có bằng chứng; đóng phần này cần Neo4j trong stack.
- Chưa làm: click-through yêu cầu phạm vi trên giao diện.

**Gate (lần cuối, `stack-full6`):** mock 55/55 đạt, không lỗi mới. Real: 40 đạt, 15 khai báo trong baseline, không lỗi mới. Checklist reports 27/27. `check:boundaries`: 810 vi phạm sau `e9ca0797`, từ 866 ở commit gate.
- Đã đổi cách phán quyết route smoke: chờ heading hoặc text kỳ vọng trước khi đánh giá; lỗi API `>= 400` chỉ in thông tin, không tính fail, vì request của shell tới runtime (fleet, threads, C2) không ổn định giữa các route.

## 9. Baseline ghi nhận ở phase 0 (HEAD fb71c24c)

- **Route smoke** (`npm run verify:routes`): mock 55/55 không lỗi. Real 53/55. Hai route lỗi là `asset-new` và `asset-scope`: màn hình gọi `useServices()` nên ném "Mock console services are unavailable in real mode". Đây là gap có sẵn, xử lý trong slice S-B.
- **check:boundaries**: 808 vi phạm. `production-imports-demo` 245; `deep-feature-import` 266; `presentation-mock-plumbing` 135; `presentation-imports-real` 102; `real-imports-features` 57; `features-import-screens` 3.
- **Route gate** (`.scratch/web-improve-refactor/route-manifest-check.mjs`): EQUAL sau khi sửa cách resolve import (router/*.ts) và loại khóa có cờ `asset-map` khỏi inventory 55 khóa.
- **Typecheck** 0 lỗi. **Lint** 5 lỗi có sẵn ở `src/screens/f.tsx`. **Test** 161 file, 1.473 test đều pass (91 giây).
- Ghi chú môi trường: container PostgreSQL riêng `raptix-verify-pg4` (cổng 55444) giữ lại cho các mốc sau; API và Vite đã dừng theo PID đã xác minh.

## 10. Trạng thái hiện hành (đợt Mốc 1–3 và checkpoint, 2026-10-22)

Đợt này làm ba việc theo thứ tự: sửa các thao tác ghi báo thành công khi handler từ chối (Mốc 1), đưa seam mock, đồng hồ và runtime demo về feature và port (Mốc 2), rồi chuyển các nhóm còn lại ra khỏi `screens/` và xóa thư mục này (Mốc 3). Trạng thái dưới đây đo trên cây tại `86beff9f`.

Commit của đợt (từ `41e577eb` đến `86beff9f`):
- Mốc 1, hành vi ghi: `d36acd0e` (confirm giữ mở và hiện lý do từ handler), `ac31d4e7` (pause và stop chỉ báo thành công khi handler nhận), `46ddc9e8` (phân công, disable, enable và đổi trạng thái trả kết quả có kiểu).
- Mốc 2, seam mock: `1dadd599` (nhãn giờ của mock lấy từ đồng hồ được inject), `523d88f9` và `de789208` (factory và ghi draft về `features/operations/mock.ts`), `aebf0342` và `e1d75783` (preflight và lifecycle về mock), `5217fd45` (đổi agent qua port, persona qua `useAgentsMockConsole`), `ad6390a5` (write gate nhận danh sách project, không còn import demo).
- Mốc 3, chuyển khỏi `screens/`: C2 (`ed6916e6`, `812d999b`, `abbaf578`), AI (`3fcea2d0`, `666be733`, `5d1c0396`, `40e093eb`, `39be8f12`), tasks (`2ffbbbd9`, `47890363`, `72ba96d1`), login (`14fdcc36`), wizard (`866ff114`), system và auth route (`40740901`), route d và e (`28dade74`, `49aed5e1`), audit test (`a109275e`).
- Dọn và khóa: `27b59057` (sửa comment còn trỏ tới module đã xóa), `86beff9f` (khóa baseline đã giảm).

File legacy đã xóa: toàn bộ `screens/`, 24 file đo cuối đợt trước, nay là 0. Mỗi file đã chuyển vào owning feature, `demo/`, `shell/` hoặc `router/`, và caller đã đổi sang đường mới. `real/screens/` (8 file) thuộc cây real, không nằm trong phạm vi, không sửa.

### 10.1 Bảng trạng thái

Cách đọc: "Đóng" = đã chuyển hoặc sửa và có bằng chứng; "Đóng một phần" = phần chính đã làm, phần còn lại có owner; "Mở" = chưa làm.

| Mục | Trạng thái | Bằng chứng | Ghi chú |
| --- | --- | --- | --- |
| Pause và stop operation báo thành công khi bị từ chối | Đóng | `ac31d4e7`; `features/operations/controls.test.tsx` | Từ chối giữ dialog với lý do của handler, không toast thành công, không commit |
| Phân công, disable, enable, thay agent và đổi trạng thái agent báo thành công khi bị từ chối | Đóng | `46ddc9e8`, `5217fd45`; `features/agents/controls.test.tsx` | `setAgentStatusTransaction` trả kết quả có kiểu thay vì `void` và non-null assertion. Enable và phân công chưa có test riêng ở giao diện |
| Confirm dialog bỏ qua lý do từ chối | Đóng | `d36acd0e` | Hợp đồng `ConfirmOutcome` trong `state/session.ts` |
| Operations: factory, ghi draft, preflight, lifecycle về `mock.ts` | Đóng | `523d88f9`, `de789208`, `aebf0342`, `e1d75783` | `service.ts` còn `startOperation`, `operationStartGate`, `createOperationDraft` (xem 10.3) |
| Operations: đổi `service.ts` thành `mock.ts` theo ADR-0096 | Mở | — | Khoảng 40 file import `service.ts`. Chưa đổi tên trong đợt này |
| Operations: signoff Results dùng giờ máy | Đóng | `features/operations/views/operation-results.tsx` dùng `mock.display.stamp()` | Đợt trước ghi là mở |
| Đồng hồ máy trong code mock và presentation | Đóng một phần | Grep `Date.now()` trong `features/` | Nhãn hiển thị của mock đã đi qua đồng hồ được inject. Còn lời gọi `Date.now()` tạo id, hạn hoặc nhịp ở một số feature (10.3) |
| Agents: persona và ghi qua `useAgentsMockConsole` | Đóng | `ef5e1ce7`, `5217fd45` | |
| Agents: `USERS` từ `domain/catalog` | Mở | `features/agents/query.ts` | Cần port đọc user trước khi bỏ |
| C2: pages, session console và infrastructure vào `features/c2` | Đóng (cấu trúc) | `812d999b`, `ed6916e6`, `abbaf578` | Không còn slot và composition ở `screens/`. Chưa có click-through cho luồng C2 |
| AI: workspace, chat, trace, plan và workers vào feature | Đóng (cấu trúc) | `3fcea2d0`, `666be733`, `5d1c0396`, `40e093eb`; route `g` ở `router/slice-g.ts` | Chat gửi qua `useAiDemo().sendChat`. Runtime thật là config-gated (10.2) |
| Tasks: inbox, dữ liệu và aggregate dashboard | Đóng | `2ffbbbd9`, `72ba96d1`, `47890363` | `features/tasks/actions.ts` giữ ba decision (plan, approval, access request) |
| Login mock | Đóng | `14fdcc36` | Vào `demo/login-page.tsx`. `real/screens/login.tsx` không đổi |
| Wizard | Đóng | `866ff114` | `features/wizard/views`, route ở `features/wizard/routes.ts` |
| System pages và auth route | Đóng | `40740901`, `a109275e` | `shell/system/`, auth route ở `router/slice-a.ts` |
| Route `d` và `e` từ `screens/` | Đóng | `28dade74`, `49aed5e1` | `router/slice-d.ts`, `router/slice-e.ts` |
| Composition `screens/` | Đóng | Thư mục đã xóa | 24 file về 0. Registry không còn slice nào mount từ `screens/` |

### 10.2 Đã kiểm chứng, config-gated, chưa kiểm chứng

Đã kiểm chứng trên cây `86beff9f` (mã giống `ad6390a5`; commit sau chỉ đổi baseline):
- Full suite web: 168 file, 1484 test, pass. Lần chạy đầu, trước khi sửa write gate, có một test fail ở `features/asset-map/domain-detail.test.tsx` ("filters the sitemap by URL or path..."). Chạy lại toàn bộ và chạy riêng đều pass. Nguyên nhân chưa xác định tại thời điểm đó, nghi là lỗi thời gian khi chạy song song. Code asset-map không đổi trong đợt này. Đính chính: nguyên nhân đã tìm ra và sửa ở `a2e61465`, xem mục 11.
- Build (gồm typecheck và `vite build`): exit 0. Cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` cho `real/screens/login.tsx` còn, đã ghi từ đợt trước.
- Lint toàn web: exit 0.
- `check:boundaries --strict`: exit 0, số vi phạm bằng baseline ở cả 10 rule.
- Stack thật, mock và real, có Neo4j: 119 PASS, 0 FAIL. Route smoke: mock 55 route và real 55 route đều không có lỗi mới. Real khai báo 13 lỗi trong `baseline.json`, 3 khai báo không xảy ra, như đợt trước.
- Test đơn vị mới cho write path: pause được chấp nhận thì commit và toast; pause bị từ chối giữ dialog với lý do, không commit, không toast; stop bị từ chối không toast; thay agent bị từ chối qua port giữ nguyên operation; disable được chấp nhận có audit và toast; disable bị từ chối khi agent đã bị xóa lúc dialog đang mở.
- Nhãn giờ của demo: `demo/display.test.ts` kiểm nhãn khi đồng hồ được advance.

Config-gated (stack không có runtime, C2 server hay LangGraph; chỉ có trạng thái gate, không tính là đã chạy):
- Execute, submit, pause, resume và cancel của operation trên runtime thật.
- Gửi và stream hội thoại AI.
- Điều phối lệnh C2 và console phiên.
- Chi tiết agent và branch có runtime thật.

Chưa kiểm chứng trong đợt này:
- Thao tác ghi ở mock chưa có click-through: resume, complete, stop được chấp nhận, enable, phân công và thay agent qua giao diện. Hai flow `operations-click` và `agents-click` chỉ đọc.
- Luồng C2, AI, tasks, wizard và system chỉ kiểm bằng route smoke (không lỗi mới), chưa có click-through.
- Dark mode, mobile và project identity từng tab sau khi chuyển.

### 10.3 Hoãn (follow-up có owner)

- **Operations (owner: Operations):** nội dung mock đã nằm ở `mock.ts` (xem 11.2), `service.ts` không đổi tên. Còn mở: click-through cho complete.
- **Agents (owner: Agents):** click-through cho phân công và thay agent qua giao diện còn mở. Enable đã có trong flow `agents-click` (xem 11.5). `features/agents/query.ts` không còn đọc `USERS`.
- **C2 (owner: C2):** không đưa `expiresAt` về đồng hồ đã inject. `features/c2/provider-grants.tsx` tính hạn grant bằng `Date.now()` và hạn đó là thời gian thực: server kiểm lại khi ghi, nên đồng hồ demo không được thay vào đó. Bản trước ghi nhầm đây là việc cần làm; đã đính chính. Click-through cho luồng C2 mock vẫn mở (xem mục 11).
- **Đồng hồ máy còn lại (owner: từng feature):** `features/wizard/service.ts`, `features/notices/service.ts` và `features/vault/service.ts` tạo id bằng `Date.now()`. `features/aichat/views/workspace.tsx` dùng `Date.now()` để giới hạn tần suất đọc checkpoint. `features/projects/environment-api.ts` dùng cho hạn polling trên đường real. Các chỗ này không phải nhãn hiển thị của mock nên không thuộc Mốc 2.
- **Asset-map (owner: Asset Map):** đã đóng ở `a2e61465`. Ô lọc sitemap đồng bộ draft từ filter trong passive effect nên có thể bị ghi đè sau lần gõ đầu tiên; đã chuyển sang đồng bộ khi render (xem mục 11).
- **Real (owner: cần gán):** `real/screens/*` (8 file) không thuộc đợt này. Cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` cho `real/screens/login.tsx` còn lại.
- **Kiểm lại UX (owner: cần gán):** dark mode, mobile và project identity cho operations, agents, C2, AI, tasks, wizard và system.

### 10.4 Số liệu đo

Ratchet `check:boundaries --strict`: exit 0 trên `86beff9f`. Khóa baseline mới được ghi ở `86beff9f`. Các rule giảm đều do file chuyển khỏi `screens/` và do `write-gates.ts` không còn import demo. Không rule nào được nới. Trong lúc làm, `production-type-imports-demo` vượt baseline 1 vì `write-gates.ts` import type `Db` từ `demo/seed`; đã sửa trước khi khóa.

| Rule | Khóa trước đợt (`66ba44aa`) | Sau đợt (`86beff9f`) |
| --- | --- | --- |
| production-imports-demo | 42 | 39 |
| production-type-imports-demo | 69 | 69 |
| production-imports-composition | 35 | 30 |
| presentation-imports-real | 13 | 13 |
| presentation-imports-adapter | 14 | 14 |
| presentation-mock-plumbing | 80 | 49 |
| real-imports-features | 68 | 68 |
| real-imports-screens | 0 | 0 |
| features-import-screens | 0 | 0 |
| deep-feature-import | 263 | 248 |

Quy mô (đo bằng `find`, `*.ts` và `*.tsx`, không tính test):

| Chỉ số | Đầu đợt | Hiện tại |
| --- | --- | --- |
| `screens/` | 24 | 0 (đã xóa thư mục) |
| `real/` (tất cả) | 33 | 33 |
| `real/screens/` | 8 | 8 |
| Thư mục feature có `index.ts` | 24 | 24 trên 34 thư mục |

Số entry `index.ts` không đổi trong đợt. Mẫu số đếm lại hôm nay là 34, đợt trước ghi 33, nên không so trực tiếp.

### 10.5 Tiến độ theo phạm vi đã đóng (không theo số test)

- **Hành vi ghi báo kết quả đúng (Mốc 1):** đóng cho pause, stop, disable, phân công, thay agent và enable. Còn thiếu click-through cho resume, complete, enable và phân công.
- **Seam mock của operations (Mốc 2):** đóng. Factory, ghi draft, preflight và lifecycle đã ở `mock.ts`. Tên file `service.ts` chưa đổi (mục mở).
- **Đồng hồ và persona (Mốc 2):** đóng cho nhãn hiển thị của mock và persona của agents. `USERS` và `Date.now()` ở chỗ khác còn mở.
- **Chuyển khỏi `screens/` (Mốc 3):** đóng về cấu trúc cho C2, AI, tasks, login, wizard, system, composition và route d, e, g. Thư mục `screens/` đã xóa.
- **Runtime thật:** chưa kiểm chứng. Execute, submit, stream AI và điều phối C2 chỉ có trạng thái gate (10.2).
- **UX MVP:** chưa tuyên bố đạt. Route smoke và flow đọc đều pass, nhưng click-through ghi ở mock, dark mode, mobile và project identity chưa kiểm lại.

### 10.6 Thứ tự đề xuất cho đợt tiếp

1. Operations: flow ghi ở mock cho complete. Không đổi tên `service.ts` (xem 11.2).
2. Agents: click-through cho phân công và thay agent. `USERS` thuộc mục Identity (xem 11.3).
3. C2: click-through cho luồng C2 mock. `expiresAt` của grant giữ theo thời gian thực (xem 10.3).
4. Đồng hồ còn lại trong `wizard`, `notices`, `vault` và các chỗ ở 10.3, theo owner.
5. Kiểm lại dark mode, mobile và project identity cho các nhóm đã chuyển.

## 11. Đợt khép migration (checkpoint cuối, 2026-10-22)

Đợt này đóng cây `real/`, chuyển hết nội dung mock của Operations ra `mock.ts`, phân loại lại đồng hồ và persona, kiểm chứng luồng ghi và luồng tích hợp trên mock, và điều tra lỗi asset-map. Trạng thái dưới đây đo trên `7504cbdf`. Mục 10 giữ lịch sử của đợt trước; các chỗ sai đã được đính chính trong đó.

### 11.1 Cây legacy

- `apps/web/src/real/` và `apps/web/src/screens/` không còn tồn tại. Không có cây real thứ hai.
- Nơi ở của các phần đã chuyển: adapter thật ở `features/<x>/remote.ts`, wire HTTP ở `features/<x>/api.ts`; control gap và guard sở hữu response ở `platform/`; composition và provider ở `state/`; chrome, bootstrap, login và search ở `shell/`; route real ở `router/feature-route.tsx`; campaign C2, command center, global resource, environment và execution log ở feature tương ứng.
- Đã xóa: `real/screens/capture-upload.tsx` và test của nó (không có caller), `real/queries.ts` (query nằm trong từng feature), `demo/display-clock.ts` (thay bằng đồng hồ được inject).
- Quy tắc trong `AGENTS.md`: presentation không import `remote`, `api` hay `mock` trực tiếp. Hiện còn 10 chỗ vi phạm, liệt kê ở 11.3.

### 11.2 Operations, plans, persona và đồng hồ

- Operations: draft, start gate, `startOperation`, list, detail, preflight và lifecycle gate ở `features/operations/mock.ts`. `service.ts` còn type port và helper thuần, không import demo. Mục "đổi tên `service.ts` thành `mock.ts`" ở mục 10 là sai theo ADR-0096, nơi `service.ts` là port, nên không đổi tên. Đo lại hôm nay có 10 file import `service.ts` (8 trong `features/operations`, 2 ở nơi khác); con số 40 ở bản trước không tái lập được.
- Plans: type port và tra cứu project của plan ở `features/plans/service.ts`; cài đặt bridge tạo operation từ plan ở `features/plans/mock.ts`; ghi đi qua `services.plansBridge(...)`.
- Persona: danh sách owner và reviewer của agents đọc từ `demo/persona.ts`. `USERS` còn ở các chỗ liệt kê ở 11.3.
- Đồng hồ: nhãn hiển thị của demo đọc từ `services.display` (đồng hồ được inject). `Date.now()` còn lại được phân loại ở 11.4.

### 11.3 Còn lại, có owner

| Mục | Chỗ dùng | Owner | Lý do chưa chuyển |
| --- | --- | --- | --- |
| Presentation import `remote` hoặc `api` (10 chỗ, 8 file) | `features/agents/views/instance-messenger.tsx`, `features/agents/views/execution-agents.tsx`, `features/audit/table.tsx`, `features/operations/plan-steps.tsx`, `features/projects/views/create-page.tsx`, `features/projects/views/project-settings-panel.tsx`, `features/projects/views/environment-panel.tsx`, `features/team/approval-inbox.tsx` | AI, Agents, Audit, Operations, Projects, Team | Component gọi hàm wire hoặc đọc type từ wire. Cần query hook trong feature, hoặc chuyển type về `service.ts` |
| `USERS` (`domain/catalog.ts`) | `shell/header.tsx`, `shell/system/pages.tsx`, `auth/identity.ts`, `demo/*` | Identity | Shell đọc danh sách user trực tiếp. Cần port đọc user trước khi bỏ |
| `features/operations/service.ts` | 10 file import | Operations | Là port theo ADR-0096; không đổi tên trong đợt này |

Số đo boundary còn lại, đã khóa và không tăng: `production-imports-demo` 39, `production-type-imports-demo` 65, `production-imports-composition` 30, `presentation-mock-plumbing` 49, `deep-feature-import` 218. Owner: từng feature, chuyển theo lô.

Cảnh báo build `INEFFECTIVE_DYNAMIC_IMPORT` (không làm build lỗi, không nằm trong gate):
- `shell/real-login.tsx`: import tĩnh từ `shell/real-bootstrap.tsx`, import động từ `router/routes.ts`. Cảnh báo có từ trước, khi file còn ở `real/screens/login.tsx`. Owner: Shell.
- `features/tasks/index.ts`: import tĩnh từ `shell/real-search.tsx`, import động từ `router/routes.ts`. Xuất hiện từ `08d0c9b9`. Owner: Tasks, Shell.

### 11.4 Đồng hồ và hạn

- Tạo id, không phải nhãn hiển thị: `state/stores.ts`, `platform/request-ledger.ts` (nhánh dự phòng), `features/notices/service.ts`, `features/wizard/service.ts`, `features/vault/service.ts`, `features/aichat/session.ts` (nhánh dự phòng). Owner: từng feature.
- Nhịp của đồng hồ demo: `state/services.tsx` đo thời gian máy mỗi 15 giây và cộng vào đồng hồ được inject. Đây là nguồn thời gian máy của đồng hồ demo; giữ nguyên.
- Polling và throttling, giữ thời gian thực: `features/projects/environment-api.ts` (hạn chờ môi trường trên đường real), `features/aichat/views/workspace.tsx` (giới hạn tần suất đọc checkpoint).
- Hạn grant thật của C2: `features/c2/provider-grants.tsx` giữ `Date.now()`. Server kiểm lại khi ghi, nên không thay bằng đồng hồ demo.

### 11.5 Kiểm chứng trên cây cuối

- Suite web: 167 file, 1483 test, tất cả pass (chạy sau `a2e61465`).
- Build (typecheck và `vite build`): exit 0, có hai cảnh báo ở 11.3.
- Lint (`eslint .`): exit 0.
- Boundary strict: exit 0. Khóa ở `7504cbdf` cho hai rule đã giảm: `production-type-imports-demo` 69 → 65, `deep-feature-import` 220 → 218. Không rule nào tăng.
- Route gate mock (`tools/verify/route-smoke.mjs --modes mock`, app trên cổng 5299): 55 của 55 route pass, `new failures: 0`.
- Flow mock `operations-click`: 7 của 7 bước pass. Taylor Chen (operator của OP-014): pause có lý do báo "Operation paused." và hiện Resume; resume báo "Rechecks passed. Operation resumed."; stop có lý do báo "Stop requested. Stopping…" rồi "Operation stopped.". Casey Nguyen (viewer): nút Pause bị khóa kèm lý do, không mở dialog, không báo thành công.
- Flow mock `agents-click`: 8 của 8 bước pass. Disable có lý do báo "AG-007 disabled.", enable báo "AG-007 enabled."; viewer thấy Disable Agent bị khóa kèm lý do, không mở dialog.
- Flow mock `integration-path-click`: 8 của 8 bước pass; lượt chạy có exit 1 vì phần dark mode, xem dưới. Chuỗi: Projects → project overview → AI Operator và Operations → Finding → Reproduce và Evidence → Reports → quay lại. Mỗi bước kiểm định danh project và không để lộ id của project khác.
- Responsive (390 × 844) và dark (1360 × 960) trên các route đã chuyển: 8 của 8 màn pass ở 390 × 844 (không tràn ngang, control trong viewport và không bị che, chữ đọc được). Ở dark 1360 × 960 chỉ 1 của 8 màn pass; 7 màn fail, và lý do duy nhất là contrast dưới 4.5 (không tràn, không control bị che): operations list, operation console, agents list, agent detail, tasks inbox, finding detail, reports.
- Refusal ở tầng handler (dialog giữ mở với lý do, không commit, không toast) kiểm bằng test đơn vị `features/operations/controls.test.tsx` và `features/agents/controls.test.tsx`. Flow chỉ thấy refusal ở giao diện, tức control bị khóa.
- Asset-map: đã đóng ở `a2e61465` (xem 11.7).

### 11.6 Chưa kiểm chứng

- Runtime thật: khi kiểm, không có API ở cổng 5280 và không có Neo4j ở cổng 7474, nên route gate real và flow real chưa chạy. Execute, submit, pause, resume và cancel trên runtime thật, stream hội thoại AI và điều phối lệnh C2 chỉ có trạng thái gate (mục 10.2), chưa chạy.
- Click-through chưa có: complete của operation, phân công và thay agent qua giao diện, luồng C2.

### 11.7 Nợ còn lại và owner

- Asset-map: đã đóng ở `a2e61465`. Nguyên nhân: draft của ô lọc sitemap đồng bộ từ filter trong passive effect, nên lần gõ đầu tiên có thể bị ghi đè. Sửa: đồng bộ khi render. Bằng chứng: bản probe chạy song song 8 lần có 1 lần fail đúng assertion, log có stack cho thấy filter rỗng được gửi từ `onSubmit`; một lần chạy đầy đủ trước đó cũng fail đúng assertion; sau sửa, file gốc chạy song song 8 lần đều pass; trước sửa, 5 lần chạy riêng đều pass. Owner: Asset Map.
- Contrast dark mode: 7 của 8 màn chưa đạt 4.5. Số đo thấp nhất: Emergency Stop 2.77 (chữ trắng trên nền đỏ sáng), Open Live Workspace 3.91, Request assignment 3.91, Approve 3.91, All 2 3.96; các ID liên kết (OP-014, OP-013, SS-041, RT-2026-014, win-dc-01, EV-014-02) đo 4.45, sát ngưỡng. Token màu dark theme chưa đổi trong đợt này vì là quyết định thiết kế; `integration-path-click` không hạ ngưỡng để pass. Owner: quyết định token màu của thiết kế, cần người dùng quyết định.
- Route gate real và flow real: cần stack có API và Neo4j. Owner: người vận hành stack, cần gán.
- Click-through complete, phân công, thay agent và C2: owner Operations, Agents, C2.
- Cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` ở 11.3: owner Shell, Tasks.
- Đồng hồ và id còn lại ở 11.4: owner từng feature.

### 11.8 Commit của đợt (từ `86beff9f`, theo nhóm việc)

- Cây real đóng, composition, shell và router: `28804b13`, `85472b9e`, `0e0207fa`, `39edd864`, `e271b7cf`, `8b3684f0`, `54e70209`, `08d0c9b9`, `f851027d`, `76882af0`, `93edef1d`, `ff8bedef`, `a3b39355`, `888f8a80`.
- Adapter real chuyển vào feature, wire trước và adapter sau: closure `baa90cab`; audit `3043153e`; notices `e2d5007f`; scope `9588f0f7`; vault `9dcaa7da`; team `fa446d10`, `f23b2ecf`; governance `6d53c62b`, `6e520e90`; analysis `4968bb5e`, `da8343d5`; C2 `08ebc9f4`, `64eec451`; planning `618f8a3a`, `5dcedc63`; findings `bfbe698f`, `63e846f2`; settings `3b59cdad`, `58eef039`; operations runtime `778fb495`, `b56abcc2`.
- Guard sở hữu response, asset map và test: `242ddc04`, `b91e64ac`, `8f2c9790`, `13da7dc6`, `b155c3ee`.
- Operations mock: `d31282fb`, `93348714`, `7e385266`, `85b5ca4a`, `788f5d60`, `dc1b0cab`, `a06584d6`.
- Plans bridge: `c642ce2c`, `8d4ca48e`, `1b0c9dc2`, `88f6065c`.
- Persona và đồng hồ demo: `d703782a`, `c0b3fd0b`.
- Kiểm chứng: `2342d096` (flow operations và agents), `daad6e73` (flow tích hợp, responsive và dark).
- Asset map: `a2e61465` (draft bộ lọc đồng bộ khi render).
- Khóa baseline và công cụ boundary: `aca0ae76`, `de5766d4`, `7504cbdf`.
- Tài liệu: `03a300ed` (AGENTS.md), `20dad9fd` (mục 10 của đợt trước), và commit đính chính mục 10 và 11 (commit này).
