# Interactive Web — Backlog hoàn thiện và nghiệm thu

> Audit ban đầu: **2026-10-02**. Nghiệm thu bổ sung: **2026-10-03**.
> Trạng thái: **IW-01/IW-02/IW-04 hoàn tất; IW-03 pass lõi local; IW-13 pass recreate/resume cho SQLite-backed threads**. HITL tắt; các mục khác còn mở.
> Phạm vi P2 chốt 2026-10-03: **làm IW-08 (GoPhish + evilginx2) + IW-09 (Sliver + C2 Profiles)**; IW-10 đóng (single-user), IW-11 tạm bỏ qua.
> **IW-05:** implementation và local gates pass; remote CI logs/acceptance còn chờ commit/push và PR run.
> **P1 bổ sung:** IW-06 code/lifecycle local pass (release remote còn mở); IW-07 absence gate pass; IW-12 copy/docs/health semantics pass và đã deploy local.
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

**Trạng thái:** implementation hoàn tất và đã kiểm chứng local ngày 2026-10-03 trên base `bacba41` + working-tree fixes; chưa đóng remote acceptance vì chưa có GitHub Actions run của bản sửa.

**Tham chiếu:** `.github/workflows/ci.yml`, job `changes` và `web-raptix`.

Việc cần làm:

- [x] Export `changes.outputs['web-raptix']` từ `steps.app.outputs['web-raptix']`.
- [x] Downstream quality steps dùng cùng bracket notation; required aggregate `ci-ok` phụ thuộc `web-raptix`, không còn job legacy `web` đã xóa.
- [x] Contract tests đọc workflow thật: UI/API/shared contracts/streaming/Dockerfiles/proxy/Compose/lockfile/CI edits match web filter; docs và legacy web/launcher không match. Job `changes` có quyền read-only để dorny đọc PR files.
- [x] Thêm Docker default real-mode bootstrap smoke vào web quality lane và upload evidence cả khi fail. CI cũng validate Compose web mới. Full DB/LLM live E2E vẫn là lane riêng, không thay bằng bootstrap smoke.
- [x] PR #9 (`feat/audit-control-plane-fixes` → `main`): `Web raptix (lint + test + build)` **pass** 3m29s và `Docker build (web-raptix[-server])` pass — lane chạy thật, không skip. `Detect changes`, `Compose YAML validate`, `actionlint` pass.
- [ ] `ci-ok` vẫn đỏ do các lỗi có sẵn trên `main` (xác minh bằng 2 push runs gần nhất của `main` cũng đỏ cùng tập lỗi): `pip-audit`, `Trivy`, `Semgrep`, `CodeQL` ×2. Python lane từng đỏ vì `ruff check`/`format` ở tool scripts cũ và 1 parity test thiếu alias `raptix` — đã sửa (`b0c6da1`, `19f45f0`), Python lane **pass** 2m02s gồm pytest 5247 passed. Sandbox `no space left` là sự cố runner tạm thời, rerun pass 4m34s.

**Nghiệm thu:** CI logs chứng minh các bước server/UI quality thực sự chạy khi thay đổi web; lỗi typecheck/test cố ý trong thử nghiệm kiểm soát làm gate fail, không chỉ emit success vì output trống.

**Các blocker đã sửa:** output web chưa export; `ci-ok.needs` còn `web` không tồn tại (actionlint báo workflow invalid); quyền PR file-read chưa được khai báo; generated Prisma client không tracked nhưng lane chưa generate trong checkout sạch. Server lane nay chạy Prisma generate → typecheck → lint → build → tests. Bốn unused-import errors cũ trong `export-service.ts`, `timeline-service.ts`, `w14-logs-reports.test.ts` đã được loại bỏ để lint trở thành blocking gate thực.

**Local verification:**

