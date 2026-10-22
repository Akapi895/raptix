# Raptix agent notes

## Focus: missing platform capabilities

- Goal: clarify what the Autonomous AI Red Team Platform still lacks across planning, execution, evidence, operator workflows and evaluation. Assess the full system; the previous frontend/mock-only focus is superseded.
- Trace each candidate gap through UI → shared contract → API/service → runtime/tool → persisted evidence. Separate **missing**, **partial/unwired**, **implemented but unavailable/config-gated**, and **unverified**; name the owning layer, source paths, user impact and acceptance check. A missing Web endpoint does not prove a missing runtime capability.
- Start Web gap analysis with `apps/web/.scratch/frontend-backend-integration/{spec,coverage,execution}.md` and relevant ticket/follow-up evidence. Recheck current routes/services and `apps/web/src/router/registry.tsx`: the original local-only membership inventory predates multi-user implementation, and route counts have changed.
- For runtime/tool gaps, use [the implementation plan](docs/tool-optimization-implementation-plan.md) and its per-wave completion notes: the overview still calls T3–T13 proposed despite completed waves. [The exploitation diagnosis](docs/exploitation-effectiveness-diagnosis-2026-10-15.md) supplies run-specific leads, not a current platform-wide verdict.
- Verify runtime wiring and outcomes separately. `/api/capabilities` distinguishes support from availability; readiness is not a model/tool execution smoke. An agent prompt, skill, registered graph or successful dispatch is not proof of a working capability or a benchmark win. Use provider evaluation and [published benchmark evidence](benchmarks/README.md), recording configuration and unexecuted checks.

## Contribution contract

- Follow [CONTRIBUTING_AGENT.md](CONTRIBUTING_AGENT.md) and [QUALITY_BAR](docs/QUALITY_BAR.md): one concern, ≤400 runtime lines / ≤10 files per PR, no AI co-author trailers. New public APIs/subsystem boundaries require a Proposed ADR in `docs/adr/`.
- Resolve prose conflicts using manifests, `langgraph.json`, `Makefile` recipes and [.github/workflows/ci.yml](.github/workflows/ci.yml). `CLAUDE.md` and architecture docs retain obsolete paths/statuses.
- Before ownership/import changes, read [runtime boundaries](docs/architecture/runtime-boundaries.md) and [dependency rules](docs/architecture/dependency-rules.md). For Web changes, follow [apps/web/AGENTS.md](apps/web/AGENTS.md) and the integration execution contract, including targeted-only local testing.

## Boundaries and runtime wiring

- Root `pyproject.toml` is a virtual uv workspace; runtime dependencies belong in the owning package. `raptix-core` is framework-free contracts (stdlib/Pydantic/settings/typing-extensions); SDK/plugins import Core/SDK, not runtime internals. Plugins own domain definitions/prompts/offline analyzers; `raptix_sdk.create_domain_agent` bridges to runtime via `raptix.agent_composers`.
- Skill corpus: `packages/raptix-skills/raptix_skills/defs/` (Markdown/YAML only). Loader/selector/graph engine: `packages/raptix/raptix/skills/`. A corpus entry does not establish that its binaries are installed in the sandbox image.
- Apps communicate through APIs. Web flow: `apps/web/src/` → `apps/shared/web-contracts/` → `apps/web/server/src/main.ts` → `src/app.ts:buildApp` → Python runtime HTTP API. The Fastify server owns Prisma schema/migrations. `clients/` and Next.js are retired; `infra/config/` provider handlers intentionally have no `raptix` dependency.

Runtime paths below are relative to `packages/raptix/raptix/`:

- `langgraph.json` loads `.env`, graphs and the HTTP app/checkpointer in `interfaces/api/`. `raptix` and alias `decepticon` share `intelligence/agents/standard/raptix.py:graph`; the orchestrator discovers `raptix.subagents` and delegates via `task`. Soundwave is a standalone planner.
- Plugin activation is CWD-sensitive: `RAPTIX_PLUGINS` → `.raptix.toml` → `[tool.raptix.plugins]` → `standard`; this checkout enables `standard,plugins`.
- Assembly: `intelligence/agents/{build,middleware_slots}.py` follows Core's `MiddlewareSlot` enum order and `SLOTS_PER_ROLE`. Inventory the assembled role/profile: middleware and nested factories contribute tools, so `_STANDARD_TOOLS` or `^@tool` scans undercount.
- `capabilities/` resolves WHAT; `execution/{adapters,workers}/` executes HOW; `knowledge/ingest/` alone normalizes output. `specialist_contracts/` is separate evidence/scorecard machinery. Engagement/OPPLAN state belongs in `orchestration/mission/`, recording/replay in `execution/session/`; UKC phases are runtime state, not a directory taxonomy.
- Import contracts from `raptix_core.*`; legacy contract/API shims are removed. `raptix.core` still holds real dispatch/streaming code. `middleware/{opplan,engagement}.py` are live redirects; edit canonical implementations in `orchestration/mission/`.
- `execution/backends/factory.py` is HTTP-only. Pass explicit run config for subagent filesystem/bash calls to reach the per-engagement sandbox; ambient config is insufficient. `/workspace/` is sandbox-backed; `/skills/` is in-process corpus data accessed via `load_skill`.

