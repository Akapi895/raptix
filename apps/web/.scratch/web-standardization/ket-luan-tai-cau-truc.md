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

## 10. Trạng thái hiện hành (đợt operations, agents và analysis, 2026-10-22)

Đợt này đóng ba nhóm legacy theo thứ tự: Operations mock, Agents và Infrastructure, Analysis mock. Trạng thái dưới đây đo trên cây hiện tại, không lấy từ các mục cũ ở trên.

Commit của đợt, theo thứ tự:
- Operations: `3fe69c3d` (console, kết quả và helper vào `features/operations/views`), `3f83d777` (trang operation), `3e9299b1` (display clock, demo runtime và hook console), `26998e85` (console đi qua hook), `98591b98` (route qua `features/operations/routes.ts`), `188d4188` (flow operations).
- Agents và Infrastructure: `ac72a9d5` (agents vào `features/agents/views`), `ef5e1ce7` (ghi và demo qua `useAgentsMockConsole`), `dcb13e15` (flow agents), `fe879f1e` (infrastructure vào `features/agents/views`, C2 đi qua slot), `839f1aa2` (flow agents kiểm tab infrastructure).
- Analysis: `969e3c8c` (analysis vào `features/analysis/views`, nội dung khuyến nghị vào `recommendations.ts`).
- Gate và checkpoint: `60424045` (gate chạy hai flow mới), `66ba44aa` (khóa baseline), `9b689dc0` (flow dùng id của mock seed), `41e577eb` (sửa hai comment, không đổi mã).

File legacy đã xóa trong đợt: `screens/c.tsx`, `screens/c-console.tsx`, `screens/c-results.tsx`, `screens/c-common.tsx`, `screens/d-agents.tsx`, `screens/e-analysis.tsx`. Mỗi file đã chuyển vào owning feature bằng lệnh move, và các caller đã đổi sang đường mới.

### 10.1 Bảng trạng thái

Cách đọc: "Đóng" = đã chuyển và có bằng chứng; "Đóng một phần" = phần chính đã chuyển, phần còn lại có owner và lý do; "Mở" = chưa làm.

| Mục | Trạng thái | Bằng chứng | Ghi chú |
| --- | --- | --- | --- |
| Operations: authority, clock và demo runtime về feature | Đóng (cấu trúc) | `3e9299b1`, `26998e85`; `useOperationMockConsole` | Đọc và ghi mock đi qua hook của feature. `service.ts` là implementation mock của port, được nạp lazy từ `demo/services.ts` |
| Operations: `screens/c*.tsx` vào `features/operations/views` | Đóng | `3fe69c3d`, `3f83d777`; file cũ đã xóa | Bốn file, không đổi hành vi |
| Operations: route qua feature | Đóng | `98591b98`; registry slice `c` trỏ `features/operations/routes.ts` | |
| Operations: presentation không gọi `useServices`, `.authority` hay demo | Đóng | Grep bốn file view: chỉ còn lời gọi `mock.*` | |
| Operations: đổi `service.ts` thành `mock.ts` theo ADR-0096 | Mở | — | Khoảng 40 file import `service.ts`, vượt giới hạn 10 file mỗi commit. Cần chuyển từng đợt |
| Operations: dấu giờ host trong xác nhận Results (signoff) | Mở | `operation-results.tsx` | Dùng giờ máy, không dùng đồng hồ dataset. Đổi sang đồng hồ dataset là đổi chuỗi hiển thị, nên để đợt riêng |
| Agents: mock vào `features/agents/views/agents-page.tsx`, xóa `d-agents.tsx` | Đóng | `ac72a9d5` | Giữ nhãn: agent là executor trên host, không phải AI specialist |
| Agents: ghi, đồng hồ, demo runtime và audit qua `useAgentsMockConsole` | Đóng | `ef5e1ce7` | Duyệt phân công, thay agent trong operation, đổi trạng thái và audit giữ nguyên context `legacy` |
| Infrastructure: trang vào `features/agents/views/infrastructure-page.tsx` | Đóng một phần | `fe879f1e` | `screens/infrastructure.tsx` còn lại làm composition, nối C2 vào slot |
| Infrastructure: C2 tab, sessions và access (`C2InfraContent`, `Sessions`, `AccessChip`, `RequestAccessDrawer`) | Mở | Còn trong `screens/h.tsx` và `screens/h-session.tsx` | Phụ thuộc chung với trang C2 project. Giữ khả năng hiện có, không mở rộng session console hay PTY |
| Agents: `USERS` từ `domain/catalog` cho lựa chọn manager và reviewer | Mở | `agents-page.tsx` | Danh sách persona seed trong presentation. Cần port đọc user thật trước khi bỏ |
| Analysis: `e-analysis.tsx` vào `features/analysis/views`, xóa file cũ | Đóng | `969e3c8c` | |
| Analysis: nội dung khuyến nghị vào `features/analysis/recommendations.ts` | Đóng | `969e3c8c` | Hai khuyến nghị seed và câu dự phòng chuyển sang module thuần |
| Analysis: coverage, attack path, MITRE, detection và trạng thái dữ liệu thiếu | Đóng (giữ nguyên) | Analysis 1/1 mock, 2/2 real; test `features/analysis` | Thiếu dữ liệu vẫn hiển thị là thiếu, không đổi thành 0. Mock coverage không được coi là bằng chứng execution |
| `screens/e.tsx` còn làm composition (analysis và findings) | Đóng một phần | `screens/e.tsx` | Composition ở `screens/`, phụ thuộc `router/findings` |
| Flow mock cho operations và agents trong gate | Đóng | `188d4188`, `dcb13e15`, `60424045`, `9b689dc0`; gate 119 PASS, 0 FAIL | Kiểm list, detail, từ chối khác project và tab. Không click các thao tác ghi (pause, duyệt, disable) |
| Entry của feature | Đóng một phần | 24/33 feature có `index.ts` (trước đợt: 22/33) | Chỉ thêm entry cho bề mặt đang có caller ngoài feature |

