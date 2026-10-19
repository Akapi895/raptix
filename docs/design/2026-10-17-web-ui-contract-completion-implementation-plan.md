# Implementation plan: hoàn thiện Web UI wiring và các contract/model còn thiếu

- **Ngày:** 2026-10-17.
- **Source baseline đã đọc:** `94c58b663529aeca52400810d2283b88873650b4`, branch làm việc `web-improve-refactor`.
- **Trạng thái:** Proposed; chỉ lập kế hoạch, chưa triển khai application code, migration, deployment hoặc chạy target.
- **Người yêu cầu:** muốn hoàn thiện hai nhóm: backend đã có nhưng UI chưa nối đủ; backend contract/model chưa đủ cho Findings, Reports, AI instances và Operations lifecycle.
- **Target kiểm thử được cung cấp:** `10.129.227.140`; cấu hình chi tiết ở §10. Không có quan sát nào trong tài liệu này khẳng định IP đang reachable hoặc có lỗ hổng.

## 1. Kết quả cần bàn giao và phạm vi

### 1.1 Mục tiêu

1. Một presentation tree cho mỗi domain, dùng được ở mock và real qua feature-service ports; giữ UX đã chốt, không duy trì thêm một bộ màn hình real tương đương.
2. Nối producer findings, evidence upload/attach/content/download và Reports vào giao diện dùng chung.
3. Mở rộng Findings/Reports để lưu và phục hồi đầy đủ những thông tin hiện đang bị gate.
4. Có contract/runtime support thật cho AI instance identity, history, messaging, forwarding, questions và controls; không dùng checkpoint label làm địa chỉ gửi lệnh.
5. Có lifecycle Operations được runtime xác nhận: pause, resume, complete và step-level controls theo semantics được chốt; không đổi nhãn run cancel thành pause.
6. Có test selection rõ theo slice, acceptance tự động có thể resume, và evidence gắn đúng source/image/schema.

### 1.2 Những việc giữ lại, không xây lại

- Mock/real mode seam, same-origin transport, actor/deployment-scoped caches và recovery.
- Engagement identity, membership, request ownership ledger, planning/handoff, preflight, scope/ROE, approved plan binding và emergency-stop latch.
- Document source/draft/publish implementation của `ca05e39`; không mở lại O06 như một feature chưa có.
- Finding lifecycle và report editor/review/revision/export-delivery nền đã tồn tại.
- Runtime/KG/workspace giữ quyền sở hữu execution và producer evidence; Prisma giữ Web workflow.

### 1.3 Biên phạm vi

- Bao gồm các UI project/detail/standalone routes và route-less actions liên quan hai nhóm trên; scope theo engagement.
- Bao gồm backend/Prisma/Python runtime khi cần cho contract mới; đây là phạm vi mở rộng được yêu cầu trong plan, không còn là frontend-only migration.
- Cross-project inventories đầy đủ, triển khai provider C2/campaign mới và tự động hóa vòng đời sandbox là workstream riêng. Plan này phải bảo toàn entrypoints/rollups hiện có và ghi rõ dependency; không lấy thiếu provider làm lý do xóa chức năng đang có.
- Per-project sandbox và binding recovery là prerequisite cho live execution, không phải lý do rewrite launcher trong plan này.
- Các mục Pxx dưới đây là bước triển khai, **không phải ticket tracker mới**. Map về 18 work packages hiện có; nếu cần đổi graph ticket thì xin quyết định riêng.
- `Unavailable` là trạng thái trung gian trung thực, không phải hoàn thành một chức năng bắt buộc. Muốn loại một mục khỏi release phải có quyết định riêng ghi rõ mục, lý do và ảnh hưởng.

### 1.4 Quan hệ với kế hoạch cũ

Plan này tiếp tục kiến trúc shared screens/feature adapters của screens-unification plan. Riêng giới hạn cũ “frontend-only, gate indefinitely nếu backend chưa có” được mở rộng thành các bước backend/runtime P05–P07/P10–P11 theo yêu cầu hiện tại. Điều đó chưa tự chấp nhận một contract/ADR cụ thể hoặc miễn các invariants của integration spec. Không reset 18 tickets; bổ sung implementation/evidence vào owning work package.

## 2. Baseline source và những điểm dễ hiểu sai

Nguồn chuẩn:

- [Integration spec](../../apps/web/.scratch/frontend-backend-integration/spec.md), [execution contract](../../apps/web/.scratch/frontend-backend-integration/execution.md), [coverage](../../apps/web/.scratch/frontend-backend-integration/coverage.md).
- [Screens-unification plan](2026-10-16-web-screens-unification-implementation-plan.md), [operational plan](2026-10-16-web-mock-to-operational-system-implementation-plan.md), [M1 ledger](2026-10-16-web-operational-m1-acceptance.md).
- [ADR-0084](../adr/0084-real-service-adapter-boundary.md), [ADR-0085](../adr/0085-single-operator-planning-scope.md), [ADR-0086](../adr/0086-per-run-sandbox-workspace-isolation.md).
- [Runtime boundaries](../architecture/runtime-boundaries.md), [dependency rules](../architecture/dependency-rules.md), [quality bar](../QUALITY_BAR.md).

| Source/commit | Hiện có | Hệ quả cho kế hoạch |
|---|---|---|
| `src/router/registry.tsx`, `route-table.ts`, `host.tsx` | 55 route keys; 10 keys Findings/Evidence/Reports trong `MIGRATED_ROUTES` | Kiểm kê keys, IDs, tabs, aliases và actions; không dùng số 53/39-unintegrated từ ledger cũ |
| `93f67bf`, `477b0ab`, `e5c846a`, `4197a76` | Findings adapter, linked evidence reads, shared routes; curation panel đã xóa | Không tạo lại curation UI; producer panel còn vì dữ liệu workspace khác curated records |
| `68a92d2`, `5e87b81` | Report adapter và standalone shared screens | `RealReportsPanel` trong project detail vẫn là consumer cần thay thế |
| `src/real/service-adapter/control-gaps.ts` | Trộn gap model với gap wiring | Chỉ gỡ từng gap sau khi contract, handler, UI và acceptance tương ứng đã có |
| `features/findings/service.ts:EvidenceUploadInput` | Chỉ metadata, không có bytes | Cần mở rộng feature port trước khi nối file picker; không gửi metadata rồi báo upload thành công |
| `ArtifactsService` | Upload/capture tối đa 256 KiB; content là UTF-8 preview bị giới hạn | Upload binary đã có nhưng content hiện không tải binary nguyên bản; phải bổ sung bytes/download contract |
| `FindingsWorkflowService` | Import draft, attach artifact/digest, versioned transitions | Import chưa có request-id/dedup contract; upload + attach là hai side effects, không atomic sẵn |
| `ReportsService` | JSON/Markdown export, revision tạo record mới, manual receipt tại delivery | PDF/DOCX và acknowledgement riêng là mở rộng thật; giữ lịch sử receipt cũ đúng nghĩa |
| `DispatchMiddleware`, `core/dispatch_context.py` | `dispatch_id`, `objective_id`, `attempt`, persisted dispatch ledger | Tái sử dụng identity sau audit; không tạo identity độc lập chỉ từ tên role |
| `history-projection.ts`, `85707b8` | Checkpoint transcripts mang `runId: null` | Không backfill run/instance attribution mà nguồn không chứng minh |
| `b265755`, `c19acd7` | Run cancel, active-stop banner, schedule cancel có version CAS | Bảo toàn; generic operation resume khác graph-interrupt resume |
| `6f10abd` → `bf32017` | Fix tương thích thread cũ đã bị revert | Không tính đã khép recovery sau đổi sandbox; `c703733`/`7386504` chỉ làm timeline chịu được stale binding |

Những kết quả test/deploy cũ là evidence lịch sử của tree đã ghi, không chứng nhận tree triển khai tương lai. Trước mỗi phase, so diff từ baseline và cập nhật đúng phần đã thay đổi.

## 3. Kiến trúc và authority bắt buộc

```text
Shared feature screens / project panels
  -> useFeatureServices() + scoped Query keys
  -> mock handlers OR real feature adapters
  -> browser transport /api (JSON + bytes + scoped SSE)
  -> Fastify routes -> authorization -> services/repositories
       -> PostgreSQL: curated workflow, revisions, references, audit, intents
       -> owned workspace: retained bytes, producer documents/artifacts
       -> runtime public HTTP: execution, instances, checkpoints, command outcomes
       -> Neo4j/corpus and provider adapters: existing read/execution authorities
```

| Dữ liệu/hành vi | Authority | Quy tắc |
|---|---|---|
| Browser UI state | Zustand/local component state | Không lưu authoritative operation/instance state ở browser |
| Curated finding, comments, retests, report composition | Web DB/services | Version/CAS, permission và audit tại server; không chỉ disable nút |
| Runtime-produced finding | Workspace/KG producer | Import tạo draft và lưu provenance; không sửa file producer để đổi trạng thái curated |
| Evidence bytes | Owned retained storage | Hash từ original bytes; preview/redaction là derivative có identity riêng |
| Report approved content | Immutable report revision snapshot | Finding/template thay đổi sau đó không âm thầm thay bytes đã duyệt |
| Instance/run/step execution | Runtime | Web có projection/intent ledger, không tự cấp execution success |
| C2 command/session | Provider + server command ledger | Connected khác granted; expiry, target scope và stop checks giữ nguyên |

Browser không import Prisma, filesystem hoặc Python runtime. Apps gọi public runtime HTTP; plugin/SDK không import runtime internals. Không đưa `DbAuthority`, seed, `MockClock` hoặc scheduler demo vào real adapters.

Giữ cache/recovery theo deployment + trusted actor + engagement + resource/filter. Mutations capture scope/version một lần; late ACK không đổi scope hoặc khôi phục dữ liệu actor cũ. Truyền abort signal qua adapters/transport đối với reads bị supersede.

## 4. Quyết định contract phải chốt trước slice liên quan

Các lựa chọn dưới đây là đề xuất thực hiện, chưa phải endpoint/schema đang tồn tại. Ghi Proposed ADR trước public API/subsystem boundary mới; rà trạng thái ADR-0084/0085 với owner. Những thay đổi safety-critical phải tuân root contribution rules và threat model tương ứng.

| ID | Đề xuất mặc định | Điều kiện chốt/owner |
|---|---|---|
| D01 Evidence identity/bytes | Opaque capture ID + metadata và immutable digest/size; artifact path chỉ là source reference | **Requester decision 2026-10-17:** capture mới là `unclassified` đến khi owner/reviewer quyết định; original bytes bị chặn khi unclassified; standard cho mọi engagement member; sensitive chỉ owner/reviewer. Server enforce trước preview/download/attach. Legacy workspace files không có capture classification không được nâng thành verified/sensitive=false. |
| D02 Finding workflow | Persist `returned` thành trạng thái riêng với decision/comment/version history; draft không đồng nghĩa returned | **Requester decision 2026-10-17:** giữ `returned` khi author sửa, chỉ về review khi resubmit. Resolve chỉ qua retest ở trạng thái `retest`, kết quả `Resolved` + ghi chú + ít nhất một retained capture đã phân loại và server kiểm tra quyền/integrity; chặn transition resolve trực tiếp. Nội dung/evidence đổi invalidates confirmation; comments không đổi status. ADR-0088 pin records, versions và pagination. |
| D03 Suggestions | Producer findings là source read model; queue state/dismiss/import là Web workflow, import luôn draft | **Requester decision 2026-10-17:** một curated draft cho mỗi `(engagementId, producerRef)`; cùng path/hash replay, bytes đổi conflict. Dismissal persist tại server **per actor/source path**; reload/bytes đổi không tự restore. Restore explicit; imported state theo curated record chung. |
| D04 Report snapshots | Versioned template + reporting period + reviewer assignment + exact selected finding versions/content/evidence snapshot; named reviewer không cấp quyền | **Requester decision 2026-10-17:** các trường template/period/reviewer/selected findings được lưu cùng snapshot; readiness và role/independence vẫn server-side. P06 chốt reportable statuses, approval invalidation và khi finding/template đổi. |
| D05 Export/acknowledgement | Server-side PDF/DOCX từ cùng snapshot; export, delivery, acknowledgement là ba facts riêng | Chốt renderer/dependency, font/container support, actor được ghi receipt và migration legacy trước P07 |
| D06 Instance identity/control | Dùng dispatch/attempt làm nền; runtime-owned durable roster/inbox/outcome, không chỉ map handle in-memory | Runtime owner audit dispatch/subgraph/checkpointer; chốt recipient lifetime, delivery ACK, retry/reassign semantics trước P10 |
| D07 Operations lifecycle | Giữ engagement/thread/run mapping D2; pause cooperative safe-point; completion là audited bookkeeping sau terminal runtime state | Runtime/mission owner chốt resume/checkpoint semantics, completion prerequisites và step identity trước P11 |
| D08 Scope migration UI | Một shared presentation/domain, real DTO projection có missing/capability fields rõ | Frontend owner chốt route/panel parity và các field cần mở rộng feature port; không ép DTO vào mock data |

**Cách xử lý chưa quyết định:** giữ slice đó `blocked`, tiếp tục slice độc lập. Không coi toàn bộ plan blocked và cũng không coi control bị gate là complete. Nếu runtime hiện hữu không hỗ trợ D06/D07, triển khai extension sau ADR hoặc xin exclusion có tên; không thay semantics âm thầm.

## 5. Hợp đồng và lưu trữ dự kiến

### 5.1 API hiện có cần tận dụng

Prefix `E` trong bảng là `/api/engagements/:id`.

| API hiện có | Dùng cho | Chỗ phải sửa adapter/port |
|---|---|---|
| `GET E/findings`, `GET E/artifacts`, `GET E/artifacts/content?path=...` | Producer reads, metadata, bounded text preview | Resolve ID/path từ source thực; giữ warning/truncated; không tạo file path từ opaque evidence ID |
| `POST E/curated-findings/import` | Import producer thành draft | `importSuggestion` resolve producer metadata + source ref; không truyền mock suggestion ID như artifact path |
| `POST E/artifacts/captures` | Upload bytes base64 | Feature input phải mang bytes; giữ giới hạn 1–262144 bytes và mapping media type hiện tại đến khi có contract mới |
| `POST E/curated-findings/:findingId/evidence` | Attach artifact/digest | Map opaque selected ref sang source do server xác minh; artifact hash do server tính |
| `GET/POST/PATCH E/report-records...`, `/review`, `/revision` | Report lifecycle | Dùng version người dùng đã đọc; không fetch latest ngay trước write/approve để né stale conflict |
| `GET E/report-records/:reportId/export`, `POST .../deliveries` | JSON/Markdown bytes và audited delivery | Giữ read-only download cho viewer theo policy; stable request ID cho retry uncertain |
| Existing threads/runs/resume/cancel/events, plans/preflight/estops | Runtime/governance | Reuse ledger, scope và stop gates; không thêm đường bypass cho controls mới |

Registration và availability vẫn tùy deployment. Capability ở mức family hiện có không chứng nhận action mới; bổ sung feature/action capability có version khi contract mới cần, duy trì tương thích consumers cũ.

### 5.2 Contract extensions cần thiết

Thiết kế DTO/validators trong `apps/shared/web-contracts/src/` trước cả hai consumer. Chốt phương thức/URL trong ADR của slice; bảng sau là **resource/operation dự kiến**, không phải danh sách endpoint đã tồn tại.

| Resource/operation mới | Contract tối thiểu |
|---|---|
| Capture metadata + bytes/download | Opaque ID, engagement, size, digest algorithm/value, media type, filename, sensitivity, producer ref; original/preview distinction; full-vs-truncated; authorization; error envelope trước khi stream bytes |
| Finding comments/history/retest | IDs, actor, timestamp, content/result, findingVersion, expectedVersion, reason, bounded pagination/cursor; append-only history |
| Finding references/suggestions | Typed asset/thread/run/technique/report refs; source identity/revision/digest; dismissed/imported state; import idempotency |
| Report options/templates/readiness | Versioned template, period, reviewer assignment, eligible findings, pin versions, per-check pass/fail/unavailable và source versions |
| Report export jobs/acknowledgement | Request ID, payload fingerprint, reportRevisionId/version, format, status, artifact ID/digest; delivery ID và separate acknowledgement actor/time/receipt |
| Instance roster/history/messages/control | Engagement/thread/run/dispatch/instance/parent/attempt IDs; cursor/sequence; supported actions; accepted/delivered/handled distinction; command outcome và version |
| Operation/step controls | Thread/run/step refs, request ID, expected revision, action/reason, accepted/observed/final states, checkpoint reference, refused/uncertain detail |

Mọi timestamp dùng ISO UTC trên wire, timezone dùng khi hiển thị/evaluate window. Unknown enum/status phải giữ unknown hoặc trả validation error, không mặc định success. Wire validators kiểm tra nested ownership/IDs, size bounds và pagination.

### 5.3 Migration strategy theo domain

- **Findings:** mở rộng versioned `FindingRecord.body` cho detail/impact/recommendation/severity rationale/scope note; thêm typed relations cho asset/owned thread/run/technique. Comments, workflow decisions, retests và suggestion dispositions cần persisted records có IDs/indexes, không nhét vào free-text audit. Tên model cuối chốt trong ADR; audit và mutation cùng transaction khi cùng DB.
- **Evidence:** giữ `EvidenceLink` cũ đọc được; bổ sung retained capture metadata/identity để upload độc lập có thể list/attach lại và phục hồi partial failure. Chốt snapshot/immutability khi source artifact còn mutable. Digest-only refs cũ vẫn external/unverified, không tự nâng thành verified.
- **Reports:** thêm template revision, reviewer assignment, period, finding snapshots/relations, report revision lineage và acknowledgement. Giữ `ReportRecord`/`ReportDelivery` identities; một revision hiện tạo record mới nên cần explicit parent/root reference, không suy từ title.
- **Runtime:** roster/messages/control outcomes là runtime checkpoint/store authority. Web chỉ persist ownership/command intent và projection cần thiết; không copy toàn bộ child graph state vào Prisma. Legacy checkpoint thiếu attribution tiếp tục hiển thị history/unknown.
- Additive migration trước; backfill có nguồn chứng minh; không tạo fake actors/producer IDs/sensitivity/acknowledgement cho dữ liệu cũ. Contract và app hiểu schema mới trước khi dọn field cũ.

