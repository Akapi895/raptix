# Implementation plan: đưa giao diện mock vào vận hành với hệ thống thật

- **Ngày:** 2026-10-16.
- **Baseline source:** `2012e69`, branch `web-improve-refactor`.
- **Trạng thái:** đề xuất triển khai; tài liệu này không thay đổi application code hoặc deployment.
- **Mục tiêu:** dùng UX vừa review ở mock để quản lý engagement và điều hành runtime thật, có persistence, recovery, quyền và audit.
- **Phạm vi:** Web UI, Fastify API, contracts, storage, runtime integration và deployment cần thiết cho các workflow bên dưới.

## 1. Kết luận và hai mốc bàn giao

**Không thể đạt mục tiêu chỉ bằng đổi `dataMode=mock` thành `real`.** Hai mode hiện
chọn hai bộ composition màn hình. Nhiều workflow thật đã có API, nhưng panel real
chưa có đầy đủ bố cục và tương tác của mock. Cần nối UX đã chốt với nguồn dữ liệu
thật, bổ sung contract còn thiếu và nghiệm thu xuyên browser/API/runtime.

| Mốc | Người dùng làm được gì | Điều kiện bàn giao |
|---|---|---|
| **M1 — dùng được luồng chính** | Đăng nhập, tạo/chọn project, lập kế hoạch, duyệt theo workflow hiện có, handoff, chat với Raptix, chạy và theo dõi tool logs bằng popup, xử lý câu hỏi/HITL, xem kết quả thật, quản lý Vault | Luồng thật qua browser; refresh/reconnect không tạo run trùng; các action chưa có contract được ghi rõ. Subagent ở mức observation chưa được gọi là full parity |
| **M2 — hệ thống hoàn chỉnh theo UX đã chốt** | M1 + editor tài liệu persistent, governance xuyên suốt, instance/subagent messaging và controls được hỗ trợ, Findings/Evidence/Reports, C2, global inventories, settings/team/audit/closure | Mọi capability bắt buộc có bằng chứng E2E; ngoại lệ phải được người dùng chấp thuận và ghi riêng. `Unavailable` đơn thuần không đóng một yêu cầu bắt buộc |

M1 là mốc dùng sớm, không thay thế M2. Việc merge branch cũng không tự chứng nhận
hai mốc này; cần theo dõi source SHA, image và evidence tương ứng.

## 2. Có thể mở gì ngay lúc này?

### 2.1 Quan sát deployment trong lượt lập plan

Đã chạy `docker ps` và GET `http://127.0.0.1:3001/api/capabilities`:

- UI đang bind `127.0.0.1:3001`; API, Postgres, Neo4j, LangGraph, LiteLLM và sandbox đang chạy.
- API trả `mode: multi-user`.
- Projects, planning, threads/runs, approvals, artifacts/findings, graphs/timeline,
  reports, members và vault báo `available: true`.
- C2 báo `available: false`, reason `provider_unavailable`.
- Port `3000` hiện do Juice Shop dùng; giữ `3001` cho console trong runbook này.

Đây là **availability probe**, không phải bằng chứng login, model inference,
tool execution, provider operations hoặc toàn bộ workflow thành công. SHA/image
của API/runtime đang chạy chưa được đối chiếu với source `2012e69` trong lượt này.

### 2.2 Mở real mode hiện có để đánh giá

```text
http://127.0.0.1:3001/?dataMode=real#/projects
```

Đăng nhập bằng tài khoản thật của deployment multi-user. Demo persona không phải
tài khoản thật. Project/dữ liệu vừa xem ở mock không tự chuyển sang real; tạo
engagement thật hoặc dùng engagement đã có quyền truy cập.

Quay lại demo bằng `?dataMode=mock`. Tham số phải ở trước `#`. Precedence trong
`apps/web/src/real/mode.ts`: query > localStorage > build default > mock; chuyển
mode reload toàn bộ providers/cache. URL real dùng được để xem implementation
hiện có, chưa đảm bảo toàn bộ UX mock đã được áp dụng.

## 3. Nguồn chuẩn và kiến trúc triển khai

### 3.1 Tài liệu liên quan

- [Integration spec, R01–R12 và D1–D6](../../apps/web/.scratch/frontend-backend-integration/spec.md).
- [Execution contract và targeted testing](../../apps/web/.scratch/frontend-backend-integration/execution.md).
- [Coverage, 18 work packages và evidence lịch sử](../../apps/web/.scratch/frontend-backend-integration/coverage.md).
- [Completion plan trước đây, W01–W28](2026-10-15-web-completion-implementation-plan.md).
- [Remaining issues/evidence backlog](web-completion-remaining-issues.md).
- [Project Workspace UI](2026-10-16-web-project-workspace-ui-implementation-plan.md).
- [Execution agent workspace](2026-10-16-web-execution-agent-workspace-implementation-plan.md),
  [Proposed ADR-0078](../adr/0078-web-execution-instance-workspace.md).
