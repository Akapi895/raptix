# Raptix agent notes

Read [`CLAUDE.md`](CLAUDE.md), [`CONTRIBUTING_AGENT.md`](CONTRIBUTING_AGENT.md), and
[`docs/QUALITY_BAR.md`](docs/QUALITY_BAR.md) for contributor rules: one concern per PR,
≤400 runtime lines / ≤10 files, no guardrail weakening without an ADR and threat model,
and no AI co-author trailers. The Incalmo section below applies only to that initiative.

## Where changes belong

- Root `pyproject.toml` is an unpublished uv workspace (Python 3.13), not the package to
  edit for runtime features. `packages/raptix-core` owns contracts (no LangChain,
  LangGraph, HTTP or FastAPI imports); `packages/raptix` owns agents, middleware,
  tools and runtime; `packages/raptix-sdk` exposes the plugin-author API. Do not
  import upward from core or reach into framework internals from SDK plugins.
- `langgraph.json` maps graph names to `packages/raptix/raptix/agents/standard/`
  and loads `.env`; in-checkout plugin bundles come from root `[tool.decepticon.plugins]`.
- Node workspaces are rooted in `package.json` (`clients/*`, `clients/shared/*`). Build
  `@raptix/streaming` before CLI typecheck/build or Web build; both consume its `dist/`.
  For Web edits also follow `clients/web/AGENTS.md` (Next's installed docs matter).

## Run from repo root

- `uv sync --dev --locked`; focused Python test: `uv run pytest
  packages/raptix/tests/path/test_x.py::test_name` or `make test-local ARGS="path::test"`.
- `make ci-lint` then `make ci-test` is the Python PR lane: Ruff + format +
  errors-only basedpyright, then `pytest -n auto -q -m "not slow"`. `make quality`
  also checks CLI and Web; `make quality-strict` includes the 60% coverage gate.
  `make test` runs pytest inside the running LangGraph container instead.
- Skill edits require `make audit-skills-strict` and `make check-skill-graph` in CI;
  the latter bootstraps pinned MITRE STIX and checks the generated `skills.cypher`.
- `make dev` uses base + dev + watch Compose files; plain `docker compose` uses base
  only. `make dogfood` exercises the launcher/onboard/CLI from local images and stops
  prior stacks; `make clean` removes Compose volumes and `.dogfood/`.

## Active initiative: Incalmo-lessons (safe subset)

Follow the work packages in [`docs/incalmo-lessons-implementation-guide.md`](docs/incalmo-lessons-implementation-guide.md).
Only L2a (fail-safe post-tool KG auto-ingest), L2b (parsers for verified coverage gaps),
L6 (investigate structured decoding before implementing), L7-obs (record and surface
tried edges/fail reasons), and L9 (optional per-role structure, current default) are in
scope. L1, L3, L4, L5 gating, and L7 blocking/pruning need explicit sign-off and a T2
before/after benchmark; do not implement them as part of this initiative.

- Do not touch the exploit-execution path (`tools/bash/*`, sandbox dispatch,
  Sliver/msf/impacket) or weaken `SafeCommand`, RoE, `EngagementContext`, egress, HITL,
  `.semgrep/decepticon-no-*`, or container hardening.
- Post-tool hooks must bound their work, catch failures, and return the original tool
  result unchanged; hook failure must never block or alter tool execution. KG remains
  the canonical state store. L7 records/surfaces only: no retry blocking or pruning.
- One lesson per ADR and PR. Require deterministic T0 mechanism tests (including hook
  failure behavior) and T1 replay using `runtime/recording.py` `ReplayMiddleware`;
  flag-gate changes to agent input. T2 is not required for the safe subset.
