# Interactive Web — Backlog hoàn thiện và nghiệm thu

> Audit ban đầu: **2026-10-02**. Nghiệm thu bổ sung: **2026-10-03**.
> Trạng thái: **IW-01/IW-02/IW-04 hoàn tất; IW-03 pass lõi local; IW-13 pass recreate/resume cho SQLite-backed threads**. HITL tắt; các mục khác còn mở.
> Có evidence backend/runtime thật cho lõi, Vault và graceful recreate; chưa phải xác nhận readiness toàn bộ sản phẩm/hosted multi-user.

## Kết luận và phạm vi

**Deployment Docker đã chạy được lõi interactive local single-user, Vault và durable local checkpoints.** Audit ban đầu phát hiện UI demo và API drift; hai lỗi này đã sửa. Nghiệm thu đã chạy Q&A/resume, runtime-generated planning documents, execution tools, interrupt/follow-up, finding/report, browser download, runtime recreate recovery và Vault store/reveal/revoke trên port 3000. Campaign delivery/C2 providers, HITL-enabled và hosted durability vẫn còn ngoài evidence hiện tại.

Cần phân biệt hai mốc:

1. **Sẵn sàng dùng lõi local single-user:** tạo engagement, planning interview, execution chat/run, streaming, interrupt/resume/HITL, findings và report trên cùng deployment thực. Cần hoàn tất các blocker và nghiệm thu tương ứng bên dưới.
2. **Hoàn thiện toàn bộ chức năng của 13 trang:** ngoài mốc lõi, cần campaign generation/deployment, C2 sessions/commands và các chức năng quản trị còn thiếu. Multi-user là một phạm vi mở rộng riêng, chưa thuộc khả năng hiện tại.

Không đồng nhất các khái niệm sau:

- Có trang giao diện ≠ mọi thao tác trên trang đã hoạt động.
- API health 200 ≠ LLM inference, tool execution và mọi integration đã hoạt động.
- Test real-mode dùng API intercept ≠ end-to-end trên backend thật.
- Code đã commit ≠ container đang chạy đã được rebuild/redeploy.
- Lockfile không có legacy workspace ≠ đã chạy thành công trong checkout thực sự không có folder legacy.

**Quyết định của người dùng vẫn được giữ:** `clients/web/` và các Dockerfile/scripts legacy giữ trong checkout làm reference; không xóa folder gốc để chạy independence gate.

## Bằng chứng kiểm tra

Các quan sát dưới đây là snapshot tại thời điểm audit, phải kiểm tra lại sau khi sửa:

| Kiểm tra | Quan sát | Ý nghĩa |
|---|---|---|
| Trình duyệt mở `http://127.0.0.1:3000/projects` | Hiển thị Acme, NovaPay, Alex Kim, số C2/HITL mẫu; không phát request `/api/*` trong lần mở trang | UI phục vụ hiện tại đang ở mock mode |
| `src/app/config.ts` | Chỉ chọn real khi `VITE_DATA_MODE === 'real'`; mặc định là mock | Real mode cần được bật rõ ràng |
| `containers/web-raptix.Dockerfile` | Build UI chưa đặt `VITE_DATA_MODE=real` | Build Docker hiện tại có thể tiếp tục tạo UI demo |
| `GET /api/health` | 200, service `web-raptix-server`; integrations ghi `not_connected` | API có phản hồi; health này không đủ chứng minh readiness end-to-end |
| `GET /api/capabilities` | Có capabilities lõi, thiếu `campaigns`, `c2`, `vault`, `members` | API đang chạy chưa phản ánh contract capabilities của code hiện tại |
| `GET /api/engagements` | 200, danh sách rỗng trong khi UI có nhiều project mẫu | Dữ liệu trang project không đến từ API đang phục vụ |
| Runtime | LangGraph `/ok` 200; `/api/agents` trả `soundwave`, `decepticon` | Runtime và catalog truy cập được; chưa chứng minh một run đầy đủ thành công |
| Vault container env | `VAULT_ENCRYPTION_KEY` chưa được cấu hình | Vault cần key trước khi store/reveal hoạt động sau deployment mới |
| Docker | UI/API mới đang chạy; legacy `raptix-web` đã Exited | Legacy service đã dừng, nhưng không chứng minh UI đang ở real mode |
| CI | `changes.outputs` chưa export `web-raptix`; job quality lại gate trên output đó | Quality steps có thể bị skip và job vẫn báo xanh |
| Release workflows | `promote-stable.yml`, `release-recover.yml`, `pin-digests.yml` vẫn nhắc `raptix-web` | Retirement release lifecycle chưa hoàn tất |