- [Quality bar](../QUALITY_BAR.md), [runtime boundaries](../architecture/runtime-boundaries.md),
  [dependency rules](../architecture/dependency-rules.md).

Các tài liệu cũ chứa baseline/path/status lịch sử. Không dùng bảng “39 route chưa
tích hợp” để kết luận hiện tại: `router/host.tsx` và `real/screens/feature-route.tsx`
đã mount nhiều real surfaces. Ngược lại, route đã mount chưa chứng minh UX/detail
resource đúng hoặc live E2E đã pass. Dùng source hiện tại và evidence có SHA.

Plan này bổ sung lộ trình vận hành, không tạo tracker cạnh tranh với 18 package.
Các mã `Oxx` dưới đây là work item trong plan, map về package hiện có. Với UX mới,
quyết định đã chốt là **AI Workspace + Execution + C2 Sessions**, inspector tool
event dạng **modal giữa màn hình**, Vault ở **Management**. Những đoạn plan/ADR cũ
gọi Execution là chat-center cần được đồng bộ ở O01.

### 3.2 Ownership

```text
React UI / feature presentation
  -> real query + command adapters (same-origin /api, scoped SSE)
  -> Fastify services / authorization / runtime and provider adapters
       -> PostgreSQL: Web workflows, ownership/request ledgers, audit, vault
       -> workspace: planning documents, produced artifacts
       -> LangGraph: threads, checkpoints, execution and interrupts
       -> Neo4j: observed knowledge / graph
       -> C2 provider: actual sessions and command outcomes
```

- Giữ bố cục/interaction của mock làm visual acceptance baseline.
- Presentation có thể dùng chung nếu view model đủ trung thực; adapter mock/real
  giữ riêng. Không đưa `DbAuthority`, `MockClock`, seed hoặc mock scheduler vào real.
- Không map toàn bộ mock `Db` thành Prisma schema; chỉ thêm storage mà workflow
  thực sự cần. Không copy runtime state thành một authority thứ hai trong browser.
- Runtime giữ quyền thực thi, RoE/egress/HITL và sandbox. Browser không tự cấp
  approval, báo stopped hay coi lời AI là bằng chứng command đã thực hiện.
- New public API/subsystem boundary phải có Proposed ADR và contract review trước code.

## 4. Ma trận phạm vi phải cover

Paths UI trong bảng nằm dưới `apps/web/src/`; service phía server nằm dưới
`apps/web/server/src/`. “Có” dưới đây là source observation, không phải live certification.

| Surface | Hiện có | Công việc để đạt UX vận hành | Owner/package |
|---|---|---|---|
| Mode, shell, nav, context | Mock/real split; sidebar global 8 mục; grouped project nav | Giữ cùng UX, real identity/permission hints, route ownership, reload/history/project isolation | UI/bootstrap; 02/03/07/18 |
| System Overview | `real/screens/overview.tsx`, scoped aggregate APIs | Tái nghiệm thu count/source/partial failures, drill-down tới record thật; không biến command audit thành live C2 count | Overview/inbox; 15 |
| Global Findings/Reports/Infrastructure | `real/screens/global-resource.tsx` còn hiện `Global source unavailable` | Cross-project inventory có authorization, filter/pagination và source freshness; Infrastructure phân biệt AI invocation, endpoint và C2 | API + UI; 06/11/12/13/15 |
| Project create/settings/team | Real create/settings/membership/session APIs | Đủ các trường workflow được duyệt; trusted identity, real roles, dirty guards, stable workspace identity | Projects/auth; 03/07/08/16 |
| Scope & ROE | `RealScopePanel`: inventory/effective scope/revisions/review | Asset-first UI như mock, thêm/sửa/review ROE đúng contract; hiển thị applied version và pending draft rõ | Scope; 08 |
| Documents/Planning | `features/documents/service.ts` ghi rõ mock-only; real Planning là cards đọc nguồn + handoff | Shared reader/source/diff UI; draft persistence, concurrency/version, publish/review và revalidation thật | Documents/runtime bridge; 04/08/09 |
| AI Workspace | `RealConversation`: root chat, real threads, SSE, interrupts, agents observation | Giữ layout chat + Agents/Context; history/drafts/recovery theo actor; context actions từ nguồn thật | Conversation; 04/05/13 |
| Instance/subagent controls | `RealExecutionAgents`/`ObservedInvocation` hiện observe-only; ADR-0078 chưa cung cấp per-instance channel | Instance identity/parent/run ownership; delivery ACK; per-instance history/questions; message/forward và controls theo capability thật | Runtime + contracts + API + UI; 05/13 |
| Execution / popup logs | Mock `AiTrace` dùng modal; `RealOperationsPanel` dùng thread/run table và checkpoint `<details>` | Real trace view model + filters/grouping + centered modal; tool inputs/outputs được redact, attribution chính xác | Events/trace; 05/06/13 |
| Preflight/schedule/stop | Governance/scheduler/cancel services đã có | Nối UX vào handlers có thật; stale version, deadlines, independent review, stop ACK/final state và restart | Governance; 08/09/17 |
| Vault | Mock mới có seed/service; real đã có `RealVaultPanel` + encrypted `VaultService` | Cùng UX, policy rõ giữa mock/real, reveal lifecycle, audit/persistence và key vận hành | Vault/auth; 07/16 |
| C2 Sessions | Real grants/console/command ledger + Sliver bridge adapter | Provider thật, grant/request/expiry, session target scope, command reconcile; session/console UI như mock | C2/provider; 12 |
| Findings & Evidence | Workspace reads + curated workflow/capture upload | Detail/claim lifecycle, producer provenance, bytes/download/integrity, no fake finding when run empty | Findings/evidence; 06/10 |
| Reports | Real editor/review/export/delivery/revisions | Cùng UX; independent review, pinned content, conflict, real downloads/manual delivery receipt | Reports; 11 |
| Assets/Library/Analysis | Observed graph, inventory, library/review projections | Preserve observed-vs-managed records, source versions, proposal review/export, real topology/coverage | Inventory/library; 08/14 |
| Notifications/search/settings/audit/closure | Real services/panels đã có | Complete useful actions, stale cache/error behavior, audit attribution và closeout blockers xuyên các workflow | 15/16/17 |

