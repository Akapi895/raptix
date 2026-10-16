# Implementation plan: hoàn thiện và nghiệm thu Web frontend/backend

Ngày rà soát: **2026-10-15**. Baseline source: **`2c3f649`**, branch `web-improve-refactor`.
Trạng thái: **kế hoạch, chưa triển khai các sửa đổi trong tài liệu này**.
Đường dẫn bắt đầu `apps/`, `packages/`, `infra/`, `tests/`, `.github/` tính từ repo root.
Để tránh lặp, `src/real/...`/`src/router/...` là bên trong `apps/web/`,
`server/...` là bên trong `apps/web/`; tên service đứng riêng là dưới
`apps/web/server/src/services/`, tên test đứng riêng được tìm trong owning test directory.
Tên hàm là anchor khi số dòng thay đổi.

## 1. Kết luận, phạm vi và cách đọc

Web đã có các luồng thật, nhưng **chưa đủ điều kiện tuyên bố full integration**.
Vẫn còn cả lỗi implementation, chức năng thiếu, quyết định sản phẩm chưa khép lại và
các luồng chưa nghiệm thu trên browser/DB/runtime/provider thật. Route đã mount,
container healthy hoặc unit test xanh không thay thế được bằng chứng đó.

Tài liệu này tổng hợp phạm vi 18 ticket, 53 route và các thao tác không có route riêng.
Đây là kết quả rà soát source và bằng chứng hiện có, không phải cam kết đã phát hiện
mọi lỗi tiềm ẩn. Những nghi vấn concurrency/deployment phải được tái hiện trước khi fix.
Trong lượt lập kế hoạch này chỉ đọc source/evidence và kiểm tra Docker; **không chạy lại
application tests, không thay runtime code, không migrate DB, không commit/push**.

### 1.1 Nguồn chuẩn

- [Spec R01–R12, D1–D6](../../apps/web/.scratch/frontend-backend-integration/spec.md).
- [Execution contract](../../apps/web/.scratch/frontend-backend-integration/execution.md).
- [Coverage và 18 ticket](../../apps/web/.scratch/frontend-backend-integration/coverage.md).
- [Báo cáo regression và real runtime flow](../../apps/web/.scratch/frontend-backend-integration/regression-fixes-and-live-flow.md).
- [ADR-0069: lifecycle storage](../adr/0069-web-workflow-lifecycle-storage.md).
- [ADR-0070: library proposals](../adr/0070-web-library-review-proposals.md).
- [Quality bar](../QUALITY_BAR.md), [Web agent rules](../../apps/web/AGENTS.md),
  [runtime boundaries](../architecture/runtime-boundaries.md), [dependency rules](../architecture/dependency-rules.md).

Khi prose và code khác nhau, ghi sự khác biệt; không dùng checkbox `complete` để bỏ qua
acceptance còn thiếu. `coverage.md` đang có thông tin cũ, gồm “39 route chưa tích hợp”
và “LLM chỉ stub”; phải cập nhật theo evidence, không sao chép các kết luận đó.

### 1.2 Phân loại và ưu tiên

| Ký hiệu | Ý nghĩa | Cách đóng |
|---|---|---|
| **B** | Lỗi/mismatch thấy trực tiếp trong source | Regression fail trước, pass sau; DB/live test nếu vượt boundary |
| **M** | Chức năng/UX chưa làm đủ | Implement vertical slice và nghiệm thu hành vi |
| **V** | Có implementation nhưng chưa có đủ evidence | Chạy test thật, chỉ sửa khi có lỗi được tái hiện |
| **D** | Cần quyết định contract/phạm vi | Ghi quyết định; Proposed ADR trước public API/subsystem mới |

- **P0:** chặn nghiệm thu multi-user hoặc thao tác execution/governance liên quan.
- **P1:** chặn hoàn tất workflow người dùng hoặc deployment đáng tin cậy.
- **P2:** thiếu parity/UX/khả năng mở rộng; vẫn phải làm hoặc có exclusion được chấp thuận.
- `W01`–`W28` là **work item trong kế hoạch**, không tạo thêm tracker ticket ngoài 18 ticket.
  Một work item lớn phải tách nhiều patch cùng concern; mỗi PR ≤400 runtime lines / ≤10 files.

### 1.3 Bằng chứng đã có và giới hạn

| Evidence | Có thể kết luận | Không được suy rộng |
|---|---|---|
| Lần verification trước báo server 339 tests, Web 1.079 tests; typecheck/lint/build pass; Web full run ổn với `--maxWorkers=4` | Baseline có regression coverage; đây là kết quả lịch sử của phiên trước | Không phải test mới trong lượt viết plan; không chứng minh schema constraints/provider/browser full flow |
| `tests/local/artifacts/workflow-live/899a8655/state.json`, `passed: true`, 12 checks | HTTP multi-user, scope approval, plan binding, finding review, report conflict/export/manual receipt, C2 TTL policy, notices, closure và API restart đã chạy thật | Không kiểm tra browser login qua nginx, Library proposal lifecycle, C2 execute live hay campaign deploy |
| Báo cáo real flow `a0639bcf` | Đã ghi nhận browser → Soundwave/model/tools thật → documents → handoff → execution → artifact, refresh và SSE replay | Không bao phủ mọi route, multi-user hiện tại, tool HITL/cancel live hay các Python thay đổi song song |
| `.github/workflows/ci.yml`, job `web-raptix`, và `verify-docker-real-mode.mjs` | CI **được cấu hình** chạy degraded bootstrap smoke không DB/LLM | Chưa tra CI run nên không tuyên bố CI đã pass; smoke này không phải production E2E |

Ở thời điểm đọc lại filesystem, raw directory `integration-live/a0639bcf` và
`integration-live/242c631a` không còn; durable report còn, workflow state `899a8655` còn.
Ba acceptance containers, hai evidence volumes và image `20261014` đã được xóa theo
yêu cầu. Giữ lịch sử là **historical evidence**, tạo run mới để tái nghiệm thu.

Docker hiện có Postgres/Neo4j/LangGraph/LiteLLM/sandbox/Skillogy healthy. Không thấy
Web UI/API container trong `docker ps`; không suy ra từ đó rằng mọi Node process đều
đã dừng. Port 3000 đang do Juice Shop dùng. Các lỗi port 7475/2400 trước đây là lịch sử,
không được mặc định vẫn đang xảy ra.

## 2. Ma trận 18 ticket: đã có gì, còn thiếu gì

| Ticket | Phần đã có | Phần còn phải khép lại | Work item |
|---|---|---|---|
| 01 Decisions/contracts | D1–D6, ADR-0069/0070 | Đồng bộ schema/contract/evidence; xác nhận exclusion thực sự được chấp thuận | W01, W02, W26, W28; §6 |
| 02 Cutover/packaging | Canonical UI/server, npm workspace, Dockerfiles | Auth qua proxy, clean install/build/smoke, preserved-data cutover | W03, W27, W28 |
| 03 Bootstrap/projects | Real/mock, portfolio/create/detail | Workspace collision giữa owners, session identity, full wizard/edit settings chưa đủ | W01, W04, W21, W22 |
| 04 Planning/conversations | Soundwave, documents, handoff, copilot | Actor-scoped recovery, history/deep links, pin/search/context disposition | W04, W21, W22, E02 |
| 05 Execution/recovery | Stable run ledger, SSE, questions, cancel/HITL UI | Quyền cancel/member, tool HITL/cancel live, loss/reconnect multi-user | W02, W05, W10, W28, E02–E04 |
| 06 Observed outputs | Workspace findings/artifacts, assets/graph/timeline | Graph query/projection đúng, binary/masking/download disposition, member access | W02, W19, W24 |
| 07 Identity/team | Sessions, CSRF, role/membership | Proxy origin, quyền trên legacy services, session expiry/cache và role-aware UX | W02–W04, W25 |
| 08 Scope/assets/ROE | Revisions, inventory/import/classification | Removal/effective scope, stale approval, timezone, runtime scope mapping, concurrency | W07, W08, W21 |
| 09 Governed operations | Plan lifecycle/revise/compare/bind, project stop | Reject-plan bug, đủ preflight, stop resolution/scopes, schedule/start semantics | W05, W08–W11 |
| 10 Findings/evidence | Curation, transitions, upload/link/digest | Stale/self-review policy, verified producer reference, post-confirm edit, draft guards | W19, W21, W26 |
| 11 Reports | Editor, review, exact-body export, manual receipt | Revisions sau approval, references/templates disposition, atomic delivery, download race | W20, W21 |
| 12 C2/campaigns | Grants, sessions/commands, drafts/jobs panels | Scope/TTL, stable UI intent, provider spec + request/version, management UI, live provider | W12–W15 |
| 13 Fleet/fanout | Catalog/threads/checkpoint branches, run cancel | Detail theo ID, truthful status, branch controls/runtime contract decision, live read/cancel | W02, W10, W22, W24; §6 |
| 14 Library/analysis | Canonical detail, proposals API, observed analysis | Sai graph relation, proposal uniqueness/drift contract, diff/export UI, heatmap disposition | W16–W18, W24 |
| 15 Overview/tasks/notices | Tasks/search/notices và overview API | Sai status query, deep link tab, partial-source false empty, thiếu inbox kinds/invalidation | W23 |
| 16 Settings/audit/vault | Policy/retention config, audit, encrypted vault | TTL mismatch, actor/audit, scope-safe plaintext, permission semantics, missing settings UI | W14, W25, W27; §6 |
| 17 Closure | Checklist, independent close, HTTP mutation fence | Pending library review, fence races, stopped-resolution, service entrypoints, member/live sessions | W05, W06, W10 |
| 18 Final acceptance | Build/test history, HTTP workflow evidence, degraded CI smoke | Fresh browser/DB/provider acceptance, clean/upgrade migration, performance/UX và ledger đúng | W27, W28; §7–§9 |

## 3. Backlog sửa lỗi và bổ sung implementation

### W01 — Tách workspace/KG identity giữa các engagement khác owner

**P0 · B/D · ticket 01/03/07.** Source: `apps/web/server/prisma/schema.prisma`
(`Engagement @@unique([userId, name])`); `projects-service.ts:createProject`;
`graph-service.ts:engagementName`; `runtime/runtime-context.ts:resolve`.