### Giới hạn của bằng chứng test trước đây

- Lane Playwright **29/29 real-mode** có nhiều specs dùng `page.route()` để trả API fixtures, bao gồm Console, Campaigns, Vault, Members, Findings, Graph và Reports. Đây là bằng chứng hành vi UI/contracts, không phải 29 full-stack live flows.
- `tests/e2e/real-core-flow-live.spec.ts` có một planning run thật, nhưng chỉ yêu cầu acknowledgement và không dùng tools; finding cho report được test tự ghi vào workspace.
- Gate này chưa chứng minh toàn bộ chu trình **interview → bộ planning documents → execution agent dùng tools → finding do runtime sinh → report**.
- W20 đã chạy clean install/build/tests trong checkout có folder `clients/web`; chưa có bằng chứng mới cho việc chạy tương tự trong bản sao thực sự không có folder đó.
- Audit hiện tại không chạy lại một assessment/tool run đầy đủ và không sửa deployment; các phần chưa kiểm chứng không được coi là đã fail, nhưng cũng chưa thể coi là đã pass.

## Backlog theo ưu tiên

**Ưu tiên:** P0 = chặn sử dụng lõi ngay; P1 = cần để nghiệm thu, duy trì hoặc phân phối đáng tin cậy; P2 = mở rộng chức năng sản phẩm theo phạm vi mong muốn.

### IW-01 — P0 — Build UI Docker ở real mode

**Trạng thái:** hoàn tất trên deployment 2026-10-03; Docker build mặc định real, demo opt-out bằng build arg.

**Tham chiếu:** `containers/web-raptix.Dockerfile`, `clients/web-raptix/src/app/config.ts`, `clients/web-raptix/src/App.tsx`.

Việc cần làm:

- [x] Đặt `VITE_DATA_MODE=real` trong build stage trước khi build UI dùng để deploy.
- [x] Giữ mock mode cho preview/test demo riêng; override `--build-arg VITE_DATA_MODE=mock`, mock E2E 8/8 pass.
- [x] Rebuild UI image và recreate UI container. Đặt biến ở runtime nginx không thay đổi bundle Vite đã build.
- [x] Thêm `playwright.deployed.config.ts` + `tests/e2e/deployed-smoke.spec.ts`: chạy trực tiếp Docker, không intercept API; create/reload/13 tabs và tải JSON thực.

**Nghiệm thu:** `/projects` gọi `/api/engagements`; project tạo bằng UI xuất hiện trong API và còn sau reload; không có Acme/NovaPay/identity/counter demo trừ khi chúng là dữ liệu thực đã được tạo.

### IW-02 — P0 — Đồng bộ deployment với code và migrations hiện tại

**Trạng thái:** hoàn tất; UI/API build cùng checkout `59636ec` + working-tree fixes IW, image IDs ghi trong evidence phía dưới.

**Tham chiếu:** `docker-compose.web-raptix.yml`, `containers/web-raptix-server.Dockerfile`, `server/src/http/routes/capabilities.routes.ts`, `server/prisma/migrations/`.

Việc cần làm:

- [x] Rebuild/redeploy API và UI từ cùng checkout, thay vì chỉ restart container cũ.
- [x] Boot logs xác nhận deploy `20261002030000_campaign_drafts`, `20261002031000_vault_storage`; `prisma migrate status`: 8 migrations, database schema up to date.
- [x] Capabilities có `campaigns`, `c2`, `vault`, `members`; C2 `provider_unavailable`, Vault `configuration_missing` đúng thực tế.
- [x] Ghi base revision, local image IDs và migration status; working-tree fixes chưa commit, không gọi deployment này là pristine `59636ec`.

**Nghiệm thu:** UI/API dùng cùng revision; migrations không pending; route của W17–W19 hoạt động hoặc trả unavailable theo đúng contract, không mất route vì đang dùng image cũ.

### IW-03 — P0 — Nghiệm thu full interactive core trên deployment thật

**Trạng thái:** pass kịch bản lõi local single-user ngày 2026-10-03; tools làm việc trong workspace, không thực hiện assessment mạng. HITL tắt. Runtime recreate durability thuộc IW-13.

**Tham chiếu:** `src/features/agent-runs/RealConsole.tsx`, `server/src/services/runtime/run-service.ts`, `tests/e2e/real-core-flow-live.spec.ts`, `playwright.core.config.ts`.