### 4.1 Khác biệt domain bắt buộc giữ

- **Project** map sang engagement ID + immutable workspace identity; không đoán từ tên/prefix.
- **Operation** dùng owned thread/run hiện có theo D2; thêm business-operation model chỉ khi có quyết định mới.
- **Planning docs/OPPLAN**, **Web business-plan approval** và **effective approved scope** là ba nguồn có vai trò riêng; readiness không cấp quyền execute.
- **AI instance**, runtime assistant graph, endpoint/host agent và C2 session không phải một entity.
- Mock có sáu persona; real membership hiện là `owner/operator/reviewer/viewer`.
  Không tự ánh xạ tên demo thành quyền server. Review vẫn phải độc lập với requester.
- Policy / human approval / execution là các facts riêng. Không đủ source thì `Unknown`.

## 5. Lộ trình triển khai theo sáu phase

Mỗi phase bàn giao một luồng review được. Trong phase, chia PR theo concern,
≤400 runtime lines và ≤10 files hoặc xin explicit exception theo quality bar.

### Phase 0 — Khóa baseline và sẵn sàng môi trường

**O01 — Reconcile scope và release baseline** · packages 01/02/18.

1. Ghi UI/API/runtime commit, image digest, config topology, schema migration state.
2. Đối chiếu `router/registry.tsx`, `router/host.tsx`, nav và feature-route trên source
   hiện tại; inventory cả page, tab, modal, header action, deep link và mutation.
3. Tách tồn đọng thành source mismatch, contract gap, configuration gap, hoặc
   evidence gap; giữ owner package và link regression/evidence cũ hợp lệ.
4. Đồng bộ wording AI Workspace/Execution/Vault trong các UI plans/changelog/ADR
   mà không thay ý nghĩa public contract. Không “reset” toàn bộ 18 package.
5. Giữ mock baseline chạy độc lập để đối chiếu layout/interaction.

**O02 — Deployment prerequisites và data durability** · 02/03/07/16/18.

- API/runtime/sandbox đọc và ghi cùng engagement workspace; kiểm tra roundtrip marker.
- PostgreSQL Web DB, runtime checkpoint/state và Neo4j có persistence đúng image hiện tại.
- Explicit Prisma generation/migration; test clean DB và upgrade DB cũ trước cutover.
- Multi-user login qua nginx `:3001`, session/CSRF và account bootstrap thật.
- Xác nhận model route thực sự inference được, không chỉ catalog có assistant.
- Vault key persistent; C2 provider được cấu hình tại phase C2. Theo dõi unavailable
  như dependency còn mở, không biến health green thành feature-complete.

**Exit:** environment manifest có SHA/digest + migration inventory + backup/restore
và basic same-origin browser login đã kiểm tra. Không cần viết lại backend sẵn có.

### Phase 1 — Đưa UX chính vào real mode; đạt M1

**O03 — Identity, scope và recovery boundaries** · 03/04/05/07.

Source cần cover: `real/identity.ts`, `real/workspace-session.ts`, `real/queries.ts`,
`real/screens/{login,workspace}.tsx`, `server/.../stream-service.ts` và auth policies.

- Selection/pending request hiện key bằng `REAL_IDENTITY.id = local`; draft mới đã
  có actor ID nhưng chưa khép cả recovery lifecycle. Chuyển sang trusted
  deployment + actor + engagement + thread/request key; xử lý legacy key có chủ đích.
- Logout/session switch dispose streams và clear incompatible state/cache/plaintext;
  late response của A không được cài state cho B. 401 và 403 giữ nghĩa riêng.
- Stream service hiện authorize lúc `open()`, chưa re-check trong publish loop.
  Freeze revoke/re-attestation policy và bổ sung enforcement khi mất membership.
- Test hai users/two browser contexts, foreign IDs, revoke giữa stream và reconnect.

**O04 — Shared UX bằng real adapters** · 03/04/05/06/13/16.

