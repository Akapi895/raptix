# Raptix agent notes

Read [`CONTRIBUTING_AGENT.md`](CONTRIBUTING_AGENT.md), [`docs/QUALITY_BAR.md`](docs/QUALITY_BAR.md),
and [`docs/agents.md`](docs/agents.md) (agent roster + middleware stack) for
contributor rules: one concern per PR, ≤400 runtime lines / ≤10 files, no
guardrail weakening without an ADR and threat model, and no AI co-author
trailers.

## Current focus: repository restructure

[`raptix-repository-architecture.md`](raptix-repository-architecture.md) (repo
root) is the approved target architecture and migration plan. Working order:

1. Read and understand the current structure first — folder by folder, layer
   by layer, down to the deepest layer. Never move code before you can name
   its owners, callers, and tests.
2. Then read the architecture doc for the work items: waves W0–W11,
   priorities P0–P5. P1/P2 subsystem boundaries precede P3 skill-corpus
   separation and P4 pluginization — do not reorder.

Plan invariants (violating these reopens settled design):

- No big-bang moves. Steps are behavior-preserving, the `raptix` import root
  stays, and compatibility is re-export shims only — never duplicate
  implementations.
- UKC phases are orchestration state (`orchestration/phases/`), never a source
  tree. Never organize agents/skills/tools by phase; skills carry `ukc_phases`
  metadata.
- Dependency direction: `raptix-core` imports no runtime frameworks; SDK and
  plugins touch only SDK + core contracts; apps never import runtime
  internals; middleware holds cross-cutting concerns only (`kg_internal` moves
  to `knowledge/graph`).
- Runtime artifacts (`workspace/`, `run/`, `telemetry/`, `test-results*/`,
  `dist/`, `node_modules/`, `generated/`) are outputs — never
  source-of-truth, never default fixtures.
- Work lands wave by wave; do not create target-layout directories ahead of
  their wave.

## Where changes belong

- Root `pyproject.toml` is an unpublished uv workspace (Python 3.13), not the
  package to edit for runtime features. `packages/raptix-core` owns contracts
  (no LangChain, LangGraph, HTTP or FastAPI imports); `packages/raptix` owns
  agents, middleware, tools and runtime; `packages/raptix-sdk` exposes the
  plugin-author API. Do not import upward from core or reach into framework
  internals from SDK plugins.
- W2 landed the top-level layout: `apps/{cli,web,desktop,launcher,shared}`,
  `infra/{containers,config,telemetry-gateway}`, `benchmarks/` (Python package
  `benchmarks`, run via `-m benchmarks.runner`). Compose files stay at repo
  root (launcher contract) and mount `./infra/{config,containers}`.
- Inside `packages/raptix/raptix/` the flat layout is still canonical until
  W3–W6: `agents/`, `llm/`, `tools/`, `sandbox_{kernel,server,web}/`,
  `backends/`, `mcp_server/`, `server/`, and `middleware/kg_internal/`.
- `langgraph.json` maps graph names to `packages/raptix/raptix/agents/standard/`
  and loads `.env`; in-checkout plugin bundles come from root `[tool.raptix.plugins]`.
- Node workspaces are rooted in `package.json` (`apps/*`, `apps/shared/*`).
  Build `@raptix/streaming` and `@raptix/web-contracts` before CLI
  typecheck/build or web-raptix build; both consume their `dist/`. For
  apps/web edits follow `apps/web/AGENTS.md`; the legacy `clients/web` Next
  app was removed in W2 (history preserved on the pre-restructure branch).

## Run from repo root

- `uv sync --dev --locked`; focused Python test: `uv run pytest
  packages/raptix/tests/path/test_x.py::test_name` or `make test-local ARGS="path::test"`.
- `make ci-lint` then `make ci-test` is the Python PR lane: Ruff + format +
  errors-only basedpyright, then `pytest -n auto -q -m "not slow"`. `make quality`
  also checks CLI and Web; `make quality-strict` includes the 60% coverage gate.
  `make test` runs pytest inside the running LangGraph container instead.
- Skill edits require `make audit-skills-strict` and `make check-skill-graph` in CI;
  the latter bootstraps pinned MITRE STIX and checks the generated `skills.cypher`.
- `make dev` uses base + dev + watch Compose files; plain `docker compose` uses
  base only. `make dogfood` exercises the launcher/onboard/CLI from local images
  and stops prior stacks; `make clean` removes Compose volumes and `.dogfood/`.

## Active initiative: Incalmo-lessons (safe subset)

Follow the work packages in [`docs/incalmo-lessons-implementation-guide.md`](docs/incalmo-lessons-implementation-guide.md).
Only L2a (fail-safe post-tool KG auto-ingest), L2b (parsers for verified coverage gaps),
L6 (investigate structured decoding before implementing), L7-obs (record and surface
tried edges/fail reasons), and L9 (optional per-role structure, current default) are in
scope. L1, L3, L4, L5 gating, and L7 blocking/pruning need explicit sign-off and a T2
before/after benchmark; do not implement them as part of this initiative.

- Do not touch the exploit-execution path (`tools/bash/*`, sandbox dispatch,
  Sliver/msf/impacket) or weaken `SafeCommand`, RoE, `EngagementContext`, egress, HITL,
  `.semgrep` `raptix-no-*` rules, or container hardening.
- Post-tool hooks must bound their work, catch failures, and return the original tool
  result unchanged; hook failure must never block or alter tool execution. KG remains
  the canonical state store. L7 records/surfaces only: no retry blocking or pruning.
- One lesson per ADR and PR. Require deterministic T0 mechanism tests (including hook
  failure behavior) and T1 replay using `runtime/recording.py` `ReplayMiddleware`;
  flag-gate changes to agent input. T2 is not required for the safe subset.