Việc cần làm:

- [x] UI trên Docker `http://127.0.0.1:3000`, nginx → API → PostgreSQL/LangGraph thật; không intercept API.
- [x] Tạo engagement bằng UI trong deployed smoke. Q&A case riêng tạo metadata qua API, sau đó planning chat, picker và answer/resume đều qua UI: `/resume` 202, run ID mới.
- [x] Final Q&A engagement `cmurr2706000136piyrqtthmm`: 8 docs do runtime ghi, tất cả valid; readiness `ready`, không cần corrective message ở lượt cuối. OPPLAN không bắt buộc cho readiness.
- [x] Execution trong cùng Q&A engagement: workspace inventory bằng tools và runtime-written `findings/FIND-2026-IW-RESUME.md`; terminal `success` xuất hiện qua UI.
- [x] Interrupt → `interrupted` persisted → follow-up cùng thread 202, run ID mới và `success`. HITL unset/tắt: producer approval/decision live chưa nghiệm thu khi bật mode này.
- [x] Finding xuất hiện ở Findings/Reports; browser tải JSON thực, parse được và chứa finding runtime. Không ghi finding từ test runner.
- [x] Reload giữa run rebind đúng thread, reconnect và không tạo run trùng; chuyển Findings/Reports và reload-after-terminal recovery đã kiểm tra.

**Nghiệm thu:** một full-stack browser flow pass với runtime output thực và evidence được lưu. Acknowledgement-only run hoặc test tự ghi finding không đủ để đóng mục này.

**Các lỗi đã sửa trong gate:** state reader giữ `tasks[].interrupts`; projection hỗ trợ cả task interrupts và `values.__interrupt__`; UI render pending question được server xác minh khi stream/checkpoint không có card, dedupe theo question ID; `interrupted` giải phóng active-run ownership; Reports thực sự tải Blob attachment thay vì chỉ báo “Download ready”; Soundwave prompt nhấn mạnh field names/types/enums quan sát bị drift.

### IW-04 — P1 — Hoàn thiện cấu hình Vault để sử dụng thực

**Trạng thái:** hoàn tất trên local deployment 2026-10-03: capability available, key ổn định trong `.env` bị gitignore, live gate 13/13 pass.

**Tham chiếu:** `server/src/config/env.ts`, `server/src/services/vault-service.ts`, `src/features/vault/RealVault.tsx`.

Việc cần làm:

- [x] Cấu hình `VAULT_ENCRYPTION_KEY` là base64 của đúng 32 bytes trong môi trường API; bootstrap không in key.
- [x] `tools/configure-local-vault-key.mjs` giữ nguyên key hợp lệ; không rotate mỗi lần boot/bootstrap.
- [x] Metadata/UI redaction, explicit reveal, DB ciphertext, reveal audit và revoke pass với API/DB thật.
- [x] Store → API recreate → reveal cùng plaintext pass; revoke xóa secret nhưng giữ created/revealed/revoked audit.

**Nghiệm thu:** capability Vault available khi key hợp lệ; missing/invalid/wrong key có kết quả đúng contract; list không chứa plaintext; reveal được audit và revoke không làm mất audit cần giữ.

**Vận hành/key recovery:** key đang nằm trong `.env` riêng của operator, không nằm trong git/image và không được log. Sao lưu giá trị key cùng DB vào nơi lưu trữ bí mật của operator; khi phục hồi phải dùng đúng key cũ. Không chạy bootstrap để thay một key đã mất, vì key mới không decrypt được dữ liệu cũ. Helper từ chối key sai format và duplicate entries; missing/invalid/wrong-key contracts được kiểm tra bởi W18 unit tests (live gate không thay key thật để thử lỗi).

```powershell
# Chạy từ repo root; chỉ tạo key khi chưa có giá trị, giữ nguyên key đã hợp lệ.
node clients/web-raptix/tools/configure-local-vault-key.mjs
docker compose -f docker-compose.web-raptix.yml up -d --no-deps --force-recreate web-raptix-api
$env:IW04_ENGAGEMENT_ID='cmurr2706000136piyrqtthmm'
node clients/web-raptix/tools/verify-vault-deployed.mjs --recreate-api
```

Evidence: `clients/web-raptix/test-results-deployed/iw04/vault.json`, 13 live checks; chỉ chứa IDs/check outcomes, không chứa key/plaintext.