- Giữ 8 global navigation entries và project context khi drill-down.
- AI Workspace: root conversation và Agents/Context panel; execution thread chỉ
  gửi khi context/binding/governance hiện có cho phép. Planning vẫn vào Soundwave.
- Execution: operation/run selector, timeline/results và tool-event table/grouping;
  click mở **centered modal**, keyboard/Escape/focus/scroll dùng UI primitives hiện có.
- Tạo real trace projection trên snapshot/SSE/timeline; không import mock `AiTrace`
  cùng `useTraceEvents()` rồi coi nó là HTTP integration. Chỉ chia presentation
  sau khi fields/source mapping đã rõ; raw checkpoint JSON là view phụ.
- Historical checkpoint không có run attribution không được lọc/đếm như event của
  run hiện tại. Missing timestamp/agent/branch phải được thể hiện trung thực.
- Vault dùng API đã có, cùng metadata list/reveal/hide/store/revoke interaction;
  không chuyển `demoPlaintext` thành DTO real.

**O05 — Golden path M1** · 04/05/06/08/09/16/18.

Browser → create engagement → Soundwave planning/questions → valid bundle →
handoff → scope/plan review và binding theo API hiện có → preflight → execution
request ổn định → SSE/tool popup → question/HITL → terminal result → artifacts.
Thêm store/reveal/hide/revoke Vault trong project và kiểm tra audit.

**Exit M1:** một engagement lab thật qua luồng trên, có failure/refusal và refresh/
lost-ACK/reconnect không dispatch trùng. Governance hiện có vẫn được enforce dù
UX editor đầy đủ ở phase sau. Per-instance controls chưa có contract giữ disabled
và M1 không được ghi thành M2.

### Phase 2 — Scope, tài liệu và governance có persistence

**O06 — Document reader/editor xuyên Scope và Planning** · 04/08/09.

- Reader dùng actual bytes/content và source version; readable/source là hai view
  của cùng model. PDF preview/download chỉ offered khi có bytes/contract phù hợp.
- Design draft API/storage và version precondition trước implementation: opaque
  document ID, base version/digest, content type/schema, actor, validation errors,
  conflict result và audit. URL/schema mới là proposal, chưa được coi là endpoint có sẵn.
- Server resolve allowlisted owned document; không nhận arbitrary filesystem path.
- Save draft survive refresh/API restart; editing bằng hai browser tạo conflict rõ,
  giữ draft khi validation/save thất bại. Không overwrite effective applied scope.
- Publish/apply theo workflow sở hữu: review RoE qua ScopeService; tài liệu planning
  qua validation/readiness pipeline. Chốt synchronization giữa approved Web scope
  và runtime workspace trước khi bật editing; không tạo hai bản ROE cùng tự nhận authoritative.
- Khi model đang ghi document, draft của người dùng phải detect stale base. Re-evaluate
  readiness và effect lên handoff/binding theo contract đã được review.

**O07 — Governed execution và scheduling** · 08/09/17.

- Independent approve/reject, scope-version pins, approval deadlines, timezone,
  effective scope removal và no-out-of-scope runtime invocation.
- Schedule cancel hiện chỉ CAS `status`, khác reschedule/claim có `version`;
  bổ sung expected-version contract/browser precondition và stale-cancel regression.
- Verify schedule dispatcher khi đóng browser và khi worker/API restart; stable
  request ID tránh duplicate dispatch. Expired scope/plan lúc due phải bị từ chối.
- Stop project/run/workspace giữ requested/ACK/final stopped/failed/unknown;
  lệnh in-flight không khóa mất emergency lane. Resume không tự bỏ stop latch.

**Exit:** sửa và lưu một tài liệu thật, review một scope/plan revision, xác minh
runtime dùng đúng approved version; stale edits/deadlines/stop/schedule có evidence.

### Phase 3 — Hoàn thiện AI instance/subagent communication

**O08 — Instance contract và runtime support** · 01/05/13; extends ADR-0078.

Trước tiên audit runtime task/subagent middleware, execution/session recording,
public API và event emitters; tái dùng identity/control thực sự có. Không lấy
`agent=Recon` hoặc checkpoint branch key làm recipient đang sống.

Contract cần chốt trước khi code controls:

| Nhóm | Contract tối thiểu |
|---|---|
| Identity/roster | engagement/thread/run/instance/parent IDs, invocation identity, lifecycle, source, last observed time |
| Conversation | per-instance transcript và ownership, cursor/replay, actor/recipient, message ID, delivery accepted/ACK/failed/uncertain |
| Questions | interrupt/question ID, recipient/origin instance, batch answers cho parallel questions; không làm mất câu hỏi còn lại |
| Controls | available actions theo instance/state; command request ID, expected version, acceptance/observation/final outcome, scope/permission checks |
| Recovery | reconcile sau timeout/restart, terminal instance, rejected stale recipient và duplicate intent |

- Message/forward đi qua reviewed runtime path với shared engagement context và
  authorization; UI chỉ báo delivered khi có ACK tương ứng.