**Hiện trạng:** DB cho hai owner cùng `name`, nhưng workspace và KG partition dùng
slug/name, không phải globally unique engagement identity. Hai record có thể trỏ
cùng thư mục/KG partition khi dùng chung workspace root. Đây là mismatch source;
chưa thực hiện thử nghiệm cross-owner trong lượt viết plan.

**Cách sửa:**
1. Tái hiện bằng hai tài khoản khác nhau, cùng slug, workspace test riêng; chỉ viết
   marker vô hại. Kiểm tra planning/artifacts/findings/graph của cả hai.
2. Freeze contract cho immutable, globally unique `workspaceSlug`/partition identity
   do server cấp. Giữ display name độc lập. Không dùng browser-supplied path.
3. Migration/backfill phải phát hiện collision, giữ nguyên workspace/thread cũ đã
   bind, không tự merge hoặc di chuyển dữ liệu khi chưa có mapping xác nhận.
4. Dùng cùng identity mapping ở projects, filesystem, runtime context hash, sandbox,
   graph, export/delete. Không chỉ thêm unique DB rồi bỏ qua dữ liệu đã va chạm.

**Test/đóng:** thêm regression vào `server/tests/projects.test.ts`,
`runtime-context.test.ts`, `graph-service.test.ts`, `findings-artifacts.test.ts`;
DB thật kiểm tra create đồng thời và upgrade dữ liệu cũ. Hai owner cùng display
name không đọc/ghi chung marker; existing bound thread vẫn truy cập đúng workspace.

### W02 — Hoàn thiện membership authorization trên toàn bộ services

**P0 · B/M/D · ticket 07 và consumers 04–17.** Source:
`runtime-ownership.ts:owned`, `c2-service.ts:authorize`, `graph-service.ts:engagementName`,
`approvals-service.ts`, `campaign-service.ts`, `vault-service.ts`, `timeline-service.ts`.

**Hiện trạng:** portfolio/workflow mới chấp nhận membership, nhiều legacy services
vẫn chỉ nhận `Engagement.userId`. Operator được cấp C2 grant vẫn có thể bị C2 trả
404 vì không phải owner. Runtime mutation có role gate ở `main.ts`, nhưng
`RunService.cancelRun` không gọi callback đó; khi mở rộng runtime reads cho member
phải bổ sung quyền cancel riêng, không vô tình cấp quyền mutate cho viewer.

**Cách sửa:**
1. Chốt bảng quyền từng action: owner/operator/reviewer/viewer, local/multi, open/closed.
   Quyền reveal vault, quản lý provider và deployment settings phải được nêu riêng.
2. Tách **actor hiện tại** và **owner của resource/ledger**. Kiểm tra membership trước
   khi resolve workspace/binding; giữ người thực sự dispatch trong audit.
3. Cập nhật từng service nhỏ; không truyền ownerId như một cách giả danh hoặc thay
   mọi filter `{id,userId}` thành `{id}`. Không đổi context hash của existing threads.
4. Thu hồi membership/đổi role phải có hiệu lực với request tiếp theo; quy định rõ
   cách đóng stream đang mở và recovery read sau revoke.

**Test/đóng:** `t07-auth-members.test.ts`, runtime/approvals/graph/C2/vault/campaign
suites liên quan; HTTP matrix 4 roles × allowed/denied/foreign ID. Hai browser
contexts chứng minh member đọc được phần được phép, không tự cấp quyền execute,
cancel, reveal, approve hoặc global setting; audit giữ actor thật.

### W03 — Sửa origin/Host qua Vite và nginx trước khi nghiệm thu login

**P0 · B/V · ticket 02/07/18.** Source: `apps/web/vite.config.ts` (`changeOrigin: true`),
`infra/containers/web-raptix-proxy.conf` (`Host $host`),
`server/src/auth/multi-user.ts:isSameOrigin`, `http/routes/auth.routes.ts`.

**Hiện trạng:** Vite có thể đổi Host sang API port trong khi Origin là UI port;
nginx `$host` bỏ port ngoài. Origin `127.0.0.1:<ui-port>` khi đó không khớp Host
backend. HTTP harness không gửi Origin nên không phát hiện đường browser này.

**Cách sửa:** tái hiện login/mutation qua cả hai proxy và ghi Host/Origin đã redacted;
preserve đúng authority gồm port bằng proxy config phù hợp. Nếu cần forwarded
scheme/host thì chỉ trust proxy đã cấu hình; so sánh origin đầy đủ theo contract,
không bỏ kiểm tra origin/CSRF, không chấp nhận mọi `X-Forwarded-*` từ client.

**Test/đóng:** `t07-auth-members.test.ts` + browser login/logout/save qua nginx port
không mặc định, dev Vite, HTTPS termination nếu được hỗ trợ. Same-origin thành công;
khác host/port/scheme, fake forwarded headers, missing CSRF bị từ chối. Secure cookie
đúng topology. Chạy lại degraded smoke để bảo đảm bootstrap không cần session.

### W04 — Session expiry, actor-scoped cache/recovery và capability refresh

**P0/P1 · B/M/V · ticket 03/04/07.** Source: `src/real/queries.ts`,
`workspace-session.ts`, `screens/login.tsx`, `transport.ts`, `bootstrap.tsx`;
`src/state/keys.ts:createConsoleQueryClient`.

**Hiện trạng:** keys project/recovery vẫn dùng `REAL_IDENTITY.id` cố định; nhiều
feature keys chỉ có engagement. Login/logout xóa query là bước bảo vệ đã có, nhưng
không thay thế actor-scoped identity và không xử lý đầy đủ cross-tab/expiry.
Transport không thông báo session gate khi API trả 401; Query client tắt refocus.
Capability document bootstrap cũng không tự re-probe định kỳ khi runtime trở lại.

**Cách sửa:**
1. Expose trusted session actor/deployment identity trước feature reads; local mode
   có identity riêng, không lấy persona. Keys/recovery gắn deployment + actor + engagement.
2. 401 làm session chuyển unauthenticated và dispose streams/queries. 403 là action
   denial, không logout hàng loạt. Không để stale in-flight response phục hồi cache cũ.
3. Đồng bộ logout/session change giữa tab bằng cơ chế có lifecycle rõ; không lưu
   password, CSRF, secret hoặc command body trong localStorage.
4. Retry/reconnect capabilities bằng cùng nguồn cache; runtime hồi phục không buộc
   user chuyển demo. Session route 404 chỉ được coi là local theo contract bootstrap.

**Test/đóng:** `session-api.test.ts`, `bootstrap.test.tsx`, `console-seam.real.test.tsx`,
`precommit-regressions.test.tsx`, `workspace.test.tsx`, `stream.test.tsx`.
Browser A→logout→B trên cùng browser không thấy cache, plaintext, selected thread hay
pending request của A; expiry giữa SSE/mutation về login đúng; runtime down/up hồi phục.

### W05 — Mutation fence không được khóa mất đường emergency stop

**P0 · B/V · ticket 09/17.** Source:
`server/src/security/engagement-mutation-fence.ts:registerEngagementMutationFence`.

**Hiện trạng:** mọi scoped HTTP mutation giữ advisory transaction lock trong toàn
handler, kể cả external provider call, timeout 60s. Estop/cancel vẫn đi qua lock đó:
command đang chờ có thể làm stop trả 409. Handler dùng services với DB client khác;
lock transaction **không đồng nghĩa** business writes cùng atomic transaction.
Nested transactions còn cần kiểm tra với connection pool nhỏ.

**Cách sửa:**
1. Regression có barrier: command/provider đang chờ → estop và closure request song
   song. Đo thời gian stop được nhận; kiểm tra mọi committed row khi outer tx timeout.
2. Thiết kế ngắn gọn reserve/fence → external call → finalize, giữ durable active
   intent làm closure blocker. Emergency request phải persist latch trước side effect.
3. Cùng lock/fence protocol ở service entrypoints/worker, không chỉ HTTP wrapper.
   Tránh DB transaction dài bọc network I/O; giữ truthful uncertain state nếu timeout.
4. Chứng minh closure không lọt qua khoảng giữa reserve/finalize; ghi ADR nếu thay
   concurrency boundary đã freeze trong ADR-0069.

**Test/đóng:** integration trên PostgreSQL thật, hai API instances và pool nhỏ;
`t17-closure.test.ts`, `iw09-c2.test.ts`, `w11-controls.test.ts`. Stop được nhận khi
work in-flight; close không thắng active reservation; lỗi không để partial success
bị báo như rollback toàn bộ. Không bỏ fence đơn thuần để làm test xanh.

### W06 — Checklist/closure phải bao phủ workflow mới và mọi mutation

**P0 · B/M/V · ticket 17.** Source: `closure-service.ts:checklist/decide`, `main.ts`
callbacks; `library-review-service.ts:decide`; mutation fence.

**Hiện trạng:** checklist có scope/plan/grant reviews nhưng chưa có library proposal
review. Finding blocker chỉ đếm status `review`, chưa thể suy ra mọi disposition
khác đều được chấp thuận đóng. Closure row bị overwrite khi re-request; API không
có expectedVersion cho quyết định. Nhiều service dựa vào HTTP fence thay vì tự gate.

**Cách sửa:**
1. Freeze danh sách blocker gồm pending library, active scheduled intent nếu W11
   được thêm, unresolved/unknown stop, commands/runs/questions/provider sessions.
   Quy định rõ draft/remediation/retest findings được đóng trong điều kiện nào.
2. Compare-and-set closure request/version/status; lưu request/decision history hoặc
   audit đủ tái dựng. Không cho stale cancel/confirm áp lên request mới.
3. Đưa cùng open-state guard vào consequential service entrypoints; định nghĩa recovery
   allowlist: đọc/reconcile outcome, revoke, stop vẫn được phép khi cần.
4. External source unavailable phải block theo policy; không biến thiếu provider thành
   “0 session” chỉ vì chưa có command nếu nguồn đó từng được sử dụng qua đường khác.

**Test/đóng:** `t17-closure.test.ts`, library/C2/campaign/vault consumers; DB thật race
close với submit/run/grant/review/schedule, request→cancel→request→stale-confirm.
Sau close mọi write bị chặn đúng contract; GET/export read vẫn được nếu được phép.

### W07 — Effective scope, stale approvals, removal và timezone

