# Phase 4 — Một capability qua execution (hướng dẫn triển khai)

**Căn cứ:** `docs/migration_roadmap_v1.md` (Phase 4), `docs/repository_structure_v1.md` (§3.3–3.5, §6, §7, §9), `AGENTS.md`.
**Trạng thái:** **đã triển khai** (xem §17 cho bản ghi implementation và các sai lệch có chủ đích). Phase 3 đã xong trước đó.

---

## 0. Mốc hoàn thành và ràng buộc

**Folder theo thứ tự (roadmap):** `tools/builtin/` + `tools/registry/` + `tools/output/`; `execution/invocation/` + `execution/sandbox/` + `execution/artifact/` + phần cancellation cơ bản trong `execution/cancel/`; `containers/sandbox/`; `evals/fixtures/`.

**Xong khi:** gọi được một tool từ ứng dụng qua `execution`, nhận kết quả + evidence; chạy được cả trường hợp thành công lẫn lỗi cơ bản.

**Ràng buộc bất biến (không được vi phạm):**

- Mọi invocation — kể cả verifier kiểm tra chủ động (Phase 5) — **phải đi qua `execution`**. Không có đường thực thi thứ hai.
- `platform/governance` sở hữu *logic quyết định* quyền; `execution` **kiểm tra hiệu lực quyền tại thời điểm dispatch** và **không tự cấp quyền**.
- Manifest/profile/skill **không cấp quyền chạy**; nạp manifest không load code, không chạy shell. Implementation đăng ký tường minh ở `app`.
- Contract do **nơi dùng sở hữu** (consumer-owned port); `app` inject adapter. Eino vẫn nằm sau `engine/llm/adapters/eino`.
- Ownership dữ liệu: `execution` sở hữu `tool_invocations`; `workspace/evidence` sở hữu bytes/metadata artifact; `tools/output` sở hữu result envelope.
- Cross-module qua public service API; không join bảng chéo; thao tác nhiều module cần atomicity phải có transaction boundary tường minh.
- `tools` không import ngược `engine/agents`; `execution` không import `api`/`app`/`engine/agents`.

---

## 1. Quyết định cần chốt trước khi code

| # | Quyết định | Đề xuất |
|---|---|---|
| D1 | Capability đầu tiên | **Builtin `http_probe`** (deterministic, không cần sandbox, test success/error dễ) để đạt acceptance; thêm **command `nmap`** (manifest đã có sẵn) để chứng minh đường sandbox |
| D2 | Sandbox Phase 4 | Interface `Runner` + `LocalRunner` (chạy process trên host, timeout, env tối thiểu) cho lab; `ContainerRunner` (Docker) + `containers/sandbox/Dockerfile` là đường production, bật khi có Docker |
| D3 | Budget | Tối thiểu: cấu hình `max_invocations_per_run`, đếm từ `tool_invocations`; vượt → deny + có thể chuyển run sang `budget_exhausted`. Full reconcile để Phase 6 |
| D4 | Nơi gọi ở Phase 4 | Use case `app.Services.InvokeCapability` + integration test (API/CLI để Phase 7) |

> Nếu muốn bám sát nguồn hơn, có thể chọn `nmap` làm capability duy nhất — nhưng test CI sẽ cần nmap + lab, khó deterministic. Đề xuất D1 ở trên.

---

## 2. Package sẽ tạo và chiều dependency

```text
backend/internal/execution/
├── invocation/     # types.go, service.go, repository.go, postgres.go, queries/, storegen/, service_test.go
├── sandbox/        # Runner interface + LocalRunner (+ ContainerRunner sau)
├── artifact/       # ghi raw/derived qua evidence (adapter)
└── cancel/         # timeout/cancel + (Phase 6) reconcile
backend/internal/tools/
├── builtin/        # http_probe (+ helper)
└── output/         # đã có, mở rộng nhẹ nếu cần
containers/sandbox/Dockerfile
evals/fixtures/ + evals/cases/ + evals/baselines/
```

**Ports do `execution/invocation` tự định nghĩa** (app inject adapter bọc service thật):

```go
type GrantChecker interface {
    CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error)
}
type ScopeReader interface {
    IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error)
}
type EvidenceWriter interface {
    Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error)
}
type RunStateReader interface {
    GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error)
}
type AuditRecorder interface {
    Record(ctx context.Context, rec audit.Record) (audit.AuditRecord, error)
}
```