- Pause/cancel/retry chỉ enable nếu runtime hỗ trợ đúng instance semantics. Nếu
  pause không tồn tại, cần triển khai safe-point lifecycle được review hoặc xin
  product decision; không đổi label run-cancel thành pause-instance.
- Retry tạo attempt identity rõ; parent/run/evidence lineage không bị ghi đè.
- Giữ mechanism fan-out/admission hiện hữu, mở rộng visibility/control boundary
  cần thiết; không refactor thuật toán điều phối như phần việc kèm theo.

**O09 — Wire Agents panel và conversation** · 04/05/13.

- Nhiều instance cùng role có conversation/draft/question riêng.
- Chọn instance → đúng history/recipient/control capabilities; root vẫn là Raptix.
- Forward giữ source/target attribution; stale message/control hiển thị refusal.
- Reconnect/reload khôi phục roster/transcript/questions từ server, không lấy seed
  để lấp chỗ trống. Trace deep link mở đúng event modal.

**Exit:** live run có ít nhất hai instance được phân biệt, message và question tới
đúng recipient, control ACK/reconcile đúng scope. Contract chưa chốt là blocker
của full per-instance parity, không đóng bằng một screenshot observe-only.

### Phase 4 — Hoàn tất workflow vận hành và quản lý

**O10 — Vault hoàn chỉnh và credential usage boundary** · 07/16; runtime owner khi cần use.

- Chốt action policy: metadata read, store, reveal, revoke, runtime use. Source
  `VaultService.findEngagement()` hiện owner-only; mock dùng demo permissions rộng
  hơn cho reveal. Giữ owner-only cho đến khi có quyết định mở rộng và server tests.
- List/Query cache/log/audit không mang plaintext. Reveal local state xóa khi hide,
  revoke, project/actor/session change và unmount; ACK muộn sau revoke không làm sống lại value.
- Store/revoke và audit phải có transaction/outcome semantics rõ; verify lỗi DB
  không để “secret created but audit failed” bị báo như rollback hoàn toàn.
- Review mock parity: `ProjectDetail.vault` hiện đưa `VaultSecret[]` gồm demo value,
  query vault chưa actor-scoped và service list chưa kiểm tra membership như project
  read. Sửa tại mock boundary nếu tiếp tục dùng demo làm baseline; không copy sang real.
- Key persistence, backup và restore thử trên test DB; không rotate key ngầm sau deploy.
- **Lưu Vault chưa đồng nghĩa agent dùng được credential.** Nếu cần “Use in run”,
  design secret reference/binding + server-side resolution/delivery vào đúng execution
  backend. Plaintext không đi qua chat prompt, browser recovery storage, SSE hoặc telemetry.
  Runtime consumption cần ADR/contract và E2E riêng trước khi enable action đó.
- Phân biệt deployment secrets (model/provider tokens) với engagement Vault records;
  config server không tự biến thành item người dùng có thể reveal trong project.

**O11 — Findings/Evidence/Reports/Closure** · 06/10/11/17.

- Runtime outputs → workspace/KG source → curated finding → independent review →
  remediation/retest/resolution; AI suggestion vẫn là proposal.
- Evidence upload/link/read/download actual bytes, digest/provenance/parser-quality
  và redaction; capture integrity không phải chứng minh claim đúng.
- Report source selection → editor → review → pinned version → export bytes/digest →
  delivery receipt; edit sau approval phải có revision và stale-write conflict.
- Closure kiểm tra mọi active run/schedule/session/grant/review và report/finding
  disposition; close xong server từ chối mutation tương ứng, audit vẫn đọc được.

**O12 — C2, infrastructure, global inventories** · 06/11/12/13/15.

- Cấu hình private Sliver bridge với provider thật; container `c2-sliver` riêng
  không tự cung cấp HTTP bridge mà Web adapter cần.
- Provider inventory/session → grant request → independent approve → console command
  → durable ACK/output → expire/revoke; server rechecks target scope/time/stop.
- Timeout command → reconcile cùng request ID, không resend như intent mới.
- Infrastructure tabs có actual inventory/health/session source. Global Findings/
  Reports/Assets và search/inbox dùng authorized aggregates/pagination, giữ partial
  failure/truncation; không client-loop toàn bộ projects để giả backend global inventory.
- Campaign provider workflow được map về package 12; provider nào chưa có phải ghi
  pending hoặc xin explicit exclusion, không suy ra campaigns available nghĩa là deploy đã chạy.

**O13 — Library/Analysis/Settings/Audit** · 07/14/15/16.

- Library canonical source/revision pin, review proposal/diff/export; approved
  proposal không tự sửa skill corpus ngoài publication workflow hiện có.
- Analysis chỉ dùng observed graph/events, có no-source/unknown thay vì suy đoán.
- Team/role-aware controls, policy/retention semantics, notices/read state,
  audit actor/source/reason/filter và cross-view invalidation.
- Validate every required mock field/action: real-backed, UI-only preference,
  missing required implementation, hoặc explicit approved exclusion.

