# Phase 6 — Độ tin cậy của execution và run (kế hoạch triển khai)

**Căn cứ:** `docs/migration_roadmap_v1.md` (Phase 6), `docs/repository_structure_v1.md` (§3.3 "phân biệt attempt", §3.5 "execution/cancel", §6.1 "chiều dependency", §7 "transaction/artifact/report flow"), `AGENTS.md`.
**Trạng thái:** đã triển khai và validate live (xem `migration_manifest_v1.md` Phase 6).

---

## 0. Mốc hoàn thành và ràng buộc

**Folder (roadmap):** `execution/cancel/`, `execution/invocation/`, `execution/artifact/`, `engine/runs/`, `engine/agents/`, `workspace/evidence/`; mở rộng test integration.

**Xong khi:** luồng Phase 5 chịu được **hủy** và **restart**; hệ thống **không mặc nhiên báo thành công hoặc chạy lại tool** khi kết quả lần trước chưa rõ.

Cụ thể:
1. **Hủy (cancel)**: hủy một run đang chạy → run/task/agent/attempt chuyển `cancelled`, invocation chưa dispatch chuyển `cancelled`, invocation đang chạy chuyển `unknown` (side effect ngoài chưa rõ). Không có invocation nào bị báo `succeeded` sai.
2. **Restart (reconcile)**: khi server chết giữa chừng, invocation để lại trạng thái không cuối (`pending`/`dispatched`/`running`) được đối soát về `unknown`; không tự chạy lại, không tự báo thành công.
3. **Retry an toàn**: cùng `idempotency_key` không bao giờ dispatch lại; kết quả `unknown` không được xử lý như thành công/thất bại cuối cùng.

**Ràng buộc bất biến (giữ nguyên từ Phase 4/5, thêm Phase 6):**

- Mọi invocation — kể cả verifier — đi qua `execution`. Không có đường thực thi thứ hai.
- `engine/runs` là **owner duy nhất** của lifecycle transition run/task/agent; `engine/agents` sở hữu attempt/conversation. Hủy phải **yêu cầu transition qua chủ sở hữu**, không tự sửa bảng chéo.
- `execution/cancel` chỉ thao tác trên `tool_invocations` (một miền execution); **không import `engine`** (runs/agents). Cascade xuyên module do `app` dàn xếp.
- "Unknown" là trạng thái bắt buộc đối soát: tác động ngoài **đã xảy ra hoặc có thể đã xảy ra** nhưng kết quả chưa ghi nhận. `cancelled` chỉ dùng khi chưa dispatch (chưa có side effect).
- Retry queue/attempt mới **không mặc nhiên tạo lại tool invocation** khi invocation trước cùng mục đích còn `unknown`; phải đối soát trước (để Phase 8–10 xử lý tiếp).
- Go `context` cancellation thể hiện **ý định hủy**; trạng thái bền vững `completed/cancelled/unknown` theo **kết quả đã ghi nhận**, không theo HTTP đã trả response.
- Ownership dữ liệu không đổi: lifecycle → `engine/runs`; invocation → `execution`; attempt/conversation → `engine/agents`; bytes → `workspace/evidence`.

---

## 1. Quyết định đã chốt

| # | Quyết định | Lựa chọn |
|---|---|---|
| D1 | Trạng thái invocation khi hủy | `pending`/`dispatched` → `cancelled` (chưa có side effect); `running` → `unknown` (side effect chưa rõ, bắt buộc đối soát) |
| D2 | Reconcile trigger | Chạy **1 pass khi `cmd/server` khởi động** + use case `Reconcile` gọi tường minh (test/thủ công). Vòng lặp định kỳ để **Phase 8** (River jobs) |
| D3 | Phạm vi cancel | **Cascade đầy đủ**: use case `CancelRun` (app) → run/task/agent/attempt `cancelled` + invocation hai mức như D1 |
| D4 | Package cancel | `execution/cancel` là package riêng (theo roadmap), chỉ thao tác `tool_invocations` qua port `Store` do `execution/invocation` triển khai; không import `engine` |
| D5 | Trạng thái trung gian | `pending` (đã ghi, chưa dispatch) → `running` (đã dispatch, đang chạy, có `started_at`) → terminal. Bỏ qua `dispatched` (giữ cột hợp lệ nhưng không dùng ở Phase 6) |
| D6 | Reconcile policy | Idempotent + optimistic-lock an toàn: nếu invocation đồng thời kết thúc, bỏ qua thay vì đè trạng thái |

