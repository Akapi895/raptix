# Phase 5 — Một agent hoàn chỉnh, có verifier (kế hoạch triển khai)

**Căn cứ:** `docs/migration_roadmap_v1.md` (Phase 5), `docs/repository_structure_v1.md` (§1, §3.3, §3.3.1, §3.4.1, §3.5, §3.6, §6, §9.2), `AGENTS.md`.
**Trạng thái:** **đã triển khai** (xem §15 cho bản ghi implementation và các sai lệch có chủ đích). Phase 4 đã xong và validate live (xem `migration_manifest_v1.md` Phase 4).

---

## 0. Mốc hoàn thành và ràng buộc

**Folder theo thứ tự (roadmap):** `engine/contextbuild/` → `engine/agents/` + `engine/runs/` → `workspace/verifier/` + `workspace/findings/` + `workspace/assessment/`; mở rộng `evals/`.

**Xong khi:** một run đi trọn đường `task → agent → tool → evidence/observation → verifier → finding draft có căn cứ`, đánh giá được trên lab bằng runner + oracle + reset.

**Ràng buộc bất biến (không được vi phạm):**

- Mọi invocation — kể cả **verifier kiểm tra chủ động** — phải đi qua `execution`. Không có đường thực thi thứ hai; verifier không tự chạy process/gọi MCP trực tiếp.
- `engine/runs` là **owner duy nhất** của lifecycle transition (run/task/agent). `engine/agents` yêu cầu chuyển trạng thái qua `engine/runs`, không tự ghi status thứ hai.
- `engine/agents` **không tự quyết định quyền**; mọi access đi qua `platform/governance`. Snapshot Requested/Available/Granted là ghi nhận tại một thời điểm, **không thay thế kiểm tra quyền hiện tại** (execution vẫn kiểm scope/grant/budget lúc dispatch).
- Eino chỉ đứng sau `engine/llm/adapters/eino` cho model call/streaming; plan/replan/checkpoint/retry/lifecycle thuộc `engine/orchestrator` + `engine/runs`. Không dùng workflow runtime của Eino làm vòng điều phối thứ hai.
- `workspace/verifier` **trả verdict** (confirmed/refuted/inconclusive) + evidence refs; **`workspace/findings` là owner duy nhất** của status transition — verdict không tự đổi status.
- Ownership dữ liệu: conversation/content snapshot → `engine/agents`; lifecycle → `engine/runs`; bytes/artifact → `workspace/evidence`; verdict → `workspace/verifier`; status/revision → `workspace/findings`; result envelope → `tools/output`.
- Cross-module qua public service API; không join bảng chéo; atomicity đa module phải có transaction boundary tường minh.
- `tools` không import `engine/agents`; `execution` không import `api`/`app`/`engine/agents`. (Luật kiến trúc Phase 5 cần bổ sung: `engine/agents` không import `workspace/verifier`/`findings`; `verifier` không import `engine/agents`.)

---

## 1. Quyết định cần chốt trước khi code

| # | Quyết định | Đề xuất |
|---|---|---|
| D1 | Agent loop tối thiểu | **ReAct đơn giản, single agent**: dựng context → gọi model → model trả *action* (tool call) hoặc *final answer*. Dùng structured output (JSON) thay vì parse function-calling của provider để giữ contract ổn định qua Eino. |
| D2 | Tool call qua execution | Agent **không** gọi tool trực tiếp. Agent sinh request capability, `engine/agents` gọi `execution.InvokeCapability` rồi đưa `output.Result` trở lại context. |
| D3 | Context ban đầu | Dùng conversation + evidence references (đã có từ Phase 3/4); **chưa cần** memory/knowledge (Phase 9). `contextbuild` ghép prompt + skill đã chọn + tool results với ngân sách token. |
| D4 | Verifier | Một loại verification đầu tiên: **re-run/re-check qua `execution`** với tiêu chí theo loại kết luận (ví dụ re-probe `http_probe` để đối chiếu observation), trả verdict gắn finding revision. |
| D5 | Điểm khởi chạy | **Plan tối thiểu**: 1 run → 1 task → 1 agent, không spawn subagent (Phase 10). Orchestrator chỉ là lớp mỏng tạo kế hoạch một bước, hoặc bỏ qua — `agents` tự chạy cho một task. |
| D6 | Lab + oracle | Lab `http_probe` đã có (`evals/fixtures/lab/compose.yaml`); thêm case agent end-to-end với oracle xác nhận finding draft + verdict. |

