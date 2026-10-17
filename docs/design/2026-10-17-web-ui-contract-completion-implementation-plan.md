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

### 13.3 Tiến độ theo phase (cập nhật sau lượt triển khai này)

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

### 13.5 Lệch khỏi plan đã biết

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