---

## 2. Package và chiều dependency

```text
backend/internal/execution/
├── invocation/     # mở rộng: StartInvocation (pending→running, started_at), ListStale, CancelByRun, MarkUnknown
├── cancel/         # mới: policy cancel/reconcile (Service + Store port + Report types)
└── sandbox/        # không đổi
backend/internal/engine/
├── runs/           # mở rộng: ListTasksByRun + CancelRun (cascade run/task/agent trong miền runs)
└── agents/         # mở rộng: CancelRunningAttempts (running→cancelled)
backend/internal/app/  # use case CancelRun + Reconcile; startup reconcile
backend/cmd/server/    # gọi reconcile một lần khi khởi động
backend/tests/architecture/  # thêm luật execution/cancel ↛ engine
```

**Ports do nơi dùng sở hữu** (consumer-owned), `app` inject adapter:

```go
// execution/cancel tự định nghĩa:
type Store interface {
    ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]invocation.Invocation, error)
    MarkUnknown(ctx context.Context, id uuid.UUID, version int) (invocation.Invocation, error)
    CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []invocation.Status, to invocation.Status) (int64, error)
}
```

**Chiều dependency bắt buộc:**

- `execution/cancel` import **chỉ** `execution/invocation` (types) — không import `engine`/`api`/`app`. `invocation.Postgres` thoả `Store`.
- `execution/invocation` giữ nguyên quy tắc hiện có (`↛ api/app/engine/agents`); vẫn được phép dùng `engine/runs` chỉ cho **type** của port `RunStateReader` (đã có từ Phase 4).
- `engine/runs` + `engine/agents` không import `execution` (cascade do app dàn xếp).
- `app` import tất cả và dựng `execution/cancel`, inject `Store = invocation.Postgres`.

---

## 3. Migration 00013 — index cho stale scan

Không cần bảng mới (mọi trạng thái đã có ở `tool_invocations` từ 00011). Chỉ thêm index phục vụ query stale:

```sql
-- +goose Up
-- Domain: execution/cancel (đọc dữ liệu của execution/invocation)
CREATE INDEX tool_invocations_pending_stale_idx
    ON tool_invocations (created_at) WHERE status = 'pending';
CREATE INDEX tool_invocations_running_stale_idx
    ON tool_invocations (started_at) WHERE status IN ('dispatched','running');

-- +goose Down
DROP INDEX IF EXISTS tool_invocations_pending_stale_idx;
DROP INDEX IF EXISTS tool_invocations_running_stale_idx;
```

> Ghi chú: hai index partial phục vụ đúng hai nhánh stale (`pending` dùng `created_at`, `dispatched`/`running` dùng `started_at`). Không thay đổi CHECK/status vì enum đã chứa `cancelled`/`unknown`.

---

## 4. `execution/invocation` — hoàn thiện trạng thái trung gian

Hiện tại `Invoke` ghi `pending` rồi nhảy thẳng đến terminal (không đặt `started_at`), nên crash giữa chừng để lại `pending` không phân biệt được với "chưa dispatch".

### 4.1. Repository (thêm 4 method)

```go
type Repository interface {
    // ... existing ...
    StartInvocation(ctx context.Context, id uuid.UUID, version int) (Invocation, error)
    ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]Invocation, error)
    CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []Status, to Status) (int64, error)
    MarkUnknown(ctx context.Context, id uuid.UUID, version int) (Invocation, error)
}
```

Queries (`queries/invocations.sql`):

```sql
-- name: StartInvocation :one
UPDATE tool_invocations SET status='running', started_at=now(), version=version+1, updated_at=now()
WHERE id=$1 AND version=$2 AND status='pending'
RETURNING <all columns>;

-- name: ListStaleInvocations :many
SELECT <all columns> FROM tool_invocations
WHERE (status='pending' AND created_at < $1)
   OR (status IN ('dispatched','running') AND started_at < $1);

-- name: CancelInvocationsByRun :execrows
UPDATE tool_invocations SET status=$3, finished_at=now(), version=version+1, updated_at=now()
WHERE run_id=$1 AND status = ANY($2::text[]);

-- name: MarkUnknown :one
UPDATE tool_invocations SET status='unknown', finished_at=now(), version=version+1, updated_at=now()
WHERE id=$1 AND version=$2 AND status IN ('pending','dispatched','running')
RETURNING <all columns>;
```