### IW-05 — P1 — Sửa CI đang bỏ qua quality lane web-raptix

**Trạng thái:** lỗi wiring CI đã xác nhận.

**Tham chiếu:** `.github/workflows/ci.yml`, job `changes` và `web-raptix`.

Việc cần làm:

- [ ] Export output của paths-filter `web-raptix` từ job `changes`.
- [ ] Đồng bộ expression downstream với tên output; có thể dùng bracket notation cho tên chứa dấu gạch nối.
- [ ] Xác nhận thay đổi source/UI/API/shared contracts kích hoạt đúng lane.
- [ ] Thêm kiểm tra deployment real-mode vào lane phù hợp; bổ sung live E2E riêng khi có môi trường tích hợp.

**Nghiệm thu:** CI logs chứng minh các bước server/UI quality thực sự chạy khi thay đổi web; lỗi typecheck/test cố ý trong thử nghiệm kiểm soát làm gate fail, không chỉ emit success vì output trống.

### IW-06 — P1 — Hoàn thiện release, update và retirement lifecycle

**Trạng thái:** retirement chưa bao phủ hết workflows; pipeline phân phối new-stack images chưa đầy đủ.

**Tham chiếu:** `.github/workflows/{release,promote-stable,release-recover,pin-digests}.yml`, `docker-compose.web-raptix.yml`, `clients/launcher/internal/updater/updater.go`, CLI `/web`, desktop bootstrap.

Việc cần làm:

- [ ] Gỡ legacy `raptix-web` khỏi các active verify/promote/recover/digest lists còn sót, đồng bộ với quyết định retirement.
- [ ] Thêm build/publish/version verification cho hai new-stack images; thống nhất image names/registry/tags giữa release và Compose.
- [ ] Bổ sung compose/config assets cần thiết vào install/update flow nếu muốn người dùng cài từ release sử dụng web mới.
- [ ] Làm rõ lifecycle: hiện CLI `/web` chỉ in URL/hướng dẫn, desktop không auto-start web. Nếu yêu cầu là một lệnh khởi động được toàn hệ thống, phải implement lifecycle new stack hoặc cung cấp entrypoint host đầy đủ.
- [ ] Kiểm tra update, stable promotion và recovery với image/config mới; bảo toàn DB/workspace.

**Nghiệm thu:** install/update từ release lấy được đúng new-stack images/config, khởi động được web mới; promotion/recovery không đòi image legacy đã ngừng build; CLI/desktop mô tả đúng khả năng thực tế.

### IW-07 — P1 — Chứng minh không phụ thuộc folder legacy trong môi trường sạch

**Trạng thái:** chưa có bằng chứng mới đạt tiêu chí absence thực sự của W20.

**Tham chiếu:** `docs/integration/w20-retirement.md`, root `package.json`/`package-lock.json`, Dockerfiles mới.

Việc cần làm:

- [ ] Tạo checkout/bản sao độc lập chỉ phục vụ gate, loại `clients/web/` khỏi bản sao đó; giữ nguyên folder reference trong checkout gốc theo lựa chọn người dùng.
- [ ] Chạy `npm ci`, shared/UI/API builds, tests và Docker build từ bản sao không có legacy folder.
- [ ] Chạy deployment/live E2E trên entrypoint mới với legacy service dừng.
- [ ] Lưu evidence ghi rõ folder absence, commands, exit codes và artifacts.

**Nghiệm thu:** lane mới install/build/run/E2E pass dù `clients/web/` không tồn tại. Không dùng lockfile scan hoặc test trong checkout còn folder đó làm bằng chứng thay thế.

### IW-08 — P2 — Implement campaign generation và deployment providers

**Trạng thái:** hiện chỉ có durable drafts và unavailable jobs; chưa có generation/delivery thực.

**Tham chiếu:** `server/src/services/campaign-service.ts`, `src/features/campaigns/RealCampaigns.tsx`.

Việc cần làm:

- [ ] Chốt provider/adapters cần hỗ trợ và contract cho spec, generated artifacts, delivery/deployment.
- [ ] Implement dispatch và job lifecycle thực, provider IDs/status/errors; tránh báo thành công chỉ vì request đã được nhận.
- [ ] Implement retry/idempotency và reload/reconciliation theo semantics provider đã chọn.
- [ ] UI hiển thị trạng thái/provider outcome thực, capabilities phân biệt draft persistence với generate/deploy availability.