**P0 · B/M/D · ticket 08/09/12.** Source: `scope-service.ts:submitRevision`,
`decideRevision`, `classifyAsset`, `normalizeRoe`, `roeWindowAllows`;
`src/real/screens/scope-panel.tsx`.

**Hiện trạng:** approval chỉ promote `diff.added`, không áp `removed`; nhiều pending
revision có thể được approve lệch thứ tự mà không supersede approved khác tại decision.
Latest diff không phải effective cumulative scope. UI luôn gửi `removed: []`,
`restrictions: []`, gửi `datetime-local` không offset nhưng ghi `tz: 'UTC'`.
Backend `Date.parse` không dùng `tz`, nên timezone máy API có thể đổi thời gian thực.

**Cách sửa (tách patch dữ liệu, validation, UI, runtime bridge):**
1. Define immutable effective scope snapshot cho mỗi version hoặc deterministic fold
   của diffs. Apply removal/out-of-scope trong transaction; không mất added targets cũ.
2. Một authoritative approved version; từ chối stale decision hoặc có explicit rebase.
   ExpectedVersion/CAS ở revise/decision/classification; submission vẫn invalidate ngay.
3. UI cho remove/restrictions/ROE-only window edit; hiển thị full diff và ROE trước
   review. Không reset các trường chưa sửa về mảng rỗng.
4. Wire timestamp phải là ISO với Z/offset; validate timezone, empty contacts,
   partial start/end và DST. UI convert từ timezone đã chọn, không gắn nhãn UTC sai.
5. Đối chiếu scope snapshot với runtime ROE/egress đang thực thi. Web preflight pass
   không tự chứng minh sandbox đã nhận scope mới. Chỉ bridge qua public contract,
   không thay/giảm runtime guardrails hay sửa producer documents bằng side effect ngầm.

**Test/đóng:** `t08-scope.test.ts`, `t09-governance.test.ts`, runtime-context/C2 tests;
DB submit/review đồng thời; approve v2 rồi approve pending v1; add A→add B→remove A;
browser UTC và Asia/Ho_Chi_Minh, API UTC. Sau narrowing, action mới ngoài scope bị
từ chối thật. Chốt policy riêng cho work đã chạy/in-flight, không giả định rollback.

### W08 — Preflight đủ dữ kiện thật và consistent với execution

**P0 · B/M · ticket 09.** Source: `governance-service.ts:preflight/bindPlan`,
`main.ts` construct `GovernanceService` không truyền readiness option.

**Hiện trạng:** chưa nối live runtime/agent/playbook checks. Target check dùng
`inScope > 0 || engagement2 !== null`, nên record engagement tồn tại đã đủ pass
dù message nói “0 inventoried targets”. Preflight không xét mọi stop state mà
`assertNoActiveStop` xét. Bind chưa bắt buộc non-null expiry như execute.

**Cách sửa:**
1. Readiness input phải nhận actor/engagement/thread/selection rõ ràng; lấy catalog,
   context/binding và canonical skill/version thực từ public sources.
2. Check project, authorization/handoff, effective target scope, ROE/time window,
   playbook selection, selected assistant readiness, required approval và contact.
   Không invent playbook requirement khi contract chưa chọn: chốt input trước.
3. Thống nhất stop/deadline/unknown semantics giữa preflight, bind, submit, resume,
   C2 liên quan. Không để preflight xanh nhưng gate cùng dữ kiện từ chối.
4. Error summary phải kể cả `unavailable`, không chỉ `fail`; không fail-open khi
   dependency vắng mặt. Tránh dependency vòng governance ↔ runtime composition.

**Test/đóng:** `t09-governance.test.ts`, `t09-governed-lifecycle.test.ts`,
`runtime-context.test.ts`; mất runtime/KG, wrong assistant/skill, zero allowed target,
null expiry, exact deadline -1/0/+1 ms, edited ROE boundary; browser giải thích đúng check.

### W09 — Plan decision/revision phải atomic và không phá approval cũ khi reject

**P1 · B/M · ticket 09.** Source: `governance-service.ts:decidePlan/revisePlan`,
`src/real/screens/governance-panel.tsx:revise`, `api.ts:decidePlan`.

**Hiện trạng:** `decidePlan` supersede mọi approved plan **trước cả khi decision là
rejected**, và hai write không nằm trong business transaction. UI revise luôn gửi
`methods: []`; compare không hiển thị methods; decision không mang expectedVersion.

**Cách sửa:** chỉ supersede trong successful approve transaction; CAS đúng proposed
version/scope pin, persist decision+audit cùng boundary. Reject giữ nguyên plan đang
approved và binding hợp lệ. Revision copy/edit methods thật, retain base identity
theo contract; UI so sánh cả objective/methods/ROE/deadline và gửi version đã đọc.

**Test/đóng:** `t09-governance.test.ts`, `t09-governed-lifecycle.test.ts`; approved v1
→ revised v2 → reject v2 vẫn execute theo v1 trong TTL; approve v2 atomically thay v1;
DB failure ở write thứ hai không làm mất approved v1. Hai reviewer chỉ có một decision.

### W10 — Emergency stop latch, scopes, observation và explicit resolution

**P0 · B/M/D · ticket 09/17.** Source: `governance-service.ts:emergencyStop`,
`assertNoActiveStop`, `http/routes/governance.routes.ts`, `main.ts:cancelRun`,
`src/real/screens/governance-panel.tsx`.

**Hiện trạng:** stop record được tạo sau callback cancel; `scope: workspace` vẫn
chạy trong một engagement; UI chỉ có project stop, không render stop list/outcome.
`assertNoActiveStop` block cả `stopped/failed/unknown` nhưng chưa có resolve API;
preflight/checklist dùng các tập status khác nhau. Foreign operation target cần
validate trước khi record/cancel. Empty run list không tự chứng minh mọi worker dừng.

**Cách sửa:** persist authorized stop latch trước cancel; xác định operation target
bằng owned identity; workspace stop enumerate đúng authorized scope theo decision,
không giả global authority từ một engagement. Observe outcome từ runtime và giữ
unknown khi chưa có bằng chứng. Bổ sung reconcile/manual-confirm/resolve kèm reason,
actor, concurrencyVersion; resolution không tự resume hay tự restore approval.
Wire list/actions/outcomes vào UI và inbox. Public contracts mới cần Proposed ADR.

**Test/đóng:** `t09-governance.test.ts`, `w11-controls.test.ts`, `t17-closure.test.ts`;
hai engagement + hai active runs, foreign thread, provider timeout, cancel ACK chưa
terminal, restart giữa stop. Khi latch active dispatch mới bị chặn; resolve chỉ từ
actor có quyền; resume là thao tác tường minh qua các gate hiện hành.

### W11 — Implement scheduling/start lifecycle theo runtime semantics

**P1 · M/D · ticket 09.** Source: `src/real/screens/feature-route.tsx` mapping
`operation-schedule` → Governance + Operations; governance routes chưa có scheduling.

**Cách làm:**
1. Chốt contract scheduling là durable execution intent gắn existing engagement/
   thread/approved plan; không tự tạo business-operation authority thứ hai (D2).
2. Proposed ADR cho scheduler/worker/API mới; requestId, expectedVersion, executeAt,
   timezone, reason, cancel/reschedule, restart recovery và missed-window policy.
3. Worker claim atomic; lúc đến giờ recheck scope/plan TTL/closure/stop/readiness,
   dispatch qua RunService/ledger. Không dùng browser timer để “chạy lịch”.
4. UI có chọn thread/plan/timezone, preview thời gian, scheduled/refused/missed/
   uncertain outcomes. Generic pause/resume chỉ thêm nếu runtime có contract riêng;
   graph interrupt answer không được đổi nhãn thành generic resume.

**Test/đóng:** mở rộng `t09-governed-lifecycle.test.ts` và thêm focused scheduler tests
(file mới, chưa tồn tại); hai workers claim một intent, restart trước/sau ACK,
reschedule stale version, expired approval/ROE lúc chạy, closed engagement. Browser
đóng tab thì lịch vẫn chạy đúng một lần hoặc báo blocked/uncertain có thể reconcile.

### W12 — C2 authorization phải bao gồm live scope và recovery policy

**P0 · B/M/V · ticket 08/12.** Source: `c2-service.ts:dispatchCommand/reconcile`,
`c2-grants-service.ts:assertCommandAuthorized`; scope service.

**Hiện trạng:** grant gate kiểm tra closed/grant/expiry/path prefix, chưa tiêu thụ
approved ROE/effective scope/time window. C2 service kiểm tra owner + authorization
boolean, không đủ để kết luận “live scope checked” như ticket 12 hiện ghi.

**Cách sửa:** freeze provider session → authorized target mapping; inject bounded
scope/window/stop gate tại pre-dispatch enforcement sites. Giữ 3 grant rechecks và
truthful outcome sau execution; revoke không xóa sự kiện đã thực thi. Recovery/
audit read policy tách khỏi execute permission để không gây dispatch lại khi hết hạn.
Định nghĩa `commandPrefix` là literal prefix hay directory boundary, validate tương
ứng; không tuyên bố path-scope mạnh hơn contract thực tế.

**Test/đóng:** `iw09-c2.test.ts`, `t12-c2-grants.test.ts`, scope consumers; revoked
scope/closed/window expired trước reserve, trước invoke và sau response. Lab provider
proves allowed one invocation, denied zero invocation, outcome đã chạy vẫn được lưu.

### W13 — C2 stable intent ở UI, reservation recovery và audit khi provider down

**P1 · B/M/V · ticket 12.** Source: `src/real/screens/c2-panel.tsx:dispatch`,
`c2-service.ts:dispatchCommand/history/reconcile`.

**Hiện trạng:** mỗi click tạo UUID mới; lost ACK rồi click lại có thể tạo intent
mới. Gate fail sau reservation chưa giải phóng/hoàn tất reservation đã chắc chắn
chưa invoke. History gọi provider-required authorize nên DB ledger không đọc được
khi provider chưa cấu hình. UI chỉ hiển thị stdout preview, chưa inspect stderr đầy đủ.

**Cách sửa:**
1. Persist request identity trước POST (actor/engagement/session scoped), giữ input
   khi uncertain, disable duplicate intent và reconcile từ history/request contract.