## 6. Lộ trình triển khai theo vertical slices

Mỗi Pxx có thể gồm nhiều PR nhỏ, mỗi PR một concern, ≤400 runtime lines và ≤10 files hoặc explicit approved exception. Packaging/dependency changes tách khỏi feature behavior. Không xóa màn hình cũ trước khi shared entrypoints đã đạt parity của slice.

### P00 — Khóa inventory, contracts và acceptance baseline

- **Owner:** packages 01/02/03/18; không phụ thuộc feature mới.
- Chụp HEAD/tree, dirty files, UI/API/runtime image digest/revision, schema ledger và capabilities. Không sửa user work.
- Inventory 55 keys + project tabs/modals/header actions, chỉ rõ real/shared/mock-only và owning port. Phân biệt UI gap, API gap, deployment gap, evidence gap.
- Chốt D01–D08 theo frontier; không cần chờ D06 để làm Evidence. Update coverage hiện có theo bằng chứng, không đổi lịch sử test thành kết quả mới.
- **Test:** docs-only: links/diff/inventory; không unit test, build, Docker rebuild hoặc target request. Với baseline lỗi thực tế chỉ chạy suite/probe tái hiện liên quan.
- **Exit:** feature/action mapping và test selection cho PR đầu; không còn coi mọi control-gap entry là backend chưa có.

### P01 — Hoàn thiện feature ports và real transport cần thiết

- **Owner:** 03/06/10/11; phụ thuộc P00 và D01/D08 phần liên quan.
- `FeatureServices` chỉ mở rộng domain đang migrate, không thêm toàn bộ `ConsoleServices` một lần. Giữ `useServices()`/`useDb()` mock-only.
- Mở rộng evidence upload input có bytes và filename/media type; caller dùng `File.arrayBuffer()`. DTO wire vẫn base64 theo API hiện có. Mock handler nhận cùng input nhưng không giả digest thật khi không lưu bytes.
- Thêm narrow bytes transport cạnh JSON transport: cookie/session, abort/timeout, error envelope, no SPA fallback, size limits và response identity checks. Không dùng `apiFetch` JSON để parse binary.
- Read/write DTO giữ numeric versions/source refs; UI không biến display date/string thành concurrency token. Report mutation phải capture version được render, không lấy latest để ghi đè draft cũ.
- **Test:** port/adapters có meaningful boundary tests: malformed scope, binary byte identity, stale version, abort và actor-switch late ACK; existing affected mock consumers. Không cần LLM hoặc IP.
- **Exit:** ports diễn tả được bytes, provenance, action gaps và expectedVersion mà không chạm mock authority trong real.

### P02 — Producer findings → shared suggestion/import flow

- **Owner:** 06/10; phụ thuộc P01 và D03.
- Tạo producer read model qua `fetchFindings`/artifact refs; UI phân biệt producer claim, curated draft và confirmed finding. AI tab dùng source thực, không seed queue.
- Nối `importSuggestion` vào existing import route; preserve title/severity/detail và producer ref từ record đã đọc. Source unavailable/missing/oversized/malformed phải hiện rõ; không báo empty giả.
- Bổ sung durable idempotency cho import theo D03: unique producer path, persist source SHA-256, cùng path/hash trả draft hiện có; changed bytes trả conflict. Timeout retry phải reconcile cùng source identity, không POST để tạo duplicate.
- Import thành công mở đúng curated draft; chỉ sau ACK mới invalidate producer/curated counts. Giữ producer panel cho đến khi shared UI đã cover đầy đủ dữ liệu của nó.
- **Test:** import draft, duplicate click/lost ACK, producer thay đổi revision, foreign engagement và empty runtime outputs. Live browser dùng produced artifact từ dedicated run; một file informational marker không được ghi là vulnerability.
- **Exit:** một output runtime thật import thành đúng một draft; reload vẫn có provenance; không tự confirmed.

### P03 — Evidence upload + attach có recovery

- **Owner:** 06/10; phụ thuộc P01, D01/D02; có thể triển khai độc lập P02.
- File picker chuyển bytes vào feature service → existing upload route → capture descriptor → attach route. Existing metadata-only form phải đổi, không chỉ un-gate button.
- Hai request là hai side effects: persist/hiển thị retained capture descriptor và attach state. Nếu upload đã xong nhưng attach lỗi, giữ capture để retry attach, không báo rollback toàn bộ hoặc upload lại mỗi lần.
- Thêm idempotency/duplicate-link policy và server version check cho attach theo reviewed finding version. Sửa evidence của finding đã confirmed phải invalidate approval theo D02, có audit trong DB transaction.
- List evidence phải cover linked và retained-but-unlinked captures theo contract; sensitivity, producer và scope checks do server quyết định. Không tin tên file hoặc media type từ browser để cấp quyền/render active content.
- **Test:** 0 byte, 1 byte, 262144 bytes, over-limit, binary, wrong digest, foreign finding/capture, stale attach, failed second request và same-intent retry. Test thật qua API/browser + refresh; không cần target IP cho file-upload cases.
- **Exit:** một capture được lưu/attach đúng một lần hoặc có trạng thái partial có thể phục hồi; bytes và digest có thể truy xuất kiểm tra ở P04.

### P04 — Evidence original bytes, preview/download và integrity

- **Owner:** 06/10; phụ thuộc P03 và retained-byte contract D01.
- Thêm metadata/bytes endpoint qua artifact service hoặc evidence facade đã review. Giữ workspace realpath/allowlist/symlink containment; server resolve opaque ID trong owned engagement trước khi mở file.
- Existing `/artifacts/content` chỉ dùng text preview có `truncated`; không dùng nó làm original download. Full download trả exact retained bytes, đúng content type/disposition và digest/version của bản được phục vụ.
- Preview text/JSON escaped; image/renderable formats theo allowlist; HTML/SVG hoặc nội dung active không chạy inline. Preview redacted có digest/identity riêng, không so với original rồi báo original verified.
- UI WebCrypto so original bytes với expected retained digest, hiển thị verified/mismatch/unverified/unavailable. Hash truncated preview không chứng nhận full capture. Hash match chỉ nói capture integrity, không nói finding đúng.
- Blob URLs revoke khi đổi evidence/project/actor/unmount; late reads không khôi phục preview đã mất quyền. Digest-only external reference không có bytes thì không bịa preview/download.
- **Test:** text đa byte, binary byte-for-byte, truncation, tampered source, missing file, permission loss, traversal/symlink và interrupted download. Browser kiểm tra file tải thật và digest, không chỉ click handler.
- **Exit:** upload → attach → inspect → download cùng bytes/digest, và mismatch/refusal path quan sát được.

### P05 — Findings model/lifecycle đầy đủ

- **Owner:** 07/10, phối hợp 08/09/14 cho references; phụ thuộc P02/P03, D02/D03.
- Mở rộng persisted body/DTO/form cho impact, recommendation, severity rationale, scope note. Legacy records thiếu field hiển thị chưa ghi nhận, không tự điền demo.
- Persist comments, review/change history, transition notes và retest observations trong records riêng; event có actor/time/version/evidence refs. Activity endpoint/page cursors pin finding version; audit projection không thay thế record nghiệp vụ.
- Link assets bằng managed asset identity, execution bằng owned thread/run/binding, techniques bằng canonical corpus identity. Cross-project refs trả refusal; không tạo fake operation ID để lấp field.
- Persist dismissal per actor/source path theo D03; re-read/bytes đổi không tự restore dismissal; Restore là mutation versioned; imported source bị curated producer identity loại khỏi queue.
- **Requester decision 2026-10-17:** chỉ một recorded retest result `Resolved` ở status `retest`, cùng note và ít nhất một classified retained capture được resolve/access/integrity-checked phía server, mới đưa status sang `resolved`; direct `retest -> resolved` bị từ chối. `Persists`/`Partial` ở eligible post-confirmation stage đưa finding về remediation.
- Content/evidence edit invalidates confirmation; bốn-mắt review bắt buộc actor khác latest content/evidence editor. Edit-and-submit lưu content, version, review event và audit trong một transaction. Report snapshots cũ remain immutable.
- **Test:** four-eyes, role/direct HTTP bypass, edit-vs-review race, stale versions, foreign refs, closed engagement, retry duplicate comment/retest và migration legacy. Live browser đủ vòng draft → review → confirmed → remediation → retest → resolved, kèm một refusal.
- **Exit:** các field/actions Findings trong yêu cầu đều persist qua refresh/API restart; source claim và curated conclusion vẫn phân biệt.

### P06 — Report composition, options và review readiness

- **Owner:** 10/11/07; phụ thuộc P05 và D04.
- Persist template definitions/revisions, period, named reviewer assignment, finding selection và report revision lineage. Template scope/management role chốt D04; không lấy demo USERS/TEMPLATES làm authority.
- Only confirmed-or-later findings theo policy được chọn; pin exact versions/content/evidence references thành report snapshot. Findings page `inReports` và report editor đọc cùng relation authority.
- Readiness computed server-side: scope/source versions, selected findings reportability, evidence availability/integrity, required template sections, reviewer eligibility/independence. Missing source là unavailable/fail, không mặc định pass; recheck khi submit/approve/deliver.
- Named reviewer assignment không bypass membership/four-eyes. Một reviewer bị revoke hoặc finding đổi trước snapshot/approval phải có conflict/re-evaluation rõ. Approved snapshots cũ immutable; template/finding edits tạo revision mới nếu muốn phản ánh vào report.
- Existing Report adapter có chỗ re-read latest trước write/decision: đổi sang explicit expectedVersion từ bản người dùng đang xem. Hai editor không được ghi đè nhau nhờ đọc latest lén.
- **Test:** foreign/unconfirmed finding refused, version pin, stale section save/review, reviewer revoke/self-review, template revision, source unavailable và legacy migration. Live hai browser sửa/duyệt; approved content không drift khi finding đổi.
- **Exit:** report từ template + findings thật, readiness và review version có authority tại server.

### P07 — PDF/DOCX export, delivery và acknowledgement riêng

- **Owner:** 11/18; phụ thuộc P06 và D05.
- Chọn renderer nhỏ nhất phù hợp server/container, Unicode/font/page-break và DOCX structure; manifest/container changes thành PR supply-chain riêng. Reuse approved snapshot, không render từ live editor state.
- Mở rộng export formats sau khi renderer có thật. Artifact ID/version/digest trỏ exact binary bytes; nếu async dùng durable job với bounded work, retry/reconcile và cùng request ID. Không giả PDF bằng đổi extension Markdown.
- UI download thực, giữ JSON/Markdown hiện có và read-only viewer export theo policy. Render failure/timeout có trạng thái failed/uncertain, không tạo completed delivery.
- Tách export → delivery record → recipient acknowledgement. Legacy manual delivery receipt giữ nguồn/actor cũ; không backfill thành recipient đã tự xác nhận. Chốt ai ghi acknowledgement và dữ liệu chứng minh receipt ở D05.
- Ack append đúng delivery/version, idempotent, không sửa approved report; closure tiêu thụ prerequisite đã review, không tự thay mọi historical delivery thành chưa hoàn tất.
- **Test:** parse mở được PDF/DOCX và đối chiếu nội dung snapshot/Unicode; digest binary; stale/replayed request; failed renderer; viewer rights; duplicate/foreign ack; legacy receipt. Browser tải file thật. Không cần model hoặc IP cho render tests.
- **Exit:** hai format mở được, export/delivery/ack là ba facts đọc lại được sau restart.

### P08 — Khép shared Findings/Evidence/Reports tại mọi entrypoint

- **Owner:** 02/06/10/11/18; phụ thuộc P04/P05/P06; P07 cần trước khi gọi Reports full parity.
- Project detail, standalone list/detail/new/review/preview và deep links dùng cùng presentation + adapters. Embedded mode chỉ đổi layout/navigation, không tạo service/state authority khác.
- Thay `RealReportsPanel`/editor cũ khi shared flow cover các action hiện có: revision, JSON/Markdown download, delivery/recovery/history và permissions. Nối producer findings vào shared source tab trước khi xóa `RealFindingsPanel`.
- Gỡ từng `REAL_CONTROL_GAPS` entry có acceptance; cập nhật route-table/host, query keys và feature test harness. Xóa dead imports/screens/tests sau khi unique workflow đã có replacement.
- **Test:** project tabs ↔ standalone round-trip, bad/foreign IDs, history/refresh, dirty save/discard/cancel, two-form dirty state, scope-switch late replies và no mock seed. Kiểm tra theme/keyboard/viewport trên các màn hình đã thay.
- **Exit:** không còn parallel real implementation cho ba domain; project và standalone nhìn cùng records/version/actions.

### P09 — Assets/Library và administrative UI dùng chung

- **Owner:** 03/07/08/14/15/16/17; phụ thuộc P01/D08, không cần chờ instance runtime.
- Tách các domain thành PR riêng: Assets/Scope → Library/Analysis → Team/Settings → Vault/Audit/Notices → Closure; chỉ migrate port của domain đang làm.
- Assets giữ managed-vs-observed provenance, pending/in/out scope và effective approved revision. Library giữ corpus read-only + proposal review/export-to-git, không biến approved Web proposal thành runtime skill publication.
- Team lấy persisted membership và role actions; không dùng demo personas. Settings/Vault/Audit giữ origin/CSRF, actor attribution, reveal/hide/revoke lifecycle; không đưa plaintext vào list/query/recovery/log.
- Closure giữ source-aware checklist qua findings/reports/schedules/instances/stop outcomes; unknown nguồn thực thi không thành pass.
- AI Workspace/Planning, documents, governance/preflight/schedule, copilot và header actions cũng có shared presentation/typed ports theo từng slice; bảo toàn implementation đã có, không chỉ migrate những route có trong sidebar.
- **Test:** named affected feature + real-panel suites trước/sau swap; thật API/browser cho action đã chuyển. Vault reveal ACK muộn, closure blocked và scope invalidation là tests bắt buộc khi consumer đó đổi. Không rerun target cho đổi labels/embedded layout.
- **Exit:** parity checklist của từng domain không còn unique action ở real panel cũ; có disposition rõ cho fields backend không có.

### P10 — Runtime instance identity, inbox/history và controls

- **Owner:** 01/04/05/13 + Python runtime; phụ thuộc D06/P00, triển khai song song P05–P09 được nếu shared contracts serialized.
- **P10a audit/design:** đọc `middleware/dispatch.py`, `core/dispatch_context.py`, `core/subagent_streaming.py`, transcript reducer, task schema, checkpointer, event log và native runtime APIs. Phân biệt bounded capability worker với subagent graph invocation; không coi `execution/workers/runner.py` là mọi subagent.
- **P10b runtime authority:** expose durable roster từ dispatch/attempt + parent/run binding. Thêm stable instance ID/cursor và supported-actions; không tạo parent/run cho legacy events thiếu nguồn. Internal dispatch ledger có sẵn không tự đồng nghĩa public control API.
- **P10c messaging:** runtime-owned durable inbox/outbox theo recipient; validate engagement/run/lifetime. `accepted` chỉ là durable enqueue; `delivered` là recipient ACK, `handled` có outcome riêng. Safe-point drain/replay, bounded message size, ordered sequence, dedup theo message ID; crash/restart không gửi hai lần tác vụ không idempotent.
- **P10d controls:** cancel có final observation riêng; retry tạo attempt mới giữ lineage, reassign qua orchestrator admission tạo replacement attempt chứ không sửa role của running graph. Terminal/stale recipient refused; timeout uncertain có reconcile. Giữ admission ceilings, ROE/HITL/egress, sandbox/run config cho child tools.
- **P10e browser/API:** public runtime HTTP → Fastify ownership facade → shared Agents/Fanout/Branch/Chat panels. Questions pin đúng interrupt/instance, giữ batch answers cho parallel questions; root conversation không lẫn child transcript.
- **Test:** runtime boundary/checkpoint tests với deterministic child graphs trước; hai instance cùng role, sibling message isolation, duplicate/lost ACK, cancellation race, parent stop, runtime restart. Sau đó live model/tool run có hai distinct instances và evidence ACK/outcome; không dùng screenshot observe-only làm pass messaging.
- **Exit:** identity/history/message/forward/retry/reassign/cancel/recovery đúng instance và scope. Nếu audit chưa tìm được safe delivery boundary thì phần implementation này blocked, không thay bằng in-memory queue rồi gọi durable.

### P11 — Operations lifecycle và step controls tại runtime

- **Owner:** 05/08/09/13/17 + runtime mission; phụ thuộc D07 và P10 identities phần step/instance cần dùng.
- Keep operation view theo owned execution thread/run và binding hiện có. Nếu cần persisted business-operation mới vượt D2 thì ghi ADR/owner decision trước schema; không lén map mock Operation thành bảng mới.
- Implement cooperative pause safe point và durable pause intent/checkpoint. Run/tool đang in-flight có thể còn work: UI giữ `pause_requested` cho tới runtime xác nhận; timeout/unsupported backend không được báo paused.
- Resume đọc authoritative paused checkpoint và recheck membership, scope version, plan expiry, preflight, stop latch, closure, sandbox context. Resume tiếp tục đúng attempt lineage; không gửi lại nguyên prompt như một fresh operation.
- Complete là audited closure của operation/binding sau khi runtime terminal, child attempts/tools đã reconcile, pending questions/approvals và outcomes đã được disposition. Không đổi `rawStatus` của failed run thành success hoặc tự terminate C2 sessions.
- Step review/approve/return/skip chỉ theo step identity/revision/runtime support đã review. Policy/HITL approval không đồng nghĩa step executed; approve không tự tạo success, và skip không bypass mandatory gate.
- Interactions: emergency stop thắng resume; plan/scope expire khi paused chặn resume; concurrent pause/cancel/complete dùng CAS; recovery sau restart không chạy tiếp tự động. Existing graph-question resume giữ riêng endpoint semantics.
- **Test:** safe-point/in-flight boundary, paused restart, stale token/version, double resume, question-vs-pause distinction, terminal failure, child still running, stop race, approval expiry deadline−1/0/+1. Live run với tool bounded đủ dài để quan sát request→ACK→pause, rồi resume checkpoint không duplicate side effect.
- **Exit:** từng action có runtime-observed outcome, direct HTTP refusal và browser recovery. Backend chưa hỗ trợ step nào giữ unsupported có tên, không certify lifecycle full parity.