### 4.2. Service — luồng `Invoke`

1. Validate → idempotency → run state → scope → grant → registry → budget (giữ nguyên Phase 4).
2. Ghi `pending` (`CreateInvocation`).
3. **Mới:** `StartInvocation(ctx, id, created.Version)` → `running` + `started_at`.
4. Dispatch có timeout (giữ nguyên), thu kết quả, `UpdateResult` (giữ nguyên optimistic version).
5. Khi context bị hủy trong lúc dispatch → kết quả impl là `cancelled`/`timed_out` → `UpdateResult` ghi terminal tương ứng (đã có). Trường hợp impl không kịp trả (panic/process chết) → để lại `running`, để `reconcile` xử lý (mục §5).

`StartInvocation` và `UpdateResult` cùng lấy `FOR SHARE` lock trên run active trong statement SQL. Nếu cancellation đã ghi run `cancelled`, start/result update trả optimistic conflict; sweep cancellation giữ `running` ở `unknown`, không ghi `succeeded` sau cancel.

### 4.3. Bất biến thêm

- `Invoke` không bao giờ dispatch khi idempotency hit trả invocation `pending`/`dispatched`/`running`/`unknown`: trả về **rõ ràng** là "outcome chưa rõ" thay vì coi là xong.
- Ghi `pending` lấy `FOR SHARE` lock trên run active trong cùng statement SQL; cancel và create được tuần tự hóa, nên cancel không bỏ sót invocation vừa được tạo.
- `started_at` là nguồn cho stale detection của `dispatched`/`running`.

---

## 5. `execution/cancel` — cancel + reconcile

Package mới `backend/internal/execution/cancel/`, sở hữu **chính sách** hủy/đối soát. Files: `types.go` (Report), `service.go`, `service_test.go`.

```go
type Service struct { store Store; log *slog.Logger }
func NewService(store Store, log *slog.Logger) *Service

type CancelReport struct { Cancelled int64; Unknown int64 }
type ReconcileReport struct { Reconciled int64; Skipped int64; Errors []error }
```

### 5.1. `CancelRun(ctx, runID) (CancelReport, error)`

Áp dụng chính sách D1:
1. `store.CancelInvocationsByRun(ctx, runID, []Status{pending, dispatched}, cancelled)`.
2. `store.CancelInvocationsByRun(ctx, runID, []Status{running}, unknown)`.
3. Trả report (`cancelled` count + `unknown` count).

Lưu ý: không đụng terminal (`succeeded`/`failed`/`timed_out`/`denied`/`cancelled`/`unknown` đã tồn tại) — hủy chỉ chuyển các trạng thái còn đang dở.

### 5.2. `Reconcile(ctx, olderThan time.Duration) (ReconcileReport, error)`

1. `store.ListStaleInvocations(ctx, now- olderThan)`.
2. Với mỗi invocation stale: `store.MarkUnknown(ctx, id, version)`.
   - Nếu `MarkUnknown` báo `ErrOptimisticLock` (invocation vừa kết thúc trong lúc đối soát) → `Skipped++` (không đè trạng thái).
   - Lỗi khác → gom vào `Errors` (không chặn toàn bộ batch).

Idempotent: chạy nhiều lần chỉ tái xét các invocation còn non-terminal; lần sau không thấy gì mới.

Unit test: fake `Store` — cancel hai mức đúng mapping; reconcile đánh `unknown` các stale, bỏ qua optimistic-lock, gom lỗi.

---

## 6. `engine/runs` + `engine/agents` — cascade trong miền sở hữu

### 6.1. `engine/runs`

Thêm read `ListTasksByRun` (đối xứng `ListAgentsByRun` đã có) + use case miền `CancelRun`:

```go
func (s *Service) ListTasksByRun(ctx context.Context, runID uuid.UUID) ([]Task, error)

// CancelRun transitions the run and its tasks/agents to cancelled. Idempotent
// for an already-terminal run; returns counts.
type RunCancelResult struct { RunCancelled bool; TasksCancelled int; AgentsCancelled int }
func (s *Service) CancelRun(ctx context.Context, runID uuid.UUID) (RunCancelResult, error)
```