2. Nếu chứng minh chưa invoke thì finalize trạng thái refused/failed theo contract
   và release slot; nếu chưa biết đã invoke thì giữ uncertain, không dispatch lại.
3. Read persisted ledger chỉ cần quyền đọc phù hợp, không phụ thuộc provider online;
   reconcile provider là action riêng. Không nuốt lỗi persist truthful outcome.
4. UI giữ status/exit code/stdout/stderr/truncation và full bounded outcome inspector.

**Test/đóng:** `iw09-c2.test.ts`, `t12-c2-grants.test.ts`; component test mới cho console
(chưa tồn tại). Browser drop response sau provider ACK, refresh, reconcile/retry;
provider execute counter chỉ tăng một. Gate refusal không làm session slot kẹt vĩnh viễn.

### W14 — Thống nhất C2 TTL giữa settings, service và form

**P1 · B · ticket 12/16.** Source: `workspace-settings-service.ts:WORKSPACE_SETTING_SPECS`
cho 1–720h; `c2-grants-service.ts:maxTtlMs` từ chối >24h; UI clamp 1–24h cố định.

**Cách sửa:** chốt một policy range; trả effective min/max từ server và dùng trong
form. Nếu trần 24h là invariant thì thu hẹp registry/validation có kế hoạch xử lý
persisted value >24; không âm thầm nâng trần authorization chỉ để khớp UI.
Hạn tuyệt đối vẫn do server tính/validate, không có grace do polling.

**Test/đóng:** `t16-settings-audit.test.ts`, `t12-c2-grants.test.ts`; save 1/24/25/720
theo range chốt, invalid persisted setting, policy source outage, boundary expiry
-1/0/+1 và in-flight revoke/expiry. Setting được server nhận không được tự làm
mọi GET grants thành 503 mà UI không cảnh báo.

### W15 — C2 management/campaign UI phải gửi đủ provider contract

**P1 · B/M/V · ticket 12.** Source: `src/real/screens/campaigns-panel.tsx`,
`api.ts:createCampaign/runCampaignJob`, `server/src/services/campaign-service.ts`
(`parseDraftInput`, `runJob`, `prepareGoPhish`), `campaign.routes.ts`.

**Hiện trạng:** form chỉ có name/vector/scenario, không nhập GoPhish assets hay
Evilginx lab profile; adapter job POST body `{}`. Backend deploy yêu cầu
`requestId` và `version`, GoPhish preparation đọc `spec.gophish`. Vì thế không chỉ
thiếu provider live: UI hiện thiếu input để chạy supported provider workflow.
Listener/profile routes có nhưng chưa có management UI; channel/session chưa chọn ID.

**Cách sửa:**
1. Expose đúng supported draft spec từ capabilities; selectors/validation cho provider
   và lab profile, không hiển thị web/mobile deployment như đã được hỗ trợ.
2. Job action gửi stable requestId + current version, giữ uncertain intent qua reload;
   đọc manifest/provider status và reconciliation theo existing ledger.
3. Implement listener/profile/session detail và stop-listener theo existing routes;
   session termination phải audit contract trước, không đổi grant revoke thành disconnect.
4. Chỉ exercise synthetic/isolated lab theo provider contract sẵn có. Không mở rộng
   dispatch ra live recipients hoặc bỏ lab-origin gates để “nghiệm thu”.

**Test/đóng:** `w17-campaigns.test.ts`, `iw08-campaign-job-ledger.test.ts`,
`iw08-gophish-preparation.test.ts`, `iw08-gophish-deployment.test.ts`, Evilginx suites;
component tests mới cho campaigns/console. Actual lab preparation/deploy/reconcile
và stale-version/duplicate/timeout/refusal, evidence provider IDs/outcome, không secret.

### W16 — Library detail phải dùng đúng corpus graph contract

**P1 · B/V · ticket 14.** Source: `library-service.ts:TECHNIQUE_DETAIL_STATEMENT`
dùng `[:COVERS]`; `packages/raptix/raptix/skills/engine/builder/skills.py` sinh
`edge_type="IMPLEMENTS"`. `graph-service.ts:neo4jQuery` không đọc Neo4j `errors`,
gom valid empty và malformed response thành “unreadable result”; `detailRows` đổi
message đó thành 404, có thể che lỗi query/schema.

**Cách sửa:** query theo relation/property thật của graph builder; shared query client
phân biệt transport/auth, Neo4j query errors, malformed JSON/result và successful
empty result. Không dùng substring của error message để quyết định not-found.
Skill body/metadata phải đến từ canonical corpus, không copy sang web executable store.

**Test/đóng:** `t14-library-review.test.ts`, `t14-library-analysis.test.ts`,
`graph-service.test.ts`; fixture có topology do builder quy định và integration Neo4j
thật có `Skill-[:IMPLEMENTS]->Technique`. Linked skill xuất hiện; valid unknown →404;
syntax/schema/auth/outage →unavailable đúng loại, không biến thành “không tồn tại”.

### W17 — Sửa persistence/version/snapshot của Library proposals

**P1 · B/D/V · ticket 14.** Source: `schema.prisma:LibraryReviewProposal`, migration
`20261015090000_library_review_proposals`, `library-review-service.ts`, ADR-0070.

**Hiện trạng:**
- Unique `(engagementId,skillName,version)` nhưng mỗi proposal mới luôn version 1;
  amendment của proposal này cũng có thể đụng version của proposal khác.
- Check “đã có proposed” chỉ ở submit, không bảo đảm hai draft cùng vào review.
- ADR nói canonical drift block amendment và cần fresh proposal; code amend lại
  re-pin tự động. Source outage bị `canonicalCurrent` catch thành false/drift.
- Bound 256 KiB chỉ kiểm tra `.length` ở submit, không áp cùng chuẩn ở amend.
  Amend/propose trả object tự dựng nên timestamp/history có thể không phản ánh DB.

**Cách sửa:**
1. Version là proposal-local; dùng proposal ID làm identity, bỏ unique skill/version
   toàn engagement bằng migration mới. Nếu chỉ một proposed/skill, enforce bằng
   DB constraint phù hợp + CAS/transaction, không chỉ find-before-create.
2. Default tuân ADR-0070: drift yêu cầu proposal mới, không silent rebase. Nếu chọn
   rebase thì sửa quyết định/contract trước và retain old snapshot/reviews.
3. Canonical unavailable là unavailable, không giả drift. Hash một projection có
   ordering ổn định, giữ content/build identity đã thống nhất.
4. Validate UTF-8 byte length/positive integer expectedVersion cho submit/amend/decide;
   returns đọc DB persisted; không mất lịch sử reviews của version trước.
5. Transaction bảo vệ status/version/review/audit; DB failure không tạo orphan review.

**Test/đóng:** `t14-library-review.test.ts` + PostgreSQL thật: hai draft cùng skill,
amend độc lập, approve/reject rồi submit mới, hai concurrent propose/decide, stale
amend, multibyte bound và canonical outage/drift. Memory double hiện tại không
enforce unique constraints, nên không đủ để đóng mục này.

### W18 — Hoàn thiện Library review/diff/export UI và entrypoints

**P1 · B/M · ticket 14.** Source: `src/real/screens/library-review-panel.tsx`,
`library.tsx`, `api.ts`.

**Hiện trạng:** reviewer có Approve/Reject nhưng không đọc full base/proposed diff;
Export chỉ hiển thị publicationContract. List không tính `canonicalCurrent` nên
drift banner không hoạt động qua list. Table headers lệch nội dung row. Library
page còn banner “không có proposal contract”, không có entrypoint review rõ ràng.
List chỉ render 100 skill trong tập tối đa 500 mà chưa có paging/load more.

**Cách sửa:** detail query theo proposal ID + engagement; render body/diff/rationale/
version/reviews/canonical state; controls theo role/author/closed state. Download
JSON chứa base/proposed/diff/review metadata thực và giữ frontmatter publication
boundary. Surface conflict khi version đổi, không approve version chưa xem.
Thêm navigation từ skill tới proposal queue/new proposal, sửa bảng/banner/pagination.

**Test/đóng:** component test mới cho library review (chưa tồn tại) + adapter guard
tests; browser hai actors submit→view diff→request amendment→propose→approve→download.
Kiểm tra bytes JSON, review version, self-review denied, source outage và fresh proposal
sau drift; refresh/API restart giữ snapshot. Runtime skill loader không đọc proposal.

### W19 — Finding review/transition, producer provenance và evidence bytes

**P1 · B/M/D/V · ticket 10.** Source: `findings-workflow-service.ts:importDraft/update/transition`,
`artifacts-service.ts:capture/upload/content`, `src/real/screens/curation-panel.tsx`.

**Hiện trạng:** confirm có reviewer-role gate nhưng chưa so author/reviewer identity;
transition không nhận expectedVersion từ UI. Update có thể sửa nội dung đã confirmed/
resolved mà giữ trạng thái xác nhận. Import lưu producerRef string nhưng không resolve
nguồn. Upload trả producer `web-user:*` nhưng capture đọc lại trả producer null.
Binary upload có thể giữ được bytes nhưng text inspector không đọc được; chưa có
download/masking workflow đầy đủ. UTF-8 truncation có thể cắt giữa codepoint và thành
decode failure; listing còn có các lỗi filesystem bị biến thành empty.

**Cách sửa:**
1. Freeze independence và edit-after-confirm contract; confirmation/retest pin version,
   update phải invalidate review hoặc tạo revision, CAS dùng version user thực sự đọc.
2. Resolve producer reference qua retained authority, không cho arbitrary foreign path
   thành verified provenance. Giữ claim/capture integrity/independent verification riêng.
3. Persist capture metadata/lineage khi cần, digest tính trên bytes retained; producer
   từ server authority, không từ client assertion. Capture identity không chỉ là path mutable.
4. Binary policy explicit: hỗ trợ bounded authorized download nếu required; không cố
   decode binary thành text. Decode truncated text an toàn; distinguish unreadable/empty.

**Test/đóng:** `t10-findings-workflow.test.ts`, `findings-artifacts.test.ts`,
`findings-panel.test.tsx`, `precommit-regressions.test.tsx`; tự confirm, stale
transition, edit confirmed, foreign producerRef, hash mismatch, multibyte split,
upload→attach→read/download bytes→refresh/restart. Việc four-eyes confirmation cần
ghi rõ contract, không suy ra chỉ từ tên role.

