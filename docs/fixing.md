# Ke hoach trien khai Phase 7A va Phase 8

**Trang thai:** ke hoach thuc thi sau Phase 6. Phase 1-6 da co implementation va da duoc kiem tra; cac thay doi hien co trong worktree chua duoc commit.

## Muc tieu va pham vi

Phase 7 trong roadmap duoc chia thanh hai lat cat:

1. **Phase 7A trong tai lieu nay:** REST API, SSE va CLI la client cua server. Khong them `web/`, frontend build, static-file hosting, hay code UI cho den khi co code web do nguoi dung cung cap.
2. **Phase 7B de lai:** `web/src/shared/`, `web/src/app/` va cac man hinh project/run/evidence/finding. Phase 7B dung nguyen OpenAPI va SSE contract cua 7A; khong doi API chi de phuc vu UI.

Phase 8 bo sung review/revision finding, report snapshot bat bien, River worker va periodic reconcile. API/CLI can thiet cho review va report nam trong Phase 8; UI cho cac use case nay cung de lai Phase 7B/phan frontend sau.

Khong dua memory, knowledge, orchestrator, multi-agent spawn, vault, MCP, dashboard hay workflow editor vao hai phase nay.

## Hien trang va cac rang buoc bat buoc

1. `internal/api.Router` hien chi co `GET /healthz`; `contracts/openapi.yaml`, `contracts/events/`, `cmd/cli`, `internal/cli`, `infrastructure/jobs` va `workspace/reporting` chua ton tai.
2. `app.Services` la public use-case boundary. HTTP handler, SSE handler va CLI khong duoc import sqlc output, Postgres repository, filesystem store, hay chay agent/tool truc tiep.
3. `engine/runs` so huu lifecycle run/task/agent. `engine/agents` so huu agent attempt/conversation. `execution` so huu invocation va cancel/reconcile invocation. `workspace/findings` la owner duy nhat cua finding status/revision. `workspace/reporting` se so huu report request/snapshot. River chi so huu queue attempt, khong so huu business status.
4. `StartAuthorizedRun` nhan `ScopeID` nhung bang `runs` chua luu scope. Mot API public khong duoc tin `scope_id` do client gui lai khi cancel, xem evidence, chay agent hay review. Day la prerequisite an toan cua 7A.
5. Phase 6 da quy dinh invocation `unknown` khong duoc re-dispatch bang retry/idempotency. Job retry o Phase 8 cung khong duoc tao invocation, agent attempt hay report business moi mot cach ngam dinh.
6. Event SSE la read/progress transport, khong la nguon du lieu. PostgreSQL va artifact store van la authoritative state; reconnect bi mat event phai lay snapshot.
7. Actor khong bao gio den tu request body/header tuy y. Transport chi lay principal da xac thuc; service van kiem membership, scope active va grant tai luc thuc thi.

## Quy uoc chung se chot truoc khi code

1. API base path la `/api/v1`; `/healthz` giu nguyen va khong can authentication.
2. Tat ca response JSON dung lower camel case. UUID va timestamp la string RFC 3339 UTC. Danh sach dung `limit` va opaque `cursor`; default va max limit duoc ghi trong OpenAPI.
3. Loi API dung `application/problem+json` theo RFC 9457: `type`, `title`, `status`, `code`, `detail`, `requestId`, va `invalidParams` khi validate input. Mapper on dinh: 400 malformed, 401 unauthenticated, 403 authorization/grant denial, 404 missing/khong duoc phep disclose, 409 optimistic-lock/idempotency-key reuse khac payload, 422 business transition invalid, 429 rate limit, 503 dependency unavailable.
4. Cac `POST` tao run, agent va agent attempt bat buoc `Idempotency-Key` 1-128 ASCII printable. Server luu request fingerprint; cung key va cung payload tra lai ket qua cu, cung key va payload khac tra 409. `POST .../cancel` la idempotent theo business state va khong retry execution.
5. Authentication production la Bearer OIDC JWT da verify issuer, audience, signature va expiry. Middleware chuyen `sub` thanh `Principal.Subject`. Khong tin `X-Actor`, khong nhan `actor` trong JSON, va khong mo endpoint nghiep vu neu auth verifier chua duoc wire. Test dung fake verifier inject; development chi duoc dung fixed principal tu config explicit, khong co header bypass.
6. Authorization co hai lop: middleware xac thuc principal; app use case kiem project membership, scope active va governance grant. Capability names duoc chot trong OpenAPI/policy: `run.start`, `run.read`, `run.control`, `evidence.read`, `finding.read`, `finding.review`, `report.create`, `report.read`. Cac capability moi khong duoc suy ra tu role UI.
7. Request ID tu `chi` duoc gan vao problem response, audit correlation va log. Secret/token/credential, raw tool argument nhay cam va evidence bytes khong di qua event payload hay log transport.

