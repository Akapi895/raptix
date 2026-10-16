# Raptix agent notes

## Read first

- Follow [CONTRIBUTING_AGENT.md](CONTRIBUTING_AGENT.md) and [QUALITY_BAR](docs/QUALITY_BAR.md): one concern per PR, ≤400 runtime lines / ≤10 files, no AI co-author trailers. New public API or subsystem boundaries need a Proposed ADR in `docs/adr/`.
- Use manifests, `langgraph.json`, `Makefile`, and [.github/workflows/ci.yml](.github/workflows/ci.yml) to resolve conflicts with prose. `README.md`, `CLAUDE.md`, and architecture docs still contain obsolete paths or wiring.
- For ownership/import changes, read [runtime boundaries](docs/architecture/runtime-boundaries.md) and [dependency rules](docs/architecture/dependency-rules.md). For browser or Web API work, follow [apps/web/AGENTS.md](apps/web/AGENTS.md).

## Current focus: web console frontend, mock mode first

- Active work-stream: optimize the web console frontend flow in `apps/web`, validated against mock data before wiring real APIs. Keep changes frontend-scoped; backend/Prisma/Python runtime changes are out of scope unless the covering ticket requires them.
- Data-mode seam: `src/real/mode.ts` — precedence is `?dataMode=` query > localStorage `raptix.dataMode` > `VITE_DATA_MODE` build default > `mock`; switching modes reloads the app so providers/caches are disposed. Mock authority: `src/domain/service-factory.ts` (+ `src/data.ts` seed). Real-mode transport lives in `src/real/` and must never fall back to demo data.
- Trackers under `apps/web/.scratch/`: `frontend-backend-integration/` (mock→real integration, active ticket graph) and `web-improve-refactor/` (production refactor spec). Read the relevant `spec.md`/`execution.md` before changing a flow they cover.
- Quick loop: root `npm run dev` serves the console at `127.0.0.1:5273` in standalone mock mode — no backend, database or Docker needed. Gates and conventions: [apps/web/AGENTS.md](apps/web/AGENTS.md).

## Boundaries and runtime wiring

- Root `pyproject.toml` is a virtual uv workspace with shared tooling, not a distributable package. Add runtime dependencies to the owning package. `raptix-core` is contracts-only (stdlib, Pydantic/settings, typing-extensions); SDK/plugins import Core/SDK, never runtime internals. Plugins own domain definitions/prompts/offline analyzers; runtime owns framework execution. `raptix_sdk.create_domain_agent` bridges via `raptix.agent_composers`.
- Skill corpus: `packages/raptix-skills/raptix_skills/defs/` (Markdown/YAML, no runtime logic). Skill loader/selector/graph engine: `packages/raptix/raptix/skills/`.
- Apps communicate through APIs: Ink CLI, Go launcher, Electron desktop, React/Vite Web UI and independent Fastify/Prisma server under `apps/`. Shared ESM packages are under `apps/shared/`; `clients/` and the Next.js app are retired. `infra/config/` provider handlers intentionally have no `raptix` dependency.

Runtime paths below are relative to `packages/raptix/raptix/`:

- `langgraph.json` loads `.env`, the HTTP app/checkpointer in `interfaces/api/`, and graph entrypoints. Both `raptix` and alias `decepticon` load `intelligence/agents/standard/raptix.py:graph`. Raptix discovers `raptix.subagents` and delegates via `task`; Soundwave is a standalone planner.
- Bundle activation is CWD-sensitive: `RAPTIX_PLUGINS` → `.raptix.toml` → `[tool.raptix.plugins]` → `standard`. This checkout enables `standard,plugins` at the root.
- Agent assembly is `intelligence/agents/build.py`; `raptix_core.contracts.slots.MiddlewareSlot` declaration order is assembly order, `SLOTS_PER_ROLE` selects slots, `intelligence/agents/middleware_slots.py` supplies factories. Tools also come from middleware/nested factories; `_STANDARD_TOOLS` or `^@tool` alone is an incomplete inventory.
- `capabilities/` resolves WHAT; `execution/{adapters,workers}/` executes HOW; `knowledge/ingest/` alone normalizes output. `specialist_contracts/` is a separate evidence/scorecard subsystem. Session recording/replay lives in `execution/session/`; engagement/OPPLAN state in `orchestration/mission/`. UKC phases are runtime state, not an agents/tools/skills directory taxonomy.
- Use `raptix_core.*` and `raptix.interfaces.{api,mcp}`; legacy contract/API shims are removed. `raptix.core` still contains real dispatch/streaming code. `middleware/{opplan,engagement}.py` remain live redirects: edit their canonical implementations in `orchestration/mission/`.
- `execution/backends/factory.py` is HTTP-only. Pass explicit run config for subagent filesystem/bash calls to share the per-engagement sandbox; ambient config is insufficient. `/workspace/` is sandbox-backed; `/skills/` is in-process corpus data accessed through `load_skill`.

## Setup and focused checks