**Exit:** workflow từ kết quả thực thi tới report/closeout, Vault và provider-backed
C2 có bằng chứng thật. Global menu không còn chỉ dẫn user quay về project thay
cho inventory đã được xác định bắt buộc.

### Phase 5 — Nghiệm thu M2, merge và cutover

**O14 — Acceptance ledger và rollout** · 18 và owners của các luồng.

- Chạy ma trận §8 trên built UI/API và runtime image khớp release manifest.
- Tái dùng evidence cũ khi source/assumption còn nguyên; thay đổi boundary nào thì
  invalidate và rerun đúng selection đó. Không cộng test counts chồng lặp.
- Clean install + upgrade migration, refresh/restart/recovery, backup/restore,
  preserved-data cutover và rollback cần evidence riêng.
- Đối chiếu route/action inventory thực tế, desktop/mobile, light/dark, keyboard,
  unsaved draft/conflict và cold-load/performance budget theo integration spec.
- Merge các PR nhỏ đã review/CI xanh; baseline UI commit `2012e69` chạm 35 files
  nên review/split hoặc xin `large-diff-approved` trước merge theo repo rules.
- Rollout dùng image tag/digest pin, production build default real; retained-data
  smoke sau deploy và một release ledger liên kết mọi acceptance ID.

**Exit M2:** mọi required row trong scope matrix có owner, implementation và E2E
pass hoặc quyết định exclusion cụ thể; không còn blocker P0/P1 của luồng phát hành.

### Dependency order

```text
O01 -> O02 -> O03 -> O04 -> O05 (M1)
O01/O03 -> O06 -> O07
O03/O07 -> O08 -> O09
O03 -> O10
O06/O07 -> O11
O03/O07 + provider readiness -> O12
O03/O06 -> O13
O06..O13 -> O14 (M2)
```

Có thể làm các domain không trùng ownership song song trong tổ chức; edits tại
bootstrap/router/nav/contracts/schema cần serialized integration. Đây không phải
yêu cầu tự spawn agent hay tạo thêm tracker packages.

## 6. Hạng mục cấu hình và vận hành

| Thành phần | Cần xác nhận | Nguồn |
|---|---|---|
| UI | `VITE_DATA_MODE=real` tại build; URL override dùng để review; build identity | `real/mode.ts`, `infra/containers/web-raptix.Dockerfile` |
| Web API | `DATABASE_URL`, `WORKSPACE_PATH`, schema migrations; API host/port qua proxy | `server/src/config/env.ts`, server manifest, Compose |
| Deployment identity | `RAPTIX_WEB_DEPLOYMENT_ID` — non-secret installation identity, khớp giữa UI login và `/api/capabilities`; đổi khi thay deployment/data authority | `server/src/config/env.ts`, `http/routes/capabilities.routes.ts`, `real/screens/login.tsx` |
| Web workspace | `RAPTIX_WEB_WORKSPACE_PATH` — host bind cho workspace plane; `WEB_RUNTIME_SLUG` namespaced `/workspace` trong dedicated volume | `docker-compose.web-raptix.yml`, `docker-compose.web-runtime.yml` |
| Runtime | `LANGGRAPH_API_URL`, `RAPTIX_RUNTIME_WORKSPACE_ROOT`; assistant catalog Soundwave và execution graph; optional language/sandbox URL | `server/src/config/runtime.ts`, `services/runtime/runtime-context.ts` |
| Model/tools | Model provider/LiteLLM route thật; sandbox/tool capability availability; actual invocation smoke | Base Compose và owning runtime config |
| Identity | `RAPTIX_WEB_AUTH_MODE=multi`, bootstrap admin env, persisted memberships; Secure cookies theo HTTPS topology | `server/src/config/env.ts`, auth modules |
| Neo4j | URI/user/password hợp lệ, actual graph data/partition | GraphService và Compose |
| Vault | Persistent `VAULT_ENCRYPTION_KEY` base64 32-byte; backup key riêng; no key => unavailable | `server/src/config/env.ts`, `vault-service.ts` |
| C2 | `SLIVER_BRIDGE_URL`, `SLIVER_BRIDGE_TOKEN`, bridge/provider connectivity | `config/env.ts`, `integrations/c2/sliver-client.ts` |
| Campaigns khi được triển khai | GoPhish/Evilginx adapter config và provider proof; scope riêng của package 12 | `config/env.ts`, `campaign-service.ts` |

Deployment/provider/model secrets ở phía server; không đưa vào `VITE_*` hoặc repo.
Không ghi giá trị secrets vào manifest/evidence. Script
`apps/web/tools/configure-local-vault-key.mjs` có thể bootstrap key một lần trong
`.env` đã tồn tại; giữ key hợp lệ có sẵn, không chạy để xoay key mỗi deploy.

### 6.1 Build và rollout sau khi acceptance đạt

Các lệnh là runbook đích, **chưa chạy trong lượt viết plan**. Dùng repo root.
Trước các lệnh này phải xác nhận DB/workspace/runtime volume mapping, backup,
dedicated database tồn tại và compatibility của migrations.

