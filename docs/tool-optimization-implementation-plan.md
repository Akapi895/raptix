# Tool Optimization Implementation Plan

> Status: **T0/T1 FROZEN; T2 GO.** T3–T13 remain proposed.
> Last updated: 2026-10-06
> Tracks: `tool-optimization-plan.md` (analysis), Incalmo-lessons initiative
> T0/T1 outputs: `benchmarks/tool_eval/baseline/` (T0a static +
> T0b assembled, pinned profile), `docs/architecture/tool-classification.md`
> (v2, 159 functions, 6-category taxonomy with Target Capability IDs).
> The true inventory is 159, not the 148 estimated below — see the
> classification doc's "Changes from v1" section for what the original
> `^@tool` line-start scan missed (nested closures, functional `tool(fn)`
> registrations, `StructuredTool.from_function`, tools outside
> `execution/tools/` entirely).

---

## Problem statement

Raptix exposes 148+ `@tool`-decorated functions across 37 files in
`execution/tools/`. The majority are internal services (parsers, KG CRUD,
report renderers, evidence sealers) that do not represent meaningful agent
decisions. This creates five compounding issues:

1. **Tool/API leakage** — internal helpers exposed as agent actions
2. **Tool-selection overload** — analyst sees ~45 tools; Ghidra MCP adds ~245
3. **Capability drift** — skill/parser corpus advertises capabilities whose
   executors are not installed in the sandbox image
4. **Core-domain coupling** — AD/cloud/reversing/defense/contracts tools live in
   core runtime despite an existing plugin architecture
5. **Custom implementation burden** — tendency to rewrite what mature security
   tools already solve

## Target architecture

```
148 Python @tool functions
    ↓
still 100+ internal functions (code stays, decorator removed)

Global capability catalog
    ↓
30–60 semantic capabilities

Active per-agent surface
    ↓
design target ~8–15 typical per turn (hypothesis — validate via T0 baseline)
```

### Target flow

```
                   Planner
                      │
                      │ WHAT (semantic capability)
                      ▼
              CapabilityRequest
                      │
                      ▼
             Capability Runtime
                      │
          ┌───────────┴───────────┐
          │                       │
   deterministic path      bounded worker path
          │                (optional — only when
          │                 deterministic resolver
          │                 is insufficient)
          │                       │
          │                 limited HOW
          │                       │
          └───────────┬───────────┘
                      ▼
                 Resolver
                      │
                      ▼
                   Adapter
                      │
                      │ exact syntax
                      ▼
                   Executor
            nmap / NetExec / etc.
                      │
                      ▼
                 Raw Artifact
                      │
                      ▼
             Parser / Normalizer
             (sole normalization owner —
              adapters do NOT parse)
                      │
                      ▼
                Observation[]
                      │
                      ▼
               Verifier / AKG
```

**Worker is optional.** Most capabilities resolve deterministically (e.g.,
`scan_network` → NmapAdapter → nmap command). A bounded Worker (LLM with
small toolset) is only needed for open-ended capabilities where the execution
path cannot be predetermined. When used, the Worker receives one
`CapabilityRequest`, a scoped toolset, and a `CompletionSpec` defining
success/failure criteria and step budget. Whether a capability needs a Worker
is determined by its `ImplementationSpec.kind`, not a top-level boolean.

### Normalization ownership

One canonical path: **Parser/Normalizer owns all output normalization.**

- Adapter: builds `ExecutionSpec` (payload, env, expected artifact formats)
- Executor: runs the spec, produces `ExecutionResult` with raw `Artifact[]`
- Parser: detects format, normalizes to `Observation[]`
- Adapter may provide `expected_artifact_formats` hint, but never parses

This eliminates the dual-owner conflict between Adapter.parse_output() and
ParserRegistry.

### Three-way separation: Availability / Eligibility / Authorization

Three distinct concepts — never conflate:

```
CapabilityManifest
        │
        ├── AvailabilityEvaluator
        │       "Can the system technically run this?"
        │       executors / profiles / health
        │
        ├── EligibilityEvaluator
        │       "Does current state make this applicable?"
        │       role / phase / AKG requirements
        │
        └── InvocationGuard
                "Is this specific call permitted?"
                scope / RoE / approval / budget
```

| Concept | Question | Example | When evaluated |
|---------|----------|---------|---------------|
| **Availability** | System has technical capability? | `nxc` installed + healthy | Startup + on-demand |
| **Eligibility** | Current state makes it applicable? | SMB target + credential in AKG | Tool exposure time |
| **Authorization** | This specific invocation is permitted? | Target in scope, RoE allows | Invocation time (hard guard) |

`CapabilityAvailability` answers only the first question — it never contains
AKG requirement checks. `CapabilityEligibility` answers the second.
Authorization is the hard security boundary at invocation time. Tool exposure
is a UX optimization; it is never a security control.

### Bash and capability honesty

Bash does NOT automatically satisfy a capability. A capability is AVAILABLE
only when it has a declared execution path:

- Typed adapter (deterministic)
- Bounded worker with explicit allowed primitives (including bash if declared)

If no declared path exists, the capability is UNAVAILABLE regardless of bash
availability. The resolver MUST NOT implicitly fall back to Bash when a typed
implementation is unavailable.

```
Capability
    │
    ├── healthy adapter?
    │       YES → use adapter
    │
    ├── declared worker implementation?
    │       YES → spawn bounded worker
    │
    └── otherwise
            UNAVAILABLE (not "bash fallback")
```

Bash remains available as a direct escape hatch for specialists (open-world
cyber domain), but it is never counted as an implementation for capability
availability checks.

### UKC phase semantics

Two distinct concepts:

- `phase_affinity` — **soft ranking** (capability is more relevant in these
  phases, ranked higher in exposure, but never hidden elsewhere)
- `allowed_phases` — **hard constraint** (capability is genuinely invalid
  outside these phases; use sparingly — default is None = all phases)