- `tests/test_web_raptix_ci.py`: **17/17** pass. Tests đã fail trước fix tại missing output, missing new-web dependency, missing PR-read permission và missing Prisma generation.
- actionlint **v1.7.7**, schema/expressions trên toàn bộ workflows: pass. Local command tắt shellcheck/pyflakes vì công cụ đó không được setup ở Windows; job actionlint trên Ubuntu vẫn giữ command đầy đủ.
- Shared builds, server Prisma generate không cần DATABASE_URL, server typecheck/lint/build pass; server tests **215/215** theo chính command CI, không skip test failures (hiện 216/216 sau regression tests IW-13/graph).
- UI typecheck/lint/build/test pass, **81/81**, lint 0 errors/0 warnings (2026-10-03 đã xóa 39 unused-vars); mock E2E **8/8**.
- Docker UI/API images build từ checkout này; `verify-docker-real-mode.mjs` pass: browser gọi `/api/engagements` qua nginx tới compiled new API thật; backend bootstrap không có DB nên response lỗi, UI không render Acme/NovaPay/Alex Kim. Không dùng `page.route()` hoặc API fixtures.
- Negative Docker canary: build cùng Dockerfile với `VITE_DATA_MODE=mock` → smoke **exit 1** vì không có browser API request. Positive image mặc định real → pass.
- Negative quality canary: tạm thêm TS2322 type error trong source → chính `npm run typecheck --workspace=@raptix/web-raptix` **exit 2**, dependent lint không chạy. File canary đã xóa, typecheck chạy lại pass.

```powershell
# Repo root. Hai image tag :ci là test images, không recreate local deployment.
docker build -f containers/web-raptix.Dockerfile -t raptix-web-raptix-ui:ci .
docker build -f containers/web-raptix-server.Dockerfile -t raptix-web-raptix-server:ci .
node clients/web-raptix/tools/verify-docker-real-mode.mjs
```

Evidence local: `clients/web-raptix/test-results-deployed/iw05/smoke.json`, `docker-real-mode.png`; canary mock tại `iw05/negative-demo/smoke.json` và `failure.png`. Smoke tạo network/containers riêng, loopback port ngẫu nhiên, không truyền `.env`/credentials/volumes, và tự cleanup. Không dùng dữ liệu hay ports của deployment đang vận hành.

**Remote gap:** `gh` chưa authenticated; bản sửa chưa commit/push, nên chưa có remote run để đối chiếu. Workflow hiện trigger trên PR target `main`, push `main` và merge group; push feature branch đơn lẻ không tự trigger nếu chưa có PR. Chỉ đóng IW-05 sau khi lưu run URL/logs của đúng revision. Local pass không được gọi là full CI green.

### IW-06 — P1 — Hoàn thiện release, update và retirement lifecycle

**Trạng thái:** implementation và local verification hoàn tất ngày 2026-10-03; publish/sign/promote/recover và install từ release thực còn chờ remote release gate.

**Tham chiếu:** `.github/workflows/{release,promote-stable,release-recover,pin-digests}.yml`, `docker-compose.web-raptix.yml`, `clients/launcher/internal/updater/updater.go`, CLI `/web`, desktop bootstrap.

Việc cần làm:

- [x] Active verify/promote/recover/digest lists dùng UI/API mới, không còn legacy `raptix-web`.
- [x] Release matrix build/push/sign/SBOM cho `raptix-web-raptix-ui` và `raptix-web-raptix-api`; registry `ghcr.io/akapi895` đồng nhất với Compose. OCI version label được stamp; publish/recover/stable preflight kiểm tra labels và toàn catalog trước promote.
- [x] Config manifest/install/update thêm `docker-compose.web-raptix.yml`; GoReleaser/updater/install URLs cùng `Akapi895/raptix`. Installer stage/verify trước install; updater verify mọi config trước replace, abort lỗi config/pull trước binary/version stamp, giữ `.env`.
- [x] Host Go launcher có `raptix web start/status/stop`; project web tách base/opscontrol, dedicated DB ensure, API-owned migrations. CLI `/web` và desktop vẫn URL/reporting-only, được ghi rõ trong runbook.
- [ ] Remote release gate: publish/sign/digest/stable promotion/recovery và install/update từ assets của một tagged release thực, có run URL/logs.

