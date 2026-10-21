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
| 3 | Đang làm, chưa slice nào hoàn tất | ce789b22 (S-J: screens/demo → demo/) | Chặn ở route smoke real mode: cần RAPTIX_VERIFY_USER/PASSWORD và API nối DB raptix-verify-pg4 (cổng 55444). Mock 55/55 sau mỗi bước. Các slice S-A … S-I còn lại |
| 4 | Chưa bắt đầu | — | |

## 9. Baseline ghi nhận ở phase 0 (HEAD fb71c24c)

- **Route smoke** (`npm run verify:routes`): mock 55/55 không lỗi. Real 53/55. Hai route lỗi là `asset-new` và `asset-scope`: màn hình gọi `useServices()` nên ném "Mock console services are unavailable in real mode". Đây là gap có sẵn, xử lý trong slice S-B.
- **check:boundaries**: 808 vi phạm. `production-imports-demo` 245; `deep-feature-import` 266; `presentation-mock-plumbing` 135; `presentation-imports-real` 102; `real-imports-features` 57; `features-import-screens` 3.
- **Route gate** (`.scratch/web-improve-refactor/route-manifest-check.mjs`): EQUAL sau khi sửa cách resolve import (router/*.ts) và loại khóa có cờ `asset-map` khỏi inventory 55 khóa.
- **Typecheck** 0 lỗi. **Lint** 5 lỗi có sẵn ở `src/screens/f.tsx`. **Test** 161 file, 1.473 test đều pass (91 giây).
- Ghi chú môi trường: container PostgreSQL riêng `raptix-verify-pg4` (cổng 55444) giữ lại cho các mốc sau; API và Vite đã dừng theo PID đã xác minh.