**Nghiệm thu:** một draft có thể generate/deploy qua provider lab thực; kết quả và lỗi được persist, reload/restart vẫn đối chiếu được với provider. Khi provider thiếu vẫn phải unavailable rõ ràng.

### IW-09 — P2 — Implement C2 session registry và commands

**Trạng thái:** scoped routes có sẵn, nhưng service luôn trả provider unavailable.

**Tham chiếu:** `server/src/services/c2-service.ts`, `src/features/c2/RealC2.tsx`.

Việc cần làm:

- [ ] Chốt C2 provider và session ownership mapping theo engagement.
- [ ] Implement session discovery/status, scoped command dispatch và output/history theo contract provider.
- [ ] Kiểm tra reconnect, stale sessions, timeout/error và isolation giữa engagements.
- [ ] Nối UI C2 vào dữ liệu/provider output thực.

**Nghiệm thu:** UI liệt kê session lab thực và gửi/nhận command qua provider; không fabricate session hoặc dùng terminal demo làm bằng chứng C2 hoạt động.

### IW-10 — P2 — Multi-user authentication, memberships và RBAC

**Trạng thái:** chưa implement; hiện chỉ local single-user.

**Tham chiếu:** `server/src/services/members-service.ts`, `server/src/auth/`, `src/features/members/RealMembers.tsx`.

Việc cần làm nếu mục tiêu bao gồm nhiều người dùng:

- [ ] Chốt identity/session/authentication strategy và mô hình membership.
- [ ] Implement authentication/authorization trên mọi scoped API; origin/session/CSRF policy phù hợp với thiết kế.
- [ ] Implement invite/accept/remove và role permissions có enforcement backend.
- [ ] Bổ sung UI lifecycle và các tests cross-user/cross-engagement access.

**Nghiệm thu:** hai identity thực có quyền truy cập khác nhau đúng thiết kế; invite/role mutations có persistence và enforcement. Không dùng dropdown Owner/Viewer hoặc hàng Local Operator để tuyên bố có RBAC.

**Phạm vi:** không chặn nghiệm thu lõi local single-user nếu mode này được công bố rõ; bắt buộc khi tuyên bố hỗ trợ hosted/team deployment.

### IW-11 — P2 — Hoàn thiện Settings ngoài metadata engagement

**Trạng thái:** hiện chỉ có persisted engagement fields; các nhóm dưới đây chưa có đầy đủ settings contracts.

**Tham chiếu:** `src/features/settings/RealSettings.tsx`, `server/src/services/settings-service.ts`.

Việc cần làm theo phạm vi sản phẩm:

- [ ] AI provider/model/runtime configuration và cách áp dụng vào thread/run thực.
- [ ] Integration registry, key references và connection checks; Vault storage đơn thuần chưa tự tạo integration registry.
- [ ] Notification preferences/delivery provider.
- [ ] Report template/rendering API nếu cần nhiều hơn export JSON/Markdown hiện có.

**Nghiệm thu:** save được backend xác nhận, reload được giá trị đã persist và operation thực sử dụng cấu hình đó; connection tests phải probe integration thật.

### IW-12 — P1 — Đồng bộ tài liệu readiness, UI copy và health/capability semantics

**Trạng thái:** có claims/copy cũ và health/capabilities chưa đủ làm readiness gate.

**Tham chiếu:** `docs/integration/{progress,w16-cutover,w20-retirement}.md`, `src/features/settings/RealSettings.tsx`, `src/features/agent-runs/RealConsole.tsx`, `server/src/http/routes/{health,capabilities}.routes.ts`.

Việc cần làm:

- [ ] Điều chỉnh claims “hoàn tất W00–W20” để nêu rõ scope, deployment revision và các evidence còn thiếu.
- [ ] Cập nhật stale UI copy như “resume arrives with W11” và “no secret storage service exists” sau khi các phần tương ứng đã implement.
- [ ] Phân biệt liveness, wiring support và operational availability: catalog có graph không bảo đảm model inference/tool integration thành công.
- [ ] Ghi lại kết quả sau mỗi fix, không chỉ cập nhật số test; readiness report phải chỉ ra thao tác nào đã chạy với backend/provider thật.

**Nghiệm thu:** docs/UI/API không mâu thuẫn; trạng thái ready được hỗ trợ bằng probe/evidence phù hợp và không che giấu tính năng stated-absent.

## Phát hiện bổ sung và evidence

### IW-13 — P1 — Checkpoint durability và workspace mount consistency