Luồng `CancelRun`:
1. `GetRun`; nếu `cancelled`/`completed`/`budget_exhausted` → trả `RunCancelled=false` (idempotent).
2. `TransitionRun(→ cancelled)`.
3. `ListTasksByRun` + `ListAgentsByRun`; với mỗi task/agent non-terminal → compare-and-set `→ cancelled`. Bỏ qua optimistic-lock của từng phần tử, gom đếm. Nếu một lần cascade lỗi sau khi run đã `cancelled`, retry vẫn quét child non-terminal để hoàn tất cascade.

### 6.2. `engine/agents`

```go
// CancelRunningAttempts marks all running attempts of an agent cancelled.
func (s *Service) CancelRunningAttempts(ctx context.Context, agentID uuid.UUID) (int, error)
```
Luồng: `ListAttemptsByAgent` → với mỗi attempt `running` → compare-and-set `FinishAttempt(→ cancelled)`. Completion không được đè một attempt đã `cancelled`.

> Hủy attempt chỉ đổi `agent_attempts`; việc chuyển `agent_instances` → `cancelled` thuộc `runs` (chủ sở hữu lifecycle), không làm ở đây.

---

## 7. `app` — use case + config

### 7.1. Use case `CancelRun` (app)

`backend/internal/app/phase6_cancel.go`:

```go
type CancelRunResult struct {
    RunID         uuid.UUID
    TasksCancelled  int
    AgentsCancelled int
    AttemptsCancelled int
    InvsCancelled  int64
    InvsUnknown    int64
}

func (s *Services) CancelRun(ctx context.Context, runID uuid.UUID) (CancelRunResult, error)
```

Luồng (app dàn xếp xuyên module, mỗi module tự chuyển trạng thái của mình):
1. `s.Runs.CancelRun(ctx, runID)` → run + tasks + agents `cancelled`.
2. Với mỗi agent của run (lấy từ kết quả hoặc `ListAgentsByRun` trước đó): `s.Agents.CancelRunningAttempts(ctx, agent.ID)`.
3. `s.cancel.CancelRun(ctx, runID)` → invocation `cancelled`/`unknown` (theo D1).
4. `s.Audit.Record(... "run.cancel" ...)` (allow) — truy vết quyết định hủy.

### 7.2. Use case `Reconcile` (app)

```go
func (s *Services) Reconcile(ctx context.Context) (cancel.ReconcileReport, error)
```
→ `s.cancel.Reconcile(ctx, s.cfg.Execution.ReconcileStaleAfter)`.

### 7.3. Config

`internal/app/config.go` — `ExecutionConfig` thêm:

```go
ReconcileStaleAfter time.Duration `yaml:"reconcile_stale_after"` // default 5m
```

Env `RAP_EXECUTION_RECONCILE_STALE_AFTER`; validate > 0. (Cập nhật `configs/app.example.yaml`, `cleanEnv` trong `config_test.go`.)

### 7.4. Wiring (`wireServices`)

```go
svc.cancel = cancel.NewService(invocation.NewPostgres(dbtx), log) // Store = invocation repo
```
Thêm field `cancel *cancel.Service` (private) hoặc expose `CancelRun`/`Reconcile` qua `Services`.

---

## 8. `cmd/server` — startup reconcile

Sau khi `app.New(...)` thành công, trước khi `Serve`:

```go
if _, err := app.Services().Reconcile(ctx); err != nil {
    log.Warn("startup reconcile failed", "error", err)  // không chặn khởi động
}
```

Không chạy lại trên mỗi request; vòng lặp định kỳ để Phase 8.

---

## 9. Tests