## Phase 7A - API, SSE va CLI

### 7A.1. Scope binding va idempotency truoc transport

1. Them migration `00014_engine_runs_transport.sql`, owner `engine/runs`.
2. Them `runs.scope_id uuid` tham chieu `scopes(id) ON DELETE RESTRICT`, index `(scope_id, created_at DESC)`, va cap nhat `runs.Run`, `CreateRunParams`, queries, sqlc output, repository va service.
3. Backfill scope cua run cu tu `audit_records`: chi chap nhan ban ghi `action='run.start'`, `outcome='allowed'`, `correlation=runs.id::text`, trong do `resource` la UUID scope. Release migration phai dung neu mot run co zero hoac nhieu scope hop le; khong duoc tu doan theo project hay scope moi nhat. Sua du lieu do truoc khi migrate roi moi dat `scope_id NOT NULL`.
4. `StartAuthorizedRun` luu scope sau khi da kiem membership, project/scope va `run.start` grant. Tat ca use case theo run tu do lay scope tu `runs.scope_id`; bo `ScopeID` do client cap khoi API `RunAgent` va cancel/read use case.
5. Them `runs.request_key` va `runs.request_fingerprint`, unique partial tren `(project_id, created_by, request_key)` khi key khong null. `StartAuthorizedRun` tim/doi chieu key truoc khi tao run de HTTP retry khong tao run thu hai.
6. Them `agent_attempts.request_key` va `agent_attempts.request_fingerprint`, unique partial tren `(agent_id, request_key)` khi key khong null. Tach API thanh tao agent va chay attempt tren agent da ton tai; nhieu retry cua lenh chay cung agent khong tao tool invocation moi.
7. Khong tao queue/scheduler moi trong 7A. `RunAgent` van la server-hosted synchronous use case; client mo SSE sau khi co run ID va gui HTTP start-attempt tren ket noi rieng. CLI co the doc SSE dong thoi voi request do. Detached goroutine khong co durable ownership se khong duoc dung.
8. Them app-level use cases nho, co authorization, thay vi handler goi truc tiep service truong:

   - `CreateRun(principal, projectID, scopeID, name, idempotency)`.
   - `ListRuns` va `GetRunView(principal, runID)`.
   - `CreateAgent(principal, runID, taskID, profile, idempotency)`.
   - `RunAgentAttempt(principal, agentID, task, idempotency)`; scope va run duoc resolve server-side.
   - `CancelAuthorizedRun(principal, runID)`; goi Phase 6 `CancelRun` sau khi authorize.
   - `ListRunEvidence`, `ReadEvidence`, `ListRunFindings`, `GetFinding`; moi path deu kiem run/project/scope truoc khi tra metadata hay bytes.

9. Ghi audit cho command transport `run.read`, `run.control`, evidence download va denial quan trong. `CancelRun` phai nhan actor cua principal cho audit; khong mac dinh ghi `CreatedBy` khi lenh den tu mot nguoi khac.
10. Them test migration tren database that: backfill thanh cong, unambiguous/missing audit bi reject, run moi bat buoc scope, va idempotency key race chi tao mot row.

### 7A.2. External contracts truoc implementation

1. Tao `contracts/openapi.yaml` la nguon contract duy nhat. Pin OpenAPI 3.1, API version `v1`, reusable UUID/time/pagination/problem schemas, security scheme Bearer OIDC, va operation ID on dinh.
2. OpenAPI 7A chi mo cac resource co implementation va service ownership ro rang:

   - `GET /healthz`.
   - `GET /api/v1/projects`, `GET /api/v1/projects/{projectId}`, `GET /api/v1/projects/{projectId}/scopes` cho principal la member.
   - `GET /api/v1/projects/{projectId}/runs` va `POST /api/v1/projects/{projectId}/runs`.
   - `GET /api/v1/runs/{runId}`, `GET /api/v1/runs/{runId}/tasks`, `GET /api/v1/runs/{runId}/agents`.
   - `POST /api/v1/runs/{runId}/agents`, `POST /api/v1/agents/{agentId}/attempts`, `POST /api/v1/runs/{runId}/cancel`.
   - `GET /api/v1/runs/{runId}/evidence`, `GET /api/v1/evidence/{evidenceId}`, `GET /api/v1/evidence/{evidenceId}/content`.
   - `GET /api/v1/runs/{runId}/findings`, `GET /api/v1/findings/{findingId}`.
   - `GET /api/v1/runs/{runId}/events` cho SSE.