---

## 2. Package sẽ tạo và chiều dependency

```text
backend/internal/engine/
├── contextbuild/        # types.go, builder.go, budget.go, builder_test.go
├── agents/              # types.go, service.go, loop.go, tool.go, snapshot.go, queries/, storegen/, service_test.go
└── runs/                # mở rộng: agent attempt/state cần thiết
backend/internal/workspace/
├── verifier/            # types.go, service.go, criteria.go, queries/, storegen/, service_test.go
└── findings/            # mở rộng: gắn verdict với revision
evals/
├── cases/agent_*.yaml
├── baselines/agent_*.json
└── fixtures/lab/compose.yaml  # đã có, bổ sung nếu cần
```

**Ports do nơi dùng sở hữu** (consumer-owned port), `app` inject adapter bọc service thật:

```go
// engine/agents tự định nghĩa:
type ToolExecutor interface {
    InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error)
}
type ModelCaller interface { // thực chất tái dùng engine/llm.Model
    Chat(ctx context.Context, req *llm.ChatRequest) (*llm.ChatResponse, error)
}
type RunState interface {
    GetRun(ctx, id) (runs.Run, error)
    TransitionAgent(ctx, id, fromVersion, to) (runs.Agent, error) // lifecycle qua runs
}

// workspace/verifier tự định nghĩa:
type Executor interface { // gọi lại execution để re-check
    InvokeCapability(ctx, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error)
}
type FindingReader interface {
    GetFinding(ctx, id) (findings.Finding, error)
    GetRevision(ctx, id) (findings.FindingRevision, error)
}
type VerdictWriter interface { // findings là owner transition; verifier chỉ ghi verdict
    RecordVerdict(ctx, p findings.InsertVerdictParams) (findings.Verdict, error)
}
```

**Chiều dependency bắt buộc:**

- `engine/agents` import `engine/llm` (contract), `engine/contextbuild`, `engine/runs` (types + service contract), `tools/output`, `tools/registry` (resolve descriptor), `execution/invocation` (types của `InvokeParams`/`Invocation`), `platform/governance` (qua interface nếu cần check granted).
- `engine/contextbuild` import `content` (prompt/skill), `workspace/evidence` (refs), `engine/llm` (message shape).
- `workspace/verifier` import `execution/invocation` (types), `workspace/findings` (types/params), `workspace/evidence` (refs). **Không** import `engine/agents`.
- `app` dựng tất cả, inject `execution.InvokeCapability` cho cả `agents` lẫn `verifier`.

---

## 3. Data model — mở rộng `engine/agents` (migration 00012)

Agent attempt và conversation là tài sản của `engine/agents`. Cần lưu bền vững để run có thể tiếp tục (Phase 6) và truy vết context đã dùng.

```sql
-- +goose Up
-- Domain: engine/agents
CREATE TABLE agent_attempts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    attempt_no    integer NOT NULL DEFAULT 1,
    status        text NOT NULL DEFAULT 'running',
        -- running | succeeded | failed | timed_out | cancelled
    started_at    timestamptz,
    finished_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_id, attempt_no),
    CHECK (status IN ('running','succeeded','failed','timed_out','cancelled')),
    CHECK (attempt_no > 0)
);

CREATE TABLE agent_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id    uuid NOT NULL REFERENCES agent_attempts(id) ON DELETE CASCADE,
    seq           integer NOT NULL,
    role          text NOT NULL,        -- system | user | assistant | tool
    content       text NOT NULL,
    invocation_id uuid REFERENCES tool_invocations(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, seq),
    CHECK (role IN ('system','user','assistant','tool'))
);

CREATE TABLE agent_snapshots (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    profile_ref   text NOT NULL,        -- name/version của profile
    content_hash  text NOT NULL,        -- hash của profile+prompt+skill đã resolve
    requested     jsonb NOT NULL DEFAULT '[]'::jsonb, -- tools/skills/resources đã yêu cầu
    granted       jsonb NOT NULL DEFAULT '{}'::jsonb, -- capability grant snapshot (tham chiếu, không thay quyền)
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_id, content_hash)
);
```