### W20 — Report revisions, references và atomic export/delivery

**P1 · B/M/D/V · ticket 11.** Source: `reports-service.ts`, `src/real/screens/report-editor.tsx`,
`reports-panel.tsx`, `schema.prisma:ReportRecord/ReportDelivery`.

**Hiện trạng:** create chỉ title/summary, chưa có explicit finding/evidence references
hay template workflow. Approved/delivered report không edit được nhưng chưa có action
tạo revision như message yêu cầu. Delivery create/status/audit tách writes; replay chỉ
so requestId, chưa kiểm tra đổi payload. UI export ghi export record rồi GET content
mới, có thể tải version khác với record nếu có edit xen giữa; revoke Blob URL ngay
sau click cần verify browser thực. Key editor theo version/status làm refetch từ người
khác có thể remount và mất draft đang gõ.

**Cách sửa:**
1. Chốt references/templates/format scope; report giữ explicit reviewed source/version,
   không copy AI claim thành confirmed. Manual save là hiện có; autosave chỉ nếu chốt cần.
2. API + UI tạo revision sau approval/delivery, retain immutable reviewed snapshot và
   require re-review. Không mở edit thẳng approved body để tránh thêm workflow.
3. Delivery/report status/audit trong business transaction; fingerprint requestId với
   kind/format/version/receipt input. Replay khác input →409; failed finalize không
   được replay thành “completed” thiếu status transition.
4. Export trả chính artifact đã ghi hoặc đọc immutable version/digest, không hai reads
   độc lập. Viewer có read/download permission không buộc gọi operator-only delivery.
5. Giữ local draft khi remote version đổi, show conflict/rebase; clear dirty chỉ sau
   ACK. Theo dõi download thật thay vì coi click đã thành công là delivered.

**Test/đóng:** `t11-reports.test.ts` + editor tests mới: approved→revision→review;
same request/different body, DB failure giữa delivery/status, concurrent edit/download,
viewer export, conflict giữ draft và dirty navigation. Browser tải file, so digest và
version với DB record; manual receipt không được báo là email đã gửi.

### W21 — Dirty/save/discard phải chờ server ACK và không mất draft

**P1 · B/M · ticket 03/08–14/R10.** Source: `src/state/session.ts:useDirty`,
`src/shell/shell.tsx:GlobalModals`, các forms trong `src/real/screens/`.

**Hiện trạng:** Save Draft gọi `u.save?.()`, toast thành công và navigate ngay, không
await kết quả. Report editor gọi `useDirty(dirty)` không truyền save callback nên có
thể toast “saved” dù không lưu. Nhiều scope/plan/curation/library/campaign forms chưa
đăng ký dirty; đổi engagement/tab hoặc refetch có thể mất draft.

**Cách sửa:** save contract async có outcome; không navigate/toast khi fail/409, không
show Save nếu chưa có khả năng save thật. Ownership dirty state theo form, không để
unmount một form clear dirty của form khác (copilot + editor). Scope switch phải
capture intended engagement; pending mutation result không ghi vào form của scope mới.
Không persist password/vault plaintext/command body để thực hiện draft recovery.

**Test/đóng:** session/shell/route suites liên quan + editor/forms được đổi. Cover
Stay, Discard, Save success, Save denied/409/timeout, browser Back/Forward, switch
engagement, remote refetch và hai dirty forms. Đóng browser với draft tuân policy
đã chọn; không giả autosave. Xác minh bằng browser, không chỉ fireEvent trên mock UI.

### W22 — Detail routes, project edit/wizard và navigation đúng resource

**P1/P2 · B/M/D · ticket 03/04/09/12/13/14.** Source:
`src/real/screens/feature-route.tsx`, `assets-panel.tsx`, `workspace.tsx`, `detail.tsx`,
`create.tsx`, `src/router/history.ts`, `screens/settings.tsx`.

**Hiện trạng:** nhiều route `operation/agent/ai-branch/c2-session/c2-channel` chỉ đổi
title rồi render panel engagement chung; `route.id` chưa được consume ở panel tương
ứng. Asset graph ID và managed inventory ID là hai namespace khác nhau. Reports và
curated findings đã có lọc detail, không gom hết vào danh sách “chưa làm”.
New Project còn là basic form; Settings chỉ dẫn sang project Settings tab không tồn
tại trong `detail.tsx`; chưa có UI sửa target/display name dù PATCH backend tồn tại.

**Cách sửa:**
1. Freeze ID semantics: operation projection dùng thread/run theo D2; catalog graph,
   worker branch, observed asset và managed asset không dùng ID thay cho nhau.
2. Detail route load đúng owned resource, 404/wrong-engagement rõ; selection/engagement
   nằm trong URL. Không hiển thị toàn list như detail thành công cho ID không tồn tại.
3. Wire project settings/edit và nối onboarding tới Team/Scope/Planning; chốt full
   wizard/objectives/ROE attachment là cần làm hay explicit approved reduction.
4. History/trace có selected thread/run và provenance; pin/search/copilot context
   chưa có thì ghi decision, không chỉ route alias rồi tuyên bố đủ parity.
5. Parse malformed percent-encoding an toàn; test base-path, encoded artifact paths,
   hash/query và foreign IDs. Read-only/role controls có lý do đúng từ server.

**Test/đóng:** `app-routing.real.test.tsx`, `real-screens.test.tsx`,
`operations-panel.test.tsx`, `assets-panel.test.tsx`, `workspace.test.tsx` và router
suites; browser mở deep link fresh session/không pid, Back/Forward/refresh, sai ID;
mọi action chỉ thay đổi resource trong URL, không resource đang chọn trước đó.

### W23 — Inbox/notices/search/KPIs đúng status, URL và source quality

**P1 · B/M · ticket 15.** Source: `server/src/services/inbox-service.ts:tasks/overview`,
`src/router/history.ts:parseHash`, `screens/command-center.tsx`, `search.tsx`,
mutation onSuccess trong các panels.

**Hiện trạng:** task plan query `status: 'pending'`, plan lifecycle dùng `proposed`;
href `#/project/<id>/<tab>` nhưng parser chỉ đọc tab từ `?tab=`, nên click có thể
về Overview. Nhiều `.catch(() => [])`/zero che source outage thành “không có việc”.
Chưa có library-review/closure/tool-HITL task kinds; Overview API chưa được nối vào
project counters đang luôn null. Invalidation thường chỉ local list, không tasks/
notices/overview/preflight/closure liên quan. Search chỉ filter portfolio/tasks đã load.
Project badges lấy `Engagement.status`, trong khi run lifecycle hiện không cập nhật
trường đó; cần chốt đây là business lifecycle hay derived runtime status, không coi
một successful run là bằng chứng cả engagement đã completed.

**Cách sửa:** đúng status + canonical route serializer, include resource ID khi
available. Partial aggregate có explicit per-source unavailable/truncated metadata;
không invent KPI zero. Thêm inbox kinds theo workflow thật, giữ role/independence.
Ghi invalidation dependency map cho mỗi acknowledged transition; polling 30s không
được mô tả là immediate update. Search/counters có phạm vi/pagination minh bạch;
project lifecycle/badge phản ánh authority đã chốt, closure read-only có trạng thái rõ.

**Test/đóng:** `t15-inbox.test.ts`, command-center/search/notices tests mới nếu thiếu;
create proposed plan thực → reviewer thấy task → click đúng Governance; quyết định
xong task biến mất/notice tới author. Source DB failure không thành “No pending work”.
Library review/closure/HITL được route tới đúng decision, foreign task/notice bị từ chối.

### W24 — Observed graph/analysis/fleet: đúng dữ liệu, trạng thái và bounds

**P1/P2 · B/M/V · ticket 06/13/14.** Source: `graph-service.ts:publicProperties`,
`toAssetSummaries/runScopedQuery`, `library-service.ts:analysis/projectAnalysisPaths`,
`src/real/screens/fleet-panel.tsx`, `operations-panel.tsx`, `analysis-panel.tsx`.

**Hiện trạng:** publicPropertyValue loại arrays thành null nhưng projection assets
mong ports/services arrays; dedupe key cho node thiếu host/ip/url có thể gộp nhầm.
Neo4j collect toàn graph trước khi JS slice nên bound response không bound DB work.
Technique/branch/path truncation cần báo đủ; analysis mới table/path list, chưa phải
heatmap đầy đủ. Operations tone map dùng completed/failed/cancelled nhưng raw runtime
là success/error/timeout/interrupted; branch ended có thể render passed dù outcome failed.

**Cách sửa:** bounded allowlisted scalar arrays với cùng redaction, stable node ID
fallback khi không có semantic identity; query DB có limits/truncation strategy đúng
subgraph và orphan edges. Chuẩn hóa status mapping từ raw provider/runtime; unknown
không thành success. Bổ sung observed heatmap/dependency view nếu required, không suy
diễn detection/execution. Catalog vẫn không được giả thành heartbeat của endpoint.

**Test/đóng:** `graph-service.test.ts`, `t13-fleet.test.ts`, `t14-library-analysis.test.ts`,
`operations-panel.test.tsx`, `assets-panel.test.tsx`; arrays/redaction, unnamed nodes,
large graph/limits, failed/unknown branch và runtime terminal states. Neo4j thật với
observed edges; browser graph/down/empty/truncated phân biệt được.

### W25 — Vault, audit và workspace settings: actor và scope semantics

**P1 · B/M/D/V · ticket 07/16.** Source: `vault-service.ts:create/findEngagement`,
`audit-service.ts`, `workspace-settings-service.ts:requireWorkspaceAdmin`,
`src/real/screens/vault-panel.tsx`, `screens/settings.tsx`.

**Hiện trạng:** vault tạo `createdBy: 'local'` cả multi-user; audit vault không có
actor column. UI revoke copy nguyên `revealed` map thay vì bỏ secret; pending reveal
cần scope/session guard. Workspace admin hiện được suy từ việc sở hữu bất kỳ engagement
hoặc owner membership; đây là policy đã code, chưa phải deployment-admin role riêng.
Workspace audit trả workspace-global rows cho caller; cần freeze ai được xem.