3. `POST /agents/{agentId}/attempts` tra result sau khi attempt ket thuc, bao gom attempt, summary va ID finding/verdict neu co. HTTP request timeout khong duoc duoc dien giai la execution thanh cong; client phai dung run/attempt read va SSE de doi chieu ket qua.
4. Evidence content response dung MIME type cua artifact, `Content-Disposition: attachment`, khong cache public, va tu choi artifact `secret` tru khi policy sau nay cap quyen ro rang. Phase 7A chi cho phep metadata/content da co; khong them upload endpoint.
5. Tao `contracts/events/v1.schema.json` cho envelope bat bien: `schemaVersion`, `id`, `type`, `occurredAt`, `runId`, `data`. Payload 7A gioi han o `snapshot`, `run.updated`, `agent.updated`, `attempt.updated`, `finding.created`, `verdict.recorded`, `run.cancelled` va `heartbeat`. Khong gui evidence bytes, model conversation hay raw tool output.
6. Them contract tests validate OpenAPI va event fixture bang schema, kiem operation ID unique, problem response cua handler va phat hien route khong nam trong contract. Chua generate client/server code tu OpenAPI trong 7A; hand-written DTO mapping giu handler mong va contract test la guard.

### 7A.3. HTTP transport va security boundary

1. Tach `internal/api/handlers`, `internal/api/middleware` va `internal/api/sse`; giu `api.Router` chi lam composition cua middleware va route. `app.New` inject public use-case facade va auth verifier vao router, khong inject pool vao handler ngoai health check.
2. Middleware thu tu: request ID -> request tracking/drain -> panic recovery -> structured access log redacted -> authentication -> per-principal rate limit -> route authorization context. CORS/CSRF chi them khi co browser UI/session cookie; Bearer API 7A khong vo tinh mo CORS wildcard.
3. Handler decode JSON co size limit, reject unknown fields, validate UUID/enum/length truoc service, doc principal tu context, map typed error sang problem response. Handler khong tu suy dien capability, scope hay status transition.
4. Pagination va run view phai duoc bo sung bang module service/repository methods co cursor theo `(created_at, id)`, thay vi handler lay het danh sach roi cat. Su dung read DTO co IDs va status; khong expose internal error, storage key, grant snapshot hay secret.
5. Rate limit la transport protection theo principal va IP, co cau hinh explicit. No khong thay the execution budget/governance; dung lenh do rate limit tra 429 truoc service side effect.
6. Them HTTP integration tests voi `httptest` va PostgreSQL: no token 401, token valid khong member/grant 403, scope khac project 403/422, terminal run khong nhan agent, key retry an toan, cancel authorization, evidence ownership/sensitivity, pagination va error envelope.

### 7A.4. SSE progress transport

1. `internal/api/sse` cung cap hub in-memory theo run, ring buffer gioi han cau hinh, sequence tang don dieu va server epoch ngau nhien. Event ID co dang `<epoch>:<sequence>`; event cu tu epoch khac hoac da rot khoi buffer la gap.
2. Ket noi `GET /runs/{runId}/events` phai authorize run truoc subscribe. Nhan `Last-Event-ID` hoac `cursor`; neu cursor lien tuc thi replay event con trong buffer, neu gap/server restart thi gui `snapshot` tu app read use case roi stream event moi.
3. Response dung `text/event-stream`, `Cache-Control: no-cache`, flush sau moi event, heartbeat 15 giay, huy subscription khi request context ket thuc. RequestTracker hien co phai drain dung SSE; shutdown dong stream sach se va client reconnect/snapshot.
4. Hub chi nhan event sau khi app use case hoan tat write thanh cong. No khong nam trong DB transaction va khong co lai de bao; missing event luon an toan vi snapshot authoritative. Phat event o ranh gioi create/cancel run, create agent, bat dau/ket thuc attempt, finding/verdict. Khong them callback tu tool implementation chi de phuc vu UI.
5. SSE test phai cover authenticated subscription, event ordering trong mot epoch, reconnect replay, stale cursor snapshot fallback, heartbeat, cancellation, subscriber slow khong block command, va shutdown/restart snapshot fallback. Chay `go test -race` de bat race trong hub.

