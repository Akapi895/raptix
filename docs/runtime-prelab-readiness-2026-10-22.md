# Runtime pre-lab: checklist cải thiện, kiểm chứng và freeze

Ngày lập: **2026-10-22**. Base HEAD: **`d2f82baa`**, cộng các thay đổi chưa commit của đợt pre-lab.

**Trạng thái: chưa freeze runtime.** Model, sandbox và workflow kết quả đã có evidence từng chặng. Còn thiếu canary xuyên suốt qua browser trên đúng bộ image/config và sandbox routing sẽ dùng cho lab.

## 1. Mục tiêu và phạm vi đã chốt

Hoàn thiện luồng sử dụng trước lần chạy duy nhất trên lab được ủy quyền:

```text
Đăng nhập → Project/environment → Chat planning → Planning documents + handoff
→ Scope/ROE + preflight → Chat execution → Agent/subagent/tool
→ Trace/results/artifacts → AI suggestion → Curated finding
→ Retained evidence + classification → Independent review
→ Confirmed finding → Report/export → Complete operation
```

- Ưu tiên **AI execution, findings, evidence và reports** trong project workspace.
- **C2 provider thật để sau**, theo lựa chọn của người dùng. Không là điều kiện freeze cho lượt lab AI này.
- Dùng engagement canary riêng và dữ liệu/dịch vụ tổng hợp nội bộ để kiểm chứng trước lab mục tiêu.
- Tái sử dụng evidence còn hiệu lực; chỉ chạy targeted checks khi code/config thay đổi hoặc còn thiếu bằng chứng.

## 2. Cách đọc và cập nhật checklist

| Nhãn | Ý nghĩa |
|---|---|
| Đã sửa, đã kiểm chứng | Có lỗi tái hiện, sửa code và kiểm tra lại đường bị lỗi |
| Đã kiểm chứng từng chặng | Thành phần chạy được; chưa chứng minh toàn bộ luồng kết nối |
| Partial/unwired | Có implementation nhưng luồng/nội dung chưa nối đủ |
| Config-gated | Có hỗ trợ, deployment chưa cung cấp cấu hình/phụ thuộc |
| Chưa kiểm chứng | Chưa có evidence phù hợp; chưa kết luận là bug |

Các ID `P0-*`, `F-*`, `T-*` dưới đây là mục đối chiếu trong tài liệu. Chỉ đánh dấu hoàn tất khi có kết quả thực thi, kèm revision/image/config và đường dẫn evidence.

## 3. Baseline của đợt kiểm tra vừa hoàn thành

### 3.1. Các lỗi đã sửa

| ID | Lỗi và ảnh hưởng | File sở hữu | Evidence |
|---|---|---|---|
| F-01 | AI finding có remediation nhưng import thành draft làm mất recommendation | `apps/web/src/features/findings/{api.ts,remote.ts}` | Regression đã fail trước fix; sau fix pass. API/DB thật giữ remediation, finding vẫn là draft |
| F-02 | C2 form tách sai argv có khoảng trắng, giá trị rỗng và Windows path | `apps/web/src/features/c2/provider-console.tsx` | Chuyển sang JSON argv; regression và browser fixture pass |
| F-03 | C2 adapter bỏ stderr; UI chỉ hiển thị 120 ký tự stdout và thiếu đường đọc đầy đủ | `apps/web/src/features/c2/{provider.ts,remote.ts,provider-console.tsx}` | Đọc đủ retained stdout/stderr, có truncation flags; regression và browser fixture pass |

**Deployment:** frontend đã build local, nhưng các fix trên **chưa được triển khai vào container UI tại `127.0.0.1:3001`** ở thời điểm lập tài liệu.

### 3.2. Các kiểm tra đã thực sự chạy

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| Targeted frontend ban đầu | 9 file / 147 tests pass | Trước fix cuối về remediation; không cộng dồn với lần kiểm tra sau |
| Targeted server | 7 file / 83 tests pass | Không thay thế execution/provider smoke |
| Targeted cuối phần thay đổi | 4 file / 48 tests pass | Findings adapter/API và C2 adapter/presentation |
| Typecheck, lint các file TS/TSX sửa, production build | Pass | Chưa deploy frontend vào cổng 3001 |
| Boundary gate | Pass tại baseline 411 violations | Ratchet pass, chưa phải hết architectural debt |
| Disposable real API/DB + browser | Project navigation, findings/evidence, review và reload pass | Dữ liệu tổng hợp; không chạy agent trong stack này |
| Reports checklist | 27 thao tác pass, gồm independent review, PDF export, delivery, acknowledgement, revision | Không chứng minh report tự sinh từ một lượt agent mới |
| Prelab flow cuối | 8 checks pass | C2 success dùng intercepted provider fixture |
| Model trong container runtime đang chạy | `soundwave: MODEL_OK`, `decepticon: MODEL_OK` | Gọi model factory trực tiếp; chưa đi qua chat/graph/browser |
| Runtime → default sandbox | `EXECUTE_OK`; scoped upload/download đúng bytes | Chưa chứng minh routing của sandbox riêng cho project lab hoặc subagent |