`execution` được phép import `tools/registry` (contract) + `tools/output` (contract) — đúng doc §3.4 "execution dispatch tới implementation tool và map kết quả về tools/output". Không import `engine/agents`, `api`, `app`.

**Bổ sung architecture test** (`backend/tests/architecture/imports_test.go`): `tools` không import `engine/agents`; `execution` không import `engine/agents`/`api`/`app`; chỉ `app` mới import concrete sandbox adapter.

---

## 3. Migration + data model

Tạo `backend/migrations/00011_execution_invocations.sql` (execution sở hữu):

```sql
-- +goose Up
-- Domain: execution/invocation
CREATE TABLE tool_invocations (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                 uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id                uuid REFERENCES tasks(id) ON DELETE SET NULL,
    scope_id               uuid NOT NULL REFERENCES scopes(id) ON DELETE RESTRICT,
    actor                  text NOT NULL,
    capability             text NOT NULL,
    capability_version     text NOT NULL DEFAULT '',
    status                 text NOT NULL DEFAULT 'pending',
        -- pending|dispatched|running|succeeded|failed|timed_out|cancelled|denied|unknown
    request                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- args đã sanitize
    raw_artifact_id        uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    structured_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    result_execution       text NOT NULL DEFAULT 'not_attempted',
    result_parse           text NOT NULL DEFAULT 'not_attempted',
    exit_code              integer,
    error_code             text NOT NULL DEFAULT '',
    error_message          text NOT NULL DEFAULT '',
    idempotency_key        text NOT NULL,
    version                integer NOT NULL DEFAULT 1,
    started_at             timestamptz,
    finished_at            timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, idempotency_key),
    CHECK (status IN ('pending','dispatched','running','succeeded','failed','timed_out','cancelled','denied','unknown')),
    CHECK (result_execution IN ('not_attempted','success','failed','timed_out','cancelled')),
    CHECK (result_parse IN ('not_attempted','success','partial','failed')),
    CHECK (version > 0)
);
CREATE INDEX tool_invocations_run_idx ON tool_invocations (run_id, created_at DESC);
CREATE INDEX tool_invocations_status_idx ON tool_invocations (status);

COMMENT ON TABLE tool_invocations IS 'Tool invocation lifecycle. Owner: execution/invocation.';

-- +goose Down
DROP TABLE IF EXISTS tool_invocations;
```

Ghi invocation **trước khi dispatch** (status `pending`) → chống mất dấu khi process chết. `idempotency_key` để retry không tạo invocation trùng. `budget_exhausted`/`unknown` để Phase 6 xử lý.

---

## 4. `tools/output` — mở rộng envelope

Đã có `Result` với `Execution`/`Parse`/`RawRef`/`StructuredRef`/`Diagnostics`/`Error`/`Validate`. Bổ sung nếu cần:

- `ExitCode *int` (command), `DurationMs int64`.
- Hàm dựng `Denied(reason)` và hằng `ExecutionDenied ExecutionStatus = "denied"` để phân biệt "không được phép chạy" với "chạy lỗi".
- Giữ `Validate()` là cổng bắt buộc trước khi ghi DB.

---

## 5. `tools/builtin` — capability đầu tiên

Tạo `backend/internal/tools/builtin/http_probe.go`:

```go
type HTTPProbe struct {
    client   *http.Client // timeout từ config
    evidence EvidenceWriter
}
func (h *HTTPProbe) Invoke(ctx context.Context, args json.RawMessage) (*output.Result, error)
```

Luồng: parse args (`url`, `method`, `headers`) → validate scheme http/https → thực hiện request với `ctx` (timeout) → ghi raw response bytes vào evidence (qua `EvidenceWriter`) → trả `output.Success(rawRef, "", "")` / `output.Error(rawRef, err)` / `output.Timeout(rawRef, err)`.

- Success: 2xx/3xx.
- Error cơ bản: DNS fail / connection refused → `output.Error`.
- Timeout: `ctx` deadline → `output.Timeout`.

**Ownership:** builtin nhận `EvidenceWriter` inject từ `app` (không import bảng/DB). Capability không tự cấp quyền.

Thêm manifest `content/tools/manifests/http_probe.yaml`:

