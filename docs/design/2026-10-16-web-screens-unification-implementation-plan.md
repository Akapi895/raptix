# Implementation plan: mock screens trở thành UI vận hành duy nhất

- **Ngày:** 2026-10-16.
- **Baseline source:** branch `web-improve-refactor`, sau commit tách
  `route-table.ts` (xem `src/router/route-table.ts`).
- **Trạng thái:** đề xuất triển khai. PR-0a (tách `useSession`, mục 1 dưới đây)
  đã thực hiện trong phiên lập plan này; phần còn lại chưa code.
- **Quan hệ với plan khác:** thay thế phần **kiến trúc UI** của
  `docs/design/2026-10-16-web-mock-to-operational-system-implementation-plan.md`
  (vốn giả định giữ song song `src/screens/*` và `src/real/screens/*` với adapter
  mỏng nối hai bên). Phần backend/contract/governance của plan đó (O06/O07/O10-O14)
  không bị ảnh hưởng và vẫn là nguồn tham khảo đúng.

## 1. Context

`apps/web` hiện có hai cây UI độc lập cho cùng một bộ màn hình: `src/screens/*.tsx`
(mock, 52 file — UX mà team coi là chuẩn/đích) và `src/real/screens/*.tsx` (real,
37 file, 8.370 dòng — viết lại từ đầu, nối thẳng vào `real/api.ts` qua react-query).
Khảo sát trực tiếp codebase (3 Explore agent + đọc `domain/service.ts`,
`service-factory.ts`, `state/services.tsx`, `state/console.ts`) xác nhận:

- Hai cây **không chia sẻ một component màn hình nào** — chỉ dùng chung `src/ui/*`
  primitives, shell chrome, router, store.
- `domain/service.ts` (ADR-0067) đã định nghĩa contract **async, không phụ thuộc
  backend** (`ServiceResult<T>`, `EntityReader.get/list` trả `Promise`) — nhưng
  `service-factory.ts` chỉ có một implementation duy nhất, luôn dựng mock store
  đồng bộ. `useServices()` **chủ động throw** ở real mode (quyết định có chủ đích,
  không phải bug, đúng tinh thần ADR-0068 D4).
- `state/console.ts` đã là một seam chạy được ở cả hai mode cho identity/project/
  permission (50 file import, `usePolicyProjects` tự branch theo `DATA_MODE`) —
  đúng mẫu hình cần nhân rộng, nhưng chưa từng áp dụng cho dữ liệu nghiệp vụ
  (findings, operations, C2...), và `real/screens/*` không dùng seam này.
- Domain model giữa hai cây đã **lệch nhau**, không chỉ lệch nguồn data:
  - *Operations*: real là threads/runs read-only (không có pause/resume/stop/
    complete); mock là steps/plan/KPI có điều khiển đầy đủ.
  - *Findings*: real tách thành 2 resource riêng (findings đọc + curated-findings
    ghi, có `expectedVersion`); mock là một lifecycle thống nhất có tab AI
    Suggestions + workflow stepper.
  - *C2*: real là dispatch/reconcile + campaigns; mock là console/transcript một
    phiên, không có khái niệm campaigns.
- Write trong mock screens đi qua service facade sạch (`useFindingWrites()`
  không chạm `services.authority` trực tiếp) đối với **Findings**, nhưng
  Operations/C2 gọi `services.authority`/`services.clock` trực tiếp ngay trong
  màn hình (`c-console.tsx`, `h-session.tsx`) — hai domain này cần refactor
  mock-side trước khi cắm được adapter thật.

**Quyết định đã chốt**: (1) giữ nguyên presentation của mock screens, build
real-service-adapter nối vào seam `domain/service.ts` đã có, xoá
`real/screens/*` dần theo từng domain khi đạt parity — không viết lại real UI
thành cây component riêng; (2) phạm vi kế hoạch này **chỉ frontend** — domain nào
backend chưa có khái niệm tương ứng (Operations lifecycle control, C2 transcript)
thì gate vĩnh viễn "chưa khả dụng", không mở ticket backend trong plan này; (3)
tài liệu này thay thế phần kiến trúc UI của plan 2026-10-16 cũ như ghi ở trên.

Mục tiêu cuối: một cây màn hình (`src/screens/*`), chạy được ở cả mock và real
mode qua cùng một service contract, với từng phần UI chưa có hậu thuẫn backend
hiển thị trung thực là "chưa khả dụng" thay vì giả data hoặc ẩn đi.

## 2. Kiến trúc đích