### P12 — C2 và Operations presentation migration

- **Owner:** 09/12/13; phụ thuộc P01/D08; lifecycle controls chỉ enable sau P11.
- Refactor direct `services.authority`/`services.clock` calls trong `screens/h-session.tsx`, `screens/c-console.tsx` vào feature ports trước khi cắm real adapter. Mock-only timers vẫn ở mock provider.
- C2 adapter dùng provider sessions + grants + durable command ledger; transcript là observed command outputs, không tự bịa interactive terminal stream. Giữ request IDs/reconcile, grants expiry, ROE target checks và provider-unavailable state.
- Campaign listener/profile/generate/deploy actions hiện có phải có shared placement hoặc explicit retained route trong quá trình chuyển; không xóa chỉ vì mock không có section campaigns.
- Operations/Results/Trace/Fleet dùng runtime status và true source attribution; tool modal giữ centered/keyboard behavior. New instance/lifecycle actions hiển thị từ action capability runtime, không từ tên status demo.
- **Test:** affected C2/Operations/Results/Trace/Fleet suites và mock isolation; API/provider contract tests cho mapping đổi. Live C2 round-trip cần lab provider riêng; IP target không tự tạo Sliver session. Provider missing thì refusal đạt, provider success acceptance vẫn blocked.
- **Exit:** shared presentation cho C2/Operations, unique actions được bảo toàn; không giữ real panel cũ làm đường vòng để tuyên bố migration xong.

### P13 — Final integration, cleanup và acceptance ledger

- **Owner:** 18 cùng owning packages; phụ thuộc P02–P12 theo required scope.
- Reconcile 55-key inventory + tabs/actions với source thực tế nếu registry đã đổi. Mọi required control là implemented+verified hoặc còn open; exclusion phải được requester ghi nhận riêng.
- Build UI/API/runtime cần dùng, gắn source revision + tree digest + image IDs; apply migrations trên dedicated DB; kiểm tra retained data và rollback theo §11.
- Chạy các acceptance còn thiếu/invalidated ở §9–§10, không rerun full suite chỉ vì final milestone. Bảo toàn evidence cũ nếu inputs/source không đổi, ghi rõ SHA cũ.
- Dọn deprecated panels/contracts/gates sau successful shared flows; update tracker/docs và operator runbook. Không commit test outputs/generated clients/artifacts.
- **Exit:** §12 đủ evidence; không còn claim mạnh hơn test/deployment thực tế.

## 7. Dependency map và mốc bàn giao

```text
P00 -> P01 -> P02 (producer import)
           -> P03 -> P04 (evidence bytes)
P02 + P03 -> P05 -> P06 -> P07 (report formats/ack)
P04 + P05 + P06 (+ P07 để full parity) -> P08
P01 + D08 -> P09 (mỗi domain một slice)
P00 + D06 -> P10; D07 + identity cần thiết ở P10 -> P11
P01 + D08 + P11 cho lifecycle actions -> P12
Required P02..P12 -> P13
```

- **M-A: UI tận dụng backend hiện có:** P01–P04 và report/project entrypoint swap có thể làm sớm với field gaps vẫn có tên; không đợi full instance runtime.
- **M-B: Findings/Reports đầy đủ:** P05–P08, bao gồm templates, linked findings, binary exports và acknowledgement.
- **M-C: Shared UI các domain khác:** P09/P12; không đòi global inventories/provider deployment ngoài phạm vi để kiểm tra frontend mapping.
- **M-D: Runtime controls thật:** P10/P11 + required live acceptance; observation-only không đóng mốc này.
- **M-Final:** P13; các mốc trên độc lập để bàn giao từng phần nhưng không đổi full scope thành M-A.

## 8. Khi nào test, khi nào không

### 8.1 Quy tắc theo loại thay đổi

| Thay đổi | Phải kiểm tra | Không cần chạy mặc định |
|---|---|---|
| Chỉ plan/docs/ghi chú evidence | Link/path, diff, consistency của source/requirements | Unit suites, build, Docker, LLM, request tới IP |
| Label/CSS/embedded layout reversible | Existing affected rendered tests nếu hành vi/selector đổi, lint/typecheck package; actual route/theme/keyboard liên quan | Test mới chỉ assert text/CSS implementation; DB migration; target run |
| Pure extraction không đổi semantics | Affected consumers/port checks và existing focused suites | Viết test mirror từng helper; full app suite |
| Adapter/query/mutation | Scope/shape/error/conflict/late-response regression tại boundary; focused mock+real consumers; UI typecheck/lint; actual happy+failure path | Full runtime golden path cho mỗi mapping nhỏ, target scan |
| JSON/shared contracts | Positive/negative wire validators và named affected UI/API consumers; build shared package trước consumers | Toàn bộ CLI/desktop trừ khi contract exports của chúng thực sự bị ảnh hưởng |
| Bytes upload/download | Exact bytes/digest, bounds, text/binary distinction, auth/path checks và browser file | LLM để sinh mọi fixture; network target cho browser upload |
| Server/model/schema | Owning handler/repository tests, concurrency/roles, clean+upgrade DB, restart persistence, actual scoped HTTP | Full server suite; migration lên DB đang dùng để tiện test |
| Runtime messaging/lifecycle | Deterministic graph/checkpoint tests + crossing API/UI contract tests; live model/tool success/refusal/recovery cho boundary đổi | Chỉ mocked ACK rồi gọi runtime E2E; live IP cho unit tests |
| Export renderer/dependency/container | Real PDF/DOCX parse/open/render và artifact digest, deployment image smoke khi image đổi | Target contact; regenerate export nhiều lần khi cùng snapshot/renderer/config đã pass |
| C2 provider mapping | Contract tests + real provider round-trip khi thay dispatch semantics; outage refusal | Giả terminal output khi provider missing; coi IP là provider |
| Release/deployment đổi | Build đúng artifact, migrations, same-origin API/SSE, named end-to-end selection bị ảnh hưởng | Full suite/all viewport matrix nếu không có lý do và requester approval |

### 8.2 Trình tự một PR implementation

1. Chọn slice/owner; ghi expected files, budget, contract và **tên suite cụ thể** trước khi chạy.
2. Bug/enforcement change: thêm regression tại execution boundary, thấy fail trên baseline rồi pass với fix. Feature mới test meaningful branch/scope/concurrency, không mock chính function đang test.
3. Implement backend/port/adapter/UI theo slice; chạy typecheck/lint package bị đổi và focused suites. Docs-only không chạy các gate code này.
4. Thực thi actual route/handler mới/đổi với happy path + refusal/conflict/outage. Frontend-only có thể dùng real local API không cần model; runtime crossing cần actual runtime.
5. Ghi SHA/tree, IDs, commands, môi trường, kết quả và gaps. Cùng source/environment đã pass thì tái dùng evidence; source/contract/schema/renderer/config đổi mới invalidate tương ứng.
6. Required live check chưa chạy được giữ `blocked`, không skip/xfail cho xanh. Network/model flake phải reconcile intent trước retry, không dispatch mới để cố lấy pass.

**Không mặc định full suite:** không chạy `npm test`/`pytest` không filter; không chọn mọi file để lách quy tắc. Rộng/full hơn cần requester decision nêu lý do/scope. Kiểm tra đã pass không lặp lại nếu không có input mới, failure hoặc concern chưa giải quyết.

### 8.3 Lệnh focused hiện có

Chạy từ repo root, Node ≥22.12/npm; Python theo workspace lock. Các nhóm dưới là menu theo slice, **không chạy tất cả mỗi PR**.

```powershell
# Chỉ build shared dependency đã đổi hoặc dist chưa có/không khớp source.
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
# Sau schema đổi / install mới; không cần DB và không phải migration.
npm run prisma:generate --workspace=@raptix/web-raptix-server

# Chọn package có thay đổi; backend-only không mặc định lint UI và ngược lại.
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix -- --max-warnings=0
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server

# Findings/Evidence port + screens (các file hiện hữu).
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/service-adapter/findings.test.ts src/real/findings-real-mode.test.tsx src/features/findings/writes.test.tsx src/features/findings/evidence.test.tsx
npm run test --workspace=@raptix/web-raptix-server -- --maxWorkers=2 tests/t10-findings-workflow.test.ts tests/findings-artifacts-fs.test.ts tests/findings-artifacts.test.ts

# Reports; thêm suite renderer/ack mới có tên thật khi P07 tạo nó.
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/service-adapter/reports.test.ts src/features/reports/editor.test.tsx src/features/reports/review.test.tsx
npm run test --workspace=@raptix/web-raptix-server -- --maxWorkers=2 tests/t11-reports.test.ts tests/w14-logs-reports.test.ts

# Shared providers/router: chỉ khi seam/routing/session đổi.
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/app-routing.real.test.tsx src/real/bootstrap.test.tsx src/real/precommit-regressions.test.tsx src/router/route-table.test.ts

# Runtime integration / operation controls: chọn phần boundary đã đổi.
npm run test --workspace=@raptix/web-raptix-server -- --maxWorkers=2 tests/runtime-context.test.ts tests/run-policy.test.ts tests/stream-service.test.ts tests/w11-controls.test.ts tests/t18-scheduler.test.ts
npm run test --workspace=@raptix/web-raptix -- --maxWorkers=2 src/real/screens/workspace.test.tsx src/real/screens/operations-panel.test.tsx src/real/stream.test.tsx
uv run pytest -q packages/raptix/tests/unit/core/test_dispatch_boundary.py packages/raptix/tests/unit/core/test_subagent_streaming.py packages/raptix/tests/unit/core/test_subagent_transcript_state.py
```

P09/P12 chọn file thật trong `src/features/{assets,library,analysis,c2,operations,agents,branches,workers,settings,vault,closure,notices}/` và corresponding `src/real/screens/` cùng server owning tests; không coi test mock hiện hữu là bằng chứng real adapter. Tests instance inbox/operation pause/export formats chưa tồn tại: tạo co-located suite ở owner đúng rồi ghi exact command vào ledger, không ghi chúng như một lệnh đã pass.

| Slice migrate | Existing UI suites để chọn | Existing server suites để chọn |
|---|---|---|
| Assets/Scope | `features/assets/query.test.tsx`, `writes.test.tsx`; `real/screens/assets-panel.test.tsx`, `scope-panel.test.tsx` | `tests/t08-scope.test.ts`, `graph-service.test.ts` |
| Library/Analysis | `features/library/query.test.tsx`, `review.test.tsx`; `real/screens/library.test.tsx`, `library-review-panel.test.tsx`, `analysis-panel.test.tsx` | `tests/t14-library-analysis.test.ts`, `t14-library-review.test.ts` |
| C2 | `features/c2/service.test.tsx`, `grants.test.tsx`, `session-detail.test.tsx`, `session-console.test.tsx`; `real/screens/c2-panel.test.tsx`, `campaigns-panel.test.tsx` | `tests/t12-c2-grants.test.ts`, `t13-c2-recovery.test.ts`, `iw09-c2.test.ts`, `w17-campaigns.test.ts` |
| Operations/Fleet | `features/operations/query.test.tsx`, `write.test.tsx`, `lifecycle.test.tsx`; `features/branches/branches.test.tsx`; `real/screens/operations-panel.test.tsx`, `fleet-panel.test.tsx` | `tests/run-policy.test.ts`, `t09-governed-lifecycle.test.ts`, `t13-fleet.test.ts`, `timeline-service.test.ts` |
| Settings/Team/Vault/Audit/Closure | `features/settings/service.test.tsx`, `features/vault/vault.test.tsx`, `features/closure/service.test.tsx`; `real/screens/settings.test.tsx`, `team.test.tsx`, `audit-panel.test.tsx`, `closure-panel.test.tsx` | `tests/t07-auth-members.test.ts`, `t16-settings-audit.test.ts`, `w18-vault.test.ts`, `t17-closure.test.ts` |

Paths cột UI tương đối `apps/web/src/`, cột server tương đối `apps/web/server/`. Chỉ lấy file/ca kiểm tra hành vi thực sự bị đổi trong hàng, không mặc định chạy cả hàng. Khi thay step/HITL semantics, thêm focused Python middleware tests ở owner tương ứng; tests của mock operation không chứng minh runtime pause.

Nếu thay capability/tool exposure, chạy focused capabilities checks theo root AGENTS; nếu đổi public Core API cập nhật stability manifest/changelog. Nếu sửa Compose chạy `uv run pytest tests/test_compose_network_isolation.py`; nếu sửa launcher chạy focused Go package của phần đổi. Những gate này chỉ kích hoạt bởi file/boundary thật sự bị thay.

### 8.4 Build/migrate/local runtime khi slice cần

Các lệnh sau phục vụ implementation sau này, không chạy cho việc sửa plan. Npm workspaces dùng root lockfile; không cài dependency chỉ để làm test qua nếu chưa có dependency decision.

```powershell
# Trong terminal đã cấu hình DATABASE_URL trỏ dedicated test DB, tuyệt đối không mặc định DB đang vận hành.
# Chỉ khi migration đã được review và clean/upgrade fixtures đã chuẩn bị.
npm run prisma:migrate --workspace=@raptix/web-raptix-server

# Khi đổi compilation/packaging hoặc cần artifact mới để nghiệm thu release.
npm run build --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix

# Hai terminal riêng nếu cần local API/UI; dùng DATABASE_URL, WORKSPACE_PATH và runtime config của test stack.
# Terminal API:
npm run dev:api
# Terminal UI, sau khi cấu hình RAPTIX_WEB_BACKEND_URL đúng API port:
$env:VITE_DATA_MODE='real'
npm run dev
```

`prisma:generate` chỉ sinh client, `prisma:migrate` apply migration đã commit, cả hai không thay thế clean/upgrade/restart tests. Không mặc định chạy `prisma migrate dev` trên deployment. API thiếu runtime/provider vẫn phục vụ những workflow DB đã hỗ trợ với capability/error trung thực; live instances/controls phải có đúng runtime/sandbox image. Nếu cần launch temporary servers để kiểm chứng thì quản lý theo §11; không để npm child processes tồn tại không rõ owner.

## 9. Acceptance matrix xuyên các lớp

| ID | Luồng cần quan sát | Failure/recovery bắt buộc | Nguồn chứng minh |
|---|---|---|---|
| A01 | Producer output → suggestion → import draft | Empty outputs, duplicate/lost ACK, wrong engagement | Runtime artifact + curated DB row/source revision + browser |
| A02 | Upload → retained capture → attach | Attach lỗi sau upload, retry không duplicate, stale finding | Original bytes/digest + descriptor/link + audit |
| A03 | Inspector → preview/original → download | Binary, truncation, tamper, access revoked | File tải thật và computed hash; không dùng text preview làm original |
| A04 | Finding fields/comments/history/refs | Foreign refs, stale edits, closed engagement | API + DB + UI reload |
| A05 | Review/remediation/retest/resolution | Self-confirm refused, failed retest, approval invalidation | Two actors, finding versions + retest/audit records |
| A06 | Report options/template/findings → snapshot | Unconfirmed/foreign finding, missing source, reviewer revoked | Pinned versions + readiness response |
| A07 | Two editors → review → approved → revision | Stale saves/approval, source changes after approval | Exact approved content, immutable older revision |
| A08 | PDF/DOCX + JSON/Markdown download | Renderer failure, tamper, uncertain export retry | Parse/open file, metadata, binary hash, stable intent |
| A09 | Export → delivery → separate acknowledgement | Foreign/duplicate ack, legacy receipt not relabeled | Three persisted facts with actor/time/revision |
| A10 | Project tab ↔ standalone shared screens | Bad IDs, refresh/history, dirty save failure | Router/browser observations; no fallback demo |
| A11 | Assets/Library/admin migration | Scope invalidation, corpus read-only, vault late ACK, closure blocked | Actual owning API + shared UI |
| A12 | Two same-role instances/history/messages/forward | Stale recipient, duplicate message, parallel questions | Runtime IDs, per-recipient ACK/sequence/checkpoints |
| A13 | Instance retry/reassign/cancel | Parent stop, crash/restart, uncertain command | Attempts/lineage + observed final outcome |
| A14 | Operation pause/resume/complete/step review | In-flight boundary, expired plan, stop race, failed run remains failed | Durable intent/checkpoint, no duplicate side effect |
| A15 | C2 shared UI/session/grants/command | Provider down, expiry, out-of-scope target, replay | Real provider outcome khi configured; outage-only không certify success |
| A16 | Restart + schema upgrade + rollout | Same IDs recover, old rows readable, rollback rehearsal | Release manifest, migration ledger, preserved-data digest |

Acceptance có thể dùng deterministic captured input cho DB/workflow slices, nhưng phải ghi nguồn là fixture/manual, không gọi là runtime-produced. A12/A14 cần live runtime boundaries, A15 cần provider; model stub không thay bằng chứng đó. Scope quyền của single-operator handoff ADR-0085 không tự mở rộng sang finding/report self-approval.

## 10. Thiết kế auto-test và target `10.129.227.140`

### 10.1 Cấu hình test profile

