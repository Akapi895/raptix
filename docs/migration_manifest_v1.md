# Migration manifest — Security Platform V1 (raptix)

**Căn cứ ownership:** `docs/repository_structure_v1.md` (nguồn quyết định ranh giới module và data ownership).
**Thứ tự implement:** `docs/migration_roadmap_v1.md`.
**Module path Go:** `github.com/Akapi895/raptix/backend`.

File này là sản phẩm của **Phase 0 (đối chiếu và danh sách migrate)**: pin commit nguồn, phân loại từng phase là tham chiếu / migrate / viết mới, và theo dõi trạng thái hoàn thành.

## Commit nguồn đã pin

| Repo | Commit | Ghi chú |
|---|---|---|
| `frameworks/strix` | `4c1f00d1ee5bac0880e66e325ba50ed18a0b182b` | fix(runtime): tear the sandbox down when staging is cancelled |
| `frameworks/CyberStrikeAI` | `f44adaddf399244f701bfefc6767f164fb3eec2c` | Update config.example.yaml |
| `frameworks/Claude-Red` | `24d7968bab4b883e7f13477afe0fd91f2df3b722` | Skill catalog source for Phase 2 |

- **CyberStrikeAI**: nguồn chính cho phần Go (cấu trúc `cmd/`, `internal/`, catalog, MCP, model integration).
- **Strix**: nguồn chính cho content, agent loop, sandbox, verification.
- Đây là **hướng tìm kiếm**, không phải mapping file 1:1 đã kiểm chứng. Coding agent phải xác nhận khả năng thực tế trong phiên bản nguồn; phần không có/không phù hợp thì viết mới theo kiến trúc V1.

## Phân loại & trạng thái theo phase

Legend: `tham chiếu` = đọc nguồn để lấy kiến thức tổ chức, viết mới theo đích; `migrate` = chuyển hành vi từ nguồn; `viết mới` = không có nguồn phù hợp, viết theo V1.

| Phase | Nội dung | Phân loại chính | Trạng thái |
|---|---|---|---|
| 0 | Đối chiếu + danh sách migrate (file này) | viết mới | ✅ file này |
| 1 | Khung app + storage | tham chiếu (CyberStrikeAI Go layout), viết mới wiring/persistence | ✅ |
| 2 | Content, catalog, model adapter | migrate (Claude-Red skills; CyberStrikeAI tool model), viết mới Go contracts/adapters | ✅ |
| 3 | Dữ liệu lõi + quyền tối thiểu | migrate cả hai | ✅ |
| 4 | Một capability qua execution | migrate (Strix sandbox/tool; CyberStrikeAI capability) | ✅ |
| 5 | Một agent hoàn chỉnh + verifier | migrate (Strix agent loop; adapter Go có sẵn) | ✅ |
| 6 | Độ tin cậy execution/run | migrate (lỗi/restart), triển khai theo Postgres+V1 | ⏳ |
| 7 | API, CLI, UI cơ bản | migrate (CLI/API cả hai), UI mới React/TS | ⏳ |
| 8 | Review, report, jobs | migrate cả hai (finding/report; River) | ⏳ |
| 9 | Memory, knowledge, context | tùy chọn từ cả hai, không mặc định chép | ⏳ |
| 10 | Điều phối nhiều agent | migrate (Strix coordination; CyberStrikeAI orchestration) | ⏳ |
| 11 | Integration & release | migrate (CyberStrikeAI MCP/catalog; Strix capability) | ⏳ |

## Ghi chú cắt ngang

- Migration chạy qua bước release riêng (`cmd/migrate`), không tự chạy ở mỗi lần HTTP server khởi động.
- `app/` là composition root, không mang nghiệp vụ severity/review/retention.
- `sqlc.yaml` cấu hình output riêng từng module; không có generated package chứa toàn bộ query.
- Database V1 chỉ chạy thử; schema bảng/trường nghiệp vụ chưa chốt.

## Phase 1 — Đã migrate

