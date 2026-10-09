# Raptix agent notes

## Read first

- Follow [CONTRIBUTING_AGENT.md](CONTRIBUTING_AGENT.md) and [docs/QUALITY_BAR.md](docs/QUALITY_BAR.md): one concern per PR, ≤400 runtime lines / ≤10 files, no AI co-author trailers; new public API or subsystem boundary needs a Proposed ADR in `docs/adr/`.
- Trust manifests, `langgraph.json`, `Makefile`, and `.github/workflows/ci.yml` over prose. `CLAUDE.md` and some architecture docs retain pre-restructure paths and the retired Next.js app.
- For subsystem ownership, read [runtime boundaries](docs/architecture/runtime-boundaries.md) and [dependency rules](docs/architecture/dependency-rules.md). For Web work, also follow [apps/web/AGENTS.md](apps/web/AGENTS.md).

## System map and dependency boundaries

- Python 3.13 uv workspace: root `pyproject.toml` builds no wheel; it owns shared tooling config. Add runtime dependencies to the owning package's manifest.
- `packages/raptix-core/raptix_core/` owns contracts, protocols and registries; imports only stdlib, Pydantic, pydantic-settings and typing-extensions. No LangChain/LangGraph/HTTP/runtime imports.
- `packages/raptix/raptix/` owns runtime behavior. SDK and `plugins/` must not import runtime internals: domain definitions/prompts/offline analyzers belong in plugins, framework-bound execution in runtime. `raptix_sdk.create_domain_agent` bridges through the `raptix.agent_composers` entry point.
- `packages/raptix-skills/raptix_skills/defs/` is the Markdown/YAML corpus; `packages/raptix/raptix/skills/` is the loader/selector/graph engine. Do not put runtime logic in the corpus.
- Apps use runtime APIs, not Python internals: `apps/cli` = Ink terminal client; `apps/launcher` = Go setup/Compose command; `apps/desktop` = Electron; `apps/web` = React/Vite UI; `apps/web/server` = independent Fastify/Prisma API; `apps/shared` = shared ESM contracts.
- `infra/containers` owns images; `infra/config` contains mounted LLM-provider handlers intentionally independent of `raptix`. Compose files stay at root for the launcher. Benchmark entrypoint is `benchmarks.runner`, not `benchmark.runner`; old `clients/` paths are not npm workspaces.
- UKC phases are runtime state in `orchestration/phases/`, never a directory taxonomy for agents/tools/skills. `orchestration/mission/` owns engagement lifecycle and OPPLAN; `middleware/` contains cross-cutting adapters, not subsystem state.
- The Phase 1 `raptix.core.*` / `raptix.plugin_loader` / `raptix.llm.models` / `raptix.execution.tools.research.graph` compat shims, `server/`, and `mcp_server/` are gone — import `raptix_core.*` / `raptix.interfaces.api` / `raptix.interfaces.mcp` directly, do not re-add a shim. `middleware/opplan.py` and `middleware/engagement.py` remain live re-export targets (mission middleware re-exports) — edit the canonical implementation under `orchestration/mission/`.

## Trace the runtime before editing

Paths below are relative to `packages/raptix/raptix/` unless stated otherwise.

- `langgraph.json` loads `.env`, registers graphs, and attaches `interfaces/api/plugins_api.py:app` plus the SQLite checkpointer. `raptix` and alias `decepticon` both load `intelligence/agents/standard/raptix.py:graph`; do not restore `decepticon.py`.
- `create_raptix_agent` discovers streaming subagents via `raptix.subagents` entry points and delegates through `task`; Soundwave is a separate planner. Bundle activation is CWD-sensitive: `RAPTIX_PLUGINS` → `.raptix.toml` → `[tool.raptix.plugins]` → default `standard`.
- `intelligence/agents/build.py` assembles plugins/tools/middleware. `raptix_core.contracts.slots.MiddlewareSlot` declaration order is assembly order; `SLOTS_PER_ROLE` selects slots; `intelligence/agents/middleware_slots.py` supplies factories. Middleware also supplies tools: `_STANDARD_TOOLS` or `^@tool` alone misses registrations in `knowledge/graph/tools.py`, `middleware/{skillogy,dispatch}.py`, and nested OPPLAN/skill factories.
- Capability catalog/evaluators: `capabilities/` (promoted out of `execution/` — it is the WHAT-resolution layer, a sibling of `execution/`, not a subsystem of it); adapters: `execution/adapters/`; bounded workers: `execution/workers/`; parsers: `knowledge/ingest/`. Adapters construct execution specs; parsers alone own normalization. Plugin/specialist contracts + evidence + scorecards live at `specialist_contracts/` (distinct from `capabilities/` — do not confuse the two). Event log/recording/replay/shutdown/task-spec bookkeeping lives at `execution/session/` (formerly top-level `runtime/`).
- `execution/backends/factory.py` uses HTTP, not Docker exec. Pass explicit run config so subagent filesystem/bash calls share the per-engagement sandbox. `/workspace/` is sandbox-backed; `/skills/` is in-process corpus data (use `load_skill`, not sandbox `cat`). Binary/profile inventory: `infra/containers/sandbox.Dockerfile`.
- Web wiring: `apps/web/server/src/main.ts` → `src/app.ts:buildApp`; schema/migrations belong to that server. DB-backed services require explicit `DATABASE_URL` and `WORKSPACE_PATH`. Node does not auto-generate/migrate; container startup deploys migrations.