| Tham số đề xuất của harness mới | Giá trị/default | Ý nghĩa |
|---|---|---|
| `WEB_ACCEPTANCE_BASE_URL` | `http://127.0.0.1:3001` | Web/nginx origin; không phải target assessment |
| `WEB_ACCEPTANCE_TARGET_HOST` | `10.129.227.140` | Target lab do requester cung cấp |
| `WEB_ACCEPTANCE_TARGET_CIDR` | `10.129.227.140/32` | Single-host scope; hợp với `targetType=ip_range` hiện có |
| `WEB_ACCEPTANCE_NETWORK_PROBES` | `0` | Tách local workflow lane khỏi lane liên hệ target; đặt `1` khi chạy target acceptance |
| `WEB_ACCEPTANCE_STATE` | `tests/local/artifacts/web-ui-contracts/<run-id>/state.json` | Resume IDs/intents, không phải credentials store |
| Credentials/model/provider config | Server-side test accounts và env của dedicated stack | Không thêm vào Vite env, Git hoặc evidence summary |

Đây là **tên cấu hình dự kiến**, chưa phải env các harness hiện có hỗ trợ. Không đổi IP thành Web origin, provider URL hay sandbox URL. Trước live lane, kiểm tra routing/VPN/reachability **từ đúng sandbox của engagement**, không chỉ host Windows.

### 10.2 Harness cần xây trong implementation

- Dự kiến `apps/web/tools/verify-ui-contract-completion.mjs`; chỉ tạo khi triển khai P02/P03 onward. Tái sử dụng Playwright/API helpers phù hợp, không copy nguyên harness M1 rồi giả target hỗ trợ.
- CLI dự kiến: `--prepare`, `--findings-evidence`, `--reports`, `--shared-ui`, `--instances`, `--operations`, `--target-flow`, `--resume`, `--cleanup`; dùng explicit `--state <path>` để không lẫn lần chạy. Mỗi phase chạy được riêng và đọc state trước side effect.
- `--prepare`: dedicated run ID, actors owner/operator/reviewer/viewer, engagement với target `ip_range`/`10.129.227.140/32`, workspace/sandbox đúng partition, capabilities/action support và source/image/schema manifest. Ghi request/resource IDs trước dispatch; không dùng project/records đang vận hành.
- Credentials tạo/lấy qua deployment bootstrap/test setup, lưu ngoài repo/evidence; không log password/CSRF/token. Không gắn Docker socket vào API để harness tiện tạo sandbox.
- Provision sandbox của test engagement theo operator/launcher flow đã review, trên dedicated stack/volume khi cần. Không chạy blanket sync/cleanup có thể đụng user sandboxes. Nếu sandbox chưa provision, fail precondition trước model run.
- `--findings-evidence`/`--reports`/`--shared-ui`: dùng bytes fixtures và curated inputs có nhãn test/manual; không cần network target hoặc LLM. Kiểm tra file download thật và DB persistence qua API restart của stack test.
- `--instances`/`--operations`: chạy runtime/tools thật, trước tiên workspace-only markers và deterministic bounded work. Handoff, scope/plan review/binding, preflight, HITL và stop gates giữ nguyên; không seed success/ACK vào DB.
- `--target-flow`: chỉ chạy khi profile network bật. Thực hiện một read-only observation có giới hạn trên host đã khai báo, do approved plan/tools chọn theo capability thực tế; không mặc định chạy exploit, password guessing, persistence, destructive commands hoặc quét cả subnet.
- Chỉ answer câu hỏi có test policy rõ. Question mới ngoài policy hoặc HITL action khác approved scenario thì dừng phase/ghi `blocked`, không dùng blanket allow để golden path xanh. Negative authorization dùng fake/foreign IDs và HTTP refusal, không gửi traffic tới host ngoài scope.
- Một target không có vulnerability vẫn phải cho honest empty findings; test pipeline dùng informational observation hoặc fixture riêng, không bịa vulnerability. Record producer attribution đúng nguồn.
- Khi network/model down: ghi failed/blocked cùng command/run IDs và reason; reconcile trước resume. Test local workflows vẫn chạy độc lập; target lane không bị biến thành pass nhờ mock fallback.

### 10.3 Lệnh minh họa sau khi harness được implement

**Không chạy các lệnh dưới ở lượt lập plan này.** File/flags là contract harness cần tạo, không phải command hiện đang sẵn sàng.

```powershell
$env:WEB_ACCEPTANCE_BASE_URL='http://127.0.0.1:3001'
$env:WEB_ACCEPTANCE_TARGET_HOST='10.129.227.140'
$env:WEB_ACCEPTANCE_TARGET_CIDR='10.129.227.140/32'
$env:WEB_ACCEPTANCE_NETWORK_PROBES='0'

# Thay <run-id> bằng ID riêng của lần kiểm; harness xác minh parent/output scope trước khi tạo.
node apps/web/tools/verify-ui-contract-completion.mjs --prepare --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"
node apps/web/tools/verify-ui-contract-completion.mjs --findings-evidence --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"
node apps/web/tools/verify-ui-contract-completion.mjs --reports --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"
node apps/web/tools/verify-ui-contract-completion.mjs --instances --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"
node apps/web/tools/verify-ui-contract-completion.mjs --operations --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"

# Chỉ lane này liên hệ target, sau scope/plan/preflight hợp lệ.
$env:WEB_ACCEPTANCE_NETWORK_PROBES='1'
node apps/web/tools/verify-ui-contract-completion.mjs --target-flow --state "tests/local/artifacts/web-ui-contracts/<run-id>/state.json"
```

Harness hiện có `verify-operational-m1.mjs` dùng `M1_BASE_URL`, pinned/legacy assumptions và local-only target `https://authorized.invalid`. Harness đó chưa tự hỗ trợ IP profile này. Phải audit/adapt khi tái dùng; M1 evidence cũ không tự certify per-project sandbox/thread migration hiện tại.

## 11. Migration, rollout và rollback

1. Chỉ chạy migrate trên dedicated DB trước: clean install → upgrade từ migration baseline + existing rows → API restart; back up DB và retained workspace khi upgrade persisted deployment.
2. Add schema/validators/server feature capability trước, UI đọc capability/action support sau. Old clients/new server và new client/missing action trả honest unavailable; không silent drop fields hoặc seed fallback.
3. Kiểm tra retry semantics: import/attach/comment/retest/export/message/control có stable intent; lost ACK không tạo duplicate workflow hoặc side effect.
4. Build shared `dist` đã đổi, Prisma generate khi schema đổi, independent UI/API builds; runtime rebuild khi Python owner đổi. Container revision/tree digest phải khớp artifacts dùng nghiệm thu.
5. Roll out từng migrated domain/action theo capability/release flag; không bật messaging/pause UI trước runtime contract. Quay lại panel cũ chỉ là biện pháp rollback tạm có owner, không final parity.
6. Rollback code giữ additive schema và records mới; không destructive down-migration hoặc xóa workspace để làm app cũ chạy. Kiểm tra phiên bản cũ đọc được legacy/compatible data; export renderer rollback giữ artifact đã phát hành và digest.
7. Cleanup chỉ resource gắn test run ID; không purge volumes hoặc blanket kill Node/Docker. Theo `apps/web/AGENTS.md`, temporary-process stop/cleanup trên Windows có hard cap 5 giây, exact PID/container ownership; survivor ghi vào evidence và dừng cleanup đó.

## 12. Definition of Done và bàn giao

### 12.1 Mỗi slice

- [ ] Mapping source → contract → service → UI có thật; không còn simulated success trong real.
- [ ] Required decisions/ADR/migration cho slice đã ghi trước boundary mới; version/ownership/error semantics rõ.
- [ ] Focused regression và static gates tương ứng pass; happy + refusal/recovery đã exercise qua actual boundary.
- [ ] Supported write survives refresh/restart; stale writes giữ draft và trả conflict, không fetch-latest để bypass.
- [ ] Source/consumer cũ chỉ retire sau replacement cover unique actions; route/tab/deep link còn đúng resource.
- [ ] Evidence ghi tested tree/images/schema, exact commands, attempted/passed/failed/blocked và gaps; không cộng các test counts chồng lặp thành full-suite pass.

### 12.2 Toàn phạm vi hai vấn đề

- [ ] Producer import và full Evidence flow A01–A03 đạt, gồm binary bytes/integrity/recovery.
- [ ] Findings fields/comments/history/typed links/retests/suggestions persist và có server enforcement.
- [ ] Reports templates/reviewer/period/finding snapshots/readiness/PDF/DOCX/delivery/ack đạt; approved content immutable.
- [ ] Project/standalone Findings/Evidence/Reports và các domain P09/P12 dùng shared presentation, không unique workflow bị mất.
- [ ] Instance identity/history/messages/forward/controls/recovery và Operations lifecycle/step controls có runtime outcomes thật; required unsupported items vẫn open cho tới implementation hoặc approved exclusion.
- [ ] Target profile `10.129.227.140/32` có bounded live evidence hoặc ghi blocker rõ; không dùng target reachability làm proxy cho mọi workflow đã pass.
- [ ] Scope, independent approvals, deadlines, stop, HITL, sandbox và actor isolation không bị nới để test chạy qua.
- [ ] Final acceptance có source↔image match, schema upgrade/restart/rollback evidence và coverage actions; cập nhật tracker cũ cho đúng trạng thái.

### 12.3 Evidence record mẫu

```text
slice / acceptance ID:
source SHA + working-tree digest:
UI/API/runtime/sandbox image IDs + revision labels:
schema migration baseline + applied version:
selected suites + exact commands:
environment / base URL / network profile / target if contacted:
actor role IDs (không credentials):
engagement / thread / run / dispatch / instance / attempt / intent IDs:
finding / evidence / report revision / delivery / acknowledgement IDs:
expected -> observed outcome, HTTP/control states, byte size/digest:
attempted / passed / failed / blocked + reason:
earlier evidence reused / invalidated + why:
cleanup result / retained test resources / process survivors:
next action / owner:
```

Tài liệu này là hướng dẫn implementation và test cho các lượt tiếp theo. Việc tạo plan không đánh dấu Pxx/Axx đã hoàn thành, không thay các pending product decisions bằng approval, và không chứng nhận target/deployment đã được kiểm thử trên baseline này.

## 13. Nhật ký quyết định và triển khai (ledger)

Ghi lại các quyết định của người yêu cầu ngày 2026-10-17 (lượt chốt trước khi tự động triển khai) và trạng thái từng phase. Mục nào chưa có bằng chứng thì ghi rõ là chưa xong.

### 13.1 Quyết định đã chốt

| Mục | Quyết định |
|---|---|
| ADR-0087 | Accepted. Owner/manager/admin phân loại capture; viewer không đọc bytes gốc; attach capture `unclassified` được nhưng không lộ bytes; đổi phân loại bằng CAS có audit, không đổi digest; lỗi file/DB dùng staging + `pending` + sweeper mồ côi. |
| ADR-0088 | Accepted. Comment trên finding `resolved` bị từ chối (resolved đóng băng); comment không đổi lifecycle status. |
| D04 | Owner = admin + manager. Viewer không đọc bytes gốc. |
| D05 (PDF/DOCX) | **Hoãn** theo yêu cầu người dùng ("chưa cần, có tính năng tạm thời"). Mục này là loại trừ có tên cho release này: PDF/DOCX chưa render, UI hiển thị `unavailable` trung thực, JSON/Markdown giữ nguyên. Acknowledgement vẫn triển khai. |
| D06, D07 | Theo đề xuất: at-least-once + ACK + dedup theo message ID; pause cooperative tại safe-point, `pause_requested` giữ đến khi runtime xác nhận; complete chỉ sau terminal + đối soát child. |
| D08 | Theo đề xuất trong §4. |
| Môi trường | Docker dùng được. PostgreSQL 17 (127.0.0.1:5433), Neo4j, Sandbox, Skillogy đang chạy. LangGraph và LiteLLM đã thoát (exit 127) ở lần kiểm tra đầu. C2: image `raptix-iw09-sliver-bridge:lab` có sẵn, chưa chạy container. |
| Target | `10.129.227.140`: mặc định không gửi request; chỉ bật `--target-flow` sau khi scope/plan/preflight hợp lệ, và log phải đủ để debug. |
| Git | Commit local theo phase, không push, không co-author trailer (theo `CLAUDE.md` dự án). File lạ ở root giữ nguyên. |
| Phạm vi | Thêm P00 và P13. |

### 13.2 Trạng thái khi bắt đầu lượt triển khai

- Không có commit nào sau `94c58b6`; working tree chưa commit.
- Trước khi sửa, build `@raptix/web-contracts` lỗi, typecheck server lỗi (4 chỗ), typecheck UI lỗi (duplicate type trong `real/api.ts`, fixture test thiếu trường).
- Đã sửa trong lượt này (chỉ về kiểu, không đổi hành vi):
  - `apps/shared/web-contracts/src/finding-workflow.ts`: biến cục bộ cho `expectedVersion`/`activityCursors` trong validator; `transitions` thành `Readonly<Record<string, readonly string[]>>`.
  - `apps/web/server/src/services/findings-workflow-service.ts`: cast `severity`, `status`, `result`; import `FindingRetestRecord`.
  - `apps/web/src/real/api.ts`: xóa bản khai báo cục bộ trùng với contract (`CuratedFindingView`, `CuratedFindingsView`, validator cũ).
  - Fixture test: thêm trường bắt buộc (`createdAt`, `producerDigest`, `lastReviewDecision`, `comments/history/retests`, `captureId`).
- Sau các sửa trên: build contracts OK, typecheck server OK, typecheck UI OK.
- Test chưa chạy. Theo yêu cầu, test chạy sau khi các phase được implement xong.

### 13.3 Tiến độ theo phase (lượt đầu; các dòng P00, P08, P10 và mục 13.5 đã được đính chính ở 13.15)

| Phase | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| P00 | Xong | Ledger này; ADR-0087/0088 chuyển sang Accepted theo quyết định người yêu cầu. Chưa chụp dirty-file ledger đầy đủ. |
| P01 | Xong (code và test) | `EvidenceUploadInput` có bytes; transport binary kiểm tra độ dài và SHA-256. Test `findings-api`, `transport`, `findings` pass. |
| P02 | Có code, đã sửa lỗi typecheck, test pass | Route suggestions/import/options; dismissal theo actor + path; migration `20261022`. |
| P03 | Có code, đã sửa lỗi typecheck, test pass | `capture-session`, `capture-upload` (UI), route captures + evidence. |
| P04 | Có code, test pass | Route `GET artifacts/captures/:id/content`; SHA-256 ở adapter. Chưa kiểm riêng tamper/traversal trên browser. |
| P05 | Có code, đã sửa lỗi typecheck, test pass | Migration `20261024`; comments, retests, activity, references. ADR-0088 Accepted. |
| P06 | Xong backend + API + panel setup | Migration `20261025000000_report_composition`; template có version; kỳ báo cáo; reviewer được đặt tên; snapshot finding theo version; readiness tính ở server; lineage khi revise; người được đặt tên mới được quyết định. Gate live `apps/web/server/tests/p06-report-composition-live.ts` pass trên DB `raptix_ui_contract_test`. |
| P07 | Một phần | Acknowledgement tách khỏi delivery, idempotent theo request id: xong. PDF/DOCX: **hoãn** theo quyết định người yêu cầu (loại trừ có tên, xem 13.1). |
| P08 | Chưa | `screens/detail.tsx` vẫn dùng `RealFindingsPanel` và `RealReportsPanel`. Shared screens (`screens/f-report.tsx`, `e-findings.tsx`) chưa có port cho template, selection, ack. `control-gaps.ts` còn 12 mục. |
| P09 | Chưa | Không có thay đổi trong `features/{assets,library,settings,vault,closure,...}`. |
| P10 | Chưa | Không có roster, inbox hay instance API trong `packages/raptix`. Cần audit dispatch, subgraph và checkpointer trước (P10a). |
| P11 | Chưa | Không có pause intent, checkpoint pause, step controls ở runtime. |
| P12 | Chưa | Phụ thuộc P11 cho lifecycle controls. |
| P13 | Chưa | Cần sau P08–P12. |

### 13.6 Cập nhật lượt triển khai tiếp theo

| Phase | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| P02–P05 | Đã xác minh | Gate live `apps/web/server/tests/p02-p05-workflow-live.ts` pass trên DB `raptix_ui_contract_test`: import idempotent khi retry đồng thời, từ chối đổi bytes, upload và tải bytes gốc khớp digest, retest chặn resolve trực tiếp, comment bị khóa khi resolved, phân trang activity, dismissal theo actor, đọc lại sau restart. Sửa lỗi thật: attach capture chưa phân loại (ADR-0087) trước đây bị chặn bởi cổng đọc; và attach gọi lại `capture()` không cần thiết. |
| P06–P07 | Đã xác minh | Gate live P06/P07 pass. Suite `t10`, `t11`, `findings-artifacts` pass. |
| P08 | Xong (code và test) | Project tab Reports dùng màn hình chia sẻ `ReportsPage`; tab Findings dùng `FindingList` chia sẻ (có cảnh báo truncated). Adapter thật nối template, reviewer, kỳ báo cáo, finding ghim theo version người dùng đã đọc, ack có request id, revise, tạo template (owner), tải JSON/Markdown. Đã xóa `RealReportsPanel`, `RealReportEditor`, `RealReportSetup`, `RealFindingsPanel` và test tương ứng. Gỡ gap đã triển khai khỏi `control-gaps.ts`. Commit `8a03dd0`. |
| P09 | Chưa | Các domain assets/library/team/settings/vault/audit/closure/C2/operations chưa có port thật (`real/service-adapter` chỉ có findings và reports). Project detail mock (`screens/b-detail*.tsx`) gọi service trực tiếp. Cần một port + adapter + màn hình chia sẻ cho từng domain. |
| P10 | Chưa | Runtime Python không có roster instance, inbox, outbox hay instance API. Cần P10a audit `middleware/dispatch.py`, `core/subagent_streaming.py`, checkpointer rồi mới viết code. |
| P11 | Chưa | Không có pause intent, checkpoint pause, step controls ở runtime. |
| P12 | Chưa | Phụ thuộc P09 (port) và P11 (lifecycle). |
| P13 | Chưa | Cần sau P09–P12. |

### 13.7 Test toàn bộ web UI (sau P08)