- `agent_messages.invocation_id` nối message "tool result" với `tool_invocations` để truy vết (không join bảng chéo — chỉ là ref).
- Snapshot ghi nhận **đã resolve tại thời điểm** chạy; `granted` là tham chiếu, **không thay thế** kiểm tra quyền hiện tại ở `execution`.

> Kiểm tra `engine/runs/agents` bảng hiện tại đã có (Phase 3 tạo `agents`); migration 00012 chỉ **mở rộng** thêm 3 bảng trên, không sửa bảng `agents`.

---

## 4. `engine/contextbuild` — dựng context có ngân sách

`contextbuild.go` + `builder.go`:

```go
type Budget struct {
    MaxTokens int
}

type Builder struct {
    prompts PromptSource // content.Loader
}

func NewBuilder(p PromptSource, budget Budget) *Builder

// Build trả danh sách message theo thứ tự: system prompt (profile + skill) →
// lịch sử conversation → tool results (đã tóm tắt/truncate) → user task.
func (b *Builder) Build(ctx context.Context, in BuildInput) ([]llm.ChatMessage, error)
```

`BuildInput` gồm: profile, các skill đã chọn (body), task, các message trước đó, evidence refs (id + tóm tắt). Provenance: context view ghi nguồn dữ liệu đã dùng (không sửa raw evidence). Khi vượt ngân sách → truncate từ dưới lên, giữ system prompt và lượt gần nhất; ghi nhận đã cắt.

Unit test: thứ tự message, cắt budget, provenance của skill/prompt.

---

## 5. `engine/agents` — agent loop

Files: `types.go`, `snapshot.go`, `tool.go`, `loop.go`, `service.go`, `repository.go`, `postgres.go`, `queries/`, `storegen/`, `service_test.go`.

### 5.1. Snapshot (Requested / Available / Granted)

`snapshot.go` — `ResolveSnapshot(ctx, agent)`:

1. **Requested**: từ profile (`Requested.Tools/Skills/Resources`).
2. **Available**: hỏi `tools/registry` (Available/Compat) cho từng tool.
3. **Granted**: hỏi `platform/governance` (`CheckActiveGrant`) cho từng capability trong scope của run.
4. Lưu `agent_snapshots` (hash profile+prompt+skill). Nạp skill hai mức (metadata trước, body khi dùng).

### 5.2. Tool call (`tool.go`)

Agent muốn chạy tool → sinh request (`capability`, `args`, `idempotency_key` từ attempt+seq) → gọi `ToolExecutor.InvokeCapability` với `InvokeParams{RunID, ScopeID, Actor, Capability, Args}`. Nhận `(Invocation, *output.Result)`:

- `result.Execution == denied` → ghi message "tool" + kết thúc attempt với lý do (hoặc báo model điều chỉnh).
- `succeeded` → đưa `RawRef` + tóm tắt vào context.
- `failed`/`timed_out` → đưa lỗi vào context, model quyết định tiếp tục hay dừng.

`idempotency_key = "<attempt_id>:<seq>"` để retry không chạy tool trùng.

### 5.3. Loop (`loop.go`)

```go
func (s *Service) RunAttempt(ctx context.Context, agent runs.Agent) (attemptResult, error)
```