**Cách sửa:** lưu actor thật từ session cho record/audit mới, historical actor thiếu
vẫn null/not recorded, không backfill bịa. Purge reveal plaintext khi hide/revoke,
scope/session đổi và ignore late ACK; không query-cache plaintext. Chốt workspace
admin/audit visibility trước khi mở multi-user rộng; giữ UI preferences/local theme,
server integration config và retention config-only tách biệt. Thay policy cần decision.

**Test/đóng:** `w18-vault.test.ts`, `t16-settings-audit.test.ts`, team/session tests;
browser reveal→switch actor/scope trong khi response trễ, revoke rồi re-render;
foreign reveal denied; encrypted data đọc lại bằng cùng key qua restart. Audit nêu
actor/scope đúng và không chứa plaintext; settings quyền đúng policy chốt.

### W26 — Hoàn thiện wire validators, request bounds và DB lifecycle contracts

**P1 · B/M · ticket 01/R05, consumers 07–17.** Source: `src/real/api.ts` DTO/guards,
`apps/shared/web-contracts/src/`, workflow services và Prisma schema/migrations.

**Hiện trạng:** DTO mới bị lặp giữa server và browser; nhiều guards chỉ check object,
status hoặc array, thiếu nested shape và returned engagement/resource ID. Version
inputs có nơi chỉ check `typeof number`; import/update có thể nhận severity không
hợp lệ. Một số workflow records thiếu FK engagement; deletion service cũ mới xóa
thread/ledger, cần xác minh orphan/blocking FK với workflow records mới.

**Cách sửa:**
1. Freeze shared DTO/error/status/ownership validators theo từng domain, không mega
   rewrite api.ts. Guard đủ mọi field mà UI dereference và nested ownership.
2. Validate positive safe integer versions, bounded body/arrays/strings/ISO dates,
   unknown fields và enums; không sửa shared guard cho chấp nhận fixture sai.
3. Định nghĩa foreign key/onDelete/history retention cho records mới; migration thêm
   incremental, chạy preflight orphan report. Không edit migration đã apply.
4. Consequential mutation + audit atomic theo domain boundary; notices có thể
   best-effort theo contract nhưng phải phân biệt với audit bắt buộc.

**Test/đóng:** `api.test.ts`, `planning-api.test.ts`, `precommit-regressions.test.tsx`
và owning server tests; valid-but-foreign nested DTO, missing body/reviews, NaN/
fraction/negative version, oversized UTF-8, delete with child records. DB thật kiểm
tra constraint, rollback, CAS; memory double chỉ là unit environment, không giả chứng cứ DB.

### W27 — Deployment/runbook thật: Web API/UI, shared mounts và preserved data

**P1 · M/V · ticket 02/18.** Source: `docker-compose.web-raptix.yml`,
`infra/containers/web-raptix*.Dockerfile`, proxy config, `server/.env.example`,
`server/src/config/env.ts`, `config/runtime.ts`, `Makefile`.

**Cách làm:**
1. Ghi topology UI→API→DB/runtime/KG/sandbox, actual port/mount/network và default
   local/multi mode. Base compose không tự khởi động Web compose riêng.
2. Document đúng env names cho auth/admin/cookies/vault/Neo4j/provider. Verify
   `RAPTIX_NEO4J_PASSWORD` của base với `NEO4J_PASSWORD` Web; không mặc định chúng
   là cùng biến. `server/.env.example` hiện chưa liệt kê auth/admin/vault/provider
   setup mới, cần bổ sung placeholder và hướng dẫn. Sandbox URL/workspace root/slugs
   phải đúng mount runtime thực.
3. Tạo dedicated Web DB và migrate explicit; API Node startup không auto-migrate,
   Docker CMD có migrate deploy. Migrate clean DB và upgrade existing DB riêng.
4. Build images từ tree đã ghi, không dùng tag stable/cached dist làm bằng chứng
   current source. UI production real default, dev cần chọn real tường minh.
5. Kiểm tra port trước start; port 3000 hiện là Juice Shop, dùng port Web khác
   (ví dụ 3001) mà không dừng service user. Không compose down -v/prune để “fix”.
6. Backup/cutover/rollback giữ DB/workspace/thread bindings/key; verify migration
   compatibility thay vì giả định downgrade binary tự hiểu schema mới.

**Test/đóng:** clean install/build/container startup; same-origin API không HTML,
SSE qua nginx không buffer; auth W03, shared artifact/runtime visibility W01;
restart từng API/UI, retained-data upgrade và rollback exercise. Health chỉ chứng
minh endpoint healthy, không thay inference/command smoke.

### W28 — Sửa harness, bổ sung acceptance và làm ledger trung thực

**P1 · B/M/V · ticket 18 và owning tickets.** Source:
`apps/web/tools/verify-integration-live.mjs`, `verify-workflows-live.mjs`,
`verify-docker-real-mode.mjs`, CI và tracker.

**Hiện trạng:** integration harness hardcode image `20261014` đã xóa, `--flow` yêu cầu
temp-tools env dù Playwright đã là devDependency. Workflow harness cần prior
containers/volume đã xóa, hardcode network/image, output phụ thuộc CWD và không có
cleanup riêng. Browser degraded smoke chưa test multi-user + DB + real runtime.
Nhiều panel mới chưa có focused component tests. Flaky tests đã được ghi nhận ở
routes/a11y/dark-theme/operations; re-run xanh không tự đóng nguyên nhân flaky.

**Cách sửa:**
1. Parameterize image/network/ports/output/state từ repo root; validate prerequisites
   trước create DB/container. Resolve Playwright từ workspace, optional temp override
   chỉ khi thật cần; record actual browser version.
2. Fresh --start tạo resources có labels/run ID; workflow harness consume state hợp
   lệ hoặc tự provision declared dependencies. Không cố reuse acceptance đã xóa.
3. Bổ sung stop/cleanup idempotent theo exact owned resources, hard timeout 5s mỗi
   operation; report survivors. Database/volume removal phải opt-in, không xóa user data.
4. Artifact evidence ghi tree SHA/dirty diff, image digest, schema migrations,
   provider/runtime versions, actual commands/outcome; redact secrets. Không để
   `passed: true` nếu cleanup/required step fail mà không ghi trạng thái riêng.
5. Thêm browser multi-user scenarios §7 và real PostgreSQL schema/concurrency lane;
   CI degraded smoke giữ vai trò riêng. Trace flake bằng timing/isolation/cleanup;
   không tăng timeout hoặc retry vô hạn để biến đỏ thành xanh.
6. Update 18 ticket acceptance/coverage/ADR references sau khi có evidence. Cập nhật
   stale “39 routes”, stale “all LLM stub”, các checkbox/status mâu thuẫn. Không đánh
   dấu complete nếu required live check còn blocked.

**Test/đóng:** `node --check` harnesses, empty/missing state, wrong image, cold startup,
failed-run cleanup, run từ repo root và CWD khác. Execute fresh E01–E12, record mỗi
check attempted/passed/failed/blocked, không suy rộng 12 HTTP checks thành all-Web pass.

## 4. Dependency và thứ tự triển khai

Không triển khai cả W01–W28 trong một PR. Sequence dưới đây là frontier, không phải
yêu cầu chạy lại mọi test ở mọi bước.

| Đợt | Công việc | Phụ thuộc / gate |
|---|---|---|
| A: Freeze & reproduce | Reconcile contract/exclusions; red regressions W01/W03/W05/W07/W09/W14/W16/W17/W23 | Xác nhận tree, không đè user work; test DB/proxy tái hiện |
| B: Identity & execution correctness | W01–W08; W10/W12 theo cùng boundary | Workspace isolation trước mở rộng member access; auth proxy trước browser multi-user |
| C: Domain workflow fixes | W09, W13–W20, W23, W25, W26 theo từng domain | Domain state/transaction pass trước polish UI; library W16→W17→W18; C2 W12→W13/W14→W15 |
| D: Required missing functionality | W11, W21, W22, W24 | ADR/contract ở §6; W05/W08/W10 trước scheduling; shared dirty guard trước thêm forms |
| E: Deployment & acceptance | W27/W28 và E01–E12 | Build source cuối; rerun đúng phần evidence invalidated; performance sau authenticated flow ổn |

W26 là contract work đi kèm từng slice, không chờ tới cuối. W28 phần sửa harness
prerequisites có thể làm sớm để hỗ trợ B/C; final ledger chỉ cập nhật sau nghiệm thu.
Mỗi work item nhiều concern tách patch: regression → service/contract → migration
nếu có → adapter/UI → live evidence, vẫn ghi dưới owning ticket hiện tại.

## 5. Coverage toàn bộ route và thao tác không có route

Đây là checklist nghiệm thu, **không phải danh sách route đã được xác nhận hoàn thiện**.
Route aliases chỉ đạt khi resource ID/hành vi đặc thù được kiểm tra.

| Nhóm | Route keys (53 tổng cộng) | Nghiệm thu bắt buộc |
|---|---|---|
| a (9) | `login`, `forbidden`, `notfound`, `error`, `offline`, `session-expired`, `states`, `command-center`, `tasks` | Session/proxy/expiry/recovery, wrong URL, tasks/deep link/source outage; states có disposition demo-only |
| b (3) | `projects`, `project-new`, `project` | Hai owners, collision, create/edit/onboarding, selected scope, mọi project tab |
| c (5) | `operations`, `operation-new`, `preflight`, `operation-schedule`, `operation` | Correct thread/run binding, complete readiness, durable scheduling, stop/recovery |
| d (10) | `agents`, `agent`, `assets`, `asset-new`, `asset-scope`, `asset`, `playbooks`, `playbook`, `technique`, `playbook-review` | Catalog/branch vs endpoint, managed vs observed ID, effective scope, canonical read/diff/export |
| e (6) | `analysis`, `findings`, `finding-new`, `finding`, `evidence`, `evidence-inspector` | Observed-only coverage/path, curation/version, retained bytes/provenance, permissions |
| f (6) | `reports`, `report-new`, `report`, `report-preview`, `report-review`, `settings` | Real edit/revision/review/download/receipt, dirty guard, policy/vault/audit source đúng |
| g (8) | `ai-operator`, `ai-plan`, `ai-plan-review`, `ai-plan-compare`, `ai-trace`, `ai-history`, `ai-fanout`, `ai-branch` | Conversation/run IDs, questions/HITL, SSE provenance/replay, methods diff, detail/actions |
| h (4) | `c2`, `c2-channel`, `c2-session`, `c2-console` | Actual provider data, grant/deadline/scope, listeners/profile, stable command/reconcile |
| s (2) | `scenarios`, `workspaces` | Explicit demo disposition; không dispatch/reset real data |