Tổng: 10 mục đóng hẳn, 3 đóng một phần, 4 mục mở (trên 17 dòng). Đây là số đếm, không phải phần trăm migration.

### 10.2 Đã kiểm chứng, config-gated, chưa kiểm chứng

Đã kiểm chứng trên stack thật (mock và real, có Neo4j), commit `9b689dc0`, exit 0:
- Route smoke: mock 55/55, 0 lỗi mới. Real 55 route, 0 lỗi mới, 13 lỗi đã khai báo trong `baseline.json`, 3 khai báo không xảy ra. Số này khớp đợt trước.
- Click-through mock: operations 3/3, agents 5/5 (gồm tab infrastructure), analysis 1/1, assets 5/5, reports 1/1, settings 2/2, projects 1/1.
- Click-through real: assets 5/5, reports 4/4, settings 5/5, projects 4/4, analysis 2/2; workspace 12/12; layout 11/11; runtime gate 5/5; checklist reports 27/27, assets và library 26/26.
- Tổng: 119 PASS, 0 FAIL.

Gate chạy lần đầu (trên `60424045`) exit 1 vì hai flow mới đọc fixture của real, thiếu id của mock. Hai flow đã sửa trong `9b689dc0`, đã kiểm lại riêng 3/3 và 5/5, rồi gate chạy lại exit 0. Các bước còn lại của lần chạy đầu đều pass.

Config-gated (stack không có runtime, C2 server hay LangGraph) — chỉ có trạng thái gate, không tính là đã chạy:
- Execute, submit, pause, resume, cancel của operation.
- Gửi và stream hội thoại AI.
- Điều phối lệnh C2 và console phiên.
- Chi tiết agent và branch có runtime thật.

Chưa kiểm chứng trong đợt này:
- Các thao tác ghi ở mock qua hook mới (pause, resume, stop, complete, duyệt phân công, thay agent, disable, enable): không có click-through. Chỉ có test đơn vị hiện có của feature operations và agents, không bao phủ trực tiếp lớp presentation mới.
- Dark mode, mobile và project identity từng tab sau khi chuyển.

### 10.3 Hoãn (follow-up có owner)