Exposure logic:
```
eligible =
    role allowed
  ∩ allowed_phases satisfied (hard)
  ∩ AKG requirements satisfied
  ∩ executor available

ranking_score += phase_affinity_bonus (soft)
```

Hard phase gating risks hiding recovery/exploration capabilities after
pivoting into new subnets. Discovery must not vanish in NETWORK_PROPAGATION.

### Recovery surface

Dynamic gating must not create deadlocks. A minimal recovery surface stays
available regardless of phase/state:

```
inspect_context
search_knowledge
load_skill
ask_user
diagnose_execution
bash (specialist only)
```

---

## Classification taxonomy (v2, post T0/T1 freeze)

Every tool-shaped registration falls into exactly one of 6 categories.
**Category and target surface are independent axes** — v1 conflated them
(its decision tree read "specialist needs it → execution primitive",
which contradicted its own table tagging many `worker:ad` rows Semantic
capability). A function can be `category=Worker primitive,
surface=worker:ad` at the same time.

| Category | Agent-facing? | Example |
|----------|:---:|---------|
| **Semantic capability** | Yes | `scan_network`, `validate_credential`, `establish_pivot` — a goal the planner or a worker actively chooses |
| **Worker primitive** | Yes | `bin_strings`, `ghidra_decompile` — HOW one step of an already-chosen capability happens; counted as part of that capability's declared implementation |
| **Control-plane tool** | Yes (few) | `get_objectives`, `ask_user`, `task` (dispatch) — plan/engagement state, approval, dispatch |
| **Execution primitive** | Specialist only | `bash`, `browser_action`, MCP bridge — the open-world escape hatch, NEVER counted as a capability's declared implementation |
| **Adapter** | No (resolver picks) | Nmap wrapper, NetExec wrapper |
| **Internal service** | No | parser, normalizer, KG CRUD, evidence seal, report renderer, availability probe |

### Decision tree

```
Function
  │
  Is this WHAT a red teamer wants to accomplish?
  ├── YES, a goal the planner or a worker actively chooses
  │        → Semantic capability
  ├── YES, but it's HOW one step of an already-chosen capability
  │   happens (a specific query/action/analysis primitive)
  │        → Worker primitive
  ├── NO — it's plan/engagement state, approval, or dispatch
  │        → Control-plane tool
  ├── NO — it's the open-world escape hatch (bash/browser)
  │        → Execution primitive
  ├── NO — the resolver picks it deterministically
  │        → Adapter
  └── NO — housekeeping, CRUD, parsing, rendering, probing
           → Internal service
```

### Classification target surface (T1 must specify per function)

Orthogonal to category — classify by role surface:

```
planner
worker:recon
worker:ad
worker:reversing
worker:exploit
verifier
operator
internal
all roles (recovery surface)
```

---

## Implementation waves

One semantic concern per PR. Prefer small diff; pure file moves, generated
files, fixtures, and parser modules do not count toward the soft file budget.
Behavior LOC ~400 preferred. Reviewable test diff. One migration concern.

Waves are ordered by dependency. **Baseline measurement (T0) comes before
any behavioral change.** Adapter architecture is proven with existing
binaries (T7) before adding new ones (T8).

**Go/hold status:**
- **T0, T1: FROZEN** (2026-10-06, after an external review found the first
  pass materially incomplete — see `docs/architecture/tool-classification.md`
  "Changes from v1")
- **T2: GO** — contract fixes already incorporated; T1's Target Capability
  ID column is ready for T2 to consume directly
- **T3–T13: GO sequentially after T2 contracts are signed off**

### Wave T0 — Baseline freeze + tool telemetry ✅ FROZEN

Split into T0a (static) and T0b (assembled) after the freeze review found
T0a alone invisible to any role whose tools come mostly from middleware.

**Goal:** Capture current tool-selection behavior before any changes. Without
this, later waves cannot measure improvement or detect regression.

Steps:
1. Record current state for representative scenarios:
   - `active_tools_per_turn` (per role)
   - `tool_schema_tokens` (per role)
   - `selected_tool` per turn
   - `parameter_schema_valid` and `parameter_keys` (never raw parameter values —
     they may contain credentials, hashes, tokens, keys)
   - `bash_usage_rate`
   - `success/failure` per tool call
2. Save scenario fixtures in `benchmarks/tool_eval/baseline/`
3. Add lightweight tool-selection telemetry to `build_tools()` path
   (log which tools are offered, which are selected — no behavioral change)
4. Tag baseline commit
5. Estimate baseline variance; freeze acceptance thresholds (non-inferiority
   margins, capability recall threshold, max latency regression) **before**
   opening held-out evaluation results in T11

**Security:** telemetry must never log raw `tool_parameters`, `context`,
`ExecutionSpec.env`, or `CapabilityRequest.context` values. Log only schema
validity, key names, and redacted summaries.

**Acceptance (met):**
- Baseline metrics recorded for all 11 OSS roles in `packages/raptix`
  (`benchmarks/tool_eval/baseline/baseline.jsonl` — T0a static;
  `assembled_baseline.jsonl` — T0b static+middleware union, with
  per-slot provenance and an explicit pinned baseline profile)
- Telemetry hook in `build_tools()` (`tool_exposure.py`, opt-in via
  `RAPTIX_TOOL_TELEMETRY=1`, logging only, no credential leakage, zero
  behavioral change verified by test)
- Scenario fixtures saved for regression testing
- Acceptance thresholds NOT YET documented — deferred; revisit before T11

**Known real numbers (not hypotheses):** analyst's assembled per-turn
surface is 37 (26 static + 6 filesystem + 3 skillogy + 2 KG), not the
~45 originally guessed nor the 26 T0a-alone would suggest.

---

### Wave T1 — Tool inventory & classification (docs only) ✅ FROZEN

**Goal:** Classify every tool-shaped registration in `packages/raptix`
core into the 6 categories (5 from this plan + **Worker primitive**,
added after the freeze review — see below). Produced
`docs/architecture/tool-classification.md` (v2) with columns:

| Function | Category | Target surface | Target capability | Notes |
|----------|----------|-----------------|--------------------|-------|