**Trạng thái:** hoàn tất cho local SQLite-backed threads và canonical Docker workspace volume. ADR-0034 ghi lựa chọn, migration và phạm vi; final live gate 19/19 pass. Các legacy pickle checkpoints được giữ lại/backup, không tự chuyển sang SQLite.

- [x] `AsyncSqliteSaver` qua `langgraph.json/checkpointer.path`, `/app/.langgraph_api` trên volume `raptix_langgraph_state`; question ID/history/run status giữ nguyên sau recreate và UI resume 202 → success.
- [x] API/runtime/sandbox dùng cùng volume `raptix_workspace_data`; host write/copy/read và mỗi container đều đọc cùng marker sau recreate. Toàn bộ workspace Linux được copy bằng tar stream, không đổi tên `::` để ép vào NTFS.
- [x] Thread cũ đã chạy nhưng checkpoint thiếu trả 503 recovery rõ ràng; không báo history rỗng là khôi phục được. Initial pending run và fresh thread không bị false positive.

**Nghiệm thu:** một pending question và execution thread khôi phục đúng sau recreate; các container đọc cùng artifacts. DB/project persistence và browser reload recovery hiện pass, nhưng không thay cho gate này.

**Cấu hình deployment hiện tại:** `.env` riêng của operator có `RAPTIX_WORKSPACE_PATH=workspace_data`. Alias Compose này dùng cùng named volume trong cả base/new-web projects. Không đặt alias volume thành host directory cho file operations. Host xem/copy artifacts bằng `docker exec`/`docker cp`; thư mục `workspace/` trên NTFS không phải canonical runtime storage của deployment này nữa. Override vẫn có thể nhận bind path ở môi trường filesystem phù hợp; volume name có thể cấu hình bằng `RAPTIX_WORKSPACE_VOLUME`.

**Lifecycle:** update dùng `up -d --force-recreate`, không `down -v`. Sao lưu runtime state volume và workspace volume khi đã stop runtime sạch. SQLite commits checkpoint; thread/run ops metadata vẫn dùng dev-server periodic file flush, nên gate này chứng minh graceful recreate chứ không phải power-loss/HA certification. Legacy state snapshots được backup private tại `C:\Users\tuanp\AppData\Local\Temp\opencode\iw13-backup\thread-state-backup.json`; pickle files được giữ trong state volume. UI đã kiểm tra lỗi 503 cho legacy thread không có SQLite checkpoint.

```powershell
uv sync --dev --locked --extra runtime-persistence
$env:IW13_ENGAGEMENT_ID='cmurr2706000136piyrqtthmm'
node clients/web-raptix/tools/verify-runtime-durability.mjs --recreate
```

**Evidence final:** `clients/web-raptix/test-results-deployed/iw13/durability.json` + `restored-question.png` + `resumed-run.png`; 19 live checks không API interception. Python round-trip test pass; Ruff check/format và basedpyright cho hai files Python mới: 0 errors/0 warnings. Server suite hiện 215/215; UI suite 81/81, mock E2E 8/8; frontend typecheck/build/lint pass (39 existing warnings).

Execution tool-flow trên SQLite cũng pass **14/14**: reload/interrupt/follow-up, tool events, runtime finding và report export. Evidence: `clients/web-raptix/test-results-deployed/iw13/core/iw-final-core.json`; execution thread `f6a26c14-7e18-41a5-9c0f-0d5ff3db3b9c`, success run `01a0ffdd-669e-7d93-8335-f3302f84cab5`.

Image IDs sau IW-13/IW-04 (base vẫn `59636ec` + working tree fixes, chưa commit):

| Container | Local image ID |
|---|---|
| `raptix-langgraph` | `sha256:94c6735cd01ab2d6311ad32685cf158fc6a9bfa12d15be96a21915d8fa8d71f5` |
| `raptix-web-raptix-api` | `sha256:49fe12d6f1c029a2eeaf68fa75b1177159290bfc81f9f2f8c35c53928aa1fb35` |

`tools/configure-local-vault-key.mjs` và hai live verification scripts đã thêm để tái chạy gate, không cần dùng script tạm của phiên trước.

### Evidence IW-01–IW-03 (trước cutover SQLite/Vault, 2026-10-03)

**Checkout:** `D:\.VTNet\redteam\raptix`, nhánh `feat/audit-control-plane-fixes`, base `59636eca89300393dd4109522379c56f1bbe946e` + các working-tree fixes IW chưa commit. Không push/commit trong đợt này.