- **Viết mới (theo kiến trúc V1):** `internal/app` composition root, `LoadConfig` + `NewLogger` (slog), adapter `internal/api`, adapter `infrastructure/database/filesystem`, `cmd/server` + `cmd/migrate`, `Makefile`, `scripts/`, `.github/workflows/ci.yaml`, `deploy/compose.yaml` (PostgreSQL 17), `README.md`.
- **Tham chiếu từ CyberStrikeAI (chỉ tổ chức):** chia `cmd/` (server, migrate) riêng khỏi `internal/`; không copy runtime, không dùng SQLite/zap — đích là PostgreSQL + pgx + slog.
- **Migration governance đã chạy:** `backend/migrations/00001_enable_extensions.sql` (pgcrypto) qua `cmd/migrate -command up`, verify bằng `status`.
- **Blocker đã sửa:** bổ sung `github.com/jackc/puddle/v2 v2.2.2` vào `go.mod`/`go.sum`; `go test -mod=readonly ./...` chạy sạch.
- **Còn thiếu (phase sau):** River, `contracts/openapi`, `containers/app/Dockerfile`, sandbox. (`sqlc.yaml` và filesystem artifact đã nhập Phase 3.)

## Phase 2 — Đã migrate

- **Content catalog:** loader YAML/Markdown schema-validated, path-contained, provenance hash/version/path, profile prompt/reference validation, và 78 skills từ Claude-Red revision đã pin.
- **Tool catalog:** nmap manifest giữ source path và CyberStrikeAI revision đã pin; registry tách declaration, binding và readiness, không cấp execution right.
- **LLM:** business contract cùng OpenAI-compatible Eino adapter, HTTP/SSE mock regression tests.
- **Không thuộc Phase 2:** tool dispatch/sandbox, governance, agent loop, evidence persistence và finding verification.

## Phase 3 — Đã migrate + hardening + validate live

- **Persistence:** `sqlc.yaml` cấu hình output riêng từng module; `sqlc generate` tạo 7 package `storegen`. Mười goose migration (00001–00010) chạy qua `cmd/migrate`; `00009_phase3_hardening.sql` thêm CHECK/UNIQUE ràng buộc (version>0, status/severity/confidence enum, sha256 format, size>=0, raw/derived parent rule), `00010_phase3_fixes.sql` sửa các lỗi do review (xem dưới) — DB chủ động từ chối dữ liệu sai, không chỉ ở service.
- **Review fixes (00010 + storage):** scope version cấp bằng counter nguyên tử trên `projects.scope_version` (thay cho `MAX(version)` cùng statement với `FOR UPDATE`, vốn không an toàn dưới READ COMMITTED — verify bằng test 8 goroutine tạo scope đồng thời ra version 1..8); `artifacts.parent_id` chuyển `ON DELETE RESTRICT`; raw artifact không được có rel_type; CHECK outcome cho audit; thêm index (sha256, run_id, finding_id, capability grant subject+scope); `TransitionFindingWithHistory` lấy `from_status` từ chính row update; `LinkEvidence` validate role + upsert; `DecideApproval` tái kiểm tra scope; **evidence chuyển sang content-addressed storage** — key `sha256/<checksum>` sinh từ bytes (không do caller cấp), bytes trùng nội dung dùng chung 1 file (dedup an toàn), loại bỏ hoàn toàn lỗi ghi đè/va chạm storage key.
- **platform/projects:** Project/Scope/Membership; scope **versioned thật** — `CreateScope` cấp `MAX(version)+1` dưới khóa project row, kèm `UNIQUE(project_id, version)` (verify live: tạo scope lần lượt ra version {1,2}). `IsScopeActive` là service contract xét scope hết hạn + project archived.
- **platform/governance:** role/permission, capability grant (revoke/expiry), approval; `GrantCapability`/`CheckActiveGrant`/`CreateApproval` đều gọi `ScopeAuthority` (projects) — **quyền không còn hiệu lực khi scope hết hạn hoặc project bị archived**. Approval hết hạn bị từ chối khi quyết định. Grant bắt buộc `granted_by`.
- **platform/audit:** audit_records; decision allow/deny của `run.start` được ghi tự động (co-relate bằng run id).
- **engine/runs:** lifecycle run/task/agent optimistic version; `CreateTask` chỉ nhận trạng thái khởi đầu hợp lệ, `CreateAgent` xác nhận task thuộc run, `AddTaskDependency` là service method chặn cross-run. Reads có tại service boundary (`GetRun`, `GetTask`, `GetAgent`, `ListRunsByProject`).
- **workspace/evidence:** `Register` nhận `io.Reader` — service tính size+SHA-256 từ bytes thật, ghi qua `filesystem.Store`, **verify bằng cách đọc lại rồi mới insert metadata**; nếu lưu metadata fail thì xóa bytes (không có artifact "dangling"). `ReadRef` đọc bytes lại; lookup SHA chuẩn nhất định theo run (`GetBySHA256InRun`) vì bytes có thể trùng giữa các run.
- **workspace/assessment:** asset/observation/**hypothesis (service method `RecordHypothesis`)**/coverage; `verified_negative` bắt buộc có evidence. Đủ read tại service boundary (Get/List per entity).
- **workspace/findings:** finding + evidence links + review history; `TransitionStatus` là **một statement atomic** (`TransitionFindingWithHistory` CTE): status/version và history không thể tách rời, stale version → optimistic lock, không ghi history. `RecordVerdict` không đổi status.
- **Composition root:** `wireServices(pool, fs)` gắn 7 service, governance nhận projects service contract, evidence nhận filesystem store. `StartAuthorizedRun` (app use case) ép membership + scope active + grant `run.start` + audit allow/deny trước khi tạo run.
- **Kiến trúc:** `tests/architecture/imports_test.go` đã sửa matcher đường dẫn (trước false-pass) và assert từng luật inspect ≥1 package, /storegen match theo path segment.
- **CI:** bước `Migrate` chạy `cmd/migrate up` trước `Test` trên `raptix_test`; test integration tự-lặp (slug/bytes unique, lookup theo run).
- **Đã validate live:** PostgreSQL 17 qua Docker Desktop 10/10 migration applied; `TestPhase3IntegrationDataFlow` chạy PASS **nhiều lần liên tục trên cùng DB** (repeatable) với đủ deny-path: project+scope{1,2}→member→denied run(no grant)→grant→authorized run→read-back→task/agent→artifact bytes write+checksum+read→observation/hypothesis/coverage→finding draft+evidence+atomic review+verdict(no flip). Thêm `TestPhase3ConcurrentScopeVersions` (8 scope đồng thời → version 1..8). Audit ghi cả allowed lẫn denied; ràng buộc DB từ chối dữ liệu sai (verify trực tiếp).