```yaml
apiVersion: manifest/v1
kind: tool
name: http_probe
version: 1.0.0
description: "Perform a single HTTP request against an authorized target and record the raw response as evidence."
executor:
  type: builtin
runtime:
  container: false
  network: true
input:
  type: object
  properties:
    url: { type: string }
    method: { type: string }
  required: [url]
output:
  type: object
source:
  repo: raptix
  path: tools/builtin/http_probe.go
```

---

## 6. `execution/invocation` — lõi (phần chính)

Files theo convention module: `types.go`, `repository.go`, `postgres.go`, `service.go`, `queries/invocations.sql`, `storegen/`, `service_test.go`.

`service.go` — `Invoke(ctx, InvokeParams) (Invocation, error)`:

1. **Validate input**: run/task/scope/actor/capability non-empty; args JSON hợp lệ.
2. **Idempotency**: nếu `(run_id, idempotency_key)` đã có → trả invocation cũ, không dispatch lại.
3. **Run state**: `RunStateReader.GetRun` → nếu run `cancelled`/`completed`/`budget_exhausted` → deny.
4. **Scope**: `ScopeReader.IsScopeActive(scopeID)` → false → deny.
5. **Grant**: `GrantChecker.CheckActiveGrant(actor, scopeID, capability)` → false → deny + audit `denied`, trả `output.Denied`.
6. **Registry**: resolve `Implementation` + `Descriptor`; declared-only (chưa bind) → deny "not available"; kiểm `Compat` executor.
7. **Budget**: đếm invocation của run; vượt `max_invocations_per_run` → deny + audit (+ tùy chọn chuyển run `budget_exhausted`).
8. **Ghi invocation `pending`** (transaction) + audit `allowed`.
9. **Dispatch**: gọi `Impl.Invoke(ctx, args)`; với command executor → qua `sandbox.Runner`; bọc `context.WithTimeout`.
10. **Thu kết quả**: `Result.Validate()`; ghi raw/derived artifact qua `EvidenceWriter`; cập nhật invocation status + refs + exit code + error, optimistic `version`.
11. Trả `Invocation`.

`repository.go` (interface) + `postgres.go` (sqlc) + `queries/invocations.sql`:
`CreateInvocation`, `GetInvocation`, `GetByRunAndIdempotencyKey`, `UpdateInvocationResult` (optimistic version), `CountByRun`, `ListByRun`.

**Cancel/timeout** (`execution/cancel` hoặc trong invocation): Phase 4 dùng `context` cancellation + deadline; kiểm `ctx.Err()` sau dispatch; map sang `timed_out`/`cancelled`. Reconcile khi server chết để Phase 6 (`status='unknown'`).

---

## 7. `execution/sandbox` — môi trường

`backend/internal/execution/sandbox/sandbox.go`:

```go
type Spec struct {
    Command   string
    Args      []string
    Env       []string
    WorkDir   string
    Network   bool
    Resources map[string]any
}
type Result struct {
    ExitCode int
    Stdout   []byte
    Stderr   []byte
    TimedOut bool
}
type Runner interface {
    Run(ctx context.Context, spec Spec, stdin io.Reader) (Result, error)
}
```

- `LocalRunner`: `exec.CommandContext`, env tối thiểu, **không shell**, capture stdout/stderr, giới hạn output size.
- `ContainerRunner` (production): Docker API/CLI, image từ `containers/sandbox/Dockerfile`, `--network`, CPU/mem limits. Wire khi `sandbox.mode=container`.
- `command` implementation (thoả `registry.Implementation`) nhận `Runner` inject; chạy `nmap` từ manifest args + user args (validate/whitelist args, không shell injection).

`containers/sandbox/Dockerfile`: base minimal + cài nmap (và tool Phase 5+ sẽ thêm). Ghi rõ image tag trong config.

---

## 8. `execution/artifact`

Adapter ghi raw/derived qua `workspace/evidence`: chuẩn hoá storage key (đã content-addressed), parse output → structured artifact (`kind=derived`, `parent_id=raw`, `rel_type=parsed`, `parser_version`). Không ghi DB trực tiếp; gọi `EvidenceWriter`.

---

## 9. `tools/registry` — bind implementation

Không đổi interface. Ở `app` wiring: `registry.RegisterFromManifest(loader, "http_probe", builtin.NewHTTPProbe(...))`, `registry.RegisterFromManifest(loader, "nmap", command.NewCommandImpl(runner, ...))`. Declared-only vẫn discoverable nhưng `Available=false`.

---

## 10. `app` wiring + config