### 7A.5. CLI la client duy nhat cua server

1. Tao `backend/cmd/cli` va `internal/cli/{scan,run,view,completions}`. Dung Cobra/pflag, HTTP client co timeout va SSE parser; CLI khong import `app`, `engine`, `execution`, repository hay filesystem store.
2. Binary ten `raptix`. Cau hinh client: `--server`/`RAP_API_URL`, `--token` hoac `RAP_API_TOKEN`, `--output table|json`, `--no-follow`; token khong ghi vao log, history hay JSON output. Co `raptix completion bash|zsh|fish`.
3. Command 7A:

   - `raptix run start --project ID --scope ID --name NAME --profile PROFILE --task TEXT` tao run, tao agent, mo SSE, gui start attempt tren request rieng va hien event/ket qua.
   - `raptix run watch RUN_ID`, `raptix run status RUN_ID`, `raptix run cancel RUN_ID`.
   - `raptix evidence list RUN_ID`, `raptix evidence get EVIDENCE_ID --out PATH`.
   - `raptix finding list RUN_ID`, `raptix finding get FINDING_ID`.

4. `--output json` in mot document ket qua, khong tron heartbeat/progress vao stdout; progress va diagnostic di stderr. Exit code phan biet validation/auth (2), remote/business failure (1), va context cancel (130).
5. CLI `run start` phai tao mot idempotency key per side-effecting request va tai su dung no neu HTTP retry truoc khi co response. Khong tu retry `run control` theo cach tao attempt moi; khi state khong ro thi goi status/watch va bao nguoi dung.
6. Test CLI bang fake HTTP/SSE server va contract fixtures: URL/token precedence, request headers/idempotency, streamed progress, reconnect snapshot, JSON output, remote problem mapping, Ctrl-C khong tu dong coi run la cancelled. Them mot E2E PostgreSQL test de CLI va HTTP client quan sat cung `run_id`.

### 7A.6. Definition of done

1. OpenAPI/event schemas, route implementation va fixtures dong bo; contract tests fail khi drift.
2. OIDC-backed principal (va fake test adapter) la con duong duy nhat vao endpoint nghiep vu; actor body/header bypass khong ton tai.
3. CLI co the tao mot run, tao/chay agent, watch SSE, xem evidence/finding va cancel chinh run do tren server. Khong co engine local hay state local.
4. Cursor gap, server restart va slow client van tra ve snapshot dung; SSE event khong duoc coi la persistent truth.
5. HTTP retry khong tao run/attempt/invocation thu hai; cancel va Phase 6 unknown semantics van dung.
6. `go test -race -mod=readonly ./...`, `scripts/check.sh`, OpenAPI/event validation, SQLC generation/diff, gofmt va live PostgreSQL transport flow deu xanh.

## Phase 8 - Review, report va background jobs

### 8.1. Finding revision va review theo owner `workspace/findings`

1. Phase 3 da co `findings.version` optimistic lock va `finding_review_history` status-only. Phase 8 mo rong, khong tao mot finding owner thu hai va khong dua status transition sang verifier/reporting.
2. Them migration `00015_workspace_findings_revisions.sql`:

   - `finding_revisions` la immutable snapshot cua title, description, severity, confidence, status, change reason, actor, created time va `revision_no` tang theo finding.
   - `finding_revision_evidence` dong bang danh sach evidence ID + role cua tung revision. Report doc snapshot nay, khong doc lien ket finding dang song.
   - `finding_verdicts` them `revision_no`/foreign key toi revision da duoc verifier kiem tra.
   - `finding_review_history` them `from_revision_no` va `to_revision_no` de decision co the truy lai immutable input/output.
   - Unique/index: `(finding_id, revision_no)`, history/verdict theo `(finding_id, revision_no, created_at DESC)`, va revision evidence theo `(finding_id, revision_no)`.