1. `runs.TransitionAgent(→ running)` (nếu chưa).
2. Lặp tối đa `max_steps` (config):
   - `contextbuild.Build` → `llm.Chat` (structured JSON output).
   - Parse action: `{"action":"tool","capability":...,"args":{...}}` hoặc `{"action":"final","summary":...,"finding_draft":{...}}`.
   - Nếu `tool` → `tool.go` dispatch; ghi `agent_messages` (assistant + tool result).
   - Nếu `final` → dừng, trả summary + finding draft thô.
3. `runs.TransitionAgent(→ succeeded/failed)`; đóng `agent_attempts`.
4. Timeout/cancel: `ctx` deadline → `timed_out`; hủy → `cancelled` (map đúng, không báo thành công khi chưa rõ).

### 5.4. Service (`service.go`)

`RunAgent(ctx, agentID)` là entrypoint công khai; `runs`/`execution`/`llm`/`contextbuild` đều qua interface. Không ghi status run/task ở đây — chỉ yêu cầu `runs.TransitionAgent`.

Unit test (fake Model + fake ToolExecutor + memRepo): model trả `tool` rồi `final`; verify snapshot, thứ tự dispatch, idempotency key, mapping denied/failed/timeout.

---

## 6. `workspace/verifier` — kiểm chứng theo tiêu chí

Files: `types.go`, `criteria.go`, `service.go`, `repository.go`, `postgres.go`, `queries/`, `storegen/`, `service_test.go`.

### 6.1. Verdict contract

```go
type Verdict string
const (
    VerdictConfirmed    Verdict = "confirmed"
    VerdictRefuted      Verdict = "refuted"
    VerdictInconclusive Verdict = "inconclusive"
)

type Criteria struct {
    FindingKind string          // loại kết luận (vd: "http-200-exposed")
    Checks      []CheckSpec     // danh sách bước kiểm chứng
}
```

### 6.2. Luồng `Verify`

`Verify(ctx, findingID)`:

1. Đọc finding + evidence links (`FindingReader`).
2. Chọn `Criteria` theo loại kết luận của finding.
3. Chạy checks qua `Executor.InvokeCapability` (vd re-probe URL → so observation). Mọi check đi qua `execution` → có `tool_invocations` + audit.
4. So kết quả với tiêu chí → `Verdict` + lý do + evidence mới.
5. Gọi `VerdictWriter.RecordVerdict` (findings là owner; verdict gắn revision, **không tự đổi status**).

Lưu ý quan trọng từ §3.6: một lần re-run thất bại có thể do môi trường/credential/thiếu điều kiện → chưa đủ kết luận `refuted`; mapping thận trọng `failed → inconclusive` (trừ tiêu chí rõ ràng).

Unit test (fake Executor + fake FindingReader): confirmed khi re-check khớp, inconclusive khi môi trường lỗi, verdict gắn đúng revision.

---

## 7. `engine/runs` + `workspace/findings` — mở rộng nhỏ

- `engine/runs`: thêm transition agent `running → succeeded/failed/timed_out/cancelled` (kiểm `allowedAgentTransitions`), method đọc `ListAgentsByRun`.
- `workspace/findings`: `RecordVerdict` đã có (Phase 3). Bổ sung nếu cần: đọc `FindingRevision`/`GetVerdict` cho verifier.

---

## 8. `app` wiring + config

`backend/internal/app/services.go`:

```go
// buildAgentLoop builds the Phase 5 agent + verifier and returns them for the
// composition root to expose (invoke path lives in cmd/server later).
ctxBuilder := contextbuild.NewBuilder(contentLoader, contextbuild.Budget{MaxTokens: cfg.Agent.MaxContextTokens})
agentSvc := agents.NewService(
    agents.NewPostgres(dbtx),
    model,          // llm.Model (nil khi chưa có API key → agent loop bị disable)
    ctxBuilder,
    svc.Execution,  // ToolExecutor (InvokeCapability)
    svc.Runs,       // RunState (transition qua runs)
    svc.Governance, // granted check cho snapshot
    cfg.Agent,
)
verifierSvc := verifier.NewService(
    verifier.NewPostgres(dbtx),
    svc.Execution,  // Executor (re-check qua execution)
    svc.Findings,   // FindingReader + VerdictWriter
    defaultCriteria(),
)
```