Route-less checklist: project switcher/badges, search, header notices read/dismiss,
profile/logout/theme, copilot, emergency entrypoint, toast, unsaved modal, empty/error/
loading states. Đặc biệt verify copilot và full workspace không tạo hai independent
authorities hoặc khiến dirty/recovery state ghi đè nhau.

## 6. Quyết định còn cần khép lại, không tự biến thành exclusion

Không có runtime endpoint không đồng nghĩa requester đã cho phép bỏ tính năng.
Các exclusion được implementation ghi nhận phải đối chiếu D1–D6 và xác nhận trước
khi đưa vào release scope. Không tạo thêm public API bằng phỏng đoán.

| Mục | Hiện trạng/decision cần ghi | Hướng triển khai nếu required |
|---|---|---|
| Scheduling, generic pause/resume | Ticket 09 yêu cầu; D2 chỉ chọn thread/run identity, không tự miễn scheduling | W11; ADR intent/worker, actual runtime pause contract hoặc giữ blocked rõ ràng |
| Branch retry/reassign/cancel, allocation/grouping | Đang banner “excluded D1/D2”; các quyết định đó chưa tự chứng minh full control exclusion đã được chấp thuận | Audit runtime public control first; Proposed ADR và focused Python+Web tests nếu thêm; không giả run cancel là branch cancel |
| Full onboarding wizard/objectives/ROE attachment | Basic create form chưa tương đương demo wizard | W22: compose các workflow đã có; persist chỉ phần contract chấp nhận |
| AI pin/search/context, history/trace UI | Shared conversation đã có; các chức năng chi tiết chưa đủ evidence | W22, scoped persisted contract nếu cần; không copy transcript vào mock Db |
| Analysis heatmap/dependency graph, full fleet endpoint health | Hiện table/path/catalog; endpoint heartbeat không có nguồn | W24; chỉ visualize observed evidence, heartbeat unavailable nếu không có source |
| Binary preview, masking, authorized download | Text/JSON inspector + capture upload hiện có | W19; chốt role/redaction/bytes contract; binary viewer mới là scope riêng |
| Report templates, approved finding refs, PDF/email | Manual report sections/Markdown/JSON/receipt hiện có | W20; templates/refs trong approved scope; PDF/email provider chỉ thêm nếu yêu cầu được chốt |
| Retention enforcement/legal hold | `consumer: null`, config-only; không có scheduled deletion | Nếu cần: ADR lifecycle/retention worker, dry-run/hold/audit tests; không gọi setting save là enforcement |
| Workspace administrator, organization/profile/integrations edits | Team engagement-scoped; settings admin suy từ ownership; credentials env-only | W25/W27; chốt deployment-admin boundary trước multi-tenant release; không thêm SSO/MFA ngoài yêu cầu |
| Automatic corpus publication | ADR-0070 chủ ý không cho Web publish corpus | Giữ git audit/graph/OPSEC workflow; proposal approval không cấp quyền thực thi |
| `states/scenarios/workspaces` | Demo showcase/walkthrough, không real deployment manager | Giữ explicit mock-only disposition, nghiệm thu mode/reset isolation |

Nếu một required item vẫn chưa có quyết định, status là **blocked**, không “complete
with named gap”. Quyết định có thể cho phép một release scope hẹp, nhưng không được
gọi release đó là full parity của các mục đã loại.

## 7. Kế hoạch nghiệm thu end-to-end

### 7.1 Môi trường và dữ liệu

- Local mode và multi-user mode riêng; multi-user có owner A, operator B,
  reviewer C, viewer D, outsider X. Browser contexts tách cookies; không dùng persona.
- Tối thiểu hai engagement cùng owner, hai owners cùng display name/slug candidate;
  dữ liệu chỉ trong DB/workspace test riêng, labels chứa run ID.
- Test thật dùng API production composition `main.ts`/`buildApp` với mutation fence,
  auth, service dependencies giống deployment; không chỉ register một route service fake.
- Ghi SHA/tree diff, image digest, Node/Prisma/browser/runtime/provider version,
  schema migration status, ports, base URL, mode và capability doc. Không log secret/env dump.
- Clock boundary unit tests dùng controlled clock; live test TTL ngắn do server
  hỗ trợ hoặc clock seam test riêng, không sửa máy hệ thống/skip deadline guard.
- PostgreSQL/Neo4j test namespace và synthetic provider lab độc lập; down/up dependency
  chỉ tác động resources của phiên nghiệm thu. Không dừng shared infrastructure tùy tiện.

### 7.2 Các kịch bản và điều kiện pass

| ID | Luồng chính | Failure/boundary bắt buộc | Evidence cần giữ |
|---|---|---|---|
| **E01** | Fresh multi-user login qua nginx và Vite, create engagement, invite 3 roles | Cross-origin/missing CSRF, disabled/expired session, two-owner slug collision, foreign resource | Browser trace, actual HTTP codes, DB/workspace identity mapping |
| **E02** | Soundwave planning → checkpoint question → reload → answer → 8 valid docs → handoff → approved bound execution → real filesystem marker | Blocked readiness, mismatched context, request ACK mất, duplicate click, API restart, wrong engagement | Native run/request/thread IDs, generated bytes/digest, no duplicate provider invocation |
| **E03** | Tool HITL allow và deny với request do runtime thật sinh | Timeout/default-on-timeout, stale/foreign decision, parallel graph questions (distinct from HITL) | Policy/approval/execution facets, checkpoint state, actual handler outcome |
| **E04** | Long-running local test run → cancel/estop → observe → explicit resolve | In-flight command/fence, ACK chưa terminal, runtime down, foreign thread, workspace two-engagement scope | Stop record before side effects, actual terminal/unknown status, dispatch-after-stop refused |
| **E05** | Import A/B assets → scope approve → plan v1 → revise/remove/narrow window → re-review | Self-review, stale v1 after v2, UTC/+07/DST, boundary start/end, target removed | Effective scope snapshot, preflight checks, runtime refusal/authorization mapping |
| **E06** | Schedule → close browser → worker dispatch đúng giờ → reconcile | Restart worker/API, two claimers, missed window, approval expired, stop/closure trước giờ | Durable intent, one request ID/run, blocked/missed/uncertain truthful outcome |
| **E07** | Runtime finding → import draft → upload/attach retained capture → review → remediation/retest | Foreign producer/path, tampered digest, binary/multibyte limits, stale/self-review/edit-after-confirm | Source provenance, exact bytes/hash, persisted version/history |
| **E08** | Report từ accepted findings → edit → independent review → exact-version download → manual receipt → new revision | Concurrent edit, save 409/offline giữ draft, export/download race, duplicate/different payload receipt | Download file+digest/version, DB delivery/audit, no false email/delivery claim |
| **E09** | C2 lab session → timed grant → approved bounded command → audit/reconcile; provider campaign prepare/deploy | Scope/ROE/expiry -1/0/+1, revoke in-flight, lost response, dead session, provider unavailable | Actual provider IDs/execute count, stdout+stderr/status, no duplicate dispatch |
| **E10** | Actual corpus skill/technique link → two proposals same skill → amend/propose/review → download JSON | Unique collision, stale decision, self-review, canonical drift/outage, reject then fresh proposal | Neo4j topology, DB snapshots/reviews, exact JSON base/proposed metadata |
| **E11** | Tasks/notice/search/counters update; vault store/reveal/revoke; settings policy; closure | DB source failure ≠empty, member revoke, pending library review blocks close, late reveal after switch | Correct deep link/tab, actor-scoped notices/audit, ciphertext/no plaintext artifacts, final read-only |
| **E12** | Deployed UI/API restart, preserved-data migration/cutover, 53 routes + UX/performance | Backend outage/reconnect, encoded bad IDs, base-path, slow response, old shell cache | Browser traces/screenshots, retained IDs/artifacts, asset closure + 5 timing samples |

Không dùng model để tự “xác nhận pass”. Assert trên API/DB/provider/checkpoint/file
thật; user-facing screenshot bổ sung, không thay thế assertion. Không cần model/network
target cho mọi test: DB/concurrency/proxy case dùng deterministic inputs; real model
chỉ ở kịch bản cần inference/tool output.

### 7.3 UX và performance acceptance

- Mỗi required route: real ID, absent/malformed/foreign ID, fresh session và refresh.
  Role/read-only/outage controls nêu đúng lý do, không fallback demo.
- Light/dark, representative desktop + mobile, keyboard Tab/Enter/Escape/Arrow,
  focus restore, dialog names, accessible error/loading, unsaved flow và browser history.
  Ghi rõ nếu chỉ chạy accessibility tree/axe, chưa test screen reader thật.
- Có focused failure regression cho flaky `routes.test.tsx`, `a11y-audit.test.tsx`,
  `dark-theme-audit.test.tsx`, `features/operations/write.test.tsx` khi tái hiện được;
  không coi retry pass là root cause đã sửa.
- Đo cold **authenticated** JS+CSS closure, gồm lazy chunks cần để sẵn sàng dùng;
  target **<200.000 gzip bytes** theo spec. Main chunk nhỏ không đủ kết luận.
- Năm cold interactive samples trong profile CPU/network công bố; target **<3s**.
  Ghi toàn bộ samples, API latency, readiness và quiet-window TTI riêng; không loại
  sample chậm hay chunk cần thiết. Nếu fail budget, tối ưu hoặc xin đổi budget rõ ràng.

## 8. Lệnh thực hiện, chọn test và quản lý evidence

### 8.1 Quy tắc thực hiện

Lệnh dưới đây chạy từ repo root bằng PowerShell trừ khi ghi khác. Manifests/CI là
nguồn chuẩn. Không chạy full suite mặc định; “test hoàn chỉnh” ở đây là phủ đủ các
luồng/biên đã liệt kê. Full run chỉ khi được yêu cầu hoặc được chấp thuận với lý do
shared blast radius. Không chạy các lệnh này chỉ để hoàn tất task viết tài liệu.