- Suite UI đầy đủ: 124 file, 1256/1264 test pass.
- 8 test fail đều đã có ở baseline `94c58b6` (đã đối chiếu bằng worktree tạm, đã gỡ): `a11y-audit` (2), `dark-theme-audit` (1), `responsive-audit` (5, một trong đó lần chạy này pass). Chưa sửa vì nằm ngoài kế hoạch này; cần xử lý riêng.
- Đã sửa trong lượt này: `features/findings/evidence.test.tsx` kỳ vọng nhãn cũ "Download", nay là "Download original" (đổi có chủ đích ở P04, commit `cf326fe`).
- Adapter Reports: 22/22 test pass. Server: `t10`, `t11`, `findings-artifacts`: 33/33 pass.
- Lint và typecheck `@raptix/web-raptix` và `@raptix/web-raptix-server`: sạch.

### 13.8 Hạ tầng live

- LangGraph và LiteLLM đã khởi động lại. Cả hai đều healthy (`/ok` và `/health/readiness` trả 200).
- Postgres, Neo4j, Sandbox, Skillogy đang chạy.
- Sliver C2: image `raptix-iw09-sliver-bridge:lab` có sẵn, chưa chạy container. Chưa kiểm tra provider.

### 13.4 Kết quả kiểm tra đã chạy (sau khi triển khai P00–P07)

- Build `@raptix/web-contracts`: pass. Typecheck `@raptix/web-raptix-server`: 0 lỗi. Typecheck `@raptix/web-raptix`: 0 lỗi.
- Lint `@raptix/web-raptix-server`: pass. Lint `@raptix/web-raptix --max-warnings=0`: pass.
- Server (vitest): `t10-findings-workflow`, `findings-artifacts`, `findings-artifacts-fs`, `t11-reports` (6/6), `w14-logs-reports`: pass. Chỉnh sửa `t11-reports` là vì gate readiness mới: submit và approve cần cổng readiness, nên fixture bổ sung template, kỳ, reviewer và một finding đã confirm.
- Gate live P06/P07 (`tsx tests/p06-report-composition-live.ts`, DB `raptix_ui_contract_test`): pass.
- Contract (`apps/shared/web-contracts`): 7 file, 49 test, pass.
- UI (vitest): 12 file, 141 test, pass (findings, reports, capture/finding session, transport, report editor).
- Migration: áp dụng sạch lên DB test. `migrate diff` không báo drift cho bảng mới; có drift có sẵn từ trước ở các FK cũ và default `createdAt` (không thuộc phạm vi này).

### 13.5 Lệch khỏi plan đã biết (mục readiness đã được đính chính ở 13.15)

- DTO report vẫn nằm ở `apps/web/src/real/api.ts`, chưa chuyển vào `apps/shared/web-contracts` như §5.2 yêu cầu. Lý do: report chưa có consumer shared; chuyển khi P08.
- Readiness chưa có check "scope/source version" vì DB chưa lưu scope window. Mục này ghi là chưa có, không báo pass.
- Plan yêu cầu PDF/DOCX trong DoD §12.2; quyết định người yêu cầu hoãn. Bản ghi này là loại trừ có tên, cần giữ đến khi có quyết định khác.

### 13.9 Lượt sửa test và target (2026-10-17, muộn)

- **Test UI:** 124/124 file, 1270/1270 test pass. Sửa ba file audit (`a11y`, `dark-theme`, `responsive`) theo điều hướng đã phát hành: sign-in về System Overview nên test khôi phục route; mục project là nút trong sidebar (không còn tablist và menu More); chip AI-mode đã bị gỡ; C2 strip là `lg:grid-cols-4`. Commit `4bb2556`.
- **Test server:** 47/47 file, 437/437 test pass.
- **Harness acceptance:** `apps/web/tools/verify-ui-contract-completion.mjs` với `--prepare`, `--findings-evidence`, `--target-flow`. Commit `fc885e1`.
  - `--prepare`: engagement scope `10.129.227.140/32`.
  - `--findings-evidence` (HTTP thật, DB `raptix_ui_contract_test`, API port 3101): replay upload giữ id; bytes gốc bị chặn 409 trước khi phân loại; sau phân loại tải về đúng bytes và `x-content-sha256`; attach 200 và replay 200; version lệch bị từ chối 409. Pass.
  - `--target-flow` (chỉ đọc, từ container `raptix-sandbox`, một host trong scope): ICMP up; TCP 22 open (OpenSSH 7.6p1 Ubuntu); TCP 80 open với HTTP 200 ở `/`; 443, 445, 3389, 8080 closed hoặc filtered. Đây chỉ là quan sát kết nối. Lượt này không chạy runtime agent và không có plan đã duyệt. Đã bỏ qua bước này trong harness.
- **P10a:** audit đã viết ở `docs/design/2026-10-17-runtime-instance-audit.md`. Kết luận: roster đọc được từ `dispatch_ledger`; subagent không có inbox; P10c bị blocked cho tới khi có safe-point; restart durability chưa được chứng minh.
- **P09–P13:** vẫn chưa làm. Trạng thái không đổi so với mục 13.6.

### 13.10 P09 theo từng domain

- **Assets (một phần Assets/Scope): xong.** Commit `59b8694`.
  - Port `AssetService` có đọc (list, get, scope, observedGraph) và ghi (importRows, changeScope).
  - Adapter thật đọc inventory managed/observed. Import theo kind. Đổi classification ở version đã đọc; server vẫn chặn `in_scope` khi chưa có scope revision đã duyệt.
  - Các phần backend không có (operations, findings, evidence, approvals, techniques, history) được ghi là `unmodelled`, không hiển thị như danh sách rỗng.
  - Đồ thị attack-chain đã quan sát chuyển thành thẻ read-only trong route assets.
  - Test: 250 test liên quan pass. Phase `--assets` của harness pass trên HTTP thật.
  - Chưa xong: scope revisions (ROE, khung giờ, người liên hệ, quyết định approve/reject) vẫn nằm ở `real/screens/scope-panel.tsx`.
  - Chưa kiểm chứng bằng trình duyệt thật cho các action đã chuyển.
- **Library/Analysis: chưa làm, cần quyết định.** Mock port mô hình playbook có vòng đời revision và approval. Real mô hình corpus skill (chỉ đọc) và proposal (propose, amend, submit, decide, export). Chọn port nào là quyết định parity theo plan D08 của frontend owner, không tự suy ra được.
- **Team/Settings, Vault/Audit/Notices, Closure: chưa làm.**


### 13.11 Library và kiểm chứng luồng live (2026-10-17, cuối)

- **Library (P09): xong.** Commit `a222392`.
  - Port `LibraryService` gồm corpus (chỉ đọc, lấy từ knowledge graph), skill, technique và proposal (submit, amend, propose, decide, export).
  - Adapter thật `real/service-adapter/library.ts` đăng ký dưới capability `graphs`. `RealLibrary` và `RealLibraryReviewPanel` đã xóa; Playbooks là danh sách skill, Review là danh sách proposal.
  - Fingerprint dùng dạng `sha256:<hex>` như server. Mock trước đây dùng hex trần, đã được sửa cho khớp.
  - Test UI: `features/library` 7 test; toàn bộ UI 121/121 file, 1242/1242 test pass.
  - Phase `--library` của harness pass trên HTTP thật: corpus 200 (324 skill), fingerprint đúng dạng, draft, amend, version lệch 409, propose, tác giả tự quyết định 403, reviewer độc lập approve 200, export 200.
  - Trên UI thật (Vite real mode, Playwright): Skill library hiện 324 skill và 697 kỹ thuật; chi tiết skill hiện fingerprint `sha256:`.
- **Sửa handoff: commit `701bcbf`.** Handoff bị 409 với mọi engagement có thành viên thứ hai, kể cả khi reviewer đã duyệt scope bao phủ target. Nay kiểm tra scope đã duyệt trước; target mới vẫn cần review độc lập. Test: `t08-scope` (test mới) và `adr0085-planning-handoff`. Server 47/47 file, 438/438 test pass.
- **Luồng live đã chạy trên API thật (engagement `cmvc80mzk0001jwfipei7teyr`, DB test):**
  - Planning: 8 tài liệu (conops, deconfliction, opplan, threat-profile, contact, data-handling, abort, cleanup) qua draft và publish với digest precondition. `plan-docs` ready.
  - ROE: `roe.json` chưa có đường publish hợp lệ (publish ROE bị chặn có chủ đích, ADR-0085). Đã ghi fixture `roe.json` do operator soạn vào thư mục plan của workspace acceptance. Đây không phải đường planner thật.
  - Scope: owner submit revision, reviewer độc lập approve 200, owner tự approve 409. `scope/effective` có `10.129.227.140/32`.
  - Plan: save, propose (cần ROE pin), tác giả quyết định 403, reviewer approve 200 với expiry 24h. Preflight: roe, targets, contact pass.
  - Handoff: lần 1 với thành viên thứ hai bị 409 (trước bản sửa). Sau khi gỡ reviewer, handoff 200 và preflight `project:pass`.
  - Estop: raise 200, preflight `estop:fail`; resolve cần `concurrencyVersion` (400 nếu thiếu), resolve lần hai 409.
  - Closure: request bị chặn bởi checklist (proposal Library còn chờ review); sau khi reviewer reject proposal còn mở, owner request 200; owner tự quyết định 403; reviewer xác nhận 200 và engagement `closed`; ghi sau đó bị 409 read-only.
  - Form tạo project trên UI thật: Playwright điền form, nút submit bị disable đến khi đủ trường và xác nhận ủy quyền (đúng thiết kế), tạo thành công `cmvc9u94y000e6gfiknyh78rj`, API xác nhận `ip_range`, `10.129.227.140/32`, `draft`.
- **Runtime (AI conversation, thread, run): đã chạy thành công.** Hội thoại đi qua API sản phẩm: thread `planning` được tạo (201), run được submit (202), agent `soundwave` trả lời đúng tên engagement và workspace, run ở trạng thái `success`. LiteLLM ghi `POST /chat/completions 200` và model là `custom/zai-org/GLM-5.3-Flash`.
  - Cấu hình: `.env` đặt `RAPTIX_ENGAGEMENT` và `RAPTIX_ENGAGEMENT_WORKSPACE` rỗng (chế độ web runtime, như `docker-compose.web-runtime.yml`), `RAPTIX_WORKSPACE_PATH` trỏ tới `tests/local/artifacts/ui-contract-target`. Giá trị cũ (workspace juice-shop-v4-r3) để trong comment. Ảnh hưởng: LangGraph dùng chung không còn gắn với juice-shop-v4-r3.
  - API test chạy với `LANGGRAPH_API_URL=http://127.0.0.1:2400` và `RAPTIX_RUNTIME_WORKSPACE_ROOT=/workspace`.
- **Docker Desktop đã restart** theo quyền của người yêu cầu. Workspace hiện thấy đúng trong container khi bind bằng đường dẫn `D:/...`; đường `/mnt/d/...` cho cây cũ.
- **Planner (soundwave), engagement `ui-live-8b98a9`:** agent ghi đủ 9 tài liệu vào `plan/`. Tám tài liệu hợp lệ, gồm `roe.json` do planner viết. Hai tài liệu lỗi: `abort.json` ghi severity chữ hoa, `opplan.json` thiếu `threat_profile` và dùng cấu trúc sai. Operator sửa qua API tài liệu (draft rồi publish, có digest precondition), giữ nguyên nội dung. Sau đó 9/9 `ready`.
  - Lỗi: công cụ `complete_engagement_planning` trả chuỗi `Planning handoff blocked: ...` thay vì lỗi. Agent không hiểu lý do và lặp tới giới hạn đệ quy 200 bước (`GraphRecursionError`). Có một run hoàn tất khi bundle đã hợp lệ.
- **Handoff sản phẩm:** `PATCH handoffConfirmed` 200, scope approved v1 từ `roe.json`. Preflight: project, roe, targets, contact, estop, runtime, assistant đều pass.
- **Plan:** owner lưu và propose, reviewer độc lập duyệt (expire 24h). Thread execution bind plan: preflight `ok: true`, gồm playbook pass.
- **Execution:** thread đầu tiên bị chặn vì runtime chưa pin (bash fence yêu cầu `RAPTIX_ENGAGEMENT` khớp engagement). Đã pin LangGraph và sandbox vào `ui-live-8b98a9`, thread mới chạy OBJ-001 `success` (45 giây đến 71 giây tùy lần). Hai quan sát chỉ đọc khớp với báo cáo của agent: SSH `SSH-2.0-OpenSSH_7.6p1 Ubuntu-4ubuntu0.7`, HTTP `Werkzeug/2.1.2`.
  - Lỗi: agent báo đã ghi `recon/SUMMARY.md` và `recon/banners_*.txt`, nhưng cả host lẫn sandbox đều không có file nào trong `recon/`. Nghi ngờ đường ghi của sub-agent (`EngagementFilesystemBackend`). Chưa điều tra sâu.
- **Tồn đọng:** file tạm `abort.json.tmp-cleanup-placeholder` vẫn nằm trong `plan/`, và `.engagement` rỗng do planner tạo.
- **Ghi chú cho owner:** engagement acceptance đã closed. Các bước mutation tiếp theo cần engagement mới.

### 13.12 Sửa lỗi planner, execution và sandbox dùng chung (2026-10-17, tối)

- **Nguyên nhân gốc của lỗi ghi bằng chứng:** không phải backend của sub-agent. `SANDBOX_URL=http://sandbox:9999` của LangGraph được DNS phân giải luân phiên giữa `raptix-sandbox` và `sbx-popup-lab-lbvq`, vì sandbox theo project do launcher sinh ra có service `sandbox` và cùng nằm trên `raptix_sandbox-net`. Các lần ghi và lệnh có thể rơi vào sandbox của lab khác.
  - Sửa: `docker-compose.yml` đặt `SANDBOX_URL` về tên container của stack (`raptix<stack>-sandbox`). Launcher (`apps/launcher/internal/sandboxes/sandboxes.go`) đặt tên service bằng tên container `sbx-<slug>`, để alias `sandbox` không còn bị chiếm.
  - Kiểm chứng: sau khi đổi URL, 26 request `/execute` tới `raptix-sandbox`, 0 request tới `sbx-popup-lab-lbvq`. Ghi qua `HTTPSandbox.write` xuất hiện đúng trên host và trong sandbox của stack.
- **Lỗi handoff của planner:** `validate_planning_bundle` gom đủ lỗi theo từng file (vị trí field, quy tắc, giá trị sai), thay vì dừng ở lỗi đầu. `complete_engagement_planning` trả `ToolMessage(status="error")` khi bị chặn. Test: 6/6 `test_complete_planning.py`.
  - Kiểm chứng live: tạm chuyển `cleanup.json` đi, planning thread mới gọi công cụ một lần, công cụ trả `status=error` (180 ký tự), agent báo đúng nguyên nhân và không lặp. Sau đó khôi phục file, bundle `ready` lại.
- **File tạm trong `plan/`:** `abort.json.tmp-cleanup-placeholder` là bản nháp do lỗi đường dẫn của Soundwave, đã xóa. `soundwave.md` thêm quy tắc không tạo file tạm trong `plan/` và cách xử lý khi handoff bị chặn.
- **Execution, OBJ-001, thread mới bind plan đã duyệt:** `success` (86 giây). Evidence nằm đúng trong `recon/` trên host và trong sandbox của stack. Banner SSH và `HEAD /` được kiểm chứng độc lập từ sandbox.
- **Chưa xong và cần quyết định:**
  - Container `sbx-popup-lab-lbvq` vẫn giữ alias `sandbox` cho tới khi lab được sync lại bằng launcher đã sửa. Lệnh xóa 4 mục do phiên này tạo trong `/workspace` của container đó (`plan/`, `recon/`, `.engagement`, `ui-live-8b98a9/`) đã bị bộ phân loại từ chối. Chúng vẫn còn đó và cần xóa bởi người sở hữu lab.
  - Agent ghi evidence vào thư mục lồng `ui-live-8b98a9/ui-live-8b98a9/evidence/`, trong khi báo cáo nhắc tới `evidence/` tương đối. Nguyên nhân: engagement đã pin ở `/workspace`, nhưng agent dùng đường dẫn có slug. Cần quyết định có chuẩn hóa đường dẫn trong fence hay không, vì đó là đổi ngữ nghĩa của fence filesystem.
  - Thread planning tạo trước khi pin trả 409 khi tiếp tục. Đây là hành vi đúng: cấu hình runtime khác với lúc tạo thread.

### 13.13 Cô lập sandbox giữa các stack và project (2026-10-17, khuya)

- **Sandbox popup lab (project `popup-lab-lbvq` của stack web):** đã sync lại bằng launcher đã sửa. Compose mới dùng service `sbx-popup-lab-lbvq`, alias `sandbox` không còn, container healthy, mount vẫn là subpath của project. Đã xóa 4 mục do phiên này tạo trong `/workspace` của container theo quyền của người yêu cầu.
- **Tách network sandbox của stack này:** `sandbox-net` đặt tên bằng `RAPTIX_STACK_SANDBOX_NETWORK` (`.env`: `raptix_lab_sandbox-net`). Mặc định vẫn là `raptix_sandbox-net` cho các cài đặt khác. LangGraph và `raptix-sandbox` nằm trên mạng mới. Sandbox của stack web (`sbx-popup-lab-lbvq`) không còn resolve được từ LangGraph.
- **Dữ liệu dùng chung còn lại:** `raptix-web-runtime` gọi `bolt://neo4j:7687`, `http://skillogy:9100` và LiteLLM, và các địa chỉ này đi qua `raptix-net`. Việc tách `raptix-net` sẽ làm đứt đồ thị tri thức của stack web, nên chưa làm. Đây là quyết định về dữ liệu dùng chung cần người sở hữu quyết định.
- **Kiểm chứng:** execution ghi `recon/ssh_recheck.txt` qua mạng mới, file xuất hiện trên host và trong `raptix-sandbox`, đúng một kết nối tới `10.129.227.140:22`. Lần chạy không yêu cầu làm lại chỉ trả về bằng chứng cũ, vì OBJ-001 đã `COMPLETED` trong OPPLAN.
- **Còn mở:** bằng chứng OBJ-001 vẫn nằm trong thư mục lồng `ui-live-8b98a9/ui-live-8b98a9/evidence/`.