## Web mode and data authority

- Root `npm run dev` serves the UI at `127.0.0.1:5273`; standalone mock mode needs no backend/DB/Docker. `apps/web/src/state/mode.ts` resolves `?dataMode=` > localStorage `raptix.dataMode` > `VITE_DATA_MODE` > `mock`; switching reloads providers/caches. Explicitly select real mode when assessing integration.
- Mock authority is `apps/web/src/demo/` (`authority.ts`, `services.ts`); real transport is `apps/web/src/platform/` plus each feature's `remote.ts`. Real mode must never fall back to demo data (ADR-0068, ADR-0096). Runtime checkpoints own thread/run state; Prisma owns Web business records/ownership; workspace artifacts and Neo4j retain evidence/knowledge authority.
- Database-backed services require `DATABASE_URL` and `WORKSPACE_PATH`. Node startup neither generates Prisma clients nor migrates; API container startup runs `prisma migrate deploy`.

## Setup and focused checks

- Run from repo root unless specified. Make recipes need a POSIX shell; on Windows use a compatible shell or the underlying commands. Python 3.13: `uv sync --dev --locked` (`--extra neo4j` for live KG). Node: root `npm ci`, npm/root lockfile only (CI Node 24; Web ≥22.12). Go version: `apps/launcher/go.mod`.
- Focused Python: `uv run pytest path/to/test.py::test_name`; package: `uv run pytest packages/raptix-core/tests`. Default collection **excludes root `tests/` and skills tests**; select affected structural/skills tests explicitly. Compose edits require `uv run pytest tests/test_compose_network_isolation.py`.
- Python PR lane: `make ci-lint` → `make ci-test` (Ruff check/format, errors-only basedpyright, then `pytest -n auto -q -m "not slow"`). `make lint` checks all typecheck levels; `make quality-strict` includes slow tests and 60% coverage.
- Shared ESM packages export `dist/`: `npm run build --workspace=@raptix/streaming` first; Web also needs `npm run build --workspace=@raptix/web-contracts`, then `npm run prisma:generate --workspace=@raptix/web-raptix-server` (no DB needed) before server typecheck/lint/build/tests. `make quality` omits skill audit/graph gates and Web Prisma generation/server lint/build; consult CI for the full lane.
- Focused JS tests: `npm run test --workspace=@raptix/web-raptix -- src/real/markdown.test.tsx`; substitute the owning workspace/file for server or CLI. CLI `dev` only watches TypeScript; after building, run `node apps/cli/dist/index.js` in a foreground TTY.
- Launcher: in `apps/launcher`, `go vet ./...` then `go test ./...`. Desktop: `npm run desktop:test`. Skill edits: `make audit-skills-strict` → `make build-skill-graph` → `make check-skill-graph`; commit regenerated `packages/raptix/raptix/skills/.graph/skills.cypher` (graph targets fetch pinned MITRE STIX).
- Benchmarks: [benchmarks/README.md](benchmarks/README.md), entry `uv run python -m benchmarks.runner`; live runner needs Docker, reachable LangGraph and provider targets. Generated attempts go in `benchmarks/results/runs/<suite>/<run-id>/`, selected evidence in `results/published/<suite>/` under `benchmarks/`.

## Tool and safety constraints

- Before capability changes, read frozen invariants in `packages/raptix-core/raptix_core/types/capability.py`; verify with `uv run pytest -q packages/raptix/tests/unit/capabilities`. Core public API changes update `packages/raptix-core/tests/test_public_api_stability.py` and `CHANGELOG.md`.
- Availability, eligibility and invocation authorization are separate. Bash never implicitly satisfies a capability or resolver fallback. Exposure rollout is UX, not authorization; preserve shadow/rollback/recovery tools and importable functions when retiring exposure.
- Check configured enforcement, not feature names: RoE without `machine_enforcement` is audit-only; HITL assembly is opt-in via `RAPTIX_HITL__ENABLED`. Weakening `SafeCommand`, RoE/egress, `EngagementContext`, HITL, OPSEC skills, Semgrep or container hardening requires an ADR/threat model. Safety-critical replacements/disables require `RAPTIX_ALLOW_SAFETY_OVERRIDES=1`.
- Post-tool hooks bound work, catch failures and return the original result unchanged; KG remains canonical. For concurrency/planning changes covered by [Incalmo](docs/incalmo-lessons-implementation-guide.md), read its scoped/deferred lessons and benchmark gates before changing blocking/pruning behavior.
- Telemetry/eval excludes raw parameter values/secrets. Never tune against capability `held-out.jsonl` fixtures; pinned baselines live in `benchmarks/suites/tool_eval/baseline/`.

## Operational gotchas

- `make dev` combines base + dev + watch Compose files; plain `docker compose` uses base only. Compose files stay at root for the launcher. `make dogfood` exercises launcher/onboard/CLI from local images; `make smoke` purges volumes before rebuilding; `make clean` deletes volumes and `.dogfood/`.
- Runtime state goes under `RAPTIX_HOME` (default `~/.raptix`); local experiments under `tests/local/artifacts/`. Keep generated `dist/`, Prisma clients and run outputs out of source fixtures.