`backend/internal/app/services.go`: thêm `Execution *invocation.Service` với các port bọc service thật:

```go
invocation.NewService(
    invocation.NewPostgres(dbtx),
    projectSvc,      // ScopeReader
    governanceSvc,   // GrantChecker
    evidenceSvc,     // EvidenceWriter
    runsSvc,         // RunStateReader
    auditSvc,        // AuditRecorder
    allTools,        // resolver (registry)
    sandboxRunner,
    cfg.Execution,   // timeouts, budget
)
```

Thêm use case `Services.InvokeCapability(ctx, params)` (giống `StartAuthorizedRun` ở Phase 3) để gọi từ test/integration.

**Config** (`internal/app/config.go`): thêm `ExecutionConfig{ DefaultTimeout, MaxOutputBytes, MaxInvocationsPerRun }` + `SandboxConfig{ Mode, Image, Network }`, env override `RAP_EXECUTION_*`, `RAP_SANDBOX_*`; validate.

---

## 11. `evals/` + lab fixture

- `evals/fixtures/lab/compose.yaml`: service lab (HTTP server đơn giản) cho `http_probe`; service target cho `nmap`.
- `evals/cases/http_probe_success.yaml`, `http_probe_error.yaml` (kỳ vọng raw evidence + result status).
- `evals/baselines/`: kết quả chuẩn để Phase 5 so sánh.
- Runner tối thiểu (Go test hoặc script) đọc case → gọi execution → so oracle.

---

## 12. Tests

- **Unit** `execution/invocation/service_test.go`: deny khi scope inactive / grant thiếu / run cancelled / budget vượt; idempotency trả invocation cũ; success/failed/timed_out mapping; `Result.Validate` gate. Dùng memRepo + fake ports.
- **Unit** `tools/builtin/http_probe_test.go`: httptest server → success; URL sai → error; server treo → timeout.
- **Unit** `execution/sandbox/local_test.go`: exit code, stdout/stderr, timeout, output cap.
- **Integration** (`internal/app` opt-in `RAP_TEST_DATABASE_URL`): project+scope+member+grant → `InvokeCapability` success (evidence row + artifact bytes + invocation `succeeded`); case lỗi (deny/không grant; command fail).
- **Architecture**: thêm luật import ở §2.

---

## 13. CI

- `ci.yaml`: integration test chạy với `RAP_TEST_DATABASE_URL` + migrate (đã có từ Phase 3).
- Nếu có Docker sandbox test → job riêng có service container; nếu chưa, chỉ test `LocalRunner` + builtin.
- Thêm `sqlc diff` để chặn drift generated code.

---

## 14. Verification checklist (acceptance)

```bash
cd backend
gofmt -l internal tests
~/go1.26/bin/staticcheck ./...
~/go1.26/bin/go vet -mod=readonly ./...
~/go1.26/bin/go build -mod=readonly ./...
~/go1.26/bin/go test -race -mod=readonly -count=1 -timeout=300s ./...
~/go1.26/bin/go mod verify

# live
RAP_DATABASE_URL=... go run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up
RAP_TEST_DATABASE_URL=... go test -race -count=1 -run TestPhase4 ./internal/app/
```

Đối chiếu DB: `tool_invocations` có bản ghi `succeeded` + `failed`; `artifacts` có raw/derived đúng provenance; `audit_records` có `tool.invoke allowed/denied`.

---

## 15. Gotchas

- **Ghi invocation trước dispatch**; không giữ DB transaction mở suốt quá trình chạy tool.
- **Không shell**: dùng `exec.Command` với args tách rời; validate/whitelist args từ manifest.
- **Evidence đã content-addressed** — key do service sinh, không truyền từ tool.
- **Không để type Eino/sandbox lộ vào entity nghiệp vụ.**
- **Budget** dùng `budget_exhausted`, không phải `completed`.
- **Cancel** theo kết quả ghi nhận, không theo HTTP response (Phase 7).
- `tool_invocations.scope_id` + grant ghi lại để truy vết; snapshot không thay kiểm tra quyền hiện tại.

---

## 16. Thứ tự commit đề xuất