**Không sửa `useServices()`/`useDb()`** — giữ nguyên throw ở real mode (mock-only
plumbing như `authority`, `clock`, `schedule`, `dispose` không có nghĩa ở real
mode).

Thêm một seam hẹp hơn, chỉ cho dữ liệu nghiệp vụ (`FeatureServices`, subset của
`ConsoleServices` — các feature service như `findings`, `operations`, `c2`...):

- `src/domain/service-factory.ts`: export thêm type `FeatureServices` (Pick của
  `ConsoleServices`), không đổi `createConsoleServices()`.
- `src/state/feature-services.ts` (mới): `useFeatureServices()` — trả
  `useServices()` ở mock mode (không đổi hành vi), trả context từ
  `RealFeatureServicesProvider` ở real mode.
- `src/real/service-adapter/` (mới, subsystem boundary mới → cần ADR):
  - `stub.ts`: `notIntegratedService<S>(kind)` — Proxy trả
    `{ok:false, failure:{kind:'unavailable', message}}` cho mọi method, tái dùng
    idiom `lazyService` đã có trong `service-factory.ts`.
  - `<domain>.ts` (một file/domain, ví dụ `findings.ts`): implement feature
    service đó bằng cách map `real/api.ts` → shape của `domain/service.ts`,
    dịch `expectedVersion` (pattern lặp lại khắp `real/api.ts`) thành
    `ServiceFailure{kind:'conflict'}` khi ghi bị stale.
  - `control-gaps.ts`: bảng tĩnh `REAL_CONTROL_GAPS: Record<string,string>` cho
    control/section không có khái niệm tương ứng ở backend (khác "chưa tích
    hợp" — đây là "không tồn tại"), ví dụ `operation.pause`,
    `finding.aiSuggestion`, `c2.transcript`.
  - `index.ts`: `createRealFeatureServices(capabilities)` — compose theo
    `capabilityState(doc, name)?.supported`, domain chưa có adapter → stub.
  - `provider.tsx`: `RealFeatureServicesCtx`/`RealFeatureServicesProvider`,
    mount trong `src/real/bootstrap.tsx`'s `RealBoot` (đã có `CapabilitiesDocument`
    tại đúng điểm này qua `useCapabilityReady`/`fetchCapabilities()`).
- Gap control-level dùng lại nguyên `Gated`/`Locked` đã có ở `src/ui/guard.tsx`
  qua một hook nhỏ thêm vào `state/console.ts`: `useRealControlGap(id)` — trả
  `null` ở mock mode, trả message từ `REAL_CONTROL_GAPS` ở real mode. Gap
  domain-level (chưa có adapter) không cần code mới — lỗi `unavailable` đã chảy
  qua đúng đường lỗi query hiện có (`FindingReadError` style) mà mock screens đã
  render sẵn.
- Router: thêm `MIGRATED_ROUTES: ReadonlySet<string>` (sibling của
  `route-table.ts`) — route key nào đã migrate thì cả hai mode render cùng
  `routeComponent(route.page)` (mock component). `router/host.tsx`'s
  `ResolvedRoute` check set này **trước** khi tra `REAL_PAGES`.

## 3. Trình tự PR

Mỗi PR ≤400 dòng runtime / ≤10 file / một concern, theo quality bar của repo.

### Prerequisite (chặn mọi phần sau)

1. **[Đã làm trong phiên này]** Tách `useSession`/`SESSION_KEY`/`SessionState`/
   `SessionContext` ra khỏi `src/real/screens/login.tsx` → `src/real/session.ts`.
   Cập nhật import ở `state/console.ts`, `real/screens/workspace.tsx`,
   `real/shell-parts.tsx`, `real/screens/login.test.tsx`. `login.tsx` giờ chỉ còn
   JSX (sign-in form, `RealLoginGate`, `RealLogin`), import `useSession` như mọi
   consumer khác. Đã verify: `npm run typecheck --workspace=@raptix/web-raptix`
   sạch; `login.test.tsx` + `bootstrap.test.tsx` + `routes.test.tsx` (19 test)
   pass.
2. Tách `RealCopilotDrawer` ra khỏi `src/real/screens/copilot.tsx` →
   `src/real/shell-parts.tsx` (đã có `RealContextRibbon`/`RealTopbar`); cập nhật
   import trong `shell/shell.tsx`. Cơ học, không đổi hành vi.
3. Viết ADR-0084 (tiếp theo `docs/adr/0083-plan-document-drafts.md`) mô tả
   boundary `FeatureServices`/`service-adapter` và cơ chế gap hai tầng ở §2 —
   **cần duyệt trước khi viết code adapter**, theo rule "subsystem boundary mới
   cần ADR" ở root CLAUDE.md.