### 13.14 Hợp nhất layout workspace và tách infra theo từng stack (2026-10-17, khuya)

- **Layout evidence (A + B):** engagement luôn ở `/workspace/<slug>` trong runtime và sandbox, ở mọi chế độ. Bash tool và daemon fence vào đúng thư mục đó, sandbox theo project mount tại cùng đường dẫn, web runtime gửi `workspace_path=/workspace/<slug>`. Validator handoff từ chối `evidence_storage_path` nằm ngoài `/workspace/<slug>/`. Commit `6ccbe8e`, `5e5772f`.
- **Kiểm chứng layout:** ghi qua `HTTPSandbox` vào `/workspace/<slug>` được; ghi ra ngoài engagement bị daemon chặn 403. Execution ghi `evidence/ssh_22_banner_recheck.txt` đúng đường dẫn tài liệu đã duyệt, không lồng thư mục. Các file bằng chứng cũ bị lồng đã chuyển về `evidence/`.
- **Tách infra theo stack (đảo ngược quyết định W16):** trước đây stack web dùng chung PostgreSQL, Neo4j và LangGraph với stack gốc qua `raptix-net`. Nay stack web có bộ riêng: postgres, neo4j, skillogy, litellm (`docker-compose.web-raptix.yml`, kế thừa định nghĩa từ `docker-compose.yml`, không publish cổng, mạng và volume riêng). Mạng sandbox của web là `raptix_web_sandbox-net` (`RAPTIX_SANDBOX_NETWORK`). Stack gốc giữ bộ riêng của nó.
  - DB `raptix_web_raptix` được copy sang postgres của web bằng `pg_dump`/`pg_restore`: 30 bảng, số dòng khớp. Các writer web được dừng trong lúc copy lần cuối.
  - Corpus skill (`skills.cypher`, `threat-actor-nodes.cypher`) được nạp vào neo4j của web: Skill 324, Technique 697, Tag 885, AssetType 159, khớp với stack gốc.
  - Đã kiểm chứng: từ runtime web, `neo4j`, `litellm`, `skillogy`, `postgres` chỉ resolve về container web; từ LangGraph của stack gốc chỉ resolve về container gốc. Hai bên không thấy sandbox của nhau. Planning conversation chạy được ở cả hai stack.
- **Cổng UI web:** `WEB_RAPTIX_PORT=3001` vì `juice-shop` đang giữ cổng 3000.
- **Còn lại / cần biết:**
  - `raptix-web-litellm-verify-old` là container thủ công còn sót từ lần kiểm chứng trước (trỏ tới `raptix-verify/`). Đã đổi tên và dừng, chưa xóa.
  - DB `raptix_web_raptix` vẫn còn trên postgres của stack gốc như bản sao lưu; chưa xóa.
  - `WEB_RUNTIME_IMAGE_TAG=stable` thay cho `web-m1` để web runtime có các sửa layout và planner.
  - Stack web vẫn dùng chung `raptix-web-p05-final-db` là DB riêng, không liên quan tới runtime.

### 13.15 Đối chiếu trạng thái và đính chính ledger (2026-10-17, đêm)

Đối chiếu với code và bằng chứng đã chạy. Các dòng cũ ở 13.3 và 13.5 được thay bằng bảng dưới đây.

| Phase | Trạng thái | Bằng chứng | Còn thiếu |
|---|---|---|---|
| P00 | Một phần | ADR-0087/0088 Accepted; D01–D08 ghi nhận | Không có inventory 55 key và dirty-file ledger cho lượt này (đính chính: không phải "Xong") |
| P01 | Xong (evidence) | `EvidenceUploadInput` có bytes; transport binary kiểm SHA-256 | Test abort và late-ACK chưa xác nhận |
| P02 | Có code, gate pass | Migration `20261022`; gate `p02-p05` | A01 cần artifact runtime thật |
| P03 | Có code, gate pass | Route captures và attach | Retry sau lỗi trên browser |
| P04 | Có code | Tải bản gốc, kiểm digest | Tamper, traversal, mất quyền trên browser |
| P05 | Có code, gate pass | Trường impact/recommendation/scope; bốn mắt; retest rule | Vòng đầy đủ hai actor trên browser; `finding.auditTrail`, `finding.reportLink` |
| P06 | Backend + API + panel setup, gate pass | Template có version; snapshot; readiness server | Live hai browser (A07); `report.projectInfo` |
| P07 | Một phần | Acknowledgement tách biệt, idempotent | PDF/DOCX hoãn theo quyết định người yêu cầu (D05) |
| P08 | Xong (code) | `RealReportsPanel`, `RealFindingsPanel` đã xóa; project và standalone dùng chung | 8 mục `REAL_CONTROL_GAPS` còn lại |
| P09 | Một phần | Assets (`59b8694`), Library (`a222392`) | Team/Settings, Scope/ROE, Closure, Vault/Audit/Notices, Analysis, Planning/Governance, Inventory vẫn real panel |
| P10 | Chỉ P10a | Tài liệu audit instance runtime | Roster, inbox, outbox, control API chưa có |
| P11 | Chưa | Không có pause intent, checkpoint pause, step control | Cần D07 |
| P12 | Chưa | C2/Operations real panel còn nguyên | Cần P11 cho lifecycle |
| P13 | Chưa | — | Sau các phase trên |

Đính chính: mục 13.5 ghi readiness "chưa có scope version vì DB chưa lưu scope window". Sai: scope revisions đã lưu windows, contacts và restrictions, và `scope/effective` trả về version. Phần còn lại vẫn đúng: PDF/DOCX là exclusion có tên.

Trạng thái 8 control gap: `finding.evidenceLink`, `finding.reportLink`, `finding.reportInclusion`, `finding.auditTrail`, `evidence.original` và `evidence.integrity` (legacy), `report.pdfDocx`, `report.projectInfo`. Ba mục có backend nhưng chưa nối UI: `finding.auditTrail`, `finding.reportInclusion`, `report.projectInfo`.

Phạm vi của lượt tiếp theo: hoàn thiện M-B bằng bằng chứng (A01–A07 trên browser và runtime thật) và đóng các gap có backend. P09, P12, P10 là các việc tiếp theo theo yêu cầu của người yêu cầu. D05 (PDF/DOCX) tạm hoãn đến khi xong P09, P12 và P10.

### 13.16 Bước 1 và bước 2 của M-B: bằng chứng trên browser và runtime thật (2026-10-17, khuya muộn)

Bước 1 kiểm A01–A07 qua browser và API thật (engagement `ui-live-8b98a9`, DB test). Bước 2 đóng các gap có backend. D05 (PDF/DOCX) vẫn hoãn.

| Kịch bản | Kết quả | Bằng chứng | Chưa kiểm |
|---|---|---|---|
| A01 producer → suggestion → import | Đạt | Browser: "Verify & create finding" tạo draft, reload giữ nguyên. API: import replay trả cùng draft; đổi bytes nguồn sau import → 409 và draft được giữ; engagement khác → 404 | — |
| A02 upload → retain → attach | Đạt | Browser: retain unclassified, digest khớp `773f7342…`, link vào finding, còn sau reload. API: replay cùng requestId trả cùng capture; attach với version cũ → 409; attach tới finding không tồn tại → 404, capture vẫn giữ và attach lại được | — |
| A03 inspect / original / download / integrity | Đạt một phần | Browser: classify standard → download bản gốc, SHA-256 khớp digest đã retain. API: sửa bytes trên đĩa → `content` trả 503 "failed its recorded integrity check" | Traversal, symlink, mất quyền với capture sensitive, redaction của preview |
| A04 field / comment / history / refs | Đạt một phần | Browser: Impact và Recommendation lưu và còn sau reload. API: PATCH với version cũ → 409; comment (`text`, `expectedVersion`, `requestId`) replay idempotent, comment với version cũ → 409; activity `kind=comments|history`; asset của engagement khác → 404 | Comment và history trên browser |
| A05 review / retest | Đạt | API: tác giả tự confirm → 403; return không có lý do → 400; return rồi resubmit; transition với version cũ → 409; `Resolved` ở remediation → 409; `Resolved` chỉ ở retest và cần capture đã classify (unclassified → 409); `Persists` giữ remediation; replay requestId khác nội dung → 409; resolved khóa comment, edit, transition; viewer retest → 403. Browser: submit; reviewer confirm qua dialog; nút Confirm/Return của tác giả bị khóa có lý do | — |
| A06 report | Đạt | API: setup template/kỳ/reviewer; reviewer là tác giả hoặc viewer bị 400; finding draft bị từ chối; readiness đủ 5 check; snapshot giữ nội dung khi finding đổi; tác giả không tự quyết (403); version cũ → 409; changes requested → sửa → resubmit → approved; approved khóa edit, chọn finding và submit; export json và markdown. Reviewer bị thu hồi: quyết định trả 404, owner không quyết được, sửa report đưa về draft, gán reviewer mới rồi approve được. Browser: báo cáo approved khóa Save và Submit | Readiness hiện ở tab Review, chưa kiểm trên browser |
| A07 hai editor | Đạt | Browser: hai phiên cùng sửa một draft; lưu thứ hai bị 409 "moved to version 2 … Reload and reapply", nội dung của phiên thứ hai còn trong form. API: approved bất biến | — |

Hành vi đã xác nhận là đúng, ghi để không báo lại như lỗi:
- Sửa finding đã confirmed đưa nó về review (bốn mắt). Báo cáo đã chọn finding đó báo "changed from vN to vM; reselect it" và không submit được cho đến khi chọn lại.
- Sửa báo cáo đang in_review đưa nó về draft. Đây là đường phục hồi khi reviewer bị thu hồi.
- Reviewer bị thu hồi nhận 404 "Project not found", không phải 403. Đây là không tiết lộ sự tồn tại của engagement.

Lỗi tìm thấy và đã sửa:
- `b80317f`: reload trên route finding/report làm mất engagement, màn hình báo "Finding not found".
- `5836766`, `ba13cb4`: không link và không classify được capture unclassified từ finding.
- `f031490`: tác giả thấy Confirm và Return bật được, server từ chối sau khi bấm. Nay khóa với lý do. Trong real mode, các gợi ý vai trò của màn finding không còn nút "Switch to <persona demo>" (nút này không đổi gì trong phiên thật). Bỏ câu audit log bị lặp trong hộp xác nhận.
- `9d78cda`, `e91c174`: cập nhật expectation của test vì route report, finding, evidence giữ `?engagement=` từ `b80317f`.

Đóng gap có backend (`47a59e6`):
- `finding.evidenceLink`: đã gỡ. Link qua attach route, đã kiểm trên browser ở A02. Lỗi "evidence không khớp" của save nay ghi rõ phải link từ tab Evidence.
- `finding.auditTrail`: đã gỡ. Change history trên finding đọc từ activity `history`, kiểm trên browser (hiện "Change history").
- `finding.reportInclusion`: đã gỡ. "Included in reports" đọc từ danh sách báo cáo thật. Kiểm trên browser: finding vừa thêm hiện đúng báo cáo; finding ở báo cáo approved hiện cả ba báo cáo.
- `finding.reportLink`: đã gỡ. Nút "Add" ghi qua `setFindings` ở version đã đọc và invalidate cache `report`. Kiểm trên browser: thêm finding vào báo cáo draft (v5 → v6, từ 2 lên 3 finding); "Open report" hoạt động cho báo cáo đã chứa finding.
- `report.projectInfo`: đã gỡ. "Insert project info" trong real mode đọc `scope/effective` và chèn cửa sổ kiểm thử và version. Kiểm trên browser: `Scope: 2026-10-17T00:00:00Z to 2026-10-24T23:59:59Z UTC. ROE 1.`

Còn lại trong registry: `evidence.original`, `evidence.integrity` (legacy, cần người yêu cầu xác nhận là exclusion có tên) và `report.pdfDocx` (D05, hoãn).

Quyết định còn mở, cần người yêu cầu chọn:
1. Quyền đọc bản gốc của viewer. ADR-0087 mâu thuẫn: dòng Status ghi "viewers never read original bytes", còn quyết định 2 ghi "any authorized engagement member may read standard captures". Server hiện theo quyết định 2 (viewer đọc được capture standard, trả 200). Ledger 13.1 ghi viewer không đọc được. Phương án: (a) khóa viewer, sửa server và ADR; (b) giữ server, sửa dòng Status và 13.1.
2. Capture bị sửa trên đĩa trả 503. 409 hoặc 422 hợp hơn vì lỗi nằm ở dữ liệu lưu, không ở dịch vụ. Đổi cần sửa test; chưa làm.
3. Exclusion cho `evidence.original` và `evidence.integrity` (legacy).

Hạn chế đã biết:
- Danh sách báo cáo đọc qua `useReportList` không phân trang. Dự án có nhiều báo cáo hơn trang đầu có thể thiếu báo cáo trong "Included in reports" và trong dialog thêm finding.
- Nhãn "ROE" trong project info hiển thị version của effective scope. Không có ROE version riêng trong backend.
- "Create a new report with this finding": màn tạo báo cáo có hiển thị finding. Chưa đi tới hết luồng tạo.
- Các `PersonaHint` còn lại ở `b-detail2`, `c.tsx`, `f-report` vẫn có nút đổi persona demo trong real mode. Thuộc P09, chưa đụng.
- Test: chạy cả bộ web có nhiều file timeout 5 giây ở `RealProjectCreateDialog`, a11y, dark-theme, responsive. Chạy riêng từng file đều pass. Đây là flakiness có sẵn khi tải cao, chưa sửa.

Kiểm chứng: `tsc` sạch; các nhóm test findings, reports, router, real, c2, screens chạy riêng đều pass.

Trạng thái sau lượt này: M-B hoàn tất bước 1 và 2 trừ ba quyết định mở ở trên. P09, P12, P10 chưa bắt đầu; D05 vẫn hoãn.

### 13.17 Viewer, toàn vẹn capture, P09 Scope và P10b (2026-10-17, rất khuya)

Theo yêu cầu: khóa viewer với bản gốc (sửa server và ADR cùng lúc); chọn mã lỗi cho capture bị sửa; bắt đầu P09 và P10.

**Viewer không đọc bản gốc (`129ce9b`).** ADR-0087 quyết định 2 đổi: viewer không đọc bản gốc, kể cả capture standard. Server trả 403 cho standard và 404 cho sensitive (như cũ, để không lộ sự tồn tại). `canReadOriginal` là false với viewer. Capture có bytes không khớp digest trả 409 thay vì 503, vì thử lại không sửa được dữ liệu đã lưu (ADR mục 2a). Test `findings-artifacts`: 11 pass, có thêm test viewer và test sửa bytes. Chưa kiểm viewer trên browser; API đã kiểm.

**P09 Scope/ROE (`2f38fdb`).** Port `ScopeService` trong `features/scope` (đọc revisions và effective scope; submit; decide), adapter thật trong `real/service-adapter/scope.ts`, panel dùng chung `features/scope/panel.tsx`. `RealScopePanel` đã xóa. Capability `scope` được server quảng bá. Mock không dùng port: tab Scope của mock vẫn đọc mock store, vì nó còn phụ thuộc operations và plans chưa có port.
- Live API: viewer submit → 403; người gửi tự duyệt → 403; reviewer duyệt → 200; effective scope chuyển sang v2.
- Browser: owner submit từ form → hiện pending và "Awaiting an independent reviewer", không có nút Approve; reviewer bấm Approve → v3 approved, v2 superseded, khớp với server.
- Đổi nhỏ: placeholder "Removed targets" không còn lấy từ inventory (feature layer không gọi api trực tiếp).
- Test: 188 pass (`features/scope`, adapter, router, real screens); tsc và eslint sạch.

**P10b roster (`5526cb6`, `1d5ac89`).** Runtime: mỗi dòng dispatch ledger có thêm `role`. Dòng cũ không có role và hiển thị là null, không suy từ transcript (transcript không có `dispatch_id`). Test mới: `test_ledger_row_names_the_role_that_owns_the_dispatch`; 31 test dispatch pass; ruff sạch. Server: `GET /api/engagements/:id/instances` đọc `dispatch_ledger` của state LangGraph ở mỗi thread gắn với engagement. Thread không đọc được được ghi là unavailable, không hiển thị là rỗng.
- Live: 10 thread đọc được; có instance legacy role null; có outcome `failed` ở attempt 2 (giá trị gốc của runtime); không đăng nhập → 401.
- Test: 3 file, 16 test pass; tsc server sạch.

Chưa làm và cần bước tiếp theo:
- P10b R6 (durability): chưa restart `raptix-langgraph` để kiểm roster còn sau restart.
- P10b: chưa có dispatch mới để xác nhận dòng mới có role; cần chạy một agent thật.
- Ledger chỉ giữ attempt mới nhất của mỗi dispatch (`merge_dispatch_ledger`). Lịch sử attempt cũ không có trong roster; P10d cần thêm nơi lưu lịch sử.
- P10b chưa có UI; P10e làm sau.
- P10c vẫn blocked theo R3 (chưa có safe-point để giao tin nhắn cho child đang chạy).
- P09 còn lại: Team/Settings, Vault/Audit/Notices, Closure, Analysis, Planning/Governance, Inventory, và tab Scope của mock.
- P11 cần D07. P12 cần P11 cho lifecycle. P13 sau cùng.
- D05 (PDF/DOCX) vẫn hoãn.

### 13.18 R6, dispatch thật, roster trên browser, Audit và Inventory (2026-10-17, rất khuya hơn)