The `Target surface` column specifies the concrete role surface
(planner / worker:recon / worker:ad / verifier / operator / internal),
independent of category — a function can be `Worker primitive` AND
`worker:ad` at once (v1 conflated these two axes).

**Output:** 159-row classification table (not 148+ — the freeze review
found 11 tool-registrations the original line-start `^@tool` scan missed:
nested closures, functional `tool(fn)` calls, `StructuredTool.from_function`,
and three locations entirely outside `execution/tools/`), generated from
a structured data table so every summary count is computed, not hand-tallied.
No code changes.

**Acceptance (met):** Classification reviewed and signed off
(2026-10-06) before any T2+ code change.

---

### Wave T2 — Capability Registry contracts (raptix-core)

**Goal:** Define capability contracts in `raptix-core` with sufficient
structure for runtime resolution. Contracts must be executor-agnostic
(not CLI-centric) and must cleanly separate availability from eligibility.
`raptix-core` continues to import nothing outside stdlib.

```python
# raptix_core/types/capability.py

from collections.abc import Mapping
from typing import Any

JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]

class CapabilityId(str): ...
class SkillId(str): ...
class RoleId(str): ...

class RiskClass(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

# ── Requirements ──────────────────────────────────────────────────

class RequirementKind(Enum):
    GRAPH_NODE = "graph_node"
    GRAPH_EDGE = "graph_edge"
    CREDENTIAL = "credential"
    SERVICE = "service"
    SESSION = "session"
    CUSTOM = "custom"

@dataclass(frozen=True)
class RequirementSpec:
    id: str                    # e.g. "credential.available"
    kind: RequirementKind
    description: str
    # NO query field — core must not couple to AKG/Cypher backend.
    # Runtime RequirementEvaluator["credential.available"] decides HOW
    # to check (graph query, state lookup, etc.).

# ── Implementations ───────────────────────────────────────────────

class ImplementationKind(Enum):
    ADAPTER = "adapter"        # deterministic: adapter builds command
    WORKER = "worker"          # bounded LLM worker with scoped toolset
    MCP = "mcp"                # MCP server/sidecar
    SERVICE = "service"        # long-lived sidecar (BloodHound, Sliver)

@dataclass(frozen=True)
class ImplementationSpec:
    id: str                    # e.g. "netexec.smb" or "ad_worker"
    kind: ImplementationKind

    # For ADAPTER kind:
    adapter_id: str | None = None
    executable: str | None = None       # binary name for availability check
    profile: str | None = None          # sandbox profile that provides it

    # For WORKER kind:
    worker_id: str | None = None

    version_constraint: str | None = None

# ── Completion (bounded worker termination) ───────────────────────

@dataclass(frozen=True)
class CompletionSpec:
    success_observations: tuple[str, ...]   # observation kinds that mean success
    failure_conditions: tuple[str, ...]     # conditions that mean stop
    max_steps: int | None = None            # hard step budget

# ── Manifest ──────────────────────────────────────────────────────

@dataclass(frozen=True)
class CapabilityManifest:
    id: CapabilityId
    schema_version: int
    description: str

    phase_affinity: tuple[str, ...]             # soft: ranked higher
    allowed_phases: tuple[str, ...] | None      # hard: None = all
    allowed_roles: tuple[RoleId, ...]

    requirements: tuple[RequirementSpec, ...]
    implementations: tuple[ImplementationSpec, ...]
    outputs: tuple[str, ...]                    # observation types produced
    completion: CompletionSpec | None            # for worker implementations

    skill_ids: tuple[SkillId, ...]              # logical IDs, not file paths

    risk_class: RiskClass
    parallel_safe: bool

# ── Availability (technical: can the system run this?) ────────────

class CapabilityStatus(Enum):
    AVAILABLE = "available"
    PARTIAL = "partial"
    UNAVAILABLE = "unavailable"

@dataclass(frozen=True)
class CapabilityAvailability:
    capability_id: CapabilityId
    status: CapabilityStatus
    healthy_implementations: tuple[str, ...]
    # NO missing_requirements here — that belongs to Eligibility

# ── Eligibility (state: does current context make this applicable?) ──

@dataclass(frozen=True)
class CapabilityEligibility:
    capability_id: CapabilityId
    eligible: bool
    unmet_requirements: tuple[str, ...]
    reason: str | None

# ── Request / Execution / Result ──────────────────────────────────

@dataclass(frozen=True)
class CapabilityRequest:
    capability_id: CapabilityId
    parameters: Mapping[str, JsonValue]     # immutable view
    context: Mapping[str, JsonValue]        # immutable view

class ExecutorKind(Enum):
    COMMAND = "command"
    MCP = "mcp"
    BROWSER = "browser"
    SESSION = "session"
    SERVICE = "service"

@dataclass(frozen=True)
class ExecutionSpec:
    executor_kind: ExecutorKind
    executor_id: str
    payload: Mapping[str, JsonValue]        # executor-specific; not just argv
    expected_artifact_formats: tuple[str, ...]
    timeout_seconds: int | None

@dataclass(frozen=True)
class Artifact:
    id: str                         # stable reference (not filesystem path)
    artifact_ref: str               # ArtifactStore reference (not raw path)
    format_hint: str | None
    content_type: str | None
    sha256: str | None
    producer: str | None
    metadata: Mapping[str, JsonValue]

@dataclass(frozen=True)
class Observation:
    kind: str
    data: Mapping[str, JsonValue]
    source_artifact_id: str | None
    parser_id: str | None
    confidence: float

@dataclass(frozen=True)
class CapabilityResult:
    request: CapabilityRequest
    execution: ExecutionSpec | None
    artifacts: tuple[Artifact, ...]
    observations: tuple[Observation, ...]
    success: bool
    error: str | None
```

Key design decisions in contracts:
- **No `RequirementSpec.query`** — core must not couple to AKG/Cypher backend;
  runtime `RequirementEvaluator` decides how to check each requirement
- **`ImplementationKind` replaces `interactive: bool`** — a capability can have
  both adapter and worker implementations; `interactive` was too coarse