## Phase 4 — Đã migrate + validate live

- **Migration:** `00011_execution_invocations.sql` — bảng `tool_invocations` (owner: execution/invocation): run/task/scope/actor/capability, request JSONB, raw/structured artifact refs, `result_execution`/`result_parse`, exit code, error, `idempotency_key` UNIQUE theo run, `version` optimistic, CHECK status/result/version. Đã apply live (11/11).
- **execution/invocation:** module chuẩn (types/repository/postgres/queries/storegen) + `Service.Invoke` thực thi đủ thứ tự §6: validate → idempotency → run state → scope → grant → registry resolve → budget → ghi `pending` + audit `allowed` → dispatch có timeout → `Result.Validate` → update optimistic. Port do nơi dùng sở hữu (`GrantChecker`/`ScopeReader`/`RunStateReader`/`AuditRecorder`), resolver là `tools/registry`. Deny trả `StatusDenied` tạm thời + `output.Denied`, không ghi row, không dispatch.
- **tools/output:** thêm `ExecutionDenied`/`Denied(reason)`/`ExitCode *int`/`DurationMs`.
- **tools/builtin:** `http_probe` — capability đầu tiên (deterministic, không sandbox), ghi raw response qua evidence, phân biệt success/error/timeout.
- **tools/builtin/command:** capability command (nmap) chạy qua `sandbox.Runner`, whitelist flag, không shell, ghi stdout làm raw evidence kể cả khi exit≠0/timeout.
- **execution/sandbox:** `Runner` interface (`Spec`/`Result`) + `local` (host lab, env tối thiểu, cap output) + `container` (docker CLI, network/resource bound) + `internal/capture`. Tách subpackage để luật "chỉ `app` dựng concrete runner" kiểm tra được.
- **execution/artifact:** adapter chuẩn hoá raw/derived qua evidence (parent/rel_type/parser_version).
- **app:** `wireServices` bind `http_probe`/`nmap` từ manifest rồi dựng `Execution`; `Services.InvokeCapability` là use case entrypoint; `ExecutionConfig`/`SandboxConfig` + env `RAP_EXECUTION_*`/`RAP_SANDBOX_*`.
- **Evals:** `evals/cases/http_probe_{success,error}.yaml` + `evals/baselines/*.json` + runner Go `tests/evals`; `evals/fixtures/lab/compose.yaml`; `containers/sandbox/Dockerfile`.
- **Kiến trúc:** thêm luật `tools↛engine/agents`, `execution↛{engine/agents,api,app}`, chỉ `app` import concrete sandbox.
- **Đã validate live:** `TestPhase4InvokeCapabilityDataFlow` PASS trên DB thật — project+scope+member → denied (chưa grant) → grant `run.start` → authorized run → grant `http_probe` → invoke success (invocation `succeeded`, raw artifact bytes đọc lại được, idempotency không dispatch lại, audit có cả `allowed` lẫn `denied`). Toàn bộ `gofmt`/`vet`/`staticcheck`/`build`/`test -race`/`mod verify`/`check.sh` sạch.