**R6 (durability), đã kiểm xong.** Restart `raptix-langgraph` ba lần, mỗi lần so trạng thái các thread của engagement với snapshot trước đó:
- Lần 1 (trước dispatch mới): 10 thread, 5 dòng ledger, giống hệt sau restart.
- Lần 2 (sau dispatch thật `OBJ-002`): 11 thread, 8 dòng ledger, giống hệt sau restart.
- Lần 3 (sau khi build lại image và tạo lại container bằng `docker compose up -d --no-deps langgraph`): 11 thread, 7 dòng, giống hệt snapshot trước đó.
Trạng thái nằm trên volume `raptix_langgraph_state` (`/app/.langgraph_api`), nên sống qua restart và recreate. Pin trong `.env` (`RAPTIX_ENGAGEMENT`, `/workspace`) được giữ nguyên.

**Dispatch thật.** Lần chạy đầu bị từ chối với `The bound ROE version is stale`. Nguyên nhân là chính phê duyệt scope v3 của tôi: nó thay thế ROE mà thread cũ đang gắn. Thread mới cũng bị từ chối vì chưa có plan approved gắn vào. Tôi đã duyệt một plan mới trên ROE hiện tại với reviewer độc lập, gắn vào thread mới, và preflight pass cả 8 check. Sau đó:
- Agent tạo `OBJ-002` và dispatch `recon` đúng một `GET /` tới `10.129.227.140:80`. Kết quả 200 OK, `Server: Werkzeug/2.1.2`. Không có path, port hay payload nào khác.
- Đã kiểm trên đĩa: `evidence/http_80_headers.txt` chỉ có status line và headers. SHA-256 bắt đầu bằng `fc1078f6…`, khớp với giá trị agent ghi.
- Một dispatch thứ hai, chỉ tính toán cục bộ (không gọi mạng), tạo dòng ledger có `role: recon`. Đây là dòng đầu tiên có role từ runtime live.

**Roster trên browser (`3b1687b`).** Tab Agents của thread hiện `recon · attempt 1` cho dòng có role, và `role not recorded` cho các dòng cũ. Browser phải đợi khoảng 9 giây vì endpoint đọc 11 thread state mất khoảng 2 giây.

**Audit (`c63130d`).** Port `AuditService` có adapter thật, panel dùng chung nằm trong `features/audit`, và `RealAuditPanel` đã xóa. Browser: tab Activity & Audit liệt kê bản ghi scope, bộ lọc action giữ đúng các dòng `scope.`. Test: adapter 2 pass, panel 3 pass.

**Inventory (`dc21849`).** `RealInventoryPanel` là code chết: route `assets` là migrated route, host render màn hình chung trước khi tới real page, và không có tab Inventory nào trong real detail. Đã xóa cùng nhóm panel `assets` không còn route nào dùng. Route-table test pass.

Việc còn lại (không làm trong lượt này, không đánh dấu là xong):
- P09: Team/Settings, Vault, Closure, Analysis, Planning (402 dòng), Governance (482 dòng), và tab Scope của mock. Analysis cần quyết định parity: port mock tính coverage từ operation mock, còn real trả về graph observed. Hai mô hình không khớp nhau, nên không nên ép vào một port mà chưa chốt.
- P10: P10c vẫn blocked theo R3, vì chưa có safe-point để giao tin cho child đang chạy. P10d cần endpoint retry và reassign theo attempt, và cancel riêng cho child đang unsupported theo R5. Ledger chỉ giữ attempt mới nhất của mỗi dispatch, nên lịch sử attempt cần một nơi lưu riêng.
- P11: cần pause safe-point và checkpoint trong runtime (D07). Chưa bắt đầu.
- P12: chưa bắt đầu. Lifecycle phải đợi P11. Phần read-side C2/Operations chưa làm.

Dữ liệu test còn lại trên engagement `ui-live-8b98a9`:
- Thread execution `93702a2f…` gắn plan đã duyệt (hết hạn 2026-10-18T14:30Z), có dispatch thật.
- Scope revision v2 và v3 đã approved.
- Vài reviewer và viewer được invite cho các phiên kiểm tra.
- Output của agent trong `tests/local/artifacts/ui-contract-target/ui-live-8b98a9/` (`evidence/`, `findings/`, `report/`, `recon/`).

### 13.19 P09 hoàn tất, P12 (C2, Operations, Fleet, thông báo), và trạng thái P10/P11 (2026-10-18)

**Commit theo thứ tự:** `1b66a005` (route settings dùng trang chung; HEAD trước đó không build được vì còn import màn hình đã xóa), `751c53fb` (closure chặn gửi yêu cầu khi checklist fail, kèm test), `d6e484b5` (dọn import lint), `0abd37b7` (Planning và Governance), `cadd977e` (thao tác console C2 và operation đi qua port), `13873405` (C2 provider), `1ec7bca4` (Operations), `020b4b11` (Fleet), `ff180f03` (persona switch chỉ ở mock), `bc5ee712` (notice center). Không push, không có dòng co-author.

**P09.** Scope & ROE, Team, Settings, Vault, Audit, Closure, Analysis, Planning, Governance và Notices đều có port và panel/tab dùng chung. Khi mock có cùng model thì mock adapter ánh xạ dữ liệu mock; khi mock không có model tương đương (tài liệu planning, business plan, C2 provider, runtime operations) thì port chỉ có real và mock giữ màn hình riêng, ghi rõ trong code. Inventory đã xóa từ 13.18.
- Còn lại chỉ ở phía mock, không phải real panel: inbox phê duyệt trong tab Team & Approvals của mock; plan review mock (`g-plan`) và session console mock (`h-session`, `c-console`) chỉ đổi lời gọi sang port.
- Kiểm chứng tĩnh: `tsc` sạch; `eslint src` sạch; test đơn vị và adapter cho từng slice đều pass.
- Vitest toàn bộ: lượt cuối 1285/1292. Các lỗi còn lại nằm ở test theo thời gian (RealProjectCreateDialog, a11y-audit, dark-theme-audit, responsive-audit, copilot drawer, tùy lượt), và mỗi file pass khi chạy riêng. Chưa xử lý độ ổn định dưới tải.
- Live (engagement test `cmvc9u94y000e6gfiknyh78rj`, trình duyệt thật, real mode): Planning tải tài liệu, lưu rồi hủy draft server-side, nội dung published không đổi. Governance: draft → propose; approve bởi cùng người bị server từ chối ("requires an independent actor"); stop cấp project → bind bị preflight từ chối ("An emergency stop is active"); resolve; schedule tạo rồi hủy. Notices: 13 thông báo chưa đọc lấy từ server; không có nút đổi persona.
- Tồn đọng từ thao tác live: plan `live check mvcpjakk` v3 còn ở trạng thái proposed trên engagement test. Chỉ reviewer độc lập mới quyết định được nó.

**P10.** P10a đã audit (13.9). P10b xong: role trong ledger, endpoint roster, roster trên UI (13.18). P10c vẫn **blocked** theo R3: chưa có safe-point nên không dùng queue in-memory thay thế. P10d chưa làm: cần endpoint runtime cho cancel theo instance, retry và reassign theo attempt, và nơi lưu lịch sử attempt (ledger hiện chỉ giữ attempt mới nhất). P10e chỉ có phần đọc (roster); các control, câu hỏi gắn đúng interrupt và batch answer chưa có.

**P11: chưa bắt đầu.** Cần safe-point pause trong runtime và chốt D07 (semantics resume/checkpoint, điều kiện complete). Đây là thay đổi LangGraph có test riêng, không làm trong lượt này. Hệ quả: Operations không có pause, resume hay complete, và tab nói rõ điều đó.

**P12.**
- Bước 1 (đưa lời gọi authority/clock của màn hình ra port): xong. `h-session` (cấp, thu hồi, gửi lệnh, hết hạn grant) và `c-console` (pause, resume, stop, complete, và đọc preflight) đi qua port. Clock nằm trong mock adapter. Hai test cũ được sửa để chờ kết quả port.
- C2 provider: xong. Port, adapter và tab dùng chung gồm grants, listeners/profiles, console và các route session/channel. Adapter test 5 ca; tab test 6 ca. Live: provider không được cấu hình trên deployment này, nên banner hiện "C2 session provider not configured; no session registry exists in this build", không có form dispatch, và route session không trả session thay thế. Round-trip live với provider thành công **blocked**: cần lab provider (theo plan).
- Operations: xong. Tab thread, run, timeline và cancel dùng chung (10 test; live 8/8). Lifecycle chờ P11.
- Fleet: xong. Tab dùng port runtime (6 test; live 4/4). Endpoint fleet mất khoảng 5 giây mỗi lần đọc trên deployment này; tab hiện skeleton trong lúc chờ.
- Campaigns: giữ route thật có tên (retained). Listeners và profiles đã nằm trong C2 tab; generate và deploy giữ nguyên. Chưa đưa vào shared presentation.
- Results và Trace: cây hiện tại không có panel real nào cho hai màn này. Chưa kiểm.

**Phát hiện cần quyết định (chưa sửa):**
- Server nhận yêu cầu grant cho session id mà provider không báo cáo (live: `sess-live-check`). Bản ghi `requested` được tạo; gửi lại thì bị từ chối là "identical grant request is already pending review". Bản ghi này còn trên engagement test, và chỉ reviewer độc lập quyết định được. Plan P12 yêu cầu giữ "ROE target checks": cần chốt có kiểm session tồn tại trong namespace khi request hay không. Đề xuất: kiểm ở lúc request và ghi ADR nếu giữ hành vi hiện tại.
- Hiệu năng: `/fleet` mất khoảng 5 giây mỗi lần đọc trên deployment này.

**Chưa làm trong lượt này:** P10c, P10d, P10e (phần control), P11, Campaigns generate/deploy, Results và Trace trong real mode, và `make quality` đầy đủ. Không đổi Python trong lượt này nên chưa chạy lại suite Python.

### 13.20 Quyết định tiếp tục P10 (2026-10-18)

Requester chốt: `handled` nghĩa model turn hoàn thành, không chứng nhận action success; không tự chuyển tin giữa attempts; cancel cooperative, retry/reassign do operator yêu cầu và chỉ tạo replacement sau khi attempt cũ terminal. Giữ đầy đủ P10 và acceptance, không có exclusion mới. [ADR-0089](../adr/0089-pin-instance-delivery-and-controls-to-attempts.md) ghi boundary và semantics.

HEAD khi bắt đầu: `f346e1a9`. Bốn commit sau 13.19 đã thêm mailbox SQLite, model-call hook, running roster, Fastify facade và UI Messages. Đây là implementation ban đầu, chưa đóng P10c: cần pin attempt, stable intent qua lost ACK, retry delivery sau lỗi model và disposition khi restart. P10d/P10e controls và acceptance tiếp tục trong lượt này. Test selection: mailbox store/routes/middleware, dispatch boundary và deterministic child graph; server instance-mailbox/runtime-instances, UI instance-messenger; typecheck/lint owning code. Không chạy full suite.

### 13.21 P10c/P10d/P10e: implementation theo ADR-0089 (2026-10-18, lượt tiếp)

Base `f346e1a9`; thay đổi chưa commit. Theo ADR-0089 (vẫn Proposed cho đến khi có bằng chứng live).

**Đã làm:**
- **Mailbox runtime** (`execution/session/instance_mailbox.py`): message pin theo attempt (`expectedAttempt`); cùng id khác body/attempt/nguồn là `message_id_conflict`; cancel cooperative (`cancel_requested` → `cancelled` khi dispatch kết thúc, tin chờ thành `undelivered`); restart đưa attempt đang chạy về `interrupted`; lỗi model giữ tin ở cùng attempt để giao lại. Thêm `intent` và `objective_id` theo attempt (retry tái phát đúng intent), `source_message_id` (forward), `max_attempt` (attempt mới luôn vượt mọi attempt đã ghi). Migration additive đã kiểm trên DB cũ: dòng cũ giữ nguyên.
- **Dispatch** (`middleware/dispatch.py`, `core/dispatch_context.py`): cancel kết thúc với outcome `cancelled` và không tính là lỗi resilience; attempt mới lấy floor từ mailbox (lỗi đọc mailbox không làm hỏng dispatch).
- **Runtime HTTP** (`interfaces/api/plugins_api.py`): `POST /_raptix/instances/{t}/{d}/cancel`; message yêu cầu `expectedAttempt` và nhận `sourceMessageId`; GET attempt trả `intent`/`objectiveId` (chỉ server dùng).
- **Fastify** (`services/runtime/run-service.ts`, `runs.routes.ts`): cancel; `commands` cho retry/reassign, chỉ khi attempt đã terminal và `expectedAttempt` khớp, replacement là orchestrator run với `requestId = commandId` nên lost ACK replay được; `messages/forward` chỉ lấy message có thật trên cùng thread. `intent` không ra browser.
- **UI** (`real/screens/instance-messenger.tsx`, `execution-agents.tsx`, `real/api.ts`): Cancel hiện "requested" cho tới khi attempt đọc `cancelled`; Retry/Reassign sau terminal; Forward giữa các instance đang chạy; mọi tin gửi kèm `expectedAttempt`.
- **P10e câu hỏi**: payload `ask_user` gắn dispatch/attempt; `PendingInterruptView.instance` (web-contracts); card hiển thị instance nguồn. Batch answer giữ ở cấp thread vì resume bắt buộc trả lời đủ mọi câu hỏi pending.

**Kiểm chứng (tập trung):** ruff sạch trên file đã sửa; pytest mailbox/middleware/routes/dispatch-boundary/fanout/ask_user (xem lượt chạy cuối); server `tsc` sạch + vitest instance/runtime/run-policy 23/23; web `tsc` sạch + vitest messenger/roster/api 16/16.

**Chưa đạt (P10 vẫn mở):**
- Acceptance live: chưa chạy model thật. Retry/reassign phụ thuộc orchestrator gọi lại đúng description; nếu sai, dispatch refuse bằng `dispatch_conflict`. Chưa có bằng chứng.
- Chưa có test deterministic child-graph cho cancel race, parent stop, sibling isolation, hai instance cùng role và restart giữa chừng.
- Restart durability của cột mới chưa chạy trên `raptix-langgraph` thật.
- Messenger chưa liệt kê câu hỏi pinned; hiện chỉ có nhãn ở root conversation.
- Lineage reassign chỉ có trong run message, chưa có bảng lineage riêng.
- Instance DTO còn trong `api.ts` và `run-service.ts`, chưa chuyển vào `@raptix/web-contracts` như ADR-0089 yêu cầu (chỉ `PendingInterruptView` đã vào shared).
- Pause theo instance thuộc P11, không thuộc P10.

### 13.22 Live P10 trên lab 10.129.227.140 (2026-10-18)

Engagement `cmvbilcji000035pdx8khoigh` (scope v1 đã duyệt, ROE đến 2026-10-24). Reviewer độc lập được tạo riêng cho lượt này. Plan HTTP-only (`cmvdcnpng…`) được owner propose, reviewer duyệt, rồi bind vào các thread execution. Stack web được build lại từ code hiện tại (`web-runtime`, `web-raptix-api`, `web-raptix-ui`).

**Đã kiểm chứng live:**
- Roster: attempt có role, số attempt tăng dần, nguồn đúng (mailbox khi đang chạy, ledger khi đã ghi).
- Message tới attempt đang chạy: `accepted`, sau đó `undelivered` với outcome `instance_finished` khi attempt kết thúc trước safe point tiếp theo. Không có tin nào bị mất âm thầm. **Chưa thấy `delivered` hay `handled`**: subagent kết thúc quá nhanh vì bash bị từ chối.
- Cancel: `cancel_requested` (200), sau đó `cancelled` khi model call đang chạy kết thúc (~1 giây và ~25 giây ở hai lần chạy). Sau khi sửa, ledger và mailbox đều ghi `cancelled`.
- Durability: mailbox giữ nguyên qua `docker restart` của runtime (hai thread, so sánh từng dòng).

**Lỗi tìm được và đã sửa (commit trong cùng lượt):**
- Ledger ghi `failed` trong khi mailbox ghi `cancelled`, khi bash lỗi ở cùng boundary với cancel. Roster ưu tiên dòng ledger nên UI sẽ hiện `failed`. Sửa trong `_finish`: cancel của operator quyết định outcome.
- `test_dispatch_boundary` fail vì mailbox mặc định (`.langgraph_api`) dùng chung giữa các lần chạy. Thêm `packages/raptix/tests/conftest.py` cách ly mailbox theo từng test. Sau đó 28/28 pass.

**Điểm nghẽn chưa sửa (cần quyết định, xem câu hỏi gửi người yêu cầu):**
- **Identity của engagement không nhất quán.** Web runtime không pin (`RAPTIX_ENGAGEMENT: ''`, commit `f4c7a008`). `opplan.add_objective` chỉ ép tên pin khi có pin, nên khi không có thì nhận `engagement_name` do model cung cấp, tức tên trong `roe.json` ("Popup Lab Assessment"). Slug workspace là `popup-lab-lbvq`. Hệ quả đã kiểm chứng: (a) fence `bash_workspace` refuse mọi bash; (b) `runtime-context.ts:66` refuse mọi run sau trên cùng thread với 409. Vì vậy **retry, reassign và forward không thể chạy live** trên thread đã có một run.
- **Orchestrator tự dispatch lại sau cancel** trong một trong hai lần chạy (dispatch mới cùng role và objective, không qua operator). Lần còn lại không xảy ra. Đây không phải do P10, nhưng đi ngược ý định cancel của operator.
- Chưa chạy live: forward (cần hai attempt đồng thời), retry/reassign admission, pin câu hỏi theo instance, hai instance đồng thời, cancel race với parent stop, và restart khi có attempt đang chạy.

**Trạng thái P10:** vẫn mở. Đóng được: identity, history, cancel, durability của mailbox. Chưa đóng: message delivered/handled, forward, retry/reassign, recovery giữa chừng, và acceptance hai instance.

### 13.23 Luồng chính live và điểm dừng (2026-10-18)