4. Scaffolding rỗng: `FeatureServices` type, `useFeatureServices()`,
   `notIntegratedService`, `createRealFeatureServices()` trả toàn stub,
   `RealFeatureServicesProvider` mount trong `bootstrap.tsx`. Không đổi
   `query.ts` nào — PR này trơ, không ai tiêu thụ còn. Test: `useFeatureServices()`
   resolve ra stub ở real mode, không throw.

### Pilot — Findings

Chọn vì write-path đã sạch qua `useFindingWrites()`, model real đã có resource
tương đương `curated-findings` + `expectedVersion`, không cần refactor mock-side
trước (khác Operations/C2, xem §4).

5. `real/service-adapter/findings.ts` — đọc (`get`/`list`) map `fetchFindings`/
   artifact endpoints trong `real/api.ts`. Chưa đụng screen.
6. Đổi `useFindingList`/`useFindingDetail`/evidence hooks trong
   `src/features/findings/query.ts` sang `useFeatureServices()` — 1 dòng mỗi hook.
7. Thêm write (`save`/`transition`/`importSuggestion`/`attachEvidence`/
   `uploadEvidence`/`recordRetest`) vào adapter, map `createCuratedFinding`/
   `updateCuratedFinding`/`transitionCuratedFinding`/... + dịch `expectedVersion`
   → `conflict`. Đổi `useFindingWrites()` sang `useFeatureServices()`.
8. Thêm `REAL_CONTROL_GAPS` cho `finding.aiSuggestion`/`finding.stepper`; gate
   tab AI Suggestions + các transition không có trong `curated-findings` bằng
   `Gated`/`Locked` trong `screens/e-findings.tsx`. Xử lý 4 chỗ gọi
   `services.authority` trực tiếp còn sót (comment, add-to-report, audit —
   đã tự đánh dấu `corr:'legacy'` trong code mock).
9. Router: xoá `findings`/`finding`/`finding-new`/`evidence`/`evidence-inspector`
   khỏi `FEATURE_ROUTE_SURFACES`, thêm vào `MIGRATED_ROUTES`. PR duy nhất sửa
   nhánh mode trong `host.tsx` — review kỹ, không regress 29 route còn lại.
10. Xoá `real/screens/findings-panel.tsx` + `curation-panel.tsx` +
    `findings-panel.test.tsx`. Viết lại phần tương ứng của
    `precommit-regressions.test.tsx` để mount `screens/e-findings.tsx` (qua
    `?dataMode=real`) thay cho `RealFindingsPanel`, giữ nguyên assertion
    transport-level (replay dedup, foreign-scope rejection, reconciliation).

### Sau pilot

Lặp lại hình PR 5-10 theo thứ tự tăng dần độ phức tạp (đã khảo sát): Reports →
Assets/Library → C2 → Operations. C2 và Operations cần một PR tiền đề riêng
(refactor `h-session.tsx`/`c-console.tsx` để thread write qua service facade
thay vì gọi `services.authority` trực tiếp) **trước** PR tương đương PR-5 của
domain đó.

## 4. File không đổi/không xoá

`real/api.ts`, `real/queries.ts`, `real/identity.ts`, `real/mode.ts`,
`real/stream.ts`, `real/transport.ts`, `real/bootstrap.tsx`,
`real/workspace-session.ts`, `real/request-ledger.ts` — nền transport/data đã
đúng, adapter mới xây trên đó, không viết lại.

`screens/a11y-audit.test.tsx`, `dark-theme-audit.test.tsx`,
`responsive-audit.test.tsx` — chỉ test mock mode, không bị ảnh hưởng suốt quá
trình.

## 5. Việc cần làm ngoài PR code

- Cập nhật `docs/design/2026-10-16-web-mock-to-operational-system-implementation-plan.md`:
  ghi chú ở đầu file rằng phần kiến trúc UI (giữ 2 cây, O04/O08/O09 real-screen
  adapter) bị thay thế bởi plan này; giữ nguyên phần backend/governance/O06/O07/
  O10-O14. (Chưa làm trong phiên này — cần một PR riêng.)
- Operations/C2: control không có backend tương đương (pause/resume/stop,
  transcript) gate vĩnh viễn qua `REAL_CONTROL_GAPS`, không mở ticket backend
  trong phạm vi plan này — ghi rõ trong ADR-0084 đây là quyết định có chủ đích,
  không phải nợ kỹ thuật tạm thời.