- **`ExecutorKind` generalizes beyond CLI** — MCP, browser, session, service
  execution paths are first-class, even if not all implemented immediately
- **`CompletionSpec`** — bounded worker termination criteria; without this,
  workers degenerate into unbounded mini-agents
- **`Mapping[str, JsonValue]` instead of `dict`** — frozen dataclasses with
  mutable dicts are not truly immutable
- **`Artifact.artifact_ref` instead of `path`** — stable cross-container
  reference via ArtifactStore; physical path is a store implementation detail
- **Skill references use logical `SkillId`** (e.g., `"ad.credential_reuse.netexec"`)
  resolved by SkillRegistry — never file paths that break on move

**Acceptance (met):** Implemented at
`packages/raptix-core/raptix_core/types/capability.py`, exported from
`raptix_core.types.__init__`, pinned in
`tests/test_public_api_stability.py` (95 public names). 173/173
`raptix-core` tests pass, incl. `test_capability_contracts.py` and
`test_no_runtime_deps.py` (no runtime behavior change; `raptix-core`
still imports only `pydantic` + stdlib + `typing_extensions` — never the
heavy frameworks, and T2 itself adds no new dependency at all —
`capability.py` uses only `dataclasses`/`enum`/`collections.abc`).

**Revised after a second review caught two real gaps in the first cut**
(fixed before anything downstream could consume the contract):
- `CompletionSpec.max_steps` is now REQUIRED (was optional). The first
  cut accepted `CompletionSpec(success_observations=(...,))` with no
  `max_steps` — if that observation never fired, the worker ran forever,
  contradicting the type's own docstring claim. A success/failure
  condition is now documented as an early-exit signal layered on top of
  the hard `max_steps` bound, never a substitute for it.
- `ExecutionSpec` now carries a required `implementation_id`. Without
  it, two implementations of one capability that both resolve through
  the same `ExecutorKind` (e.g. `ad.netexec.smb` vs `ad.impacket.psexec`,
  both `ExecutorKind.COMMAND`, under `access.move_laterally`) were
  indistinguishable once the provenance chain reached execution — the
  adapter/resolver must copy `ImplementationSpec.id` into this field.
- `CapabilityResult.execution: ExecutionSpec | None` (singular) is now
  `executions: tuple[ExecutionRecord, ...]`. The architecture always
  allowed a bounded `WORKER` to run several executions per request
  (e.g. `curl` → research → PoC → `bash`); the contract's first cut
  only modeled "1 capability = 1 tool invocation". `ExecutionRecord`
  wraps one `ExecutionSpec` with the artifacts it produced, so artifacts
  stay attributed to the execution that produced them.
- Documented (no new field): `CapabilityManifest.allowed_roles == ()`
  means UNRESTRICTED, matching `PluginBundle.roles`'s existing
  convention — not "no roles allowed". A `WORKER`
  `ImplementationSpec.worker_id` MUST resolve, via T10's
  `WorkerRegistry`, to a `WorkerSpec` with an explicit primitive
  allowlist, or the implementation is UNAVAILABLE — this invariant is
  written into T2 now specifically so T10 does not have to break the
  contract to add it.
- Flagged for T3 (not a T2 code change): a Parser must never treat
  `Artifact.artifact_ref` as a filesystem path — it may be `artifact://`,
  `s3://`, a database id, or a container-crossing reference. T3's
  `ParserRegistry` should read the artifact via an `ArtifactReader`/
  `ArtifactStore` and hand the parser *content*, never let the parser
  resolve the ref itself.

---

### Wave T3 — Parser registry (internal service, remove @tool) ✅ DONE

**Goal:** Convert 14 `kg_ingest_*` functions from agent-facing tools to
internal parser services. This is the highest-value change: 14 tools that
no LLM should ever need to choose.

**Outcome: 9 of 14, not all 14.** A review of the first implementation
found 6 formats (sarif, slither, gobuster, testssl, crackmapexec,
asrep_hashes) had their `@tool` decorator removed with no auto-ingest
replacement wired in, making them silently unreachable — a real
capability regression that 804 passing tests didn't catch, because the
tests only exercised the shim functions directly, never end-to-end
reachability. Fix: only formats with a clean, evidence-based
`<binary> ... -o <file>` bash invocation auto-ingest —
`nmap_xml`/`nuclei_jsonl`/`httpx_jsonl`/`katana_jsonl` (pre-existing
adapter path) + `subfinder`/`dnsx`/`ffuf`/`masscan`/`gobuster` (new
`ParserRegistry` path, confirmed against `packages/raptix-skills`
canonical invocations). `gobuster` additionally needed its `-u`
value threaded through as artifact metadata (`GobusterParser` cannot
anchor hits to a host otherwise). The other 5 — `sarif`, `slither`,
`testssl`, `crackmapexec`, `asrep_hashes` — are conventionally invoked
with output redirected to a file (`> out.txt` / piped), which
`KGAutoIngestMiddleware` deliberately never parses (it rejects any
command containing shell redirection outright); guessing a flag
convention for these risked silently ingesting the wrong content, so
they kept their `@tool` decorator and `RESEARCH_TOOLS` membership —
exactly their pre-T3 shape. A future wave can revisit once there's a
safe way to detect their output (e.g. a stdout-capture heuristic, or a
documented convention requiring an explicit output flag).