**Deployment để mở:** UI `http://127.0.0.1:3001` (proxy tới API `raptix-web-raptix-api`, healthy). Image build từ source `de37925c` (API, UI kèm `66689bc3`) và `66689bc3` (runtime `raptix-web-raptix-web-runtime-1`, `langgraph dev --no-reload`). Engagement lab `cmvbilcji000035pdx8khoigh` (target 10.129.227.140, ROE đến 2026-10-24, scope v1). Plan HTTP-only `cmvdcnpng000337pislty8v1n` đã duyệt bởi reviewer độc lập và bind vào thread execution.

**Đã sửa (commit):**
- `075eedbb`, `767f12ac`: identity run (ADR-0090). OPPLAN không còn ghi `engagement_name` từ model hay từ `opplan.json`; fence bash kiểm tra theo workspace slug khi không có pin. Thread test mới chạy được nhiều run liên tiếp (`local1`: run gốc, retry, reassign).
- `42af01b0`, `0cc2fa67`: operator grant. Retry/Reassign chạy persisted intent qua admission; grant `consumed` sau khi attempt bắt đầu.
- `66689bc3`: intent đã bị interrupted không được replay tự động (`interrupted_intent`).
- `de37925c`: planning bị chặn 409 vì run cũ kết thúc không ai quan sát vẫn giữ active slot. Submit giờ đối soát run trước khi reserve.
- `ca928fad`: stack nghiệm thu chạy `langgraph dev --no-reload`.

**Đã quan sát live (API thật, model/tool thật, output thật):**
- Roster đúng attempt/role; message `accepted → delivered → handled (model_turn_completed)` trên attempt đang chạy (`local1`, attempt 1).
- Cancel qua Fastify: `cancel_requested` → `cancelled` khoảng 9 giây; ledger ghi `cancelled`, khớp mailbox; không có redispatch tự động.
- Retry có grant (`local1`, attempt 2, cùng dispatch, intent 1635 ký tự trùng bản đã persist, grant `consumed`).
- Reassign sang `analyst`: dispatch mới `…-rf6e8e63bc1f4`, attempt chạy đúng role.
- Restart runtime lúc attempt đang chạy: attempt → `interrupted`, message → `undelivered/instance_interrupted`. Orchestrator sau đó lập intent khác (`REMAINING STEP ONLY`); intent này được admit như dispatch riêng. Retry operator trên attempt bị interrupted chạy lại đúng intent (`recov2`).
- Parent stop lúc attempt đang chạy (`parent`): attempt → `interrupted`, message chờ → `undelivered`, run → `interrupted`.
- Planning: run → `pendingQuestions` (ask_user của soundwave) → resume bằng `questionId` → run `success`, pending xóa (thread `340e0f18`).
- Report: tạo report từ output run thật (thread `f6fa5925`), export JSON và Markdown đều 200 (`cmvdhsdg100033mqobhfpd6dp`). Không có finding nào được tạo; lab hiện có 0 finding.
- HITL bash: mọi lệnh bash cần duyệt (`RAPTIX_HITL__REQUIRE_BASH_APPROVAL=1`). Trong lượt này duyệt bằng script chỉ cho lệnh cục bộ không chạm target; lệnh tới 10.129.227.140 bị deny. Đây là hành vi duyệt của lượt test, không phải duyệt của người dùng.

**Chưa đạt / còn mở:**
- **Browser:** không có công cụ browser trong phiên này. Chưa click qua UI. Các API đằng sau từng bước đã kiểm chứng ở trên.
- **Forward:** attempt A nhận message `handled` (`fwd`); run 2 bị 409 vì run 1 treo do vòng sleep của model. Chưa chạy forward live.
- **Hai instance cùng role đồng thời:** model dispatch tuần tự dù được yêu cầu song song (`pair`). Chưa có bằng chứng live.
- **Pin question theo instance:** đường `ask_user` của execution assistant không có tool này. Pin chỉ kiểm chứng ở planning (không có instance). Batch resume giữ nguyên.
- **P11:** pause/resume/complete chưa implement trong lượt này. Cần runtime pause safe point và continue-run (LangGraph input null) với checkpoint; chưa làm.
- **P12:** Results/Trace/Fleet/C2 không đổi trong lượt này. Campaign và C2 nằm ngoài luồng chính.
- Các thread test có run `interrupted` lịch sử và reviewer account trong lab DB, giữ làm evidence.

**Trạng thái P10:** vẫn mở (forward, hai instance đồng thời, pin question live). P11, P12: mở.

### 13.24 P11 backend và live; C2 grant verification; P10 deterministic (2026-10-18, phiên tiếp)

**Đã làm (commit):**
- `72ccc1c9`: pause, resume, complete qua runtime checkpoint. Pause ghi `pause_requested` trước khi cancel ở safe point; `paused` chỉ khi runtime báo run `interrupted`. Resume là run mới trên cùng thread với `input: null` (tiếp tục checkpoint, không gửi prompt cũ). Complete là audit `operation.completed` sau khi run terminal, không còn instance chạy, không còn request uncertain, và không đổi status run lỗi. Tái dùng `OperationBinding.status`, không thêm bảng.
- `2c06098e`: gate plan (`assertExecutionAuthorized`) chấp nhận `pause_requested`/`paused`, vẫn chặn `completed`. Submit tin nhắn mới bị từ chối khi operation paused/completed.
- `2942658a`: C2 grant yêu cầu session phải được provider báo cáo trong namespace engagement, khi request và khi approve. Provider chưa cấu hình trả 503; không giả định session tồn tại.
- `af1befa6`, `135390d1`: test C2 verification; test hai dispatch cùng role giữ ledger row và mailbox instance riêng.

**Live (lab `cmvbilcji000035pdx8khoigh`, thread `a81a9b14-…`, plan `cmvdcnpng…`):**
- Run `01a14e07` chạy, pause → `paused`, run `interrupted`.
- Tin nhắn mới khi paused bị 409 "This operation is paused; resume it…".
- Resume → run `01a14e09` `success`; số user message trước/sau = 1/1 (không prompt mới).
- File `recon/p11.txt` có `part1` một lần (trước pause) và `part2` một lần (sau resume): không side effect lặp.
- Complete khi run còn active → 409 "The runtime run is still active."; complete sau khi run success → 200 `completed`; audit `operation.completed` ghi trong `WebAuditEntry`.
- Quan sát: approval bash đang chờ làm run treo; approver (chỉ lệnh cục bộ) được khởi động lại mới đi tiếp.

**Còn mở:**
- P11 UI: nút pause/resume/complete trong Operations chưa có (thuộc phạm vi session UI đang làm).
- P11 step controls: chưa có step model; OPPLAN objective là ứng viên, cần quyết định mapping.
- P12: Results/Trace (panel + adapter), C2 round-trip Sliver trong Docker lab, campaigns vẫn blocked theo ROE.
- P10: forward live; hai instance đồng thời live; pin câu hỏi trong messenger (UI); DTO instance vào `@raptix/web-contracts`.
- P01: test abort và late-ACK. P00: inventory 55 key. P02–P06: browser acceptance. P09: parity checklist và mock-only (UI). P13: chưa làm.

**Lưu ý phối hợp:** trong lúc làm, các file runtime Python (`instance_mailbox.py`, `dispatch_context.py`, `dispatch.py`, `plugins_api.py`) đã được sửa bởi phiên khác (có thêm `parent_dispatch_id`). Phiên này không commit các thay đổi đó.

### 13.25 Phần C đã xử lý và quyết định của owner (2026-10-19)

**Quyết định của owner:**
- Tách thay đổi đang dở thành commit theo concern (đã làm, xem bảng commit).
- Map step với OPPLAN objective (D07). Phần đọc đã có từ planning view (`opplan.objectives`, `status`, `blockedBy`); phần ghi (approve/return/skip) chưa làm vì đổi trạng thái plan mà runtime đọc khi chạy, nên cần làm khi không có run đang hoạt động.
- Cho phép đổi prompt/tool để chạy song song (P10). Chưa thực hiện: cần chạy live trên project đang hoạt động.
- Dựng Sliver trong Docker lab cục bộ (P12). Chưa thực hiện: cấu hình provider cần khởi động lại web API.
- PDF, DOCX, Markdown đều thuộc phạm vi và được phép tải thêm dependency (D05). Chưa thực hiện.
- Owner D06/D07/D08: owner chốt theo đề xuất mặc định trong §4 khi có quyết định cụ thể; mục này vẫn mở cho từng phần ghi.
- `apps/web/.scratch/frontend-backend-integration` có trong checkout; các tham chiếu tới thư mục này là hợp lệ.
- Lab: project `cmvdticfo000036n169e70nz9` (Reddish-1.0), target `10.129.84.232`, authorization đã xác nhận.
- HITL: owner đã test tạm hoàn chỉnh.
- Cho phép chạy `raptix web sandboxes sync` và tự cài tool khi thiếu.

**Ràng buộc trong lượt này:** runtime đang chạy `make cli-dev` trên project thực tế, không được interrupt. Không restart container, không chạy live test trên lab, không sửa `apps/cli`. Image API/UI/runtime đã build nhưng chưa deploy.

**Commit đã tạo (từ `f41e4cfa`):**

| Commit | Nội dung |
|---|---|
| `3011292c` | runtime: per-conversation HITL switch và dangerous-method approval |
| `2d4939f3` | CLI gửi `workspace_path` của subtree engagement; cập nhật hash fixture parity |
| `26d60eb7` | web: lưu HITL switch theo thread và expose qua HTTP |
| `06a47c09` | web: HITL switch và Plan \| Execute toggle trong AI workspace |
| `27ff9f44` | planning: validate plan document, gate execution theo handoff; regenerate skill graph |
| `7e69e84b` | web: render markdown table; cập nhật audit test |
| `a4ab6bb5` | web: Evidence trong sidebar project thật |
| `3b971a61` | launcher: sandbox sync không xóa sandbox đang chạy |
| `2c2c67e6` | docs: thuật ngữ capture classification, env cho CLI local, skill cleanup |
| `3108fc5c` | P12: panel Trace và Results thật cho route `ai-trace` |
| `b69a3a98` | P10: chuyển DTO lệnh instance vào web-contracts, có wire guard |
| `2cec344a` | P01: abort của caller không bị hiển thị như lỗi (`guarded`) |
| `5b33f30e` | P00: inventory 55 key đối chiếu với registry; gate manifest cập nhật |
| `5990ba68` | P09: ổn định test UI (maxWorkers=4, timeout) |

**Chưa commit (không thuộc phạm vi):** `README.md` (viết lại toàn bộ, cần owner quyết định), `.gitignore` (thêm `benchmarks/scenarios/`, đang ảnh hưởng benchmark đã track), `benchmarks/scenarios/reddish/inputs/prompt.txt`, `apps/web/src/screens/f.tsx` (phiên khác đang sửa; lint còn 5 lỗi `react-refresh/only-export-components`), các file untracked (`infra-test.log`, `now.txt`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`, `docs/proposals/temp.md`, `docs/design/2026-10-12-*`, `docs/design/2026-10-19-*`).

**Kiểm tra đã chạy:** pytest raptix-core + middleware + tools: 1865 pass, 2 skip. Server vitest: pass (graph-service timeout khi chạy song song, pass khi chạy riêng). Web vitest: 1333/1333 pass với `--maxWorkers=4`. Typecheck web và server: pass. ESLint: `f.tsx` còn lỗi. Launcher go test: pass. CLI useAgent test: pass. Skill audit strict: 0 vi phạm.

**Chưa làm (cần runtime hoặc quyết định):**
- P10: forward live, hai instance cùng role live (cần prompt/tool, cần chạy trên project đang hoạt động).
- P11: acceptance còn lại (paused restart, question vs pause, stop race, deadline, double resume); step controls (cần quyết định ghi).
- P12: C2 Sliver round-trip; campaigns giữ blocked.
- P02–P06: browser acceptance còn lại (xem §2).
- P04/P05/P06 nhánh còn thiếu; P07 PDF/DOCX/Markdown (đã được duyệt, chưa làm).
- P09: mock-only (inbox phê duyệt trong Team, `g-plan`, `h-session`, `c-console`); lint `f.tsx`.
- UX: sandbox thiếu bị retry 150 giây; `_retry_on_connection_error` cố ý retry để chờ VM boot, và test hiện có khẳng định `httpx.ConnectError` là kiểu lỗi khi hết budget. Cần quyết định: giữ budget, hay fail nhanh kèm thông báo rõ.
- P13: chưa làm.
- Plan `2026-10-19-single-active-project-environments` (I00–I09) mới được đề xuất. Nó thay đổi cách activate runtime và xung đột với luồng đang chạy; chưa triển khai.

### 13.26 Results, C2/c-console, P07 và checklist P09 (2026-10-19, tiếp)

**Results (P12):** panel `ThreadResults` trong chi tiết operation hiển thị run theo status thô của runtime, branch từ fleet, và findings có `references.threadId` hoặc `runId` của thread. Dùng endpoint runtime và curated findings sẵn có; chưa có adapter backend mới. Còn lại: proposed findings do AI đề xuất, và nút tạo/đính kèm finding từ operation.

**C2 và c-console (P12):** `h-session` và `c-console` không còn gọi `services.authority` hay `services.clock`; chúng đi qua `services.c2` và `services.operations`. Real composition không gọi mock authority hay clock. Vẫn còn import giá trị từ module feature dùng chung (các hàm `unavailable*` không có state, và `demo-clock`). Không đổi cấu trúc import, vì mock và real nằm chung một bundle và chỉ chọn chế độ lúc chạy.

**P07 PDF/DOCX/Markdown:** server render PDF và DOCX từ cùng snapshot với Markdown và JSON (`report-render.ts`). PDF nhúng DejaVu Sans để hiển thị đủ dấu tiếng Việt. Deliver kind `export` nhận `pdf` và `docx`. Artifact có trường `encoding`; byte nhị phân đi dưới dạng base64 để replay của delivery vẫn là chuỗi. UI real bật Export PDF và Export DOCX cho báo cáo đã approved và lưu file trả về. Đã gỡ gap `report.pdfDocx`. Dependency thêm vào server: `docx`, `pdfkit`, `@types/pdfkit`, `dejavu-fonts-ttf`.

**P09 checklist:** `docs/design/2026-10-19-p09-parity-checklist.md` liệt kê 50 nhãn hành động trên màn mock: 9 có bằng chứng trong code, 31 cần kiểm tra UI, 10 chỉ-mock. Đây là danh sách việc, chưa phải bằng chứng parity; cần xác nhận từng dòng trên browser.

**Commit trong lượt này:** `03fa8679` (Results), `4ff23dcb` (sửa type test P01), `5a7e7e24` (PDF/DOCX server), `d2889ba4` (PDF/DOCX UI), `7094c8aa` (checklist P09).

**Kiểm tra:** server 53 file, 480/480 test; web 140 file, 1344/1344 test (`--maxWorkers=4`); typecheck web và server pass. Lint web còn lỗi ở `apps/web/src/screens/f.tsx` do phiên khác đang sửa; không thuộc các commit trên.

**Còn lại (cần live hoặc quyết định):** P10 forward và hai instance cùng role; P11 acceptance và step controls; P12 Sliver; P02–P06 browser; P09 xác minh checklist và các surface chỉ-mock (inbox phê duyệt, plan review, session console); P13.

### 13.27 Phần không cần live, theo mặc định đã chốt (2026-10-19)

**Mặc định đã áp dụng** (owner chưa đổi):
- Surface chỉ-mock: inbox phê duyệt làm thật; plan review (`g-plan`) và session console (`h-session`, `c-console`) ghi là **exclusion có tên** chờ owner xác nhận. Lý do: runtime chưa có khái niệm plan review riêng và session console là mock demo.
- P11 step controls: chỉ đọc. Panel Steps liệt kê OPPLAN objective với status plan mang, không có nút ghi.
- Trace: giữ tool trace thô; không map facet Policy/Approval/Execution.

**Đã làm:**
- P04 (server): file retained bị xoá trả 409 "missing from storage" thay vì 404 chung; thành viên bị gỡ nhận 404 "Project not found" (không lộ sự tồn tại project).
- P05 (server): test Partial đưa finding về remediation; Resolved bị từ chối khi chưa ở retest hoặc chưa có capture đã phân loại.
- P06 (server): approved export không đổi (content và digest) khi finding được pin bị sửa sau approve; reviewer bị gỡ membership không quyết định được. Race hai editor mới phủ bằng stale write tuần tự (409 khi expectedVersion cũ); race đồng thời chưa có test riêng.
- P09: inbox "Waiting for a decision" trên tab Team, lấy từ task view server, lọc theo project, có trạng thái rỗng và lỗi.
- P11 (đọc): panel Steps trong chi tiết operation.
- P12: nút Create finding và Attach evidence trong Results; ghi chú rằng proposed findings chưa xác minh và được duyệt ở tab Findings. Danh sách proposed findings chưa hiển thị trong Results.
- P07 kiểm tra: đã render PDF mẫu và xem ảnh; tiếng Việt hiển thị đúng. **Giới hạn:** text layer không ánh xạ được dấu (copy và tìm kiếm trong PDF sai với dấu); cần xử lý ToUnicode của font subset, theo dõi riêng.

**Commit:** `aaa269e0` (artifact thiếu file), `dcedad86` (test P05), `e889fba4` (test P06), `f65d8ee1` (inbox phê duyệt), `797a335d` (steps và hành động Results).

**Kiểm tra:** server 53 file, 485/485; web 142 file, 1349/1349; typecheck web và server pass; eslint sạch trên các file đã đổi. Lint `f.tsx` vẫn lỗi do phiên khác.

**Chưa làm (không phải live nhưng cần quyết định hoặc việc lớn):**
- Quyết định mở: retry sandbox 150 giây; semantics ghi step (approve, return, skip); xác nhận exclusion plan review và session console.
- Proposed findings đầy đủ trong Results; Trace facets.
- Giới hạn text layer của PDF.
- P13: dọn panel và gate cũ (cần rà soát có hệ thống); dirty-file ledger.

**Còn live:** P10 forward và hai instance cùng role; P11 acceptance (paused restart, question vs pause, stop race, deadline, double resume đồng thời); P12 Sliver; P02 producer output và browser click-through P02–P06; build digest và acceptance trên stack deploy.