## 6. Open decisions (cần chốt trước khi code domain tương ứng)

1. Findings PR-4 scope: comment-posting/AI-suggestion-dismissal/"add finding to
   report" ship trong pilot (cần mở rộng `FindingService`/`ReportService`) hay
   gate real-mode-unavailable, deferred?
2. Findings transition coverage: `curated-findings` resource thật có phủ hết
   `ai_suggested/draft/review/confirmed/returned/remediation/retest/resolved`
   không, hay thiếu trạng thái AI-suggestion?
3. C2 transcript vs dispatch/reconcile: tạm thời (đóng được khi backend thêm
   transcript) hay là model thật vĩnh viễn (cần redesign UX phần đó của
   `h-session.tsx`)?
4. Campaigns: thêm vào mock UI (section mới) hay bỏ hẳn khỏi UI vận hành?
5. Operations detail shape: mở rộng `OperationDetailRead` cho phần data có thể
   thiếu, hay gate cả drawer steps/plan/agent tới khi có backend?

## 7. Verification

- Mỗi PR: `npm run typecheck --workspace=@raptix/web-raptix`,
  `npm run lint --workspace=@raptix/web-raptix`, test có mục tiêu theo domain
  đang sửa (không chạy full suite).
- PR scaffolding (4): test mới xác nhận `useFeatureServices()` không throw ở
  real mode và trả đúng stub shape.
- PR 5-7 (adapter + query swap): unit test cho adapter (map DTO → ServiceResult
  đúng, dịch `expectedVersion` → `conflict` đúng); test hiện có của feature
  findings chạy lại không đổi ở mock mode.
- PR 8 (gating): test mới cho `useRealControlGap`; review bằng tay
  `screens/e-findings.tsx` ở `?dataMode=real` xem tab AI Suggestions/stepper
  hiện đúng "chưa khả dụng".
- PR 9 (router): chạy lại `src/router/route-table.test.ts` +
  `src/router/routes.test.tsx` + `src/real/app-routing.real.test.tsx` — không
  regress route còn chưa migrate.
- PR 10 (decommission): `precommit-regressions.test.tsx` sau rewrite phải pass
  với cùng invariant transport-level cũ, mount qua mock screen thay vì real
  panel.
- Sau pilot (PR 1-10): chạy thủ công toàn bộ luồng Findings ở `?dataMode=real`
  trên deployment thật để xác nhận parity trước khi áp dụng khung này cho domain
  tiếp theo.

## 8. Trạng thái thực hiện (cập nhật 2026-10-16)

- **Xong:** PR 1 (tách `useSession`), PR 2 (tách `RealCopilotDrawer`), PR 4 (scaffolding `FeatureServices`/provider/`REAL_CONTROL_GAPS`), PR 5 (adapter Findings đọc), PR 7 (adapter Findings ghi, dịch `expectedVersion` → `conflict`, ghi theo phiên bản đã đọc), PR 8 (gating real: comment, report link, retest, evidence, trường chưa lưu được, tab AI), PR 9 (route `findings`/`finding`/`finding-new` qua `MIGRATED_ROUTES`, render mock screen ở cả hai mode). Quyền real lấy theo membership thay vì `viewer` cố định.
- **Chưa xong:** PR 10 (xoá `findings-panel`/`curation-panel`): hai panel này vẫn được route `evidence`/`evidence-inspector` dùng, và `precommit-regressions.test.tsx` còn import `RealFindingsPanel`. Route evidence chưa migrate. Reports, Assets, C2, Operations chưa bắt đầu. ADR-0084 vẫn Proposed.
- **Kiểm chứng đã làm (trên stack thật `:3001`, multi-user, dev server tạm):** đăng nhập; danh sách Findings và trạng thái rỗng; tab AI và KPI ẩn kèm lý do; form tạo có trường bị disable; tạo finding, lưu nháp, gửi review (server ghi `review`, phiên bản 2); form sửa cũ bị từ chối khi người khác đã ghi (`409`, thông báo hiện, vẫn ở form); chi tiết khoá comment và Add to Report với lý do đăng ký. Không có lỗi console trang.
- **Hạn chế kiểm chứng:** dev server dùng config tạm ngoài repo (không có plugin React Refresh do lỗi transform của môi trường; không có Tailwind nên giao diện không có CSS). Test mock `features/findings` có 3 lỗi có sẵn, và một số audit a11y/responsive/tasks ở mock fail do phụ thuộc thời gian; các lỗi này chưa được xác minh trên HEAD sạch.
