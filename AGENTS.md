# Raptix agent notes

Read [`CONTRIBUTING_AGENT.md`](CONTRIBUTING_AGENT.md), [`docs/QUALITY_BAR.md`](docs/QUALITY_BAR.md),
and [`docs/agents.md`](docs/agents.md) (agent roster + middleware stack) for
contributor rules: one concern per PR, ≤400 runtime lines / ≤10 files, banned
patterns + AI-slop signatures in QUALITY_BAR, no guardrail weakening without an
ADR and threat model, no AI co-author trailers.

## Current focus: tool-optimization plan — finish wave T2

Active initiative:
[`docs/tool-optimization-implementation-plan.md`](docs/tool-optimization-implementation-plan.md)
(T0/T1 FROZEN, T2 GO, T3–T13 sequential after T2 sign-off). Root-level
[`docs/tool-optimization-plan.md`](docs/tool-optimization-plan.md) is the raw
analysis transcript behind the plan — the implementation plan is canonical.

State (branch `structure`, as of 2026-10-06): T2 contracts live in
`packages/raptix-core/raptix_core/types/capability.py`. First pass committed
(`feat(core): T2 capability-registry contracts`); the second-review hardening
sits on top in the working tree — `ExecutionSpec.implementation_id` and
`CompletionSpec.max_steps` became REQUIRED, and `CapabilityResult.execution`
became `executions: tuple[ExecutionRecord, ...]`. Frozen contract decisions —
do not relax without re-reviewing the same points:

- No `RequirementSpec.query` — core never couples to the AKG/Cypher backend; a
  runtime `RequirementEvaluator` decides HOW to check each requirement id.
- `ExecutionSpec.implementation_id` required — provenance when two
  implementations of one capability share an `ExecutorKind`.
- `CompletionSpec.max_steps` required — the only guaranteed worker termination;
  success/failure observations are early-exit signals layered on top.
- `allowed_roles == ()` means UNRESTRICTED (matches `PluginBundle.roles`), not
  "no roles".
- A `WORKER` `ImplementationSpec` carries only `worker_id`; the scoped-toolset
  allowlist lives in the `WorkerSpec` resolved by T10's `WorkerRegistry` — a
  `worker_id` that resolves to no such spec means UNAVAILABLE, never an
  unscoped toolset.
- `Artifact.artifact_ref` is never a filesystem path (`artifact://`, `s3://`,
  db id are legal) — T3 parsers read content via `ArtifactStore` and stay
  storage-agnostic.
- `raptix-core` imports only pydantic + pydantic-settings + typing-extensions +
  stdlib (enforced by `tests/test_no_runtime_deps.py`).
- Public-API names are pinned in `tests/test_public_api_stability.py` — bump
  the expected count deliberately, with the CHANGELOG, in the same commit.
- Unrelated in-flight rename: `create_raptix_agent` now lives in
  `intelligence/agents/standard/raptix.py` (module renamed from
  `decepticon.py`; function name unchanged — do not "fix" it back).

Standing rules for every tool wave (T3+):

- Never delete code — remove the `@tool` decorator and `*_TOOLS` list
  membership only; keep functions importable (re-export shims).
- Shadow mode before enforcement (T9); prove adapters on existing binaries
  before adding executor profiles (T7 before T8).
- Bash never counts as a capability implementation; the resolver never falls
  back to bash implicitly.
- Recovery surface (`inspect_context`, `search_knowledge`, `load_skill`,
  `ask_user`, `diagnose_execution`) is never filtered by exposure.
- `phase_affinity` is soft ranking; `allowed_phases` is a hard constraint used
  sparingly. Exposure is UX, never a security control.
- Telemetry/eval never logs or tunes on raw parameter values (credentials,
  hashes, tokens, keys).
- `tests/fixtures/capabilities/held-out.jsonl` is a T11 artifact (does not
  exist yet); never tune tool schemas against held-out scenarios.
- One semantic concern per PR; ~400 behavior LOC preferred.

Key files for tool work (many registrations are NOT in `execution/tools/`):

- `execution/tools/` — most `@tool` functions, but `opplan.py` (7 nested
  closures) and `skills.py` (nested `load_skill`) hide theirs inside factories.
- `knowledge/graph/tools.py` (`kg_record`/`kg_ingest`/`kg_surface_inventory`),
  `middleware/skillogy.py` (default skill backend), `middleware/dispatch.py`
  (`task` via `StructuredTool.from_function`) — outside `execution/tools/`.
- `intelligence/agents/build.py` (`build_tools()`/`build_middleware()`),
  `intelligence/agents/middleware_slots.py` (any factory whose instance sets
  `self.tools` adds to the assembled surface — static `_STANDARD_TOOLS` is only
  half the per-turn surface), `intelligence/agents/domain_composer.py`.
- `docs/architecture/tool-classification.md` — frozen 159-row v2 table; its
  Target Capability ID column feeds T3+.
- `benchmarks/tool_eval/baseline/` — pinned T0 baseline (`baseline.jsonl`,
  `assembled_baseline.jsonl`) + capture scripts.
- `infra/containers/sandbox.Dockerfile` — the real binary inventory; several
  `kg_ingest_*` parsers have no executor installed yet (T8 closes that gap).

## Where changes belong

- Root `pyproject.toml` is an unpublished uv workspace (Python 3.13), not the
  package to edit for runtime features. `packages/raptix-core` owns contracts
  (no LangChain, LangGraph, HTTP or FastAPI imports); `packages/raptix` owns
  agents, middleware, tools and runtime; `packages/raptix-sdk` exposes the
  plugin-author API; `packages/raptix-skills` holds the SKILL.md corpus. Never
  import upward from core; SDK and plugins touch only SDK + core contracts;
  apps never import runtime internals.
