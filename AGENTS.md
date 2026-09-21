# Raptix agent guidance

## Current state and sources of truth

- This is the `raptix` Git repository, separate from the parent `redteam` workspace. **Phase 1 is done**: config loading, PostgreSQL pgxpool adapter, filesystem blob adapter, `internal/app` composition root, `internal/api` health endpoint, `cmd/server` + `cmd/migrate`, Makefile, CI workflow, and `deploy/compose.yaml`. The large directory tree in the docs is a target layout; packages exist only where there is real implementation.
- Read `docs/repository_structure_v1.md` for the locked architecture and ownership, `docs/migration_roadmap_v1.md` for phase order, and `docs/migration_manifest_v1.md` for pinned reference commits and progress. References to `security-platform/` or `docs/repository_structure.md` in prose are legacy names; use the local `_v1` docs.
- Migration sources are `../frameworks/strix` and `../frameworks/CyberStrikeAI`; use the manifest's pinned revisions. Port behavior into the Go design rather than copying source layout or hosting a Python engine. Update the manifest as phases advance.
- Only create packages with real implementation. Not implemented yet: CLI entrypoint, River jobs, sqlc configuration, `containers/sandbox`, frontend build. Do not assume commands shown in the target layout exist.

## Commands and current gotchas

- The sole Go module is `backend/` (`github.com/Akapi895/raptix/backend`), requiring Go **1.26.0**. Run Go commands there, not at the repository root; do not introduce per-feature modules, `go.work`, or `pkg/`.
- Package checks: `go test -mod=readonly ./...`; `scripts/check.sh` runs vet+build+test. PostgreSQL transaction tests are opt-in: set `RAP_TEST_DATABASE_URL` to a dedicated test database; CI supplies `raptix_test`.
- Go in WSL: apt has `go1.22.2` at `/usr/bin/go`; the user-local Go 1.26 (`~/go1.26/bin/go`, wired via `~/.profile`) takes precedence so plain `go` resolves to 1.26. If `go version` reports 1.22, the shell didn't source `~/.profile` — call `~/go1.26/bin/go` explicitly or `bash -lc`.
- Run the server/migrate from `backend/`: `go run ./cmd/server -config ../configs/app.yaml` and `go run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up`. The config path is passed as a flag; hardcoded defaults are in `internal/app/config.go`.
- The default server addr `:8080` is already taken by another process in this WSL. For local runs use `RAP_SERVER_ADDR=:18080` (env override is supported; see `applyEnvOverrides`). It is safe to hardcode a different port in `configs/app.yaml` for development.
- PostgreSQL is NOT installed in WSL — it runs in Docker via `deploy/compose.yaml` (service `postgres`, image `postgres:17-alpine`, DSN default `postgres://raptix:raptix@localhost:5432/raptix?sslmode=disable`). Start it with `docker compose -f deploy/compose.yaml up -d postgres`.
- `internal/app/config.go` loads defaults → optional YAML → explicitly supported `RAP_*` overrides. A missing YAML file is silently accepted; `.env` is not loaded. `scripts/dev.sh` treats a relative `RAP_CONFIG` as repo-root-relative and rejects an explicit missing path. See `configs/app.example.yaml` and the override function rather than assuming every field has an env override.
- Default content/artifact paths are relative (`./content`, `./data/artifacts`); the loader does not resolve them against the config file or repo root. Set `RAP_CONTENT_ROOT`/`RAP_ARTIFACT_ROOT` explicitly when running from another directory.
- PostgreSQL `Open` creates a lazy pool; use `Ping`/`Health` to establish readiness. `TxFunc` passes `pgx.Tx` to its callback; callback queries must use that tx to participate in the transaction. The filesystem `Store` writes atomically via staging + rename inside `os.Root`, preventing path/symlink escape; a blocking input reader still needs its own cancellation contract.
- Always run WSL commands via `wsl.exe -d Ubuntu bash -lc "..."` and keep everything (Go, psql, git) inside WSL; Windows PowerShell is used only to invoke them.

## Architecture constraints for implementation

Package paths below are relative to `backend/internal/`, entrypoints to `backend/`; these are target boundaries, not claims of completed features.

- `app` wires services and adapters. `cmd/server` alone hosts agent execution, HTTP/SSE, and jobs; CLI and web are clients of the same server/run. Migrations run separately via `cmd/migrate`, never automatically on server startup.
- `engine/orchestrator` plans and assigns; `engine/agents` owns the agent loop/attempt and conversation/content snapshots; `engine/runs` alone owns durable run/task/agent lifecycle transitions. Eino stays behind `engine/llm/adapters/eino` for model calls/streaming, not a second orchestration runtime.
- `tools` owns capability implementations and output contracts; all invocations, including active verification, go through `execution`. `platform/governance` decides grants; execution checks current scope/grants/budget/cancellation at dispatch. Profiles, skills, and installed manifests do not grant execution rights.
- `workspace/evidence` owns artifact provenance; `workspace/verifier` returns verdicts, while `workspace/findings` alone changes finding status. Memory, evidence, coverage, and findings remain separate. Reporting renders an immutable snapshot, not live data.
- Modules own their repositories, tables, SQL, and per-module sqlc output. Cross-module access uses service contracts; handlers do not query tables. Shared `infrastructure` supplies adapters, not a central business repository. Keep one ordered goose migration sequence in `backend/migrations/`.
- `content/` holds declarative catalogs, not executable extensions. Loading a manifest must not run shell or load code; implementations are registered explicitly through application wiring.