Trước patch: `git status --short`, đọc full intended diff và HEAD; không stage user
work. Viết regression fail trước fix, giữ semantics bảo vệ scope/ROE/HITL/egress.
New public API/subsystem phải có Proposed ADR; migration mới phải incremental.

### 8.2 Chuẩn bị dependencies và static gates

```powershell
git status --short
git log --oneline -10
# Chỉ trên install cần setup; root lockfile là authority, không dùng app-local lock.
npm ci
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server

# Chạy cho package thực sự đã đổi ở slice đó.
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
```

Schema generate không cần DB; migration cần **test DATABASE_URL đã kiểm tra**.
Node startup không tự đọc/generate/migrate chỉ vì có `.env.example`; cấu hình env
được đưa vào process theo runbook. Không ghi password/token/key vào VITE variables.

### 8.3 Focused test commands có file hiện hữu

Chọn command ứng với slice, không chạy toàn bảng như một ritual.

```powershell
# Identity, proxy và scoped reads
npm run test --workspace=@raptix/web-raptix-server -- tests/t07-auth-members.test.ts tests/runtime-context.test.ts
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=4 src/real/session-api.test.ts src/real/bootstrap.test.tsx src/real/console-seam.real.test.tsx

# Scope / governance / closure
npm run test --workspace=@raptix/web-raptix-server -- tests/t08-scope.test.ts tests/t09-governance.test.ts tests/t09-governed-lifecycle.test.ts tests/t17-closure.test.ts

# C2 / policy
npm run test --workspace=@raptix/web-raptix-server -- tests/iw09-c2.test.ts tests/t12-c2-grants.test.ts tests/t16-settings-audit.test.ts

# Campaign jobs/providers (chọn thêm owning provider suite khi thay adapter)
npm run test --workspace=@raptix/web-raptix-server -- tests/w17-campaigns.test.ts tests/iw08-campaign-job-ledger.test.ts tests/iw08-gophish-preparation.test.ts tests/iw08-gophish-deployment.test.ts

# Library / observed graph
npm run test --workspace=@raptix/web-raptix-server -- tests/t14-library-review.test.ts tests/t14-library-analysis.test.ts tests/graph-service.test.ts tests/t13-fleet.test.ts

# Findings / reports / inbox / vault (chọn domain đang thay đổi)
npm run test --workspace=@raptix/web-raptix-server -- tests/t10-findings-workflow.test.ts tests/findings-artifacts.test.ts tests/t11-reports.test.ts tests/t15-inbox.test.ts tests/w18-vault.test.ts

# Runtime/SSE browser regressions
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=4 src/real/precommit-regressions.test.tsx src/real/screens/workspace.test.tsx src/real/stream.test.tsx src/real/request-ledger.test.ts

# Route/unsaved consumers nếu thay shell/router/session
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=4 src/real/app-routing.real.test.tsx src/router/routes.test.tsx src/screens/a11y-audit.test.tsx
```

W11/W15/W18/W20 cần thêm owning tests chưa tồn tại; đặt tên theo hành vi, ghi command
thực tế vào owning ticket sau khi tạo. Không chỉ test callback mock của chính service.
W01/W05/W06/W07/W09/W17/W20/W26 bắt buộc PostgreSQL integration; `app.inject` với fake
DB không chứng minh SQL constraint/transaction/advisory lock đúng. Giữ provider mock
cho failure matrix, chạy provider thật riêng cho E09.

### 8.4 Build, migration và deployment

```powershell
# Chỉ với test database đã cấu hình, có backup nếu là upgrade fixture.
npm run prisma:migrate --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix

docker compose -f docker-compose.web-raptix.yml config --quiet
# Setup dedicated DB trước; compose không tạo DB tùy ý thay operator.
# Chọn port không trùng Juice Shop, ghi lại actual port.
$env:WEB_RAPTIX_PORT = '3001'
docker compose -f docker-compose.web-raptix.yml build
docker compose -f docker-compose.web-raptix.yml up -d --wait --wait-timeout 300
```

Đây là Web compose riêng, dùng base network/DB/runtime đã cấu hình; `.env` phải có
mode/admin/key/provider/mount đúng W27. Đừng chạy compose nếu nó sẽ thay volume hoặc
container đang dùng mà chưa kiểm tra config. Nếu đổi Compose, chạy thêm:

```powershell
uv run pytest tests/test_compose_network_isolation.py
```

Dev hai terminal (env server đặt trước từ cấu hình local riêng):

```powershell
# Terminal API
npm run dev --workspace=@raptix/web-raptix-server
# Terminal UI, sau khi W03 sửa proxy origin
$env:VITE_DATA_MODE = 'real'
$env:RAPTIX_WEB_BACKEND_URL = 'http://127.0.0.1:5280'
npm run dev --workspace=@raptix/web-raptix -- --host 127.0.0.1 --port 5273 --strictPort
```

### 8.5 Harness hiện có và điều kiện chạy lại

```powershell
node --check apps/web/tools/verify-integration-live.mjs
node --check apps/web/tools/verify-workflows-live.mjs
node --check apps/web/tools/verify-docker-real-mode.mjs
npm exec --workspace=@raptix/web-raptix -- playwright install chromium
```

- `verify-docker-real-mode.mjs`: hiện dùng env `IW05_UI_IMAGE`, `IW05_API_IMAGE`,
  `IW05_EVIDENCE_DIR`; build đúng images trước. Nó chỉ chạy degraded bootstrap.
- `verify-integration-live.mjs --start`: **đang trỏ image `20261014` đã xóa**;
  sửa W28 trước. Sau sửa, chạy start → lấy state path mới in ra → `--flow <state>`.
- `verify-workflows-live.mjs <integration-state>`: input là **integration state có
  `containers`, `volume`, `slug`**, không phải output workflow state `899a8655`.
  Current historical integration state/resources không còn; tạo run mới.
- Image/network env flags mới do W28 bổ sung là **proposed**, chưa phải flags đang
  được hỗ trợ. Không copy command giả định chúng tồn tại rồi tuyên bố reproducible.
- Các tools `verify-sliver-lab.mjs`, `verify-vault-deployed.mjs`,
  `verify-runtime-durability.mjs` là nguồn tái sử dụng; phải đọc prerequisites/old UI
  selectors trước chạy, cập nhật bounded adapter nếu đã stale.

### 8.6 Evidence format và cleanup

Mỗi work item và E-scenario ghi:

```text
work_item / owning_ticket / scenario
tested_sha + dirty_diff_or_tree_hash
UI/API/runtime/provider image digests + schema migration list
mode + topology + actual ports + actor roles (không credentials)
commands + started_at + finished_at
attempted / passed / failed / blocked + exact reason
resource IDs + expected vs observed HTTP/DB/provider/filesystem outcomes
trace/screenshot/download/digest paths (redacted)
old_evidence_reused + invalidated_claims
cleanup_targets + result + survivors
```

Output local dưới `tests/local/artifacts/`, durable summary/commands trong owning
ticket/coverage. Không commit DB dumps, session cookies, browser storageState chứa
token, plaintext vault hoặc generated dist/Prisma client làm fixtures.

Trước cleanup xác minh label/run ID/PID/command/port/worktree; mỗi stop/remove có
hard cap **5 giây** theo `apps/web/AGENTS.md`. Dọn đúng resources phiên test; không
blanket-kill Node, không docker prune/down -v. Nếu quá hạn, ghi survivor và dừng
cleanup đó, không retry vô hạn. Container và volume đã được người dùng yêu cầu xóa
không được xem là live infrastructure vẫn còn cho lần chạy sau.

## 9. Definition of Done và bàn giao

### 9.1 Gate cho từng work item

- [ ] Source defect đã có repro; regression fail trên baseline, pass với fix.
- [ ] Contract/version/authority/migration và failure behavior được ghi rõ.
- [ ] Frontend → adapter → route → service → DB/runtime/provider thực sự nối đủ.
- [ ] Direct HTTP role/scope/stale/closed/outage cases pass ở boundary đã đổi.
- [ ] Browser happy path + refusal/conflict/recovery cho UI đã đổi; dirty state không mất.
- [ ] DB/network side effects có identity, reconciliation và audit đúng contract.
- [ ] Chọn đúng static/focused suites; evidence lịch sử tái dùng có lý do, không đổi SHA giả.
- [ ] Owning ticket/coverage không còn claim mạnh hơn bằng chứng.

### 9.2 Gate “Web dùng toàn diện trong release scope đã chốt”

- [ ] W01–W28 đã đóng hoặc một mục optional có requester-approved exclusion rõ ràng;
      required item chưa làm không được đổi thành exclusion bằng banner unavailable.
- [ ] Không còn P0/P1 implementation defect trong phạm vi release; new findings được
      đưa về owning work item, không chỉ ghi “known issue” rồi tuyên bố hoàn thiện.
- [ ] E01–E12 pass trên deployed tree cuối cho các chức năng release gồm cả multi-user
      browser, PostgreSQL constraints, actual runtime và supported lab providers.
- [ ] 53 route + route-less actions có disposition đúng, detail IDs và denied states đã test.
- [ ] Clean/upgrade DB, restart, retained workspace/thread, proxy/CSRF/SSE và rollback
      đã nghiệm thu; healthcheck không thay proof của workflow.
- [ ] Performance/keyboard/themes/accessibility có số liệu và giới hạn công bố.
- [ ] Flaky failures được tái hiện/giải thích bằng evidence; không dùng repeated retry
      để tính thành một “final green” che failure.
- [ ] Final ledger ghi tested SHA/image digest/schema, scope/exclusions, provider
      evidence và cleanup; không còn “39 route chưa tích hợp” hay “LLM chưa chạy thật”
      nếu những câu đó đã bị source/evidence mới supersede.

### 9.3 Điểm bắt đầu được đề nghị

**Bắt đầu W01 + W03 + W05 bằng regression tái hiện, rồi W07/W08/W10.** Đây là nền
workspace/auth/execution correctness. Có thể sửa độc lập các lỗi nhỏ W09/W14/W16/W23
trong patch riêng sau khi review contract. Hoàn thiện Library W17→W18 và Campaign W15
trước khi chạy nghiệm thu sản phẩm; chạy hết browser để rồi gặp các phần chưa có
implementation không phải một cách thay thế cho backlog này.