- **Unit `execution/cancel`** (`service_test.go`, fake Store): mapping hai mức D1; reconcile đánh `unknown` stale, bỏ qua optimistic-lock, gom lỗi, idempotent.
- **Unit `execution/invocation`** (`service_test.go` + `repository_test.go` memRepo): `StartInvocation` set `running` + `started_at` + bump version; `ListStaleInvocations`/`CancelInvocationsByRun`/`MarkUnknown` đúng; idempotency hit trả non-terminal đúng nghĩa.
- **Unit `engine/runs`** (`service_test.go`): `CancelRun` idempotent cho run terminal; cascade task/agent non-terminal → cancelled.
- **Unit `engine/agents`** (`service_test.go`): `CancelRunningAttempts` chỉ đổi attempt `running`.
- **Concurrency:** cancel chạy giữa dispatch/create không để invocation mới dispatch sau cancel; attempt completion không được đè `cancelled`; retry cancel hoàn tất cascade partial.
- **Integration (`internal/app`, opt-in `RAP_TEST_DATABASE_URL`)**:
  - `TestPhase6ReconcileStale`: run + invoke `http_probe` succeeded → SQL update invocation về `running` với `started_at` cũ (giả lập crash) → `Services.Reconcile` → assert invocation `unknown`, không thành `succeeded`.
  - `TestPhase6CancelRunCascade`: run+task+agent+attempt+running invocation → `Services.CancelRun` → assert run/task/agent `cancelled`, attempt `cancelled`, invocation `unknown` (vì running) và một invocation `pending` → `cancelled`.
  - `TestPhase6IdempotencyNoRerun`: gọi lại `InvokeCapability` cùng `idempotency_key` khi invocation đang `unknown` → không dispatch mới, trả invocation `unknown` hiện có.
- **Architecture** (`tests/architecture/imports_test.go`): thêm luật `execution/cancel ↛ engine` (chỉ import `execution/invocation`).

---

## 10. CI

- Giữ integration Phase 3/4/5/6 chung một job `raptix_test` + migrate (đã có). Reconcile/cancel không cần Docker.

---

## 11. Verification checklist (acceptance)

```bash
cd backend
gofmt -l internal tests
~/go1.26/bin/staticcheck ./...
~/go1.26/bin/go vet -mod=readonly ./...
~/go1.26/bin/go build -mod=readonly ./...
~/go1.26/bin/go test -race -mod=readonly -count=1 -timeout=300s ./...
~/go1.26/bin/go mod verify
/home/pat/go/bin/sqlc diff

# live
RAP_DATABASE_URL=... go run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up
RAP_TEST_DATABASE_URL=... go test -race -count=1 -run "TestPhase6" ./internal/app/
```

Đối chiếu DB:
- `tool_invocations` có `cancelled` (pending/dispatched) và `unknown` (running) đúng theo D1; không có `succeeded` sai.
- `agent_attempts`/`agent_instances`/`tasks`/`runs` chuyển `cancelled` đầy đủ khi hủy.
- Reconcile sau khi giả lập crash đưa invocation treo về `unknown`, `started_at` được đặt đúng ở bước dispatch.

---

## 12. Gotchas

- **`running` → `unknown`, không phải `cancelled`**: side effect ngoài đã/có thể xảy ra; `unknown` bắt buộc đối soát, không mặc nhiên kết luận.
- **Reconcile phải optimistic-lock safe**: nếu invocation vừa kết thúc trong lúc đối soát, bỏ qua thay vì đè trạng thái.
- **Startup reconcile non-fatal**: log warning, không chặn khởi động (server vẫn phải lên khi DB tạm lỗi).
- **Không đè terminal**: cancel/reconcile chỉ chạm `pending`/`dispatched`/`running`.
- **Idempotency vẫn chặn dispatch trùng** kể cả sau reconcile; `unknown` không được xử lý như `succeeded`.
- **Cascade do app dàn xếp**, mỗi module tự chuyển trạng thái của mình — không join bảng chéo, không import ngược.
- **`started_at` phải được đặt ở bước dispatch** (`StartInvocation`) để stale detection đúng.
- **Mọi transition là state-aware:** version lock không thay thế predicate source state; terminal row không được restart hoặc bị reconcile đè.

---

## 13. Thứ tự commit đề xuất

1. Migration `00013` (index) + `execution/invocation` repository/queries/postgres: `StartInvocation`/`ListStale`/`CancelByRun`/`MarkUnknown` + memRepo + unit tests.
2. `execution/cancel` Service + Store port + unit tests.
3. `execution/invocation` service: chèn `StartInvocation` vào luồng `Invoke`, xử lý idempotency non-terminal; unit tests.
4. `engine/runs` `ListTasksByRun` + `CancelRun`; `engine/agents` `CancelRunningAttempts`; unit tests.
5. `app` config `ReconcileStaleAfter` + use case `CancelRun`/`Reconcile` + wiring `execution/cancel`; `cmd/server` startup reconcile.
6. Integration tests (`TestPhase6*`) + architecture test + docs (`migration_manifest_v1.md` Phase 6, `AGENTS.md`, `README`, `configs/app.example.yaml`).