**Config** (`internal/app/config.go`): thêm `AgentConfig{ MaxSteps, MaxContextTokens, DefaultTimeout, Model }`, env `RAP_AGENT_*`; validate. `model` nil (thiếu `RAP_LLM_API_KEY`) → agent loop disable nhưng server vẫn khởi động (giống Phase 2 đã làm).

Thêm use case `Services.RunAgent(ctx, runID, taskID)` làm entrypoint cho test/integration (giống `StartAuthorizedRun`).

---

## 9. Evals + lab

- `evals/cases/agent_http_probe.yaml`: case end-to-end — agent nhận task "kiểm tra endpoint lab" → chạy `http_probe` → tạo finding draft → verifier confirm. Oracle xác nhận: có ≥1 `tool_invocations` succeeded, có finding draft gắn evidence, verdict `confirmed`.
- `evals/baselines/agent_http_probe.json`: baseline để so sánh Phase 6+.
- `backend/tests/evals/`: mở rộng runner để chạy case agent (dùng fake Model có lời đáp script, không cần API key — deterministic).

---

## 10. Tests

- **Unit** `engine/contextbuild`: thứ tự message, cắt budget, provenance.
- **Unit** `engine/agents`: snapshot (requested/available/granted), tool dispatch + idempotency key, loop mapping (tool→final, denied/failed/timed_out/cancelled).
- **Unit** `workspace/verifier`: confirmed/inconclusive/refuted theo tiêu chí; verdict gắn revision, không đổi status.
- **Integration** (`internal/app` opt-in `RAP_TEST_DATABASE_URL`): run→task→agent (fake Model) → `InvokeCapability` `http_probe` thành công → finding draft + verdict → assert invocation/evidence/finding/verdict rows.
- **Architecture** (`tests/architecture/imports_test.go`): bổ sung `engine/agents ↛ workspace/{verifier,findings}`; `workspace/verifier ↛ engine/agents`; `engine/contextbuild ↛ execution` (chỉ đọc refs).

---

## 11. CI

- Giữ integration test Phase 3/4/5 chung một job `raptix_test` + migrate (đã có).
- Eval agent chạy trong job test thường (fake Model, không cần API key).

---