## Phase 5 — Đã migrate + validate live

- **Migration:** `00012_engine_agents.sql` — `agent_attempts` (một lần agent làm việc, status running/succeeded/failed/timed_out/cancelled), `agent_messages` (conversation + `invocation_id` ref), `agent_snapshots` (Requested/Available/Granted tại thời điểm chạy, hash nội dung). Đã apply live (12/12).
- **engine/contextbuild:** `Resolve` nạp profile + prompt + skill đã chọn và hash nội dung; `Build` ghép system prompt (role/prompt/skill/protocol/evidence refs) + history + task dưới ngân sách token, cắt lịch sử cũ trước, giữ system + task. Không import `execution`.
- **engine/agents:** agent loop ReAct đơn giản dùng structured JSON (`{"action":"tool",...}` / `{"action":"final",...}`) qua `llm.Model`; mọi tool call đi qua `execution` với idempotency key `attempt:step`; ghi `agent_messages`; snapshot Requested/Available/Granted; lifecycle yêu cầu qua `engine/runs` (không tự ghi status). `RunAgent` map timeout→`timed_out`, cancel→`cancelled`, lỗi→`failed`.
- **workspace/verifier:** kiểm chứng theo tiêu chí, re-run capability qua `execution`; verdict `confirmed`/`refuted`/`inconclusive` ghi qua `findings.RecordVerdict` (không tự đổi status). Re-check lỗi/denied → `inconclusive` (không mặc nhiên `refuted`). Stateless (không bảng riêng).
- **engine/runs:** thêm `ListAgentsByRun`.
- **app:** `AgentConfig` (`max_steps`/`max_context_tokens`/`default_timeout`/`model`, env `RAP_AGENT_*`); `wireServices` dựng `Agents`/`Verifier` (executor = `Services.InvokeCapability`, cùng một đường execution); use case `Services.RunAgent` chạy agent → tạo finding draft → link evidence → verify.
- **Evals:** `evals/cases/agent_http_probe.yaml` + baseline + runner `tests/evals/agent_test.go` (fake model script, deterministic, không cần API key/DB).
- **Kiến trúc:** `engine/agents↛workspace/{findings,verifier}`, `workspace/verifier↛engine/agents`, `engine/contextbuild↛execution`.
- **Đã validate live:** `TestPhase5AgentDataFlow` PASS trên DB thật — project+scope+member+grant `run.start`/`http_probe` → authorized run → agent attempt (model script gọi `http_probe` qua execution rồi final) → invocation `succeeded` + evidence bytes → finding draft gắn evidence (status vẫn `draft`) → verifier re-check → verdict `confirmed`; `agent_attempts` succeeded, `agent_messages` có lượt tool nối `invocation_id`. Toàn bộ `gofmt`/`vet`/`staticcheck`/`build`/`test -race`/`mod verify`/`check.sh` sạch; `sqlc diff` không drift.