1. Migration `00011` + `execution/invocation` types/repo/queries/postgres (+ test repo).
2. `execution/invocation` service + ports + unit tests (dùng fake impl, chưa có sandbox thật).
3. `tools/output` mở rộng + `tools/builtin/http_probe` + manifest + unit test.
4. `execution/sandbox` LocalRunner + `execution/artifact` + `nmap` command impl.
5. `app` wiring + config + use case `InvokeCapability`.
6. Integration test + `evals/fixtures` + `containers/sandbox/Dockerfile`.
7. Architecture tests + docs (`migration_manifest_v1.md` Phase 4, `AGENTS.md`, `README`).

---

## 17. Bản ghi implementation (Phase 4)

Đã triển khai đủ 7 bước commit đề xuất. Trạng thái xác minh: `gofmt`/`vet`/`staticcheck`/`build`/`test -race`/`mod verify`/`scripts/check.sh` đều sạch; integration test Phase 3 + Phase 4 chạy live trên PostgreSQL (`RAP_TEST_DATABASE_URL`).

**Đã tạo:**

- `backend/migrations/00011_execution_invocations.sql` — bảng `tool_invocations` (owner: execution/invocation), đã apply live.
- `backend/internal/execution/invocation/` — `types.go`, `repository.go`, `postgres.go`, `queries/invocations.sql`, `storegen/`, `service.go` (ports `GrantChecker`/`ScopeReader`/`RunStateReader`/`AuditRecorder` + resolver registry), test repo + service.
- `backend/internal/execution/artifact/` — adapter `Writer` chuẩn hoá raw/derived qua evidence (provenance: kind/parent/rel_type/parser_version).
- `backend/internal/execution/sandbox/` — `sandbox.go` (Spec/Result/`Runner` interface); `sandbox/local/` (`LocalRunner`, host lab); `sandbox/container/` (`ContainerRunner`, docker CLI); `sandbox/internal/capture/` (capped stream buffer).
- `backend/internal/tools/builtin/http_probe.go` + `http_probe_test.go` — capability builtin đầu tiên.
- `backend/internal/tools/builtin/command/` — capability command (nmap) qua `sandbox.Runner`, whitelist flag, không shell.
- `backend/internal/app/services.go` — bind implementation (`http_probe`, `nmap`) + dựng `Execution`; `Services.InvokeCapability` use case.
- `backend/internal/app/config.go` — `ExecutionConfig` + `SandboxConfig` (+ env `RAP_EXECUTION_*`, `RAP_SANDBOX_*`, validate).
- `backend/internal/app/phase4_integration_test.go` — acceptance opt-in (success + deny + idempotency + audit + artifact bytes).
- `backend/tests/evals/` + `evals/cases/*.yaml` + `evals/baselines/*.json` + `evals/fixtures/lab/compose.yaml`.
- `containers/sandbox/Dockerfile`.
- `backend/tests/architecture/imports_test.go` — thêm luật `tools↛engine/agents`, `execution↛{engine/agents,api,app}`, chỉ `app` import concrete sandbox.

**Sai lệch có chủ đích so với hướng dẫn (và lý do):**

1. **Evidence do implementation ghi, execution chỉ lưu ref.** §6 bước 10 mô tả execution ghi artifact qua `EvidenceWriter`, nhưng §5 lại inject `EvidenceWriter` vào `http_probe`. Chọn cách nhất quán: capability (builtin/command) tự ghi bytes domain-specific của nó qua evidence, trả `Result.RawRef`; `execution` chỉ persist ref. Nhờ vậy `execution` không cần biết định dạng bytes của từng tool, và ownership evidence vẫn nằm ở `workspace/evidence`. Do đó `invocation.NewService` không nhận `EvidenceWriter`/`sandboxRunner` như danh sách port ở §10.
2. **Sandbox tách subpackage.** Để luật "chỉ `app` import concrete sandbox adapter" (§2) kiểm tra được, `LocalRunner`/`ContainerRunner` nằm ở `execution/sandbox/local` và `execution/sandbox/container`; `execution/sandbox` chỉ còn `Spec`/`Result`/`Runner` (interface) mà `tools`/`execution` được phép import.
3. **`nmap` manifest thu hẹp về contract đã implement.** Manifest gốc (timing/NSE/OS-detection/`additional_args`) vượt phạm vi Phase 4; manifest hiện chỉ khai báo `target`/`ports`/`flags` (allowlist) để catalog khớp với implementation thật. Các tuỳ chọn còn lại để phase sau.
4. **`Result` có thêm `Denied`/`ExitCode`/`DurationMs`** như §4 (đã có sẵn từ đầu Phase 4).