Model probe dùng `LLMFactory().get_model(role).ainvoke(...)`. Sandbox probe dùng HTTP backend với explicit `sandbox_url`, lệnh nội bộ và marker trong thư mục canary riêng. Không truy cập lab mục tiêu.

### 3.3. Evidence và lệnh chạy lại

- Prelab cuối: `C:\Users\tuanp\AppData\Local\Temp\raptix-stack-3ucTus\flows-prelab.json` — 8 checks, `failure: null`.
- Stack/API/browser rộng hơn: `C:\Users\tuanp\AppData\Local\Temp\raptix-stack-yXfqfI\` — các flow project/report/assets pass; prelab C2 tại lần này chưa pass do fixture timestamp, đã sửa và chạy lại thành công ở đường dẫn trên.
- Stack trước đó: `C:\Users\tuanp\AppData\Local\Temp\raptix-stack-NbVXL1\` — route smoke, workspace và report checks.
- Marker sandbox đã đọc lại: `/workspace/prelab-canary-21e4d25f4a80/marker.txt` trong default sandbox.
- Container/process của các disposable verification stack đã được dọn. Evidence ở thư mục tạm cần sao lưu nếu muốn giữ lâu dài.

Chạy từ repo root, khi cần kiểm tra lại phần đã đổi:

```powershell
# Workflow pre-lab riêng: API/DB thật + browser; không cần graph/model/C2 thật.
node apps/web/tools/verify/stack.mjs --modes real --no-graph --prelab-only

# Regression đúng các feature đã sửa.
npm run test --workspace=@raptix/web-raptix -- src/features/findings/remote.test.ts src/features/findings/api.test.ts src/features/c2/provider-tab.test.tsx src/features/c2/remote.test.ts
```

Harness: `apps/web/tools/verify/flows/prelab.mjs`, được gọi bởi `apps/web/tools/verify/stack.mjs`.

## 4. P0: phải đóng trước khi freeze

| ID | Việc cần cải thiện hoặc xác nhận | Owning layer và nguồn chính | Acceptance check | Baseline |
|---|---|---|---|---|
| P0-01 | Đồng nhất bản sẽ chạy: frontend fix mới, API, runtime, sandbox, model profile | Deployment; `apps/web/server/src/main.ts`, manifests/Compose thực tế | Ghi commit/image digest; mở browser xác nhận đúng build; các service tương thích | Frontend chưa deploy |
| P0-02 | Graph/plugin/model đúng cấu hình, đúng CWD; assemble đúng tool/middleware cho role | Runtime assembly; `intelligence/agents/`, `intelligence/llm/`, `langgraph.json` | Planning thực sự dùng Soundwave; execution dùng graph đã chọn; specialist cần cho lab thực sự chạy | Model riêng từng role pass; graph E2E chưa kiểm chứng |
| P0-03 | Project → runtime → sandbox → workspace nhất quán | `server/src/services/runtime/runtime-context.ts`, runtime backend factory | Đối chiếu engagement ID, workspace slug/path, assistant và sandbox URL; marker chỉ nằm trong workspace canary và API đọc cùng bytes | Default sandbox pass; per-project chưa kiểm chứng |
| P0-04 | Planning documents, handoff, scope/ROE, preflight và binding đúng đường authorization | Planning/scope/governance; `server/src/services/governance-service.ts` | Preflight server cho đúng execution thread pass; một execution được admit qua gate thật | Chưa kiểm chứng trọn chuỗi ở bản sẽ freeze |
| P0-05 | Chat, token/tool events, questions/interrupts và trạng thái cuối đồng nhất | `features/aichat/views/workspace.tsx`, `server/src/services/runtime/run-service.ts`, stream service | Gửi/nhận qua browser; có request/thread/run IDs; refresh khôi phục hội thoại và pending question | Component tests pass; live browser/graph còn thiếu |
| P0-06 | Orchestrator và subagent filesystem/bash cùng tới đúng sandbox | Runtime tools/backends/middleware; `execution/backends/factory.py` | Delegate thật ít nhất một objective; subagent ghi/đọc marker bằng explicit run config; API thấy đúng output | Chưa kiểm chứng delegation ở deployment hiện tại |
| P0-07 | Các capability/executor/parser cần cho kịch bản lab thực sự hoạt động | `capabilities/`, `execution/{adapters,workers}/`, `knowledge/ingest/`, sandbox image | Kiểm binary/version; chạy tác vụ nhỏ nội bộ; có raw artifact và normalized/persisted output | Chưa kiểm chứng theo danh sách tool lab |
| P0-08 | Output agent đi hết tới curated finding và retained evidence, có liên hệ execution | `server/src/services/{findings-service,findings-workflow-service,artifacts-service}.ts`; `features/findings/` | Agent tạo producer + evidence; UI import; classify/attach; reviewer confirm; đọc original đúng digest và execution refs | Workflow dữ liệu tổng hợp pass; output của agent thật chưa đi hết |
| P0-09 | Recovery, lỗi/timeout, interrupt và cancel không mất việc hoặc tạo run trùng | Runtime ownership, stream, operation lifecycle | Thử ba failure cases ở §7; giữ same request/run identity và trạng thái thật | Có targeted coverage; live failure injection còn thiếu |
| P0-10 | Luồng kết quả cuối sử dụng được sau khi kết thúc execution | Analysis/Reports/Audit/Closure và sources tương ứng | Graph/timeline đọc đúng project hoặc báo nguồn thiếu; confirmed finding vào report; export; giữ artifacts; complete operation | Report/workflow riêng pass; chưa nối sau live agent canary |

### Các ràng buộc cần đối chiếu trong P0

1. `/api/capabilities` phân biệt support và availability. `/api/health/ready` hiện kiểm dependency wiring, không kiểm model inference/tool execution.
2. Chọn rõ đường authorization theo ADR-0091: handoff + preflight khi không có business plan, hoặc approved plan + current binding khi có plan. Plan đã tạo nhưng bỏ dở có thể làm execution bị chặn.
3. Planning documents không tự đồng nghĩa với approved Web scope revision. Kiểm ROE version/window, emergency contact và target identities phía server.
4. Có hai danh tính thật: author/operator và reviewer khác. Tự đổi persona không đáp ứng independent-review gate.
5. Graph catalog, fleet observations và host executor heartbeat là các khái niệm khác nhau; không lấy một loại để chứng minh loại còn lại.
6. Kiểm filesystem và bash ở cả orchestrator/subagent. Bash chạy được không chứng minh filesystem đã route đúng engagement.

## 5. Hợp đồng output phải chốt trước lab

### 5.1. Những gì runtime cần giữ lại

- Producer finding parser đọc được, với severity và nội dung không phải placeholder.
- Raw evidence riêng, liên hệ rõ với finding.
- Producing execution có thể đối chiếu: project, thread/run hoặc invocation tương ứng.
- Kết quả failed/partial/unverified được ghi rõ; successful dispatch không tự chứng minh finding đúng.
- Raw scanner/tool output và dữ liệu graph không bị thay thế bằng nội dung chat.

### 5.2. Đường import hiện tại

```text
findings/FIND-<id>.md
findings/evidence/FIND-<id>_*
          ↓