## Verification commands

Run from repo root unless a working directory is specified. Make recipes use POSIX shell utilities; use a compatible shell for Make on Windows, or run the underlying `uv`/`npm` commands directly.

- Setup: `uv sync --dev --locked`; add `--extra neo4j` for live KG tools. Node uses root `package-lock.json` and `npm ci` (CI uses Node 24; Web requires ≥22.12), not pnpm. Go toolchain is pinned by `apps/launcher/go.mod`.
- Focused Python: `uv run pytest packages/raptix/tests/path/test_x.py::test_name`; single package: `uv run pytest packages/raptix-core/tests`. `make test-local ARGS="path::test"` forwards pytest arguments.
- Default pytest collection covers core/runtime/SDK and `plugins`, **not** root `tests/` or `packages/raptix-skills/tests`. Pass those paths explicitly for structural changes; Compose changes require `uv run pytest tests/test_compose_network_isolation.py`. Capability lane: `uv run pytest -q packages/raptix/tests/unit/capabilities`.
- Python PR lane: `make ci-lint` → `make ci-test` (Ruff check → format check → errors-only basedpyright; pytest `-n auto -q -m "not slow"`). `make lint` uses full basedpyright. `make quality` adds CLI/Web; `make quality-strict` includes slow tests and 60% coverage.
- CLI: build `npm run build --workspace=@raptix/streaming` before CLI typecheck/build/test; `make quality-cli` runs that chain. `npm run dev --workspace=@raptix/cli` only watches TypeScript; launch `node apps/cli/dist/index.js` separately in a foreground TTY.
- Web: `npm run build --workspace=@raptix/streaming` → `npm run build --workspace=@raptix/web-contracts` → `npm run prisma:generate --workspace=@raptix/web-raptix-server` (no DB needed) → server typecheck/lint/build/test. `make webraptix-quality` omits Prisma generation and server lint/build; CI is the complete lane. UI/E2E gates: `apps/web/AGENTS.md`.
- Focused Node test: `npm run test --workspace=@raptix/cli -- path/to/test.ts`; launcher checks run in `apps/launcher`: `go vet ./...`, then `go test ./...`.
- Skill edits: `make audit-skills-strict`, `make build-skill-graph`, then `make check-skill-graph`; commit the regenerated `packages/raptix/raptix/skills/.graph/skills.cypher`. Graph targets bootstrap pinned MITRE STIX data.
- `make dev` explicitly combines base + dev + watch Compose files; plain `docker compose` uses base only. `make dogfood` exercises launcher/onboard/CLI from local images. `make smoke` purges Compose volumes before rebuilding; `make clean` deletes volumes and `.dogfood/`.

## Tool/capability constraints

- For tool work read [the implementation plan](docs/tool-optimization-implementation-plan.md), not the raw transcript. Its T2 GO overview is stale; T3–T13 sections record completion. Check code/per-wave notes before implementing purportedly pending work.
- Read the frozen invariants in `packages/raptix-core/raptix_core/types/capability.py` before contract changes: required provenance/step budget, unrestricted empty roles, opaque artifact refs, backend-independent requirements, unresolved workers unavailable. Public API changes must update `packages/raptix-core/tests/test_public_api_stability.py` manifest/count and CHANGELOG.
- Retiring agent exposure removes decorators/list membership, not importable functions. Bash alone never establishes capability availability and is never an implicit resolver fallback. Availability, eligibility and invocation authorization remain distinct.
- `intelligence/tooling/exposure.py` defaults to `off`; active mode also needs a rollout stage. Exposure is UX, not authorization. Preserve shadow/rollback and recovery tools; `phase_affinity` ranks softly, `allowed_phases` constrains eligibility.
- Tool telemetry/eval must not record raw parameter values or secrets. Never tune schemas against `packages/raptix*/tests/fixtures/capabilities/held-out.jsonl`; pinned surface baselines live in `benchmarks/suites/tool_eval/baseline/`.

## Guardrails and scoped initiatives

- Never weaken `SafeCommand`, RoE/egress, `EngagementContext`, HITL, OPSEC skills, `raptix-no-*` Semgrep rules or container hardening without an ADR and threat model. Safety-critical replacements/disables require `RAPTIX_ALLOW_SAFETY_OVERRIDES=1`; use the actual `SAFETY_CRITICAL_SLOTS`/`SAFETY_CRITICAL_TOOLS` sets rather than a copied list.
- Post-tool hooks must bound work, catch failures and return the original result unchanged; failures must not block execution. KG remains canonical state. Runtime data belongs under `RAPTIX_HOME` (default `~/.raptix`; local checkout may use ignored `.raptix/`); local experiments under `tests/local/artifacts/`; benchmark runs under `benchmarks/results/runs/<suite>/<run-id>/`, selected evidence under `results/published/`. Benchmark implementation is in `engine/` and `suites/`; `benchmarks.runner` stays the shared CLI. Do not create root `workspace/`, `run/` or `telemetry/`. `dist/`, `generated/`, `test-results*/` are outputs, not source/default fixtures.
- [Incalmo guide](docs/incalmo-lessons-implementation-guide.md): only L2a/L2b/L6/L7-obs/L9 are scoped (L6 investigate-first, L9 defer-by-default). L1/L3/L4/L5/L7 blocking/pruning need sign-off and before/after benchmarks. T0/T1/T2 here are benchmark tiers; flag-gate agent-input changes and verify hook failures/replay.