| Container | Local image ID (không phải published release digest) |
|---|---|
| `raptix-web-raptix-ui` | `sha256:d767fddca95e357fc6c2a4f111ce72c074b958cb716249fa0a6093148ad5117d` |
| `raptix-web-raptix-api` | `sha256:a779db382105e48631192dee5ab40aed442480c4705fc6085c5919ed72f5dabe` |
| `raptix-langgraph` (`:stable`, rebuilt từ checkout) | `sha256:87da193a82ad3f3c7a57343a98d94239c438ef3953f9c03423263a27f3f68bea` |

Commands deploy (chạy riêng project Compose, không gộp tên project):

```powershell
docker compose -f docker-compose.web-raptix.yml build
docker compose -f docker-compose.web-raptix.yml up -d --force-recreate web-raptix-api web-raptix-ui
docker compose -f docker-compose.yml build langgraph
docker compose -f docker-compose.yml up -d --no-deps --force-recreate langgraph
docker exec raptix-web-raptix-api npx prisma migrate status
```

Gates:

- API typecheck/build pass; unit tests **213/213** (`npm test --workspace=@raptix/web-raptix-server -- --maxWorkers=1`). Graph mock test flaky khi chạy parallel, pass khi chạy riêng/serial.
- Regression sensitivity check: tạm vô hiệu hóa riêng các fix task interrupts/pending UI/terminal ownership trên source local làm 5 server assertions và 1 UI assertion fail đúng lỗi; khôi phục fix → targeted server **16/16**, UI **4/4** pass. Container deployment không bị thay đổi trong phép kiểm tra này.
- UI typecheck/build pass, lint **0 errors/39 existing warnings**, unit tests **81/81**, mock E2E **8/8**.
- `npx playwright test --config playwright.real.config.ts`: **29/29**, API fixtures/error states — không dùng làm full-stack evidence.
- `npx playwright test --config playwright.deployed.config.ts`: **1/1**, actual Docker create/reload/download, không API intercept.
- Soundwave strict audit: **17 files, 0 violations**. Full corpus strict audit vẫn báo 28 attribution violations ở skills khác. `skills.cypher` đã regenerate và builder `--check` pass; generated delta chứa skill `defense-evasion` đã được thêm ở audit-control-plane commit.
- API lint còn **4 errors** unused imports ở `export-service.ts`, `timeline-service.ts`, `tests/w14-logs-reports.test.ts`, các file này không sửa trong đợt IW.