- Top-level layout: `apps/{cli,web,desktop,launcher,shared}`,
  `infra/{containers,config,telemetry-gateway}`, `benchmarks/` (Python package,
  run via `-m benchmarks.runner`). Compose files stay at repo root (launcher
  contract) and mount `./infra/{config,containers}`.
- Runtime subsystems under `packages/raptix/raptix/`: `orchestration/`
  (`phases/` = UKC runtime state, `mission/`), `knowledge/graph/`,
  `intelligence/{agents,prompts,llm}`, `execution/{tools,sandbox,backends}`,
  `interfaces/{mcp,api}`, `middleware/` (cross-cutting only — ADR-0041).
  Full layout and dependency rules: `docs/architecture/` (8 authoritative docs).
- Re-export shims still standing: `mcp_server/`, `server/`,
  `middleware/engagement.py`, `middleware/opplan.py`, plus the Phase-1
  `raptix.core.*` / `raptix.plugin_loader` shims (2.0.0 contract). Everything
  else was retired in W11.
- Domain ownership: `plugins/{contracts,reversing,mobile,iot,ics,wireless,
  cloud,phishing,active-directory,web,network}` own specialist definitions,
  prompts and offline analyzers; they import stdlib + SDK/core only.
  `raptix_sdk.create_domain_agent` dispatches to the runtime
  `raptix.agent_composers` provider (ADR-0038).
- UKC phases are orchestration state (`orchestration/phases/`), never a source
  tree — never organize agents/skills/tools by phase; skills carry
  `ukc_phases` metadata (ADR-0037). Nothing in the runtime gates on them yet.
- `infra/config/` LLM provider handlers stay there intentionally — zero raptix
  dependency, container-mount artifacts (ADR-0039).
- Structural invariants (SDK/app/skill imports, UKC phase tree, middleware
  shims) are enforced by tests, not just docs: a boundary violation fails CI —
  fix the placement, don't bypass the test.
- `langgraph.json` maps graph names to
  `packages/raptix/raptix/intelligence/agents/standard/` and loads `.env`;
  in-checkout plugin bundles come from root `[tool.raptix.plugins]`.
- Node workspaces are rooted in `package.json` (`apps/*`, `apps/shared/*`).
  Build `@raptix/streaming` and `@raptix/web-contracts` before CLI
  typecheck/build or web-raptix build; both consume their `dist/`. For
  apps/web edits follow `apps/web/AGENTS.md`.
- Runtime artifacts (`workspace/`, `run/`, `telemetry/`, `test-results*/`,
  `dist/`, `node_modules/`, `generated/`) are outputs — never source-of-truth,
  never default fixtures.

## Run from repo root

- `uv sync --dev --locked`; focused Python test: `uv run pytest
  packages/raptix/tests/path/test_x.py::test_name` or
  `make test-local ARGS="path::test"`.
- `make ci-lint` then `make ci-test` is the Python PR lane: Ruff + format +
  errors-only basedpyright, then `pytest -n auto -q -m "not slow"`.
- `make quality` adds CLI + Web checks; `make quality-strict` adds the 60%
  coverage gate; `make smoke` is the cross-stack smoke test.
- Skill edits require `make audit-skills-strict` and `make check-skill-graph`
  in CI; the latter bootstraps pinned MITRE STIX and checks `skills.cypher`.
- `make dev` uses base + dev + watch Compose files; plain `docker compose` uses
  base only. `make dogfood` exercises launcher/onboard/CLI from local images;
  `make clean` removes Compose volumes and `.dogfood/`.

## Guardrails — never weaken without an ADR + threat model

- Exploit-execution path (`execution/tools/bash/`, sandbox dispatch,
  Sliver/msf/impacket), `SafeCommand`, RoE, `EngagementContext`, egress, HITL,
  `.semgrep` `raptix-no-*` rules, container hardening.
- Safety-critical middleware slots (`engagement-context`, `roe-guardrail`,
  `untrusted-output`, `prompt-injection-shield`, `hitl-approval`) can only be
  replaced or disabled with `RAPTIX_ALLOW_SAFETY_OVERRIDES=1` set.
- Post-tool middleware hooks must bound their work, catch failures, and return
  the original tool result unchanged; hook failure never blocks or alters tool
  execution. KG remains the canonical state store.
- New subsystem boundary, public-API change, guardrail relaxation, or new
  dependency → ADR in `docs/adr/` (`Status: Proposed`) before code lands;
  latest is ADR-0041.

## Incalmo-lessons initiative (safe subset)

Follow [`docs/incalmo-lessons-implementation-guide.md`](docs/incalmo-lessons-implementation-guide.md).
Only L2a (fail-safe post-tool KG auto-ingest), L2b (parsers for verified
coverage gaps), L6 (investigate structured decoding before implementing),
L7-obs (record/surface tried edges + fail reasons), and L9 (optional per-role
structure, current default) are in scope. L1, L3, L4, L5 gating and L7
blocking/pruning need explicit sign-off + a before/after benchmark — do not
implement them.

- Naming trap: the Incalmo guide's T0/T1/T2 are *benchmark tiers*, unrelated
  to the tool-optimization plan's waves T0–T13.
- T3 (ParserRegistry) wires into the L2a auto-ingest hook. One lesson per ADR
  and PR; deterministic mechanism tests (including hook-failure behavior) +
  T1 replay via `runtime/recording.py` `ReplayMiddleware`; flag-gate changes
  to agent input.
