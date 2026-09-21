# Raptix — Security Platform V1

Backend security-automation platform (agent + skills + tools + evidence + findings + reporting), built as a **Go modular monolith**. This is the `raptix` repo; authoritative docs live in `docs/` (`repository_structure_v1.md`, `migration_roadmap_v1.md`, `migration_manifest_v1.md`).

> Trạng thái: **Phase 2 hoàn tất** — content catalog, tool declaration/registry và LLM adapter đã có contract/test; agent loop và tool execution thật thuộc phase sau. Xem manifest để theo dõi.

## Nhanh

```bash
# 1. DB (PostgreSQL qua Docker)
docker compose -f deploy/compose.yaml up -d --wait postgres

# 2. Migration
(cd backend && go run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up)

# 3. Server
(cd backend && go run ./cmd/server -config ../configs/app.yaml)
#   GET http://localhost:18080/healthz (addr local trong configs/app.yaml)
```

Hoặc dùng helper: `scripts/dev.sh up` rồi `scripts/dev.sh server`. `scripts/check.sh` chạy vet+build+test.

## Cấu trúc (đã triển khai đến Phase 2)

- `backend/` — module Go duy nhất `github.com/Akapi895/raptix/backend`, Go 1.26.
- `backend/cmd/server` — entrypoint HTTP server (sole engine host trong tương lai).
- `backend/cmd/migrate` — goose migration runner (release step, không tự chạy khi server khởi động).
- `backend/internal/app` — composition root + `LoadConfig` (defaults → YAML → `RAP_*` env).
- `backend/internal/api` — HTTP transport tối thiểu (health endpoint).
- `backend/internal/infrastructure/database/postgres` — pgxpool + health + transaction primitive.
- `backend/internal/infrastructure/database/filesystem` — blob store (artifact).
- `backend/migrations` — goose migrations.
- `backend/internal/content` — declarative catalog loader, schema/provenance/reference validation.
- `backend/internal/tools` — tool registry và output contract; chưa dispatch capability.
- `backend/internal/engine/llm` — business LLM contract và Eino OpenAI-compatible adapter.
- `content/` — profile, prompt, tool manifests và skill catalog; xem `content/skills/NOTICE.md` cho attribution.

## Config

Key mặc định trong `internal/app/config.go`; YAML mẫu tại `configs/app.example.yaml` (copy thành `configs/app.yaml`). Env override chỉ cho các field được khai báo trong `applyEnvOverrides` (prefix `RAP_`). `scripts/dev.sh` hiểu `RAP_CONFIG` relative từ repo root và từ chối đường dẫn explicit không tồn tại.

`go test ./...` chạy unit tests; integration transaction chỉ chạy khi set `RAP_TEST_DATABASE_URL` tới database test riêng. CI tạo database test PostgreSQL riêng cho suite đó.

## Yêu cầu

- Go 1.26 (WSL: `~/go1.26/bin`, xem `~/.profile`).
- Docker (tùy chọn, cho DB) — đã có `deploy/compose.yaml`.
- PostgreSQL 17 (qua compose; DSN mặc định `postgres://raptix:raptix@localhost:5432/raptix`).