Live evidence local tại `C:\Users\tuanp\AppData\Local\Temp\opencode\iw-verify\evidence\`:

- `iw03-qa-resume-v2.json`: Q&A engagement `cmurr2706000136piyrqtthmm`, planning thread `6f74948f-b5e0-47fb-86e4-df5b1c5bbd24`, 1 answer via UI, readiness ready/8 required docs valid.
- `iw-final-core.json`: execution thread `d3e880bc-3a59-4297-bd1e-9f32cc2f0413`, **14 live checks pass**. Interrupted run `01a0ff8c-c4f6-7f83-a3df-7235e44c46e3`, follow-up success run `01a0ff8c-d35d-70e2-8c6c-f78f501488a4`.
- `iw-final-interrupt.png`, `iw-final-execution.png`, `iw-final-report.png`: UI screenshots của đúng flow.
- `iw-final-download.json` + `iw-resume-1790993118645-export.json`: browser download thực, **12,304 chars**, JSON parseable và chứa `FIND-2026-IW-RESUME`.
- Deployed smoke artifacts: `clients/web-raptix/test-results-deployed/` (gitignored).

**Scope của evidence:** workspace-only integration note, không phải finding bảo mật trên target mạng; HITL disabled, C2 unavailable, Vault key thiếu. Schema readiness được chứng minh bằng file validation; `runtimeSignal` vẫn `not_observed`, không suy diễn rằng custom handoff signal đã được UI xác nhận. Các thread từ trước runtime recreate có thể thiếu checkpoint (IW-13).

## Thứ tự thực hiện

1. **IW-01 + IW-02:** đã hoàn tất real build/deploy; dùng deployed smoke để kiểm tra mỗi lần rebuild.
2. **IW-03 + IW-13:** lõi workspace-only/HITL-off và local recreate/resume pass; kiểm tra approval producer nếu chọn bật HITL, hosted/power-loss durability cần gate riêng.
3. **IW-04:** Vault local pass; giữ key ổn định và dùng live verification khi redeploy.
4. **IW-05 + IW-06 + IW-07:** sửa CI/release/install/update và chứng minh independence, để deployment có thể tái tạo và duy trì.
5. **IW-12:** cập nhật tài liệu/copy/readiness cùng các gate tương ứng.
6. **IW-08 → IW-11:** triển khai providers và tính năng quản trị theo phạm vi sản phẩm. Không đánh dấu chúng hoàn tất chỉ vì trang UI đã tồn tại.

Sau mỗi nhóm sửa: ghi revision, commands, environment, kết quả và đường dẫn evidence vào mục tương ứng. Không cần commit/push tự động khi chỉ cập nhật backlog.

## Checklist nghiệm thu cuối

### Mốc A — Interactive web lõi local single-user dùng được

- [x] Docker UI real-mode, không dùng fixture data làm trạng thái vận hành.
- [x] UI/API cùng checkout + IW fixes; migrations đã deploy, image IDs ghi ở evidence.
- [x] Tạo engagement → reload từ DB thành công qua UI.
- [x] Planning interview → runtime sinh documents → execution readiness đạt (lượt cuối không corrective message).
- [x] Execution thread/run → tool events/output thực → terminal status hiển thị đúng, workspace-only.
- [x] Interrupt/resume theo mode hiện tại; HITL tắt, chưa nghiệm thu producer approval khi bật HITL.
- [x] Finding/artifact do runtime sinh → report preview/export và browser download đúng.
- [x] Reload/reconnect/history recovery không tạo duplicate mutations; SQLite-backed threads còn question/history qua graceful recreate (IW-13).
- [x] Vault store/reveal/revoke/restart pass, có ciphertext/audit evidence và stable key.
- [x] Các chức năng chưa có provider được ghi rõ unavailable, không báo thành công giả.
- [x] Có evidence browser/live của deployment; health-only và API-intercept tests không thay thế gate này.

### Mốc B — Phân phối và chức năng sản phẩm hoàn chỉnh theo phạm vi đã chọn

- [ ] CI web quality steps thực sự chạy và fail khi có regression.
- [ ] Install/build/run/live E2E pass trong bản sao không có `clients/web/`.
- [ ] Release/update/promotion/recovery hỗ trợ images/config mới; legacy image không còn trong active lanes.
- [ ] Lifecycle host/CLI/desktop rõ ràng và dùng được theo tài liệu.
- [ ] Campaign provider và C2 provider được nghiệm thu nếu tuyên bố hai nhóm này hoạt động đầy đủ.
- [ ] Auth/membership/RBAC được nghiệm thu nếu tuyên bố hỗ trợ nhiều người dùng.
- [ ] Settings/integrations/notifications/templates được nghiệm thu theo tính năng công bố.
- [ ] Readiness docs phản ánh revision và evidence mới nhất.

## Tài liệu và code tham chiếu

Các path dưới đây tương đối với repo `D:\.VTNet\redteam\raptix`, trừ guide ghi riêng:

- Guide gốc: `D:\.VTNet\redteam\summary\impl-guide-web-raptix-integration.md`.
- Progress/evidence: `clients/web-raptix/docs/integration/` — đặc biệt `w15-settings.md`, `w16-cutover.md`, `w17-campaigns.md`, `w18-vault.md`, `w19-members.md`, `w20-retirement.md`.
- UI composition/mode: `clients/web-raptix/src/{App.tsx,app/RealApp.tsx,app/config.ts}`.
- Deploy: `docker-compose.web-raptix.yml`, `containers/web-raptix.Dockerfile`, `containers/web-raptix-server.Dockerfile`, `containers/web-raptix-proxy.conf`.
- Runtime/context/run ownership: `clients/web-raptix/server/src/services/runtime/`, `clients/web-raptix/server/src/services/runtime-ownership.ts`.
- Browser gates: `clients/web-raptix/playwright.real.config.ts`, `clients/web-raptix/playwright.core.config.ts`, `clients/web-raptix/tests/e2e/`.
- CI/release: `.github/workflows/ci.yml`, `release.yml`, `promote-stable.yml`, `release-recover.yml`, `pin-digests.yml` trong cùng thư mục workflows.

**Quy tắc đóng backlog:** chỉ đánh dấu hoàn tất sau implementation/configuration tương ứng **và** verification đạt; luôn ghi rõ backend/provider thật hay fixtures để người đọc sau không hiểu sai mức độ sẵn sàng.