**Nghiệm thu:** install/update từ release lấy được đúng new-stack images/config, khởi động được web mới; promotion/recovery không đòi image legacy đã ngừng build; CLI/desktop mô tả đúng khả năng thực tế.

**Local evidence:** `tests/test_web_raptix_release.py` 6/6 (đã fail trước fix), Go tests toàn launcher pass, test web-project isolation và checksum mismatch giữ nguyên installed config/`.env`. Installer Bash/PowerShell syntax pass. `raptix web start --pull=false --start-infra=false`, `web status`, `web stop` rồi `start` đã chạy trên deployment local; chỉ web containers bị thay đổi, không dùng `--volumes`. Hai image canary từ absence snapshot carry version `0.0.0-iw07`, đã kiểm tra labels qua Docker inspect. Không publish/retag remote trong đợt này.

Chi tiết lifecycle/backup/rollback và semantics: `p1-release-runbook.md`. OCI label là build version metadata, không thay DB migration compatibility hay model/tool readiness.

### IW-07 — P1 — Chứng minh không phụ thuộc folder legacy trong môi trường sạch

**Trạng thái:** hoàn tất local gate 2026-10-03, snapshot thật không có `clients/web`; original reference folder không bị xóa.

**Tham chiếu:** `docs/integration/w20-retirement.md`, root `package.json`/`package-lock.json`, Dockerfiles mới.

Việc cần làm:

- [x] Snapshot `C:\Users\tuanp\AppData\Local\Temp\opencode\raptix-iw07-independent-1791015032914` thực sự không có `clients/web`, `.env`, node_modules/dist/generated ban đầu; giữ folder reference gốc.
- [x] `npm ci`, shared builds, Prisma generate, API/UI typecheck/lint/build/tests, mock E2E và cả 2 Docker builds pass từ snapshot. API 216/216, UI 81/81, mock E2E 8/8.
- [x] Docker UI/API + PostgreSQL riêng dùng images build từ snapshot, nối shared Python runtime thật; UI create/reload, planning chat/run `success`, reload history recovery pass, không intercept API. Legacy web không running. Test này là acknowledgement-only independence probe, không thay full core gate IW-03.
- [x] `test-results-deployed/iw07/independence.json`, `live.json`, `independent-live-console.png` ghi target, absence, commands/exit codes, image names/version và 10 live checks pass. Một lỗi harness `fetch.Response.ok()` đã sửa thành property `ok`; live retry trong cùng snapshot pass, failed attempt vẫn được giữ trong evidence.

**Nghiệm thu:** lane mới install/build/run/E2E pass dù `clients/web/` không tồn tại. Không dùng lockfile scan hoặc test trong checkout còn folder đó làm bằng chứng thay thế.

Tái chạy từ repo root: `node clients/web-raptix/tools/verify-iw07-independence.mjs`. Script dùng temporary snapshot, PostgreSQL/network/containers riêng, cleanup test thread/containers; shared runtime/workspace chỉ nhận engagement test có slug duy nhất.

### IW-08 — P2 — Implement campaign generation và deployment providers

**Trạng thái:** hoàn tất implementation + native lab gate cho cả hai providers (GoPhish prepare/deploy/reconcile, evilginx2 prepare/deploy/reconcile qua typed bridge). **Providers = GoPhish + evilginx2.** Deployment port 3000 chưa được cutover sang slice mới này; commit/push do operator tự quản.

**Tham chiếu:** `server/src/services/{campaign-service,campaign-job-ledger,campaign-deployment-service,evilginx-campaign-service}.ts`, `server/src/integrations/campaigns/{gophish-client,evilginx-client}.ts`, `src/features/campaigns/{RealCampaigns.tsx,real-campaigns-api.ts}`, `containers/campaign-bridge/`.

Việc cần làm:

- [x] Chốt providers GoPhish + evilginx2. Người dùng xác nhận Generate = chuẩn bị bundle provider assets có version, không phải AI viết nội dung mới.
- [x] GoPhish preparation: draft nhận `gophish: {templateId,pageId,groupId,smtpId}`; Generate đọc native REST resources, ghi job `succeeded` và manifest `spec.prepared`, campaign `prepared`, tăng version atomically. Manifest chứa native refs/names, recipient count, fingerprint; không chứa SMTP credentials, recipient records hoặc HTML.
- [x] GoPhish lab deploy: `GOPHISH_LAB_DEPLOYMENT=1` mới cho dispatch; Deploy validate manifest fingerprint, scope lab (example.test recipients, mail-sink SMTP, non-capturing page, target `http://gophish:8080`), freeze recipients trong job-owned group, POST native campaign, persist providerId/status. Kết quả reconcile đọc native summary (total/sent/errors); SMTP acceptance không được gọi là inbox delivery. Uncertain POST outcomes giữ lock `activeCampaignId`, chặn redispatch cho đến khi reconcile.
- [x] Request ledger bền vững: `requestId` + version theo từng campaign (`CampaignJob.requestId/payloadHash/campaignVersion/activeCampaignId/providerId/providerStatus/summary`); retry cùng identity replay cùng job, reuse ID với input khác → 409, version cũ → 409, concurrent retries chỉ một job thắng. Deploy yêu cầu request identity rõ ràng (thiếu → 400).
- [x] evilginx2 typed bridge: `containers/campaign-bridge/` (evilginx2 **3.3.0** pinned `5557960`, build từ source) nhận duy nhất typed operations prepare/deploy/inspect qua `POST /v1/campaigns`, không nhận shell text; ownership `(engagement,campaign,version)` trong SQLite, label SHA256 deterministic, hostname `.lab.test`, lure URL port 8443. Bridge output chỉ có lure metadata, không có captures/cookies/console text. API enforce target `https://login.origin.test` + authorization; thiếu bridge → `unavailable` rõ ràng.
- [x] evilginx2 generate/deploy qua API: generate tạo child phishlet + lure native, persist bundle `prepared` + version bump; deploy enable native config (`enabled`); reconcile inspect xác nhận trạng thái. Capabilities route phân biệt draft persistence với generate/deploy availability theo từng provider (configuration, không phải connectivity probe).
- [x] UI: chọn GoPhish assets hoặc evilginx lab profile (mutually exclusive), hiển thị prepared bundle, provider/status/request IDs, native counts, nút Reconcile cho jobs chưa terminal; capabilities banner nêu rõ configuration ≠ connectivity.

**Nghiệm thu:** một draft có thể generate/deploy qua provider lab thực; kết quả và lỗi được persist, reload/restart vẫn đối chiếu được với provider. Khi provider thiếu vẫn phải unavailable rõ ràng.

**Evidence native lab (2026-10-03, rerun trên cây hiện tại):** base `b0c6da1` + uncommitted IW-08 changes. `test-results-deployed/iw08/preparation/native.json` + `native-ui-prepared.png` + `native-ui-deployed.png`; `failed.json` lưu các failed harness attempts. Harness hợp nhất GoPhish + evilginx trong một lab: **40 checks pass**, gồm GoPhish create/select/prepare, browser reload, API restart, request-identity replay (cùng job, không duplicate mutation), 409 khi reuse identity với input khác, browser Deploy → mail sink nhận đúng 1 message, reconcile `emails_sent` (sent 1/1), reload giữ counts, retry không gửi thêm mail, foreign engagement 404, missing-asset failed job persisted — và evilginx capabilities (configuration ≠ connectivity), generate `succeeded`/`prepared` v2 qua typed bridge, deploy `enabled`, reconcile không redispatch, replay cùng job, foreign reconcile 404, outputs không chứa bridge token/captures.

GoPhish source image pinned `sha256:8a57cd171999dcd1fa33f346d6898440913ae14be114ffc850cc678354672d29` (0.12.1); lab derivative bỏ binary file capability để chạy high ports với `cap_drop=ALL`, user `app`, no-new-privileges. evilginx2 **3.3.0** pinned commit `5557960`, build từ source trong `containers/campaign-bridge/Dockerfile`; bridge chạy user `bridge` (uid 10001), `cap_drop=ALL`. GoPhish/PostgreSQL/mail-sink/bridge chỉ nối network `internal`, không publish ports; API nối thêm control network, publish loopback port tạm. Test containers/networks/volumes đã cleanup. Lab chỉ dùng example.test recipients, mail sink nội bộ và synthetic `login.origin.test`; không gửi mail ra ngoài, không proxy traffic thật.