3. Data migration seed mot revision `1` tu finding hien tai va evidence link hien tai, co reason `legacy baseline`. Khong duoc gia lap cac revision lich su ma schema Phase 3 khong luu. History/verdict cu giu lai va duoc danh dau legacy khi khong the gan revision chinh xac.
4. `findings.version` van la optimistic lock cua aggregate. Moi sua content, severity/confidence, evidence set hoac status decision deu yeu cau expected version, tang version, tao immutable revision moi va ghi history phu hop trong mot transaction. `LinkEvidence` khong con la mutation public khong co revision; API dung request revise co full evidence set/reason.
5. `workspace/verifier` lay va giu finding revision no truoc khi check. `RecordVerdict` tu choi neu revision khong ton tai; verdict cua revision cu van la evidence lich su, nhung khong duoc tu dong quyet dinh status cua revision moi.
6. Them public service methods: get current/revision, list revisions, revise finding, review finding, va report input snapshot. Reporting chi goi public read contract cua findings/evidence; khong import storegen hay query bang module khac.
7. App use case `ReviewFinding(principal, findingID, expectedVersion, decision, reason)` resolve run/scope tu finding, kiem `finding.review`, goi findings service va audit actor/reason/outcome. Verifier van chi ghi verdict.
8. Test race cho hai reviewer cung version, edit-evidence so voi review, verdict den muon cho revision cu, transition illegal, va migration legacy. Ket qua can dam bao khong history/revision nao duoc ghi nua voi optimistic-lock failure.

### 8.2. Report snapshot va template content

1. Tao `workspace/reporting` voi types, service, repository, `queries/`, Postgres adapter va sqlc output rieng. No so huu `report_requests`, immutable snapshot va business status `queued`, `rendering`, `completed`, `failed`, `cancelled`.
2. Phase 8 report scope la **mot run**. `CreateReport` nhan `run_id`, template reference/version va request idempotency; project/scope duoc resolve tu run. Bao cao cross-run/project la scope sau, khong tu y join cac run trong Phase 8.
3. Migration `00016_workspace_reporting.sql` tao:

   - `report_requests`: ID, run ID, requested by, template ID/version/hash, request key/fingerprint, status, output artifact ID nullable, error code safe, render lease/attempt metadata, timestamps va optimistic version.
   - `report_snapshots`: mot row bat bien cho moi request, JSONB canonical chua finding revision IDs/noi dung, evidence IDs/checksum/provenance can thiet, verdicts, run metadata va template digest.
   - Unique partial `(run_id, requested_by, request_key)` va unique `report_request_id` tren snapshot/output linkage de retry khong tao report business thu hai.

4. `CreateReport` goi report-input contracts cua findings/evidence de copy du lieu da version hoa vao JSON snapshot. Sau khi snapshot duoc tao, revision/finding/evidence moi khong thay doi output cua report do. Khong giu DB transaction trong luc render template hay ghi file lon.
5. Tao content declarative o `content/templates/findings/` va `content/templates/reports/`: manifest co ID, version, MIME, input schema, hash va body Markdown. Renderer dung template engine gioi han, khong co filesystem/network/shell function, chi nhan report snapshot DTO. Template loader validate schema va snapshot version/hash vao report request.
6. Report output la artifact `derived`, MIME `text/markdown`, parser/template version ro rang va provenance toi snapshot. Renderer dang ky artifact qua `workspace/evidence`; `FinalizeReport` compare-and-set output artifact mot lan. Retry gap output da ton tai thi return success/no-op, khong tao report request moi; artifact metadata du thua neu crash duoc danh dau orphan va don bang maintenance job, khong lam thay doi business result.
7. API Phase 8 them `POST /api/v1/runs/{runId}/reports`, `GET /api/v1/reports/{reportId}`, `GET /api/v1/reports/{reportId}/content`; finding them `GET /findings/{id}/revisions`, `POST /findings/{id}/revisions`, `POST /findings/{id}/reviews`. Cac POST dung idempotency/expected version; content report di qua evidence authorization va `report.read`.
8. CLI Phase 8 them `raptix finding revise`, `raptix finding review`, `raptix report create`, `raptix report watch`, `raptix report get`. UI de lai; OpenAPI/SSE la contract duy nhat UI se dung sau.

### 8.3. River va job reliability