```powershell
# Node >=22.12 (CI dùng Node 24); npm ci từ root khi chuẩn bị clean environment.
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server

# Migrate deploy cho đúng DATABASE_URL sau backup/review migration.
npm run prisma:migrate --workspace=@raptix/web-raptix-server

# Rebuild API theo source và UI real-default; pin tag/digest trong release manifest.
docker compose -f docker-compose.web-raptix.yml build web-raptix-api
docker compose -f docker-compose.web-raptix.yml build --build-arg VITE_DATA_MODE=real web-raptix-ui
$env:WEB_RAPTIX_PORT='3001'
docker compose -f docker-compose.web-raptix.yml up -d --wait --wait-timeout 300

Invoke-RestMethod 'http://127.0.0.1:3001/api/capabilities'
Invoke-RestMethod 'http://127.0.0.1:3001/api/health/ready'
```

API container startup cũng chạy `prisma migrate deploy` theo deployment wiring;
Node startup trực tiếp không tự generate/migrate. Không cần rebuild Python chỉ
cho presentation changes; nếu thay runtime contract ở O08 hoặc credential use ở
O10 thì build/test/pin runtime image tương ứng, không dùng nhãn `stable` làm proof
source match. Cấu hình mạng/volume phải theo cả base Compose và Web Compose.

### 6.2 Cutover và rollback

1. Backup Web DB, workspace artifacts, runtime checkpoint state, graph data cần
   giữ và vault key bằng cơ chế riêng; thử restore trên môi trường tách biệt.
2. Ghi mapping engagement/workspace/thread/run IDs trước deploy; không seed lại real.
3. Deploy forward-compatible migrations, API/runtime rồi UI version phù hợp.
4. Verify login + existing project/history + một workflow mới qua `:3001`.
5. Nếu fail, trả UI/API/runtime về known-good image theo compatibility matrix;
   không rollback schema bằng xóa volume. Restore DB chỉ theo runbook đã rehearsal.

## 7. Test selection và harness

Chỉ chạy suites chịu ảnh hưởng, theo integration execution contract. Typecheck/lint
ở packages thay đổi; build khi cần deployed artifact. CI lane thực hiện các gate
đã cấu hình; không coi local targeted run là full-suite certification.

| Concern | Existing selections để mở rộng |
|---|---|
| Shell/nav/mode | `src/shell/shell.test.tsx`, `src/real/app-routing.real.test.tsx`, `src/screens/project-detail/detail.test.tsx` |
| Identity/recovery/SSE | `src/real/screens/workspace.test.tsx`, `src/real/precommit-regressions.test.tsx`, `src/real/stream.test.tsx`; server `tests/t07-auth-members.test.ts`, `stream-service.test.ts`, `w02-run-authorization.test.ts` |
| Documents/planning | `src/real/screens/planning-panel.test.tsx`, `src/real/planning-api.test.ts`; server `tests/planning.test.ts`, `runtime-context.test.ts`; thêm draft/conflict tests tại owner mới |
| Logs/modal | `src/features/trace/trace.test.tsx`, `src/real/screens/operations-panel.test.tsx`; server `tests/stream-projection.test.ts`, `history-projection.test.ts` |
| Governance/scheduling/closure | `src/real/screens/governance-panel.test.tsx`, `closure-panel.test.tsx`; server `tests/t08-scope.test.ts`, `t09-governance.test.ts`, `t09-governed-lifecycle.test.ts`, `t18-scheduler.test.ts`, `w11-controls.test.ts`, `t17-closure.test.ts` |
| Vault | `src/features/vault/vault.test.tsx`, real settings tests; server `tests/w18-vault.test.ts`, `t16-settings-audit.test.ts`; thêm rendered real vault test |
| C2 | `src/real/screens/c2-panel.test.tsx`; server `tests/t12-c2-grants.test.ts`, `t13-c2-recovery.test.ts`, `iw09-c2.test.ts` |
| Outputs/report/library | Owning real-screen tests; server `tests/t10-findings-workflow.test.ts`, `findings-artifacts-fs.test.ts`, `t11-reports.test.ts`, `t14-library-review.test.ts`, `t14-library-analysis.test.ts` |
| Instance contract | Existing `src/features/execution/service.test.ts`, real workspace/fleet tests; bổ sung runtime/contract tests sau audit O08, không dùng mock ACK để chứng nhận runtime control |

Web test path không bắt đầu `apps/` ở bảng là tương đối với `apps/web`; server
`tests/` tương đối với `apps/web/server`. Ví dụ cho O04:

```powershell
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix -- --pool=threads --maxWorkers=2 src/real/screens/operations-panel.test.tsx src/real/screens/workspace.test.tsx src/shell/shell.test.tsx
```