Server env: cấu hình cùng lúc `GOPHISH_API_URL` + `GOPHISH_API_KEY`; HTTPS giữ verification mặc định (private CA dùng `NODE_EXTRA_CA_CERTS`), HTTP chỉ loopback hoặc service `gophish` trong lab. Endpoint/key không nhận từ browser; startup errors không echo secrets. Client không follow redirects, timeout 5s, mỗi response tối đa 512 KiB. Scope/authorization và optimistic campaign-version check được enforce trước persist; provider errors thành failed jobs, database errors không bị đổi thành provider success.

Verification: IW-08 focused server **56/56** (preparation 20 + deployment 6 + job ledger 10 + evilginx client 6 + evilginx service 6 + w17 campaigns 8); toàn suite server **264 tests** (263 pass + 1 flake heartbeat timing ở stream-service khi chạy full, pass khi rerun riêng — không liên quan IW-08). Server/frontend typecheck/lint/build pass, Prisma schema validate pass, Ruff check/format bridge pass, frontend unit **81/81**, mock E2E **8/8**, campaign real-mode fixture browser **5/5** (thêm evilginx profile flow + capabilities intercept). Native 40-check lab gate ở trên là evidence riêng, không coi fixture tests là provider E2E. Negative UI canary ẩn asset selection làm test mới fail tại checkbox; đã restore và pass lại. Một lỗi teardown fixture oversized HTTP response đã sửa bằng đóng connections do fixture sở hữu, không tăng timeout/skip test.

Harness local: `C:\Users\tuanp\AppData\Local\Temp\opencode\verify-iw08-gophish.mjs` (hợp nhất GoPhish + evilginx, 40 checks), `iw08-gophish-config.json`, `iw08-gophish.Dockerfile`, `verify-iw08-evilginx-bridge.mjs` (bridge trực tiếp, 11 checks). Chạy harness sau build `raptix-iw08-api:preparation` từ `containers/web-raptix-server.Dockerfile`, lab derivative `raptix-iw08-gophish:capless` và `raptix-iw08-evilginx-bridge:lab` từ `containers/campaign-bridge/Dockerfile`. Các image tags này dành cho test, không phải release hay replacement cho deployment đang vận hành. Lab/harness/container bridge là diện cần review riêng khi tách changeset/commit (operator tự commit).

### IW-09 — P2 — Implement C2 session registry và commands

**Trạng thái:** implementation và native gate cho local single-user lab đã pass ngày 2026-10-04 trên base `7c399a5` + working tree IW-09. Provider Sliver **1.7.7**, HTTP C2 profiles; normal deployment port 3000 chưa cutover, code IW-09 chưa commit/push.

**Tham chiếu:** `server/src/services/c2-service.ts`, `src/features/c2/RealC2.tsx`.

Việc cần làm:

- [x] Chốt Sliver **HTTP C2 profiles**, phân biệt implant build profiles. Người dùng chọn listener riêng theo engagement và command explicit path + argv có audit.
- [x] Native gRPC/mTLS bridge: official 1.7.7 linux-amd64 release checksum verified; protobuf pinned `0aa7e5b`. CA + certificate identity `multiplayer` được verify, không dùng insecure channel. Operator config/key nằm trong private `/state` volume, không vào DTO/browser. HTTP API không expose Generate/Shell RPC.
- [x] Session discovery/ownership: native ActiveC2 phải khớp lab host/protocol/owned port, FirstContact sau listener creation; immutable session-ID/UUID binding trong SQLite. Unattributed/foreign sessions bị ẩn; stopped listener ports không reuse. Listener intents khôi phục sau graceful bridge restart.
- [x] Command dispatch/history: explicit binary + args, scoped ownership và authorization trước execution, request identity/payload hash, PostgreSQL audit `C2Command` + native bridge outcome ledger, session lock cho pending/uncertain. Nonzero exit = failed, output tối đa 65,536 bytes/stream + explicit truncation; late observations không được regress terminal state. Native timeout/malformed responses giữ uncertainty, không auto-redispatch.
- [x] HTTP C2 profiles: clone native default thành namespace theo engagement, trả configuration counts từ native detail lookup; create replay không overwrite profile. Profile lab được áp dụng khi enrol implant trong harness; không đổi traffic config của implant đã chạy.
- [x] UI session/listener/profile forms, explicit argv command composer, provider error/empty states, refresh và persisted audit output/reconciliation. Mock 13-tab baseline giữ nguyên.
- [x] Native gate **22/22**: actual Sliver + PostgreSQL + Linux implant + real browser không intercept; distinct listeners, native session, foreign isolation/dispatch denial, profile, command argv, nonzero exit, truncation, replay/conflicting identity, audit sau API restart, bridge restart + implant reconnect, profile/ownership isolation sau restart, browser invalid path 400 rồi sửa input/execute thành công và reload audit.

**Evidence:** `clients/web-raptix/test-results-deployed/iw09/native.json`, `native-c2.png`; actual command marker `IW09_NATIVE_OK` và browser `/usr/bin/uname -s` → Linux. Linux HTTP sessions được nghiệm thu; Windows commands, beacon tasking, hosted multi-user, power-loss/HA không nằm trong native gate này. Unit fixtures kiểm tra stale/unconfirmed authorization, bridge failure/oversized output → uncertain, cross-engagement history/reconcile và invalid input.

**Gates:** shared build + Prisma generate; server/frontend typecheck/lint/build pass; server **275/275**, UI **81/81**, mock **8/8**, campaign/C2 unavailable fixture regression **5/5**; Ruff check/format bridge pass. Negative sensitivity canary bỏ request replay lookup làm 2 IW-09 assertions fail đúng duplicate/changed-input lỗi; restore → focused **11/11** và full suite pass. Sửa nhỏ test fixture IW-08: bỏ cast `never` gây TS2339, bổ sung created/updated dates; không đổi behavior provider IW-08.

**Rerun từ repo root:** build `raptix-iw09-sliver-bridge:lab` bằng `containers/sliver-bridge/Dockerfile`, build `raptix-iw09-api:lab` bằng `containers/web-raptix-server.Dockerfile`, rồi `node clients/web-raptix/tools/verify-sliver-lab.mjs`. Harness dùng internal network + private state volume + DB/target riêng; API thêm control network với loopback port tạm. Tokens/passwords chỉ truyền qua process-local env, không in/commit. Containers/networks/DB/bridge volumes test được cleanup; ephemeral compiler failures được chẩn đoán trước final gate.

**Cấu hình:** API cần paired `SLIVER_BRIDGE_URL` + `SLIVER_BRIDGE_TOKEN`; HTTPS hoặc loopback/service `sliver-bridge` HTTP trong lab. Native root `/state/sliver`, bridge ownership/outcomes `/state/ownership.sqlite`, API audit trong PostgreSQL. Daemon bỏ HTTP bridge token khỏi environment để compiler diagnostics không log secret. Giới hạn GOMAXPROCS=2/GOFLAGS=-p=2 tránh fork exhaustion; không nới pids/container hardening. Xem ADR-0036 và `containers/sliver-bridge/README.md` cho lifecycle/unknown-outcome semantics.

**Nghiệm thu:** UI liệt kê session lab thực và gửi/nhận command qua provider; không fabricate session hoặc dùng terminal demo làm bằng chứng C2 hoạt động.

### IW-10 — P2 — Multi-user authentication, memberships và RBAC

**Trạng thái:** **đóng theo phạm vi 2026-10-03 — giữ local single-user, không implement.** Các việc dưới đây chỉ mở lại nếu mục tiêu chuyển sang hosted/team deployment.

**Tham chiếu:** `server/src/services/members-service.ts`, `server/src/auth/`, `src/features/members/RealMembers.tsx`.