- Run from repo root unless specified. Make recipes require a POSIX shell; on Windows use a compatible shell or the underlying `uv`/`npm` commands.
- Python 3.13: `uv sync --dev --locked`; add `--extra neo4j` for live KG tools. Node: root `npm ci` and `package-lock.json`, npm only (CI uses Node 24; Web requires ≥22.12). Launcher toolchain comes from `apps/launcher/go.mod`.
- Python test selector: `uv run pytest path/to/test.py::test_name`; package: `uv run pytest packages/raptix-core/tests`. Default collection covers Core/runtime/SDK/plugins, **not** root `tests/` or skills tests. For structural changes use `uv run pytest tests -m "not slow and not manual"` and relevant `packages/raptix-skills/tests`; Compose edits require `uv run pytest tests/test_compose_network_isolation.py`.
- Python PR checks: `make ci-lint` → `make ci-test` (Ruff check/format, errors-only basedpyright, then `pytest -n auto -q -m "not slow"`). `make lint` checks all basedpyright levels. `make quality-strict` includes slow tests and the 60% coverage gate.
- CLI: `npm run build --workspace=@raptix/streaming` → `npm run typecheck --workspace=@raptix/cli` → CLI build/test (`make quality-cli`). Shared packages export `dist/`, so build them first. Focused test: `npm run test --workspace=@raptix/cli -- src/path.test.ts`. CLI `dev` only watches TypeScript; run `node apps/cli/dist/index.js` separately in a foreground TTY.
- Web: build `@raptix/streaming` then `@raptix/web-contracts`; run `npm run prisma:generate --workspace=@raptix/web-raptix-server` (no DB needed), then server typecheck/lint/build/test. UI/E2E gates are in `apps/web/AGENTS.md`. `make quality` adds CLI/Web but omits skill audit/graph gates; its Web target also omits Prisma generation and server lint/build. CI is the complete lane.
- Launcher: from `apps/launcher`, run `go vet ./...` then `go test ./...`. Desktop: `npm run desktop:test`.
- Skill edits: `make audit-skills-strict` → `make build-skill-graph` → `make check-skill-graph`; commit regenerated `packages/raptix/raptix/skills/.graph/skills.cypher`. Graph targets bootstrap pinned MITRE STIX data.

## Tool and safety constraints

- For tool/capability changes, read [the implementation plan](docs/tool-optimization-implementation-plan.md) and frozen invariants in `packages/raptix-core/raptix_core/types/capability.py`. The plan's overview status is stale; check per-wave completion notes. Verify with `uv run pytest -q packages/raptix/tests/unit/capabilities`. Core public API changes update `packages/raptix-core/tests/test_public_api_stability.py` manifest/count and `CHANGELOG.md`.
- Retiring exposure removes decorators/list membership, preserving importable functions. Bash is never implicit capability availability or resolver fallback. Availability, eligibility and invocation authorization are distinct. `intelligence/tooling/exposure.py` defaults off; active needs a rollout stage. Preserve shadow/rollback/recovery tools; `phase_affinity` ranks softly, `allowed_phases` constrains eligibility.
- Tool telemetry/eval excludes raw parameter values/secrets. Never tune against `packages/raptix*/tests/fixtures/capabilities/held-out.jsonl`; pinned baselines are in `benchmarks/suites/tool_eval/baseline/`.
- Weakening `SafeCommand`, RoE/egress, `EngagementContext`, HITL, OPSEC skills, `raptix-no-*` Semgrep rules or container hardening requires an ADR/threat model. Safety-critical replacements/disables require `RAPTIX_ALLOW_SAFETY_OVERRIDES=1`; consult actual `SAFETY_CRITICAL_SLOTS`/`SAFETY_CRITICAL_TOOLS` sets.
- Post-tool hooks bound work, catch failures and return the original result unchanged; failure must not block execution. KG remains canonical. For [Incalmo work](docs/incalmo-lessons-implementation-guide.md), only L2a/L2b/L6/L7-obs/L9 are scoped (L6 investigate-first, L9 defer-by-default); blocking/pruning L1/L3/L4/L5/L7 needs sign-off and before/after benchmarks. T0/T1/T2 are benchmark tiers; flag-gate agent-input changes and verify failures/replay.

## Stack and data gotchas

- `make dev` combines base + dev + watch Compose files; plain `docker compose` uses base only. Compose files stay at root for the launcher. `make dogfood` exercises launcher/onboard/CLI from local images; `make smoke` purges volumes before rebuilding; `make clean` deletes volumes and `.dogfood/`.
- Web server wiring: `apps/web/server/src/main.ts` → `src/app.ts:buildApp`. That server owns Prisma schema/migrations. DB services require explicit `DATABASE_URL` and `WORKSPACE_PATH`; Node startup neither generates nor migrates. API container startup runs `prisma migrate deploy`.
- Runtime state goes under `RAPTIX_HOME` (default `~/.raptix`); local experiments under `tests/local/artifacts/`. [Benchmarks](benchmarks/README.md) use `uv run python -m benchmarks.runner`, implementation in `engine/`/`suites/`, outputs in `benchmarks/results/runs/<suite>/<run-id>/`, selected evidence in `benchmarks/results/published/<suite>/`. Keep generated `dist/`, Prisma clients and test results out of source fixtures.