## 12. Verification checklist (acceptance)

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
RAP_TEST_DATABASE_URL=... go test -race -count=1 -run "TestPhase5" ./internal/app/
```

Đối chiếu DB: `agent_attempts` có attempt succeeded; `agent_messages` có tool + tool result (nối `invocation_id`); `tool_invocations` có succeeded từ agent; `findings` có draft gắn evidence; verdict gắn revision; `audit_records` có `tool.invoke` allowed.

---

## 13. Gotchas

- **Không gọi tool ngoài execution** — cả agent lẫn verifier.
- **Lifecycle qua `runs`** — agent không tự ghi status.
- **Snapshot không thay quyền hiện tại** — thu hồi/scope hết hạn vẫn chặn ở dispatch.
- **Structured output của model là contract nội bộ** — parse JSON thận trọng; parse lỗi = attempt failed có lý do, không crash.
- **Idempotency key theo attempt:seq** — retry loop không chạy lại tool.
- **Mapping verdict thận trọng** — re-check fail ≠ refuted.
- **`model == nil` khi thiếu API key** — agent loop disabled nhưng app vẫn khởi động.

---

## 14. Thứ tự commit đề xuất

1. Migration `00012` + `engine/agents` types/repo/queries/postgres (+ test repo).
2. `engine/contextbuild` builder + budget + unit test.
3. `engine/agents` snapshot + tool + loop + service + unit tests (fake model/executor).
4. `workspace/verifier` types/criteria/service + unit tests.
5. `engine/runs` transition agent + `workspace/findings` read/verdict mở rộng nhỏ.
6. `app` wiring + `AgentConfig` + use case `RunAgent`.
7. Integration test + `evals` case agent + architecture tests + docs (`migration_manifest_v1.md` Phase 5, `AGENTS.md`, `README`).

---

## 15. Bản ghi implementation (Phase 5)

Đã triển khai đủ 7 bước commit đề xuất. Xác minh: `gofmt`/`vet`/`build`/`staticcheck`/`mod verify`/`test -race ./...`/`scripts/check.sh` sạch; `sqlc diff` không drift; integration Phase 3/4/5 chạy live trên PostgreSQL.

**Đã tạo:**

- `backend/migrations/00012_engine_agents.sql` — `agent_attempts`, `agent_messages`, `agent_snapshots` (owner: engine/agents; FK tới `agent_instances` + `tool_invocations`). Đã apply live (12/12).
- `backend/internal/engine/agents/` — `types.go`, `repository.go`, `postgres.go`, `queries/agents.sql`, `storegen/`, `service.go` (ports `ToolExecutor`/`RunState`/`GrantChecker`/`CapabilityResolver`), `loop.go`, `tool.go`, `snapshot.go`, `memrepo_test.go`, `repository_test.go`, `service_test.go`.
- `backend/internal/engine/contextbuild/` — `types.go`, `builder.go` (`Resolve` + `Build` có budget), `builder_test.go`.
- `backend/internal/workspace/verifier/` — `types.go`, `service.go` (criteria + verdict aggregation), `service_test.go`. Stateless: verdict ghi qua findings.
- `backend/internal/content/loader.go` — thêm `LoadPrompt(ref)`.
- `backend/internal/engine/runs/` — thêm `ListAgentsByRun` (query + repo + service + memRepo).
- `backend/internal/app/` — `AgentConfig` (+ env `RAP_AGENT_*`), wiring `Agents`/`Verifier` trong `wireServices`, use case `Services.RunAgent` (`phase5_runs.go`), integration test `phase5_integration_test.go`.
- `evals/cases/agent_http_probe.yaml` + `evals/baselines/agent_http_probe.json` + runner `backend/tests/evals/agent_test.go`.
- `backend/tests/architecture/imports_test.go` — luật `engine/agents↛workspace/{findings,verifier}`, `workspace/verifier↛engine/agents`, `engine/contextbuild↛execution`.

**Sai lệch có chủ đích so với hướng dẫn (và lý do):**

1. **Verifier stateless, không có repository/queries/storegen riêng.** §6 liệt kê repository/queries/storegen cho verifier, nhưng verdict thuộc `workspace/findings` (`finding_verdicts`) và §3.6 chốt findings là owner duy nhất. Verifier chỉ đọc finding + ghi verdict qua findings service, nên không cần bảng riêng (đúng nguyên tắc "chỉ tạo package có implementation thật").
2. **Criteria truyền tường minh thay vì suy từ `FindingKind`.** Findings chưa có trường `kind` (finding revision/report để Phase 8). Verifier nhận `[]Check{Capability, Args, ConfirmOn, RefuteOn}` do app dựng từ các tool call thành công của agent (`AttemptResult.ToolCalls`) — grounding vào đúng kiểm tra đã tạo ra evidence. `RefuteOn` mặc định rỗng nên re-check lỗi → `inconclusive` (theo §3.6).
3. **`RunAgentParams` mang `ScopeID`/`Actor`.** `runs` không lưu scope (Phase 3); agent cần scope để dispatch. Truyền qua params thay vì đổi schema runs.
4. **Tool result là lượt `user` khi gửi model.** Contract `engine/llm` chỉ có system/user/assistant (không có tool role); `agent_messages` vẫn lưu role `tool` + `invocation_id` để truy vết.
5. **Agent trả finding draft thô, không tự tạo finding.** §5.3 nói loop trả "finding draft thô"; `engine/agents` không import `findings` (luật kiến trúc), nên `Services.RunAgent` (app) tạo draft + link evidence + verify.
6. **Status agent instance dùng `completed/failed/cancelled`** (enum sẵn có của `runs`); `timed_out` nằm ở `agent_attempts.status` và map sang `failed` ở agent instance.