Việc cần làm nếu mục tiêu bao gồm nhiều người dùng:

- [ ] Chốt identity/session/authentication strategy và mô hình membership.
- [ ] Implement authentication/authorization trên mọi scoped API; origin/session/CSRF policy phù hợp với thiết kế.
- [ ] Implement invite/accept/remove và role permissions có enforcement backend.
- [ ] Bổ sung UI lifecycle và các tests cross-user/cross-engagement access.

**Nghiệm thu:** hai identity thực có quyền truy cập khác nhau đúng thiết kế; invite/role mutations có persistence và enforcement. Không dùng dropdown Owner/Viewer hoặc hàng Local Operator để tuyên bố có RBAC.

**Phạm vi:** không chặn nghiệm thu lõi local single-user nếu mode này được công bố rõ; bắt buộc khi tuyên bố hỗ trợ hosted/team deployment.

### IW-11 — P2 — Hoàn thiện Settings ngoài metadata engagement

**Trạng thái:** **tạm bỏ qua theo quyết định 2026-10-03.** Hiện chỉ có persisted engagement fields; các nhóm dưới đây chưa có đầy đủ settings contracts.

**Tham chiếu:** `src/features/settings/RealSettings.tsx`, `server/src/services/settings-service.ts`.

Việc cần làm theo phạm vi sản phẩm:

- [ ] AI provider/model/runtime configuration và cách áp dụng vào thread/run thực.
- [ ] Integration registry, key references và connection checks; Vault storage đơn thuần chưa tự tạo integration registry.
- [ ] Notification preferences/delivery provider.
- [ ] Report template/rendering API nếu cần nhiều hơn export JSON/Markdown hiện có.

**Nghiệm thu:** save được backend xác nhận, reload được giá trị đã persist và operation thực sử dụng cấu hình đó; connection tests phải probe integration thật.

### IW-12 — P1 — Đồng bộ tài liệu readiness, UI copy và health/capability semantics

**Trạng thái:** hoàn tất code/docs và local deployed verification ngày 2026-10-03; scope và các gate remote còn thiếu được ghi rõ.

**Tham chiếu:** `docs/integration/{progress,w16-cutover,w20-retirement}.md`, `src/features/settings/RealSettings.tsx`, `src/features/agent-runs/RealConsole.tsx`, `server/src/http/routes/{health,capabilities}.routes.ts`.

Việc cần làm:

- [x] `progress.md`, W16/W20 notes được đánh dấu historical implementation evidence và trỏ về current backlog/runbook, không đồng nhất code với full product readiness.
- [x] Console W11 stale copy đã sửa ở IW-03; Settings nay ghi Credentials Vault cung cấp encrypted storage nhưng integration registry/connect settings chưa có. Real-mode UI regression và live Settings copy probe pass.
- [x] `/api/health` trả `scope: process_liveness`, integration status `not_checked`; `/api/health/ready` trả `scope: dependency_wiring`, `notProbed` liệt kê inference/tool/provider operations. Health 200 không được dùng để suy diễn inference đã pass.
- [x] Evidence ghi rõ actual DB/runtime flow, fixture UI tests, version labels, workspace-only/local limits và remote acceptance chưa có. Provider-less features vẫn unavailable đúng contract.

**Nghiệm thu:** docs/UI/API không mâu thuẫn; trạng thái ready được hỗ trợ bằng probe/evidence phù hợp và không che giấu tính năng stated-absent.

**Verification:** health semantic tests đã fail trước change rồi pass; server suite 216/216, real-mode UI regressions 29/29 (fixtures). `tools/verify-p1-readiness.mjs` probe Docker port 3000 + actual Settings UI pass; evidence `test-results-deployed/p1/readiness.json` + `settings-readiness.png`. Current deployment built từ base `bacba41` + working-tree P1 fixes, OCI development version `0.0.0`, không phải published release:

| Image | Local image ID |
|---|---|
| `ghcr.io/akapi895/raptix-web-raptix-ui:stable` | `sha256:f7434d0a2bcbb4270a43f9fac2833e9cfaf1fc47b0201f893af4a5219bf6e4d2` |
| `ghcr.io/akapi895/raptix-web-raptix-api:stable` | `sha256:fb293077b44590e07fb6b86a0ed96379deeccf027acd285aa34af9d5152b0309` |

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

**Evidence final:** `clients/web-raptix/test-results-deployed/iw13/durability.json` + `restored-question.png` + `resumed-run.png`; 19 live checks không API interception. Python round-trip test pass; Ruff check/format và basedpyright cho hai files Python mới: 0 errors/0 warnings. Server suite hiện 216/216; UI suite 81/81, mock E2E 8/8; frontend typecheck/build/lint pass (0 warnings sau khi xóa 39 unused-vars).

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

- API typecheck/build/lint pass; unit tests **216/216**. Graph mock test từng flake hiếm (~1/6 full runs, `fetch failed` chung chung): đã surface nguyên nhân gốc (`ECONNREFUSED`/timeout từ `cause`) vào `GraphUnavailableError` kèm test dùng port đã đóng xác định; full suite xanh 2 vòng liên tiếp sau fix.
- Regression sensitivity check: tạm vô hiệu hóa riêng các fix task interrupts/pending UI/terminal ownership trên source local làm 5 server assertions và 1 UI assertion fail đúng lỗi; khôi phục fix → targeted server **16/16**, UI **4/4** pass. Container deployment không bị thay đổi trong phép kiểm tra này.
- UI typecheck/build pass, lint **0 errors/0 warnings** (2026-10-03 đã xóa 39 unused-vars: icon imports, mock-screen `project` props + call sites, `openDrawer`, `tabs`, `setRevision`), unit tests **81/81**, mock E2E **8/8**.
- `npx playwright test --config playwright.real.config.ts`: **29/29**, API fixtures/error states — không dùng làm full-stack evidence.
- `npx playwright test --config playwright.deployed.config.ts`: **1/1**, actual Docker create/reload/download, không API intercept.
- Skill audit strict toàn corpus: **323 files, 0 violations** (2026-10-03 đã bổ sung attribution thật cho 28 skills: MITRE Enterprise IDs cho web-exploitation/chains/reporting, OWASP LLM Top 10 `upstream_ref` cho các lỗi LLM-specific, `T1574` cho trust-boundary). `skills.cypher` đã regenerate và builder `--check` pass (2137 nodes, 5773 edges).
- API lint **sạch** (4 unused-import errors cũ ở `export-service.ts`, `timeline-service.ts`, `tests/w14-logs-reports.test.ts` đã xóa trong IW-05).

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
4. **IW-05 + IW-06:** code/local gates pass; chờ remote CI/release/promotion/recovery acceptance. **IW-07:** absence gate local hoàn tất.
5. **IW-12:** docs/copy/health scope đã đồng bộ; cập nhật tiếp khi có remote evidence/revision mới.
6. **IW-08 + IW-09:** triển khai providers đã chốt (GoPhish + evilginx2; Sliver + C2 Profiles). IW-10 đóng theo single-user scope, IW-11 tạm bỏ qua. Không đánh dấu chúng hoàn tất chỉ vì trang UI đã tồn tại.

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
- [x] Install/build/run/live E2E pass trong bản sao không có `clients/web/` (independence scope).
- [ ] Release/update/promotion/recovery hỗ trợ images/config mới; legacy image không còn trong active lanes.
- [x] Lifecycle host/CLI/desktop rõ ràng; Go host start/status/stop đã chạy local, CLI/desktop URL-only được nêu rõ.
- [ ] Campaign provider và C2 provider được nghiệm thu nếu tuyên bố hai nhóm này hoạt động đầy đủ.
- [x] Auth/membership/RBAC: đóng theo phạm vi — tuyên bố single-user, không hỗ trợ nhiều người dùng (quyết định 2026-10-03).
- [ ] Settings/integrations/notifications/templates: tạm bỏ qua theo quyết định 2026-10-03.
- [x] Readiness docs phản ánh revision/evidence local mới nhất và remote gaps.

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