**Artifact access (per the T2 review — not a T2 code change, a T3
design constraint):** `Artifact.artifact_ref` is intentionally not a
filesystem path (it may be `artifact://`, `s3://`, a database id, or a
container-crossing reference — see `capability.py`'s module docstring).
A parser must never resolve it itself (e.g. `Path(artifact.artifact_ref).read_text()`).
The `ParserRegistry` reads the artifact through an `ArtifactReader`/
`ArtifactStore` and hands the parser *content*, so a parser stays
storage-backend-agnostic:

```
ParserRegistry
      │
      ├─ Artifact (metadata only)
      │
      └─ ArtifactReader / ArtifactStore
                ↓
              content (bytes)
                ↓
              parser.parse(artifact, content)
```

Steps:
1. Create `knowledge/ingest/registry.py` with `ParserRegistry`
2. Create `knowledge/ingest/parsers/` with one module per format
   (nmap, ffuf, nuclei, httpx, masscan, etc.)
3. Each parser implements `ArtifactParser` protocol:
   - `format_id: str`
   - `parser_version: str`
   - `supports(artifact: Artifact, content: bytes) -> float` (confidence 0.0–1.0)
   - `parse(artifact: Artifact, content: bytes) -> list[Observation]`
4. Parser resolution order:
   - Execution metadata / adapter `expected_artifact_formats` → exact match
   - Explicit format hint on artifact → exact match
   - Parser sniffing (highest confidence wins)
   - Ambiguous sniffing → deterministic rejection/escalation (never silently pick)
5. Parsers must be **idempotent**: same artifact → same observations
6. Remove `@tool` decorator from the 14 `kg_ingest_*` functions
7. Wire `ParserRegistry` into post-tool middleware hook (L2a auto-ingest)
8. Re-export shim for backward compatibility of callers

**Acceptance (met):**
- 9 fewer agent-facing tools (not 14 — see Outcome above)
- 811/811 tests pass via registry dispatch (incl. end-to-end auto-ingest
  tests per format, not just shim-function unit tests)
- The 9 auto-ingested `kg_ingest_*` are importable but not in
  `RESEARCH_TOOLS`; the other 5 stay in `RESEARCH_TOOLS` by design
- Auto-ingest works for all 9: bash tool output → parser → AKG (no LLM
  decision), verified per-format in `test_kg_autoingest.py`
- Explicit format ID resolves to exactly one parser (fixed a
  multi-candidate `expected_formats` fallthrough bug: the resolver
  used to examine only the first candidate regardless of list length)
- Ambiguous sniffing never silently chooses a parser
- Parser fixture dispatch is deterministic

---

### Wave T4 — KG surface consolidation (25 → ~4 tools) ✅ DONE

**Goal:** Replace 25 low-level KG tools with 3–4 semantic query tools.

| Remove from agent surface | Replace with |
|---------------------------|-------------|
| `kg_add_node`, `kg_add_edge`, `kg_neighbors`, `kg_stats`, `kg_query`, `rank_candidates`, `normalize_*`, `dedupe_*` | `inspect_asset(id)`, `find_attack_paths()`, `search_knowledge(query)` |

`get_attack_context()` becomes automatic context injection into the planner
(runtime builds `PlanningContext` and injects it), not a tool the model must
call every turn.

KG mutation becomes automatic:
```
Tool execution → ActionResult → Observation → Knowledge service → AKG
```

Agent reads graph through projections, never raw CRUD.

**Acceptance:**
- Agent files reference ≤4 KG-facing tools
- `PlanningContext` injected automatically (no tool call needed for base context)
- Low-level functions remain as internal services (importable, no `@tool`)
- Graph reads return structured projections, not raw Cypher results

**Outcome: agents read via 3 semantic projections; 12 more functions
became internal services.** The agent-facing surface is now
`search_knowledge(query)` / `inspect_asset(node_id)` /
`find_attack_paths()` (all `@tool`, `kg_degrades`-guarded,
structured-projection JSON) beside the KGMiddleware pair
`kg_record`/`kg_ingest` and the raptix-only `kg_surface_inventory`.
Demoted to plain functions (importable, no `@tool`, per the standing
never-delete rule): the 6 KG CRUD services (`kg_add_node`,
`kg_add_edge`, `kg_query`, `kg_neighbors`, `kg_stats`,
`kg_dedupe_findings`) and 6 duplicate twins identified by the T1
classification (`kg_analyze_jwt`, `kg_analyze_oauth_callback`,
`kg_analyze_cookie_value`, `kg_scan_solidity`, `kg_triage_binary` —
each collapsible into `jwt_parse`/`oauth_audit`/`cookie_audit`/
`solidity_scan_file`/`bin_identify`+`bin_strings` — plus
`slither_ingest`, whose canonical twin is `kg_ingest_slither`;
the contracts plugin's `tool_names` now selects the canonical name,
while the provenance string `created_by == "slither_ingest"` is kept).
Verification passed on day one: zero agents or domain plugins
selected any demoted tool name before the change.

Scope decisions worth remembering:

- `rank_candidates` and `kg_add_candidate` keep their `@tool` and
  `RESEARCH_TOOLS` membership — the detector→scanner candidate
  pipeline still drives them as a workflow; revisit at T10.
- `bh_ingest_zip` vs `bhce_ingest_zip` overlap: intentionally not
  picked apart here (needs an cycles-relation ADR first).
- `PlanningContext` is injected, revision-cached and bounded: rebuilt
  inside `KGMiddleware._hydrate_kg_state` only when the KG revision
  advances, ≤3 crown jewels × 1 cheapest path × ≤6 hops, failure →
  `""` with the revision still advancing. Wired for the orchestrator
  role only (`_make_kg`: `planning_context=role == "raptix"`).
- Bug caught by the new unit tests: `search_knowledge`/`inspect_asset`
  originally read `node.key`, which does not exist — the dedup key
  lives in `props["key"]` (`Node.make`, `types/kg.py`). Now read via
  `node.props.get("key")`.
- Fixed en route: pre-existing `_StubStore` route typo in
  `test_kg_summary_unit.py` (`HAS_VULP` → `HAS_VULN`) that had quietly
  broken the "full engagement" summary test.
- Deferred to T9: the skills corpus still teaches the old surface —
  `kg_query`/`kg_stats` playbook references across SKILL.md files and
  one `slither_ingest` mention in `standard/contracts/SKILL.md` line 39.
  Refresh them together with `make build-skill-graph` /
  `make audit-skills-strict` (one deliberate skills pass, no piecemeal
  `content_sha256` churn).

Test surface: new `test_semantic_tools.py` (projection behaviors and
error paths, fake-store based) and `test_kg_slot.py` (`_make_kg` role
wiring via recording stand-in); planning-context hydration/failure/injection
tests in `test_kg_middleware_unit.py` and `test_kg_summary_unit.py`;
converted twin tests to direct calls in `test_tools.py`,
`test_tools_extended.py`, `test_dedupe.py`, `test_blue_cell_agent.py`,
`test_contract_tools.py`, `test_misc_tool_wrappers.py`. 283 tests
pass across those nine files.

---

### Wave T5 — Reference + Reporting + Evidence cleanup

**Goal:** Consolidate references (15 → 3), reporting (6 → 0–1),
and evidence (4 → 0 for attack agents, 1 inspection tool for verifiers).

References:

| Current | Target |
|---------|--------|
| `payload_search`, `oneliner_search`, `h1_search`, `methodology_lookup`, `killchain_lookup`, `cve_poc_lookup`, `ref_*` (15 total) | `research_cve(query)`, `search_security_references(query, kinds=[])`, `lookup_payload(query)` |

Backend fan-out is automatic — agent doesn't need to know which corpus.

Reporting:
```
6 format-specific tools → 0 for attack worker (not its job)
                         → 1 generate_report(format) for finalization/operator
```

Evidence:
```
seal_evidence / verify_evidence → automatic in ArtifactStore pipeline
                                → inspect_evidence(finding_id) for verifier/operator
```

Surface by role:

| Role | References | Reporting | Evidence |
|------|-----------|-----------|---------|
| Planner | `research_cve` | — | — |
| Worker | `search_security_references`, `lookup_payload` | — | — |
| Verifier | `search_security_references` | — | `inspect_evidence` |
| Operator | all 3 | `generate_report` | `inspect_evidence` |
| Internal | — | renderer functions | seal/verify pipeline |

**Acceptance:**
- 15 → 3 reference tools; 6 → 0–1 reporting; 4 → 0–1 evidence
- All existing data reachable through new surfaces
- Role-appropriate exposure (attack workers never see reporting)

---

### Wave T6 — Capability catalog + executor availability

**Goal:** Map current capabilities to their implementations and determine
real-time availability. This is the runtime instantiation of T2 contracts.
Availability answers only "can the system technically run this?" — not
eligibility (state) or authorization (permission).

Steps:
1. Create initial `CapabilityManifest` entries for all T1-classified
   semantic capabilities
2. Implement `CapabilityRegistry` in runtime that loads manifests
3. Add `AvailabilityEvaluator` (binary exists? healthy? profile loaded?)
4. Add `EligibilityEvaluator` (role? phase? AKG requirements?)
5. Expose `CapabilityAvailability` and `CapabilityEligibility` separately
6. Record `tool_name`, `tool_version`, `adapter_version`, `parser_version`,
   `tool_data_version` in execution metadata for provenance

**Acceptance:**
- Every semantic capability has a manifest
- Availability reflects actual executor presence (not AKG state)
- Eligibility reflects current state (role, phase, requirements)
- Health check runs at startup and is queryable
- Execution provenance records full version chain

---

### Wave T7 — Adapter layer for EXISTING executors

**Goal:** Create thin adapters for security binaries already installed in
the sandbox image. Prove the adapter architecture works before adding
new binaries (T8).

Adapters for existing sandbox binaries only:

```
execution/adapters/
├── network/
│   ├── nmap.py          # scan_network → nmap command
│   └── subfinder.py     # discover_subdomains → subfinder
├── web/
│   ├── sqlmap.py        # test_injection → sqlmap
│   ├── gobuster.py      # fuzz_paths → gobuster
│   └── nikto.py         # scan_web → nikto
├── ad/
│   ├── impacket.py      # lateral_move, credential_dump → impacket-*
│   └── responder.py     # capture_ntlm → responder
└── resolver.py          # picks adapter by capability + availability
```

Adapter contract (no parsing — that's Parser's job):
```python
class ToolAdapter(Protocol):
    capability_id: CapabilityId
    executable: str

    def is_available(self, context: ExecutionContext) -> CapabilityAvailability: ...
    def build_execution(self, request: CapabilityRequest, context: ExecutionContext) -> ExecutionSpec: ...
```

**Acceptance:**
- Adapters exist for binaries already in sandbox.Dockerfile
- Resolver dispatches to correct adapter
- Adapter produces `ExecutionSpec`; Parser handles output normalization
- End-to-end: capability request → adapter → executor → artifact → parser → observation
- Resolver does NOT implicitly fall back to bash when no adapter matches;
  capability is UNAVAILABLE if no declared implementation exists

---

### Wave T8 — Add missing sandbox executor profiles

**Goal:** Close the capability-drift gap by adding mature executors that
already have parsers/skills in the repo. Not custom Python — Dockerfile only.

Profile additions (separate Dockerfile stages or sidecar services):

| Profile | Add | Kali package |
|---------|-----|-------------|
| `sandbox-web` | httpx-toolkit, nuclei, ffuf, katana, testssl.sh | kali-rolling |
| `sandbox-ad` | netexec, certipy-ad, evil-winrm | kali-rolling |
| `sandbox-pivot` | ligolo-ng (default pivot tool) | kali-rolling |

Version pinning: record `tool_version` and `tool_data_version` (e.g., nuclei
template corpus version) in execution metadata for reproducibility.

**Acceptance:**
- Capabilities previously UNAVAILABLE become AVAILABLE with new profiles
- Parser/skill that already existed now has matching binary
- No custom Python reimplementation of security tools
- Tool and data versions recorded in execution provenance

---

### Wave T9 — Dynamic exposure — SHADOW MODE

**Goal:** Implement dynamic tool exposure but in shadow mode only (log
proposed filtered set, don't enforce).

Exposure logic (hard eligibility + soft ranking):
```
eligible =
    role allowed
  ∩ allowed_phases satisfied (hard)
  ∩ AKG requirements satisfied
  ∩ executor available

ranking_score += phase_affinity_bonus (soft)
```

Implementation in `intelligence/tooling/exposure.py`:
```python
def resolve_active_tools(
    role: RoleId,
    phase: str,
    graph_state: GraphSnapshot,
    available_executors: set[str],
) -> ExposureResult:
    ...

@dataclass
class ExposureResult:
    proposed_tools: list[Tool]     # what dynamic exposure would show
    current_tools: list[Tool]      # what static _STANDARD_TOOLS shows
    filtered_out: list[Tool]       # tools removed by dynamic filtering
    reason_map: dict[str, str]     # tool_name → reason for filtering
```

Recovery surface (`inspect_context`, `search_knowledge`, `load_skill`,
`ask_user`, `diagnose_execution`) is always included regardless of filtering.

`phase_affinity` affects ranking only, never hard exclusion.

**Shadow mode:** log `ExposureResult` diffs, but serve `current_tools`.
Never enforce until T12 validates non-regression.

**Acceptance:**
- Shadow mode logs what would be filtered and why
- Recovery surface always present in proposed set
- `phase_affinity` used for ranking, not intersection/exclusion
- Static `_STANDARD_TOOLS` still serves actual tools
- Diff data available for T11 evaluation

---

### Wave T10 — Bounded worker execution

**Goal:** Implement optional bounded worker for capabilities with
`ImplementationKind.WORKER` implementations where deterministic resolver
is insufficient.

**Contract already frozen in T2 (`capability.py`'s `ImplementationSpec`
docstring) — T10 must honor it, not redesign it:** `worker_id` carries
no allowlist field itself; it MUST resolve, via a `WorkerRegistry`, to a
`WorkerSpec` that carries an explicit primitive allowlist (model policy,
step budget, etc. also live there). A `worker_id` that resolves to no
such `WorkerSpec` makes that implementation UNAVAILABLE — never a
worker running with an implicit/unscoped toolset:

```
ImplementationSpec.worker_id
          ↓
     WorkerRegistry
          ↓
      WorkerSpec
   ├─ allowed_primitives
   ├─ model policy
   ├─ step budget
   └─ ...
```

Worker contract:
- Receives one `CapabilityRequest` and a scoped toolset (≤10 tools,
  from `WorkerSpec.allowed_primitives` — never an implicit/unscoped set)
- Has `CompletionSpec` from the manifest defining:
  - `max_steps` (REQUIRED hard step budget — see T2's revision)
  - `success_observations` (early-exit "done" signal, not a substitute
    for `max_steps`)
  - `failure_conditions` (early-exit "stop" signal)
- Does not hold canonical state
- May run several executions per request (one `ExecutionRecord` each —
  see T2's `CapabilityResult.executions`), not just one
- Output is normalized by Parser before AKG ingestion

Example: `exploit_unknown_service` spawns a bounded worker with
`bash`, `web_search`, and a few exploit primitives — but not the
full planner toolset. `CompletionSpec` limits it to 10 steps and defines
`authentication.success` as the success observation.

**Acceptance:**
- Worker capabilities dispatch to bounded workers
- Worker toolset scoped to capability requirements
- Worker terminates on `CompletionSpec` criteria (not open-ended)
- Worker output goes through standard normalization pipeline

---

### Wave T11 — Tool-selection + end-to-end evaluation

**Goal:** Measure whether the new architecture improves agent tool selection
accuracy compared to T0 baseline.

Four evaluation tiers:

| Tier | What | LLM needed? |
|------|------|:-----------:|
| **A — Registry correctness** | capability → resolution, availability, eligibility, phase filter | No |
| **B — Tool-selection** | Given scenario, does model pick correct capability and avoid irrelevant ones? | Yes |
| **C — Executor** | capability → correct adapter → expected command → normalized output | No |
| **D — End-to-end** | mission → planner → worker → capability → executor → observation → AKG → next decision | Yes |

Ablation configs:
- **A** — Current Raptix (static role tools, T0 baseline)
- **B** — Dynamic tool filtering (same current tools)
- **C** — Capability abstraction (dynamic semantic tools + mature executors)

Metrics (compare against T0 baseline):
- `selection_precision` — correct capability / all selected
- `capability_exposure_recall` — required capability exposed / all required
- `invalid_selection_rate` — forbidden/irrelevant selections
- `unnecessary_tool_calls` — calls that produce no value
- `bash_fallback_rate` — how often bash used instead of typed adapter
- `task_success_rate` — scenario completion
- `schema_tokens_per_turn` — token budget for tool schemas
- `discovery_latency` — time from need to capability exposure

Use `tests/fixtures/capabilities/held-out.jsonl` for final evaluation
(separate from dev scenarios used to tune tool schemas). Acceptance
thresholds were frozen in T0 before this evaluation.

**Acceptance:**
- Evaluation harness in `benchmarks/tool_eval/`
- Comparison against T0 baseline for all metrics
- No material decrease in `capability_exposure_recall` or `task_success_rate`
  (per thresholds frozen in T0)
- Document numeric results

---

### Wave T12 — Enable dynamic exposure

**Goal:** Switch from shadow mode to active dynamic exposure, gated on
T11 non-regression results.

Steps:
1. Verify T11 shows no material regression in capability recall or task success
2. Add feature flag: `RAPTIX_DYNAMIC_TOOL_EXPOSURE=shadow|active|off`
3. Gradual rollout per role (not all-at-once):
   ```
   recon → exploit → postexploit → AD specialists → analyst (last)
   ```
   Analyst last because its tool surface is largest and behavior change most significant.
4. Keep shadow-mode logging for ongoing monitoring alongside active filtering
5. Run held-out evaluation one more time with active filtering
6. Rollback = `active → shadow` (no code revert needed)

**Acceptance:**
- Dynamic exposure active, role by role
- T0 baseline metrics maintained or improved per role
- Monitoring in place for ongoing regression detection
- Feature flag allows instant rollback to shadow mode

---

### Wave T13 — Domain pluginization (physical move)

**Goal:** Move domain-specific tool implementations from `execution/tools/`
to their respective plugins. Only after T0–T12 stabilize.

```
execution/tools/ad/         → plugins/active-directory/capabilities/
execution/tools/cloud/      → plugins/cloud/capabilities/
execution/tools/contracts/  → plugins/contracts/capabilities/
execution/tools/defense/    → plugins/defense/capabilities/
execution/tools/reversing/  → plugins/reversing/capabilities/
```

Core `execution/tools/` retains only:
- `bash/` (frozen, guardrail)
- `browser/` (generic transport)
- `interaction/` (HITL)
- `mcp/` (generic bridge)
- `filesystem.py` (generic)
- `verification.py` (generic)
- `skills.py` (generic)

**Acceptance:**
- Plugins own their domain capabilities + adapters + parsers
- Core runtime knows only `Capability`, `ToolAdapter`, `Observation`, `Artifact`
- All existing tests pass through plugin discovery

---

## What NOT to custom-implement

Mature security tools already solve these — write adapters, not engines:

- Port/network scanner (nmap, masscan)
- HTTP fuzzer/directory brute-forcer (ffuf, gobuster)
- Vulnerability scanner (nuclei)
- SMB/Kerberos/NTLM client (impacket, netexec)
- ADCS enumerator (certipy)
- Credential dumper (impacket-secretsdump)
- Tunneling protocol (ligolo-ng, chisel)
- C2 (sliver)
- Binary decompiler (ghidra, radare2)
- Password cracker (hashcat, john)

## What to custom-implement (Raptix's value)

- Capability registry & resolver
- Availability / eligibility / authorization evaluators
- Phase-aware dynamic exposure
- AKG projection & attack-path reasoning
- Observation normalizer pipeline (ParserRegistry)
- State/provenance machinery
- Invocation guard (scope, RoE, approval, budget)
- Execution lifecycle & retry/recovery
- Artifact manager (stable cross-container references)
- Tool availability/health detection
- Skill selector integration
- Verifier framework
- Bounded worker orchestration with CompletionSpec

---

## Tool naming convention

Capabilities use logical namespaces for clarity:

```
knowledge.inspect_asset
knowledge.search
planning.find_paths

network.scan
network.enumerate_service

access.validate_credential
access.move_laterally

pivot.establish

operator.ask
operator.generate_report
```

Python function names may use underscores, but `CapabilityManifest.id` uses
dotted namespace. This prevents overlap/ambiguity as the catalog grows.

---

## Dependencies & risks

| Risk | Mitigation |
|------|-----------|
| Removing `@tool` breaks callers outside repo | Re-export shims; function stays importable, only removed from `*_TOOLS` lists |
| Dynamic exposure hides needed capability | Shadow mode first (T9); measure `capability_exposure_recall` (T11); recovery surface always available |
| Over-aggressive phase filtering | `phase_affinity` is soft ranking only; `allowed_phases` hard constraint used sparingly |
| Bash makes all capabilities falsely available | Bash explicitly excluded from availability; resolver never falls back to bash implicitly |
| Availability/eligibility/authorization conflated | Three separate evaluators with distinct responsibilities |
| Adapter architecture adds latency | Prove with existing binaries (T7) before adding new ones (T8) |
| New sandbox profiles increase image size | Separate Dockerfile stages, pulled only when profile is activated |
| Adapter bugs hide tool failures | Adapter produces ExecutionSpec only; never parses output or swallows errors |
| Evaluation overfits to dev scenarios | Use held-out fixtures; freeze thresholds before opening results |
| Worker becomes unbounded mini-agent | CompletionSpec defines success/failure/step budget; no open-ended workers |
| Capability contracts too rigid | `schema_version` field enables evolution |
| Telemetry leaks credentials | Never log raw parameter values; redact summaries only |

---

## PR budget

One semantic concern per PR. Behavior LOC ~400 preferred. Pure file moves,
generated files, fixtures, and parser format modules do not count toward
the soft file budget.

| Wave | Est. behavior LOC | Concern |
|------|------------------:|---------|
| T0 | ~100 | baseline telemetry |
| T1 | 0 (docs) | classification |
| T2 | ~150 | capability contracts |
| T3 | ~200 | parser registry |
| T4 | ~250 | KG consolidation |
| T5 | ~250 | ref + report + evidence |
| T6 | ~200 | capability catalog + availability + eligibility |
| T7 | ~350 | adapter layer (existing binaries) |
| T8 | ~50 (Dockerfile) | executor profiles |
| T9 | ~300 | dynamic exposure (shadow) |
| T10 | ~200 | bounded worker |
| T11 | ~300 | eval harness |
| T12 | ~80 | enable exposure (feature flag + rollout) |
| T13 | ~400 | domain pluginization |

---

## Success criteria

Numeric thresholds are **hypotheses to validate**. Thresholds are frozen
after T0 baseline variance estimation but **before** T11 held-out evaluation
results are opened (prevents post-hoc acceptance).

### Correctness
- Deterministic registry/parser/adapter tests: 100% pass
- No undeclared capability → executor resolution
- Every execution records capability → implementation → artifact →
  parser → observation provenance

### Capability honesty
- Every advertised capability has a declared healthy execution path
- Bash alone does not constitute a declared path
- Availability, eligibility, and authorization are evaluated by separate
  components with distinct responsibilities

### Selection (validate against T0 baseline)
- **Hypothesis H1:** reducing active surface to ~8–15 semantic tools
  improves selection accuracy without reducing task success
- **Hypothesis H2:** schema token cost decreases materially
- No material decrease in `capability_exposure_recall`

### Effectiveness
- No material task-success regression on held-out scenarios
- Bash fallback rate stable or decreasing

### Safety
- Authorization enforced at invocation time (invocation guard)
- Dynamic exposure is never the sole security control
- Recovery surface always available
- Telemetry never leaks credential/secret values

### Incalmo alignment
- Planner decides WHAT
- Worker (when needed) decides bounded HOW within CompletionSpec
- Adapter handles exact syntax
- Parser/Normalizer determines WHAT HAPPENED
- AKG records VERIFIED STATE