Reusable harnesses: `apps/web/tools/verify-integration-live.mjs`,
`verify-workflows-live.mjs`, `verify-docker-real-mode.mjs`, `verify-vault-deployed.mjs`
và `verify-sliver-lab.mjs`. Audit/update selectors, URLs, auth, versions và config
trước khi chạy. `verify-runtime-durability.mjs` chứa legacy URLs và recreate runtime/
API/sandbox: chưa được coi là phù hợp baseline hiện tại hoặc chạy như smoke vô hại.
Harness nào chỉ kiểm tra degraded bootstrap không chứng minh model/tool/provider E2E.

## 8. Ma trận nghiệm thu end-to-end

| ID | Kịch bản bắt buộc | Bằng chứng pass |
|---|---|---|
| A01 | Mock/real isolation | Real không có seed/persona/mock writes; API down hiện failure, mock vẫn độc lập |
| A02 | Multi-user + scope | Hai browser, same-origin login, role action matrix, foreign IDs/stream denied; actor switch không recovery state/secret của user trước |
| A03 | Documents | Read/edit/save/reload/restart; malformed source và concurrent edit giữ draft; reviewed applied version đúng runtime |
| A04 | Planning/handoff | Soundwave/model/tools thật sinh bundle valid; pending question tồn tại sau reload; incomplete bundle bị chặn |
| A05 | Governed execution | Approved scope/plan binding + preflight + execution ACK; hết hạn/sai scope/timezone bị server/runtime từ chối |
| A06 | Trace popup | Tool events thật qua same-origin SSE/history, filters/groups, modal centered trên desktop/mobile; redaction và attribution đúng |
| A07 | Recovery | Mất ACK, SSE disconnect, API/runtime restart; same request reconcile không duplicate; final state đúng source |
| A08 | HITL/stop | Runtime-generated allow/deny; parallel questions; cancel ACK khác stopped; stop khi có in-flight work; không autoresume |
| A09 | Subagents | Hai instance cùng role phân biệt được; đúng recipient/question; message/control ACK và stale-recipient refusal; replay/history không đổi lineage |
| A10 | Scheduler | Chạy khi browser đóng; restart giữ intent; stale cancel/reschedule conflict; expired plan lúc due không dispatch |
| A11 | Vault | Store/reveal/hide/revoke thật, audit actor, key persistence; late ACK/logout/project switch không giữ plaintext; unauthorized request bị từ chối |
| A12 | Findings/evidence | Runtime output → curated claim; actual bytes/digest/link/download; empty run không sinh finding giả; independent review |
| A13 | Reports/closure | Review/pin/export bytes/delivery receipt; conflict/revision; close từ chối active work và chặn mutations sau close |
| A14 | C2 | Provider thật, approved grant, scoped command ACK/result, expire/revoke + in-flight boundary; lost ACK reconcile |
| A15 | Global surfaces | Authorized inventories, pagination/search/drill-down, partial source error; các count có definition/source |
| A16 | Release | Clean/upgrade deploy, preserved IDs, backup/restore/rollback; route/action matrix + dirty guards + themes/keyboard + measured performance |

Evidence mỗi ID ghi: tested SHA/tree và image digest, commands/config đã redact,
engagement/thread/run/request/instance IDs liên quan, HTTP/result/source, ảnh hoặc
artifact digest khi phù hợp, refusal/error case, và unverified gap. Raw evidence
đặt dưới `tests/local/artifacts/`; durable summaries/harness giữ trong repo.

## 9. Các quyết định cần chốt tại đầu implementation

| Quyết định | Default đề xuất cho plan | Gate |
|---|---|---|
| Deployment | Local Docker console `:3001`, multi-user như API hiện có; hai account độc lập để nghiệm thu approvals | O01/O02 |
| Document publish | Draft storage tách effective scope; review/publish theo owner, explicit version/conflict và runtime bridge | O06 contract/ADR trước endpoint mới |
| Instance parity | M1 observe + root chat; M2 cần runtime-backed per-instance messaging/control capability. Chốt semantics từng action thay vì giả ACK | O08 contract/ADR |
| Vault access/use | Giữ owner-only real policy hiện tại đến khi approve policy mới; runtime credential reference là contract riêng nếu bật “Use in run” | O10 |
| Provider/exclusions | C2 thuộc full scope thì cần provider thật; exclusion chỉ có hiệu lực khi người dùng chấp thuận rõ | O12/O14 |

Các default trên là đề xuất triển khai, không phải phê duyệt thay đổi public API
hay tự mở rộng quyền. First implementation nên bắt đầu **O01–O03**, rồi O04/O05
để bàn giao M1 sớm. M2 chỉ đóng sau khi các dependency bắt buộc được nghiệm thu.

## 10. Verification của chính tài liệu này

- Đã đọc source wiring/UI/API/services và đối chiếu trackers/manifests tại baseline nêu trên.
- Đã probe Docker running services và `/api/capabilities` qua `:3001` như §2.1.
- Chưa chạy workflow login/model/tools/provider E2E, tests ứng dụng, build, migrate
  hoặc deploy trong lượt lập plan; evidence pass từ các phiên trước giữ là lịch sử.
- Tài liệu chỉ lập phạm vi/lộ trình. Không thay đổi trạng thái completion của tracker,
  không tự commit/push hoặc mở PR.