1. Them River dependency phu hop `pgx/v5`. Tao `internal/infrastructure/jobs` la adapter duy nhat biet River client, worker registration, payload version, retry policy va lifecycle start/stop. Domain package khong import River types.
2. Mo rong `cmd/migrate` de chay application goose migrations va River schema migration nhu release step rieng, bao cao status cua ca hai. `cmd/server` tuyet doi khong auto-migrate. Down/status phai xu ly ordering ro rang va test tren DB rong/cap nhat.
3. `app` wire River client va worker registry sau khi services da san sang; `cmd/server` start worker cung process server va shutdown worker co context truoc khi dong DB/artifact store. `cmd/cli` va `cmd/migrate` khong start worker.
4. Report creation thuc hien trong mot PostgreSQL transaction ngan: persist request + snapshot + enqueue River args `{version, reportRequestID}`. Neu enqueue fail thi request/snapshot rollback; neu commit thanh cong job luon co the nhan biet request. Khong dung in-memory goroutine thay cho enqueue.
5. Report worker chi goi `reporting.Render(requestID)`. Service claim request bang compare-and-set va lease co han; completed/cancelled la no-op. Worker retry sau crash chi reacquire lease het han va render immutable snapshot, khong tao request moi, khong goi tool/model va khong replay agent attempt.
6. Loi render co the retry theo policy River khi transitory. Loi template/input khong hop le danh dau request `failed` voi safe error code va khong retry vo han. Huy report chi hop le khi chua completed; worker kiem status truoc finalize.
7. Theo doi job attempt bang River, business status bang reporting. Dashboard/log co the lien ket job ID voi report ID, nhung khong duoc dung job retry count de suy ra report da hoan thanh.
8. Test PostgreSQL/River: create hai request cung key, crash sau enqueue, crash sau render truoc finalize, lease expiry, River retry, duplicate delivery, cancelled request, completed request redelivery va concurrent worker. Moi case phai ket thuc voi toi da mot `report_requests` business result va toi da mot output artifact duoc link.

### 8.4. Periodic reconcile va event mo rong

1. Phase 6 giu one-shot reconcile khi startup. Phase 8 them periodic loop trong `infrastructure/jobs` hoac server-owned scheduler dang ky qua `app`; no goi public `Services.Reconcile`, khong query `tool_invocations` truc tiep.
2. Cau hinh them `execution.reconcile_interval` va `RAP_EXECUTION_RECONCILE_INTERVAL`; validate positive, mac dinh thuc dung dai hon `reconcile_stale_after`, co jitter nho, chi mot loop moi server process, va shutdown theo context. Chay that bai chi log/metric va thu lai chu ky sau; khong chay nhieu goroutine sau moi loi.
3. Reconcile van chi mark stale invocation `unknown`, khong dispatch lai. Event/metric chi thong bao summary da reconcile; khong expose tool input/output. Test fake clock + real Postgres xac nhan periodic call idempotent, khong chay sau shutdown va khong de result muon bi ghi de.
4. Bo sung event schema/publisher `finding.revised`, `finding.reviewed`, `report.queued`, `report.rendering`, `report.completed`, `report.failed`. Nhu 7A, SSE event la advisory; reconnect luon doc report/finding snapshot qua API.

### 8.5. Definition of done

1. Reviewer co the xem revision, sua finding tren expected version, ghi decision co reason va xem history/verdict gan dung revision. Verifier khong tu doi finding status.
2. Tao report tu mot run tao immutable snapshot va template digest; thay doi finding/template sau do khong doi artifact report cu.
3. River retry/crash/duplicate delivery khong tao report request hay output link business thu hai, khong chay agent/tool lai, va khong giu DB transaction trong render/file I/O.
4. Periodic reconcile chay trong server, tuan thu Phase 6 `unknown` semantics va dung sach khi shutdown.
5. API/CLI contract tests, migration upgrade tests, River integration tests, `go test -race -mod=readonly ./...`, `scripts/check.sh`, `sqlc diff`, `go vet`, `staticcheck`, `gofmt -l` va `git diff --check` deu xanh.

## Thu tu thuc hien va ranh gioi thay doi de xuat

1. Phase 7A.1: migration scope/idempotency, run-bound authorization facade, tests migration va service. Day la hard gate truoc moi route public.
2. Phase 7A.2: OpenAPI/event contracts + validation fixtures; review contract truoc handler.
3. Phase 7A.3: auth/middleware/handlers/read pagination + HTTP integration tests.
4. Phase 7A.4: SSE hub, snapshot fallback, race/shutdown tests.
5. Phase 7A.5: CLI client + fake-server tests + one end-to-end shared-run test.
6. Phase 8.1: immutable finding revisions/verdict binding/review use case + migration and concurrency tests.
7. Phase 8.2: reporting aggregate, template validation/renderer, OpenAPI/CLI contracts.
8. Phase 8.3: River migration integration, transactional enqueue, report worker and failure-injection tests.
9. Phase 8.4: periodic reconcile, SSE additions, full integration/reliability pass.

Moi buoc chi commit khi verification cua buoc do xanh. Khong gop UI vao bat ky buoc nao; khi web code duoc cung cap, bat dau Phase 7B bang cach consume OpenAPI va SSE fixtures da khoa, khong tao transport/business path moi.