Producer read → AI suggestion → Import draft
          ↓
Retained captures → Classify → Attach → Independent review
          ↓
Confirmed finding → Report snapshot/export
```

- Workspace evidence importer đọc file trực tiếp trong `findings/evidence/`.
- Tối đa **50 file/lượt**, **256 KiB/file**, theo loại file được hỗ trợ.
- Matching prefix cho phép import draft tự gắn evidence của producer finding.
- Kiểm tra `skipped` và audit: draft có thể được giữ dù một số evidence bị bỏ qua.
- Capture mới ở trạng thái `unclassified`; chỉ đọc original khi người có quyền phân loại.
- Nội dung trong chat hoặc command output chưa tự là retained capture.
- Kiểm tra execution references: finding không cite đúng thread/run có thể không hiện trong Results của operation.
- Retest cần quan sát thật và evidence phù hợp; không đổi trạng thái chỉ để hoàn thành luồng.

## 6. Canary xuyên suốt cần chạy trong lượt tiếp theo

Mục tiêu: kiểm pipeline trên một engagement riêng, không đánh giá hiệu quả khai thác lab.

- [ ] **T-01:** tạo project canary, chuẩn bị environment và hai danh tính.
- [ ] **T-02:** mở planning chat qua browser; model hỏi một câu và operator trả lời đúng interrupt.
- [ ] **T-03:** agent tạo planning documents hợp lệ; API đọc cùng documents; confirm handoff.
- [ ] **T-04:** hoàn tất scope/ROE và preflight cho đúng execution thread; plan/binding nếu dùng governed path.
- [ ] **T-05:** gửi objective nhỏ; agent thực thi tool thật trên dữ liệu/dịch vụ nội bộ tổng hợp.
- [ ] **T-06:** delegate ít nhất một objective; kiểm sandbox/workspace và output của subagent.
- [ ] **T-07:** agent ghi/read-back marker, producer finding và raw evidence theo §5.
- [ ] **T-08:** refresh giữa lúc run đang hoạt động; khôi phục cùng run, không tạo execution khác.
- [ ] **T-09:** mở trace/results/artifacts; đối chiếu run/branch outcome với persisted output.
- [ ] **T-10:** import AI suggestion; classify/attach evidence; reviewer độc lập confirm.
- [ ] **T-11:** tạo report từ finding này; duyệt và tải bản xuất có nội dung đúng.
- [ ] **T-12:** complete operation; đọc lại artifacts/audit; sao lưu evidence.

Nếu một bước lỗi, giữ project/run IDs và sửa ngay bước đó. Chỉ chạy lại đoạn bị ảnh hưởng và consumer liên quan.

## 7. Ba failure cases tối thiểu

| ID | Cách thử trong canary | Kết quả phải thấy | Evidence |
|---|---|---|---|
| T-R1 | Reload/mất SSE trong lúc đang chạy; tình huống ACK chưa xác nhận | Run tiếp tục phía server; restore cùng thread/run; dùng reconcile khi uncertain; không tự POST execution mới | Request/run IDs, server ledger, stream/recovery outcome |
| T-R2 | Một tool lỗi hoặc timeout có kiểm soát | Lỗi xuất hiện ở chat/trace/results; branch failed/partial không bị che; artifact đã tạo vẫn còn | Raw outcome, branch state, retained artifact |
| T-R3 | Interrupt/HITL rồi refresh/resume; thử cancel trên run canary riêng | Pending request phục hồi; câu trả lời đúng interrupt; theo dõi cancel tới trạng thái thực tế | Interrupt/question ID, resume request ID, cancel/result state |

Không coi ACK accepted là execution success; không coi cancel accepted là mọi worker/tool đã dừng.

## 8. Evidence cần lưu để review sau fix và sau lab

| Mốc | Nội dung cần giữ |
|---|---|
| Trước canary/freeze | Commit và working-tree state, image digests, model/profile, plugin config, tool versions, cấu hình không chứa secret |
| Planning | Engagement/slug, planning thread/run, document readiness, handoff và scope/ROE version |
| Execution | Request/thread/run IDs, assistant graph, sandbox binding, subagent dispatch IDs, raw terminal status |
| Recovery/failure | ACK/reconcile history, SSE control/recovery state, interrupt/cancel outcome |
| Results | Producer finding, raw artifact path, curated ID, capture ID/digest/classification, execution references |
| Report | Finding snapshot/version, independent decision, export bytes/digest, audit |
| Kết thúc | Bước chưa thực hiện, lỗi chưa đóng, cleanup outcome, vị trí backup workspace/DB/graph |

Giữ secrets/raw auth headers ngoài báo cáo. Giữ workspace, database và graph để tiếp tục curation/report sau khi cửa sổ lab kết thúc.

## 9. Gate freeze và biên bản review

### 9.1. Điều kiện freeze

- [ ] Browser dùng frontend đã sửa; API/runtime/sandbox có version/config được ghi nhận.
- [ ] Planning và execution qua browser đã chạy thật.
- [ ] Orchestrator và subagent tới đúng sandbox/workspace của project.
- [ ] Các executor/parser cần cho kịch bản lab đã chạy trên đúng image.
- [ ] Refresh/recovery không làm mất run và không tạo run trùng.
- [ ] Producer output đi hết tới finding/evidence; tải original khớp digest.
- [ ] Independent reviewer hoàn thành workflow; report export được.
- [ ] Failure/interrupt/cancel có kết quả thực tế và đường đọc lại evidence.

Khi đạt gate: ghi phiên bản freeze, giữ nguyên image/config/model profile cho tới khi hoàn thành lab. Thay đổi sau freeze phải có lý do blocker và targeted verification tương ứng.

### 9.2. Bảng cập nhật sau fix

| Ngày / tested revision hoặc image | Checklist ID | Fix hoặc thay đổi cấu hình | Lệnh / thao tác kiểm tra | Kết quả + evidence | Còn chặn freeze? |
|---|---|---|---|---|---|
| Chưa thực hiện | P0-01…P0-10, T-01…T-12, T-R1…T-R3 | Điền theo từng thay đổi | Điền đúng lệnh đã chạy | Pass/fail/unverified và đường dẫn | Có / Không |

### 9.3. Biên bản freeze

- **Verdict:** chưa freeze.
- Tested commit + local changes: chưa chốt.
- Frontend/API/runtime/sandbox image digests: chưa chốt.
- Model/profile/plugin config: chưa chốt.
- Engagement canary và evidence bundle: chưa chốt.
- Các exclusion đã chấp nhận: C2 provider thật.
- Blocker còn lại: các mục P0 chưa có evidence xuyên suốt.
- Người review / thời điểm: chưa chốt.

**Thứ tự lượt tiếp theo:** triển khai bản mới → xác nhận project/sandbox routing → canary xuyên suốt → failure/recovery checks → lưu evidence → freeze.