- **C2 (owner: C2):** `screens/h.tsx` và `screens/h-session.tsx`, gồm C2 infrastructure, sessions và session access dùng chung. Chuyển sau khi bỏ slot trong `screens/infrastructure.tsx`. ADR-0095 chỉ chặn phần PTY/console tương tác.
- **Operations (owner: Operations):** đổi tên `service.ts` thành `mock.ts`; dấu giờ host trong Results signoff; các tab mock chưa có nghiệp vụ real (Objectives, Activity thuộc Projects).
- **Agents (owner: Agents):** `USERS` làm nguồn lựa chọn; `screens/d.tsx` là composition của ba nhóm route (agents, assets, library).
- **Analysis (owner: Analysis):** `screens/e.tsx` là composition của analysis và findings.
- **Infrastructure (owner: Agents):** `screens/infrastructure.tsx` là composition nối C2 slot; xóa khi C2 không còn ở `screens/`.
- **AI mock (owner: AI Workspace):** `screens/g*.tsx`; `features/execution/workspace.tsx` chỉ dùng cho demo.
- **Tasks, login, wizard, system (owner: System và Projects):** `screens/a*.tsx`, `screens/b-wizard.tsx`, `screens/tasks`, `screens/system`, `screens/dashboard`.
- **Route slices:** registry vẫn mount từ `screens/` cho `b`, `d`, `e`, `g`, `h`, `i`, `s`.

### 10.4 Số liệu đo

Ratchet `check:boundaries --strict`: exit 0, khóa tại `66ba44aa`. Số giảm đều đã xem lại; không rule nào được nới.

| Rule | Khóa trước đợt | Sau đợt |
| --- | --- | --- |
| production-imports-demo | 47 | 42 |
| production-type-imports-demo | 71 | 69 |
| production-imports-composition | 39 | 35 |
| presentation-imports-real | 13 | 13 |
| presentation-imports-adapter | 14 | 14 |
| presentation-mock-plumbing | 100 | 80 |
| real-imports-features | 68 | 68 |
| deep-feature-import | 288 | 263 |

Quy mô (đo bằng `find`, `*.ts` và `*.tsx`, không tính test):

| Chỉ số | Trước đợt | Sau đợt |
| --- | --- | --- |
| `screens/` | 30 | 24 |
| `real/` (tất cả) | 33 | 33 |
| `real/screens/` | 8 | 8 |
| Feature có `index.ts` | 22/33 | 24/33 |

### 10.5 Gate của checkpoint

- Full suite web: 165 file, 1477 test, pass, 0 fail (trên mã của `60424045`; các commit sau chỉ đổi baseline, flow và comment).
- `npm run build` (gồm `typecheck` rồi `vite build`): exit 0. Cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` cho `real/screens/login.tsx` vẫn còn, đã ghi ở đợt trước.
- `npm run lint` (toàn bộ web): exit 0.
- `check:boundaries --strict`: exit 0.
- Stack thật, mock và real, có Neo4j: exit 0 trên `9b689dc0`, chi tiết ở 10.2.

### 10.6 Tiến độ và ba nghĩa khác nhau

Đo theo mục đã đóng ở 10.1, không theo số test. Đợt này: 10 mục đóng hẳn, 3 đóng một phần, 4 mục mở.

- **UX MVP đạt:** chưa tuyên bố. Route và click-through trên mock và real đều pass, nhưng các thao tác ghi ở mock chưa có click-through, và dark mode, mobile cùng project identity chưa kiểm lại.
- **Migration cấu trúc hoàn tất:** không. Còn 24 file trong `screens/` (C2, AI, tasks, system, wizard, login và composition), 33 file trong `real/`, và route slice vẫn mount từ `screens/`.
- **Runtime execution đã kiểm chứng:** không. Execute, submit, stream AI và điều phối C2 chỉ có trạng thái gate (10.2).

### 10.7 Thứ tự đề xuất cho đợt tiếp

1. C2: chuyển `screens/h.tsx` và `screens/h-session.tsx` vào `features/c2/views` theo từng nhóm nhỏ (infrastructure tabs trước, rồi session access, rồi trang project), bỏ slot khi xong. Kiểm bằng flow C2 mock và real.
2. Operations: đổi `service.ts` thành `mock.ts` trong nhiều commit, mỗi commit không vượt 10 file. Thêm flow ghi ở mock (pause/resume và duyệt phân công).
3. Agents: thay `USERS` bằng port đọc người dùng; bỏ `screens/d.tsx` khi các route group có entry riêng.
4. AI mock (`screens/g*.tsx`), sau đó tasks, system, wizard và login.
5. Xóa route slice khi `screens/` không còn module mock nào được mount.
6. Kiểm lại dark mode, mobile và project identity cho operations, agents và analysis.
