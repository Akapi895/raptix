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

### Wave T5 — Reference + Reporting + Evidence cleanup ✅ DONE

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

**Outcome: references 15 → 3, reporting 6 → 1, evidence 4 → 4 (see fix
below); 21 functions demoted to internal services.** The agent-facing
reference surface is now `research_cve(query)` (every CVE id in the
query is resolved against the local PoC index), `search_security_references(
query, kinds=[], limit=5)` (one call fans out across the HackerOne /
one-liner / methodology / kill-chain corpora — the agent never picks
the corpus; external sections keep the `wrap_corpus` trust envelope),
and `lookup_payload(query, vuln_class="", limit=25)` (bundled + ingested
payload fan-out). Reporting collapsed into `generate_report(format,
...)` with formats `hackerone | bugcrowd_csv | executive | timeline |
sarif | bounty` — `format_bounty_report` was absorbed as the `bounty`
format per the T1 note that both renderers should merge. Evidence added
`inspect_evidence(finding_id)` (finding node + 1-hop linked nodes +
chain-of-custody verification + asciicast recordings) as a 4th tool
alongside the 3 capture/seal tools (see fix below) — `_verify_manifest`
is the shared internal both `verify_evidence` and `inspect_evidence` call.

**Fix (same regression shape as T3): `seal_evidence` /
`export_session_asciicast` / `list_session_recordings` restored to
`@tool` + `EVIDENCE_TOOLS`.** The first cut demoted all 4 evidence
functions, same as references/reporting, on the stated plan "automatic
in the ArtifactStore pipeline" — but that pipeline doesn't exist yet, so
removing their only caller (`@tool`) left nothing to ever invoke them.
Concretely: nothing wrote the chain-of-custody manifest anymore, so
`inspect_evidence`'s new `custody` field would always report "manifest
not found," and nothing captured asciicast recordings, so its
`recordings` field would always be empty — the new tool's own flagship
feature was dead on arrival. Restored exactly like T3's 5 holdouts:
`seal_evidence`/`export_session_asciicast`/`list_session_recordings`
keep `@tool` + `EVIDENCE_TOOLS` membership until a real automatic
pipeline lands to replace them. `verify_evidence` alone stays a plain
function — it IS reachable today via `inspect_evidence`'s
`_verify_manifest` call, so no fix needed there.

Demoted to plain functions (importable, no `@tool`, never-delete rule):
13 references services (`ref_list/suggest/topic/fetch/status/grep`,
`payload_search`, `payload_classes`, `cve_poc_lookup`, `h1_search`,
`oneliner_search`, `killchain_lookup`, `methodology_lookup`,
`references_hydrate`), the 5 `report_*` renderers, `verify_evidence`
(reachable via `inspect_evidence`), and `format_bounty_report`. The
corpus trust helpers moved to `references/corpus.py` (shared by the
semantic fan-out and the demoted services — no circular import).

Scope decisions worth remembering:

- `killchain_suggest` keeps its `@tool` — T1 pins it as a planner
  control-plane tool, not a reference lookup — but is deliberately OUT
  of `REFERENCES_TOOLS` (no agent carried it before the change either;
  planner wiring lands with the capability catalog, T6+).
- `UNTRUSTED_TOOL_NAMES` unchanged: the reference corpus tools were
  never quarantine-listed; they carry their own explicit
  `untrusted-external-corpus` envelope (now via `corpus.wrap_corpus`).
- `bounty_scope_check` stays `@tool` in `BOUNTY_TOOLS` (control-plane,
  per T1); `EVIDENCE_TOOLS = [inspect_evidence, seal_evidence,
  export_session_asciicast, list_session_recordings]` is wired to the
  verifier plugin and the analyst (operator lane); `REPORTING_TOOLS =
  [generate_report]` stays analyst-only — attack workers never see
  reporting or evidence surfaces.
- Role remap applied across 8 standard agents + the exploiter plugin
  (`cve_poc_lookup`→`research_cve`, `payload_search`→`lookup_payload`,
  `methodology_lookup`/`oneliner_search`/`killchain_lookup`→
  `search_security_references`) and 6 plugin bundles' `tool_names`
  (wireless, ics, phishing, active-directory, mobile, iot); phishing's
  `killchain_lookup` collapsed into the `killchain` section of
  `search_security_references`.
- Prompts updated in place: `analyst.md` (generate_report / semantic
  references / inspect_evidence), `exploit.md` CVE-research checklist,
  `raptix.md` skill tool-chain citation. Skills corpus references are
  deferred to the single T9 skills pass, same as T4.

Test surface: new `test_semantic_references.py` (fan-out, aliasing,
envelope trust, clamps); `test_tools_wrappers.py` /
`test_tools_new.py` converted to direct service calls;
`test_reporting_tools_and_executive.py` + `test_sarif.py` converted
plus a new `generate_report` dispatch matrix; `test_evidence_tools.py`
converted plus `inspect_evidence` projection/custody tests;
`test_reporting_tools_wired.py` re-pinned to the `generate_report`
contract; `test_bounty*.py` re-pinned to the 1-tool `BOUNTY_TOOLS`.
2,757 tests pass across the focused suites (references + reporting +
evidence + bounty 425, agents 192, tools 510, research + middleware
1,600). basedpyright 0 errors / 727 warnings (T4 baseline held).

**After the evidence fix:** `test_evidence_tools.py` and
`test_misc_tool_wrappers.py`'s `seal_evidence`/`export_session_asciicast`/
`list_session_recordings` call sites converted back to `.invoke({...})`
(they're `StructuredTool`s again); `test_misc_tool_wrappers.py`'s
`EVIDENCE_TOOLS == [inspect_evidence]` assertion — which had been
directly pinning the regression — updated to the 4-tool set. 106/106
pass across the targeted evidence + adapter suites post-fix.

---

### Wave T6 — Capability catalog + executor availability ✅ DONE

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

**Outcome: 12 manifests, a queryable registry, and separated
availability/eligibility evaluators under
`raptix/execution/capabilities/`.** `catalog.py` declares one
`CapabilityManifest` per T1-classified semantic capability (the 12
Target Capability IDs; `kg_surface_inventory` excluded per its own T1
note — T4's PlanningContext absorbed it). All twelve currently execute
as in-process deterministic callables, so each declares `ADAPTER`
implementations whose `executable` is a `"module:attr"` carrier path
(e.g. `raptix.execution.tools.web.search:web_search`) — T7 replaces
carriers with real adapters + binaries per entry, never renaming the
capability id. `analyst.fuzz_target` already demonstrates two
implementations under one capability.

- `registry.py` — `CapabilityRegistry` (get/contains/for_role/
  health_snapshot; duplicate-id rejection; no implicit fallback for
  unknown ids) + `health_check()` startup gate (UNAVAILABLE fails,
  PARTIAL passes).
- `availability.py` — `AvailabilityEvaluator` with three probe kinds
  and honest defaults: ADAPTER → PATH lookup for bare names, import
  probe for `module:attr` carriers (injectable); WORKER → resolves
  only through the supplied T10 `WorkerRegistry`-shaped callable,
  unavailable without one (the frozen T2 invariant); MCP/SERVICE →
  supplied executor probe or unavailable — never assumed. Aggregation:
  all healthy → AVAILABLE, some → PARTIAL, none/undeclared →
  UNAVAILABLE (bash is never an implicit path).
- `eligibility.py` — `EligibilityEvaluator`: role (empty `allowed_roles`
  = unrestricted), `allowed_phases` as the only hard constraint (left
  `None` across the initial catalog — used sparingly), and requirements
  via the runtime `RequirementEvaluator` protocol; with no evaluator
  registered, declared requirements count as UNMET (conservative).
  `phase_affinity` is never consulted here.
- `provenance.py` — `build_execution_provenance(tool_name, *,
  tool_version, adapter_version, parser_version, tool_data_version)` —
  the version-chain dict T7 adapters / T10 workers embed in execution
  metadata; version strings only, never raw parameter values.

Scope decisions worth remembering:

- Manifest `allowed_roles` use runtime role ids (blue_cell, patcher,
  scanner, analyst, osint_operator, exploit, recon); `research.web_*`
  declare `()` (unrestricted) matching their T1 "planner, worker:*"
  surface.
- Nothing consumes the registry yet by design — T7's resolver picks
  adapters by capability + availability, T9's exposure layers
  eligibility ranking on top. The wave is declarations + evaluation
  only; no tool surface change.
- `raptix/capabilities/` (pre-existing) is the skill-lane contract
  system — unrelated; the T6 package lives under `execution/` next to
  where T7's adapters land.

Test surface: new `tests/unit/capabilities/test_capability_registry.py`
— 44 deterministic tests (catalog coverage/uniqueness, real import
probes over every carrier, role/phase/requirement eligibility paths,
worker/MCP honesty defaults, aggregation, health snapshot, provenance
shape). ruff clean; basedpyright 0 errors / 727 warnings (baseline
held).

---

### Wave T7 — Adapter layer for EXISTING executors ✅ DONE

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

**Outcome: 8 binary-backed capabilities + 8 adapters + a no-fallback
resolver under `raptix/execution/adapters/`.** The plan's sketch
predates the T2 contract freeze — the shipped `ToolAdapter` protocol
takes `is_available() -> bool` and
`build_execution(request, *, implementation_id)` (there is no
`ExecutionContext` in the frozen contracts; the request carries its own
`context` mapping). All 7 binaries verified present in
`infra/containers/sandbox.Dockerfile` (nmap, subfinder, sqlmap, gobuster,
nikto, responder, python3-impacket).

- `base.py` — `ToolAdapter` protocol (class-level identity metadata) +
  `CommandAdapter` base: `payload = {"argv": [...]}` handed to the
  executor as a list, never a shell string; strict param validators
  (`str/int/bool/list/url/domain/artifact-name`) with
  `AdapterParameterError`; **unknown request parameters are ignored** —
  there is no raw-args escape hatch, a planner cannot smuggle flags.
  **Fix (hardening, not a regression):** a review found `str_param`
  only rejected whitespace/control characters, not a leading `-` — a
  bare positional value (e.g. `target`) starting with `-` could be
  misread by the binary's own argument parser as a flag rather than a
  value (argument injection; no shell is invoked, so not command
  injection). `str_param`/`str_list_param` now reject a leading `-` by
  default, with an explicit `allow_leading_dash=True` opt-out for a
  future adapter that genuinely needs one (none of the current 8 do).
- 7 adapter modules, one capability each (impacket module serves two):
  `network.scan`→nmap (fixed `-sT/-sS/-sU` mapping, port-list charset,
  `-oX` artifact), `network.discover_subdomains`→subfinder (`-json -o`
  JSONL), `web.test_injection`→sqlmap (`--batch` always on, level/risk
  bounds, technique charset), `web.fuzz_paths`→gobuster (`dir` mode,
  wordlist param defaulting to the dirb common list), `web.scan_web`→
  nikto (`-Format txt` pinned), `access.move_laterally`→impacket
  psexec/wmiexec/atexec (principal built from validated parts; all
  wrappers ship in one apt package so probing one probes the package),
  `access.credential_dump`→impacket-secretsdump, and
  `network.capture_ntlm`→responder (analyze mode `-A` by default,
  poisoning only on explicit `poison=True`).
- `resolver.py` — `AdapterResolver`: registry lookup → availability →
  first healthy implementation with a registered adapter, copying the
  resolved `ImplementationSpec.id` into `ExecutionSpec.implementation_id`
  (frozen T2 contract). Unknown id → registry's
  `UnknownCapabilityError`; unavailable or no registered adapter →
  `AdapterResolutionError` — **no bash fallback anywhere**; a test
  asserts bash appears in no adapter id/executable and the resolver
  never fabricates a spec.
- `catalog.py` — the 8 T7 manifests join the 12 T6 ones (registry is
  now 20): one `ADAPTER` impl each, bare binary name (PATH probe),
  `profile="base"`, `adapter_id` matching the adapter class. Risk
  honesty: `web.test_injection`/`access.move_laterally`/
  `network.capture_ntlm` HIGH, `access.credential_dump` CRITICAL;
  impacket capabilities declare the `credential.available` AKG
  requirement (unmet until the runtime evaluator is wired — the
  conservative T2 default).
- Expected artifact formats pin the T3 parser ids where parsers exist
  (`nmap_xml`, `subfinder`, `gobuster`); formats without parsers yet
  (`sqlmap_log`, `nikto_txt`, `impacket_txt`, `responder_log`) are
  declared anyway so parsing surfaces a hard `UnknownFormatError`
  naming the missing parser — never a silent skip (T8 closes the gap).

Test surface: new `tests/unit/adapters/test_adapters.py` — 40
deterministic tests (protocol conformance + adapter-id↔catalog match,
per-adapter argv matrices incl. rejection paths, no-passthrough
smuggling, resolver dispatch/PARTIAL selection/hard errors, binary
missing/present snapshot honesty, no-bash-fallback, and the
request → spec → fake executor → artifact → `ParserRegistry` →
observation end-to-end). `test_capability_registry.py` re-pinned to
the 20-manifest catalog (T1 set ∪ T7 set, base-profile declaration,
import-probe restricted to `module:attr` carriers, health gate with
injected probes). 82/82 tests pass. ruff clean; basedpyright 0 errors
/ 727 warnings (baseline held, zero new warnings in the adapter
package).

**After the leading-dash fix:** 3 new tests in `test_adapters.py` —
`NmapAdapter` rejects `target="--script=evil"`, `str_list_param` rejects
a dash-prefixed entry, and the `allow_leading_dash=True` opt-out is
proven to still work. 106/106 pass across the targeted evidence +
adapter suites post-fix (combined with the T5 evidence fix above).

---

### Wave T8 — Add missing sandbox executor profiles ✅ DONE

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

**Outcome: three opt-in build-arg profiles in `sandbox.Dockerfile` +
compose passthrough + build-time version manifests.** The plan's "separate
Dockerfile stages or sidecar services" resolved to the image's own
precedent: `INSTALL_REVERSING`-style build args (`INSTALL_WEB_TOOLS`,
`INSTALL_AD_TOOLS`, `INSTALL_PIVOT_TOOLS`, all default `false`) — stages
would fork the base image and sidecars are useless for CLI binaries the
agent execs inside its own sandbox container. All 9 kali-rolling package
names verified against `pkg.kali.org` before landing (incl. ligolo-ng
0.9.1, migrated 2026-08 — the Dockerfile's old "needs a GitHub release"
deferred note was stale and is updated).

- `sandbox-web` (`INSTALL_WEB_TOOLS=true`): httpx-toolkit, katana, ffuf,
  nuclei, testssl.sh. `sandbox-ad` (`INSTALL_AD_TOOLS=true`): netexec
  (nxc — the CrackMapExec rename; output format the T3 `crackmapexec`
  parser already reads), certipy-ad, evil-winrm. `sandbox-pivot`
  (`INSTALL_PIVOT_TOOLS=true`): ligolo-ng.
- `docker-compose.yml` `sandbox` service passes the three args through
  from `.env` (default off) so `docker compose build sandbox` opts in;
  `INSTALL_REVERSING` is deliberately NOT passed — the reversing toolset
  stays sidecar-scoped (ghidra-mcp). `.env.example` documents the knobs.
- Version provenance: each profile writes
  `/opt/raptix/tool-versions/<profile>.tsv` (dpkg name + version via
  `dpkg-query -W`) at build time — the version strings T6's
  `build_execution_provenance` consumes once executors/adapters for
  these binaries embed provenance. Nuclei's template corpus is NOT in
  the apt package; its manifest row records `runtime-fetched
  (nuclei -update)` instead of pinning a corpus the image does not ship.

Honesty notes (deviations from the acceptance wording, deliberate):

- **No catalog flip.** "Capabilities previously UNAVAILABLE become
  AVAILABLE" holds at the inventory level, not the T6 registry: T1
  classified the related ingest functions as internal services and
  assigned these binaries NO semantic capability ids, so there is no
  manifest to flip — and per the frozen bash-honesty rule the resolver
  must not claim capabilities for binaries without declared adapter/worker
  paths. The drift T8 closes is skill-corpus ↔ binary (recon/
  active-recon, exploit/web/\*, ad/netexec, ad/certipy-esc-chain,
  post-exploit/lateral-movement all teach these commands) plus
  parser ↔ binary. Capability manifests/adapters for these binaries are
  future waves, if warranted at all.
- **Parser gap not fully closed.** `dnsx`/`masscan` parsers still have no
  binary — they are not in the plan's T8 table and were not added
  (staying close to the frozen plan); they remain honestly
  UNAVAILABLE/parses-only.
- **Release pipeline** still builds the base image only; profile images
  are local-build opt-ins for now.

Test surface: new `tests/unit/execution/test_sandbox_tool_profiles.py`
— 10 deterministic drift-guard tests (ARG defaults opt-in, exact package
sets per the plan table, per-profile version manifests, nuclei
runtime-fetched row, compose passthrough defaults + REVERSING
exclusion, and a catalog cross-check that no
`ImplementationSpec.profile` names a profile the image cannot provide).
10/10 pass. ruff clean; basedpyright clean on the new file (0/0/0).

---

### Wave T9 — Dynamic exposure — SHADOW MODE ✅ DONE

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

**Outcome: a shadow-mode exposure module under
`raptix/intelligence/tooling/` (the plan's named path — new package) +
a logging-only hook in `build_tools()`.** Opt-in via
`RAPTIX_EXPOSURE_SHADOW=1` — zero cost when off, mirroring T0's
`RAPTIX_TOOL_TELEMETRY` pattern. Nothing is enforced; T12 validates
non-regression before any filtering goes live.

- `exposure.py` — `resolve_active_tools(...)` composes the T6
  evaluators: `EligibilityEvaluator` (role → hard `allowed_phases` →
  requirements) then `AvailabilityEvaluator` (UNAVAILABLE filters;
  PARTIAL keeps). `phase_affinity` only re-ranks the proposed order
  (stable sort by bonus, original order within equal rank) — it never
  excludes. Returns `ExposureResult(proposed_tools, current_tools,
  filtered_out, reason_map)` — frozen tuples instead of the sketch's
  lists.
- `GraphSnapshot` — caller-computed requirement answers (requirement id
  → satisfied), NOT a live graph handle: the exposure module never
  queries the AKG itself (the frozen T2 no-query rule); an id absent
  from the mapping counts as unmet (the conservative T6 default).
- Recovery surface — `RECOVERY_TOOL_NAMES` pins the plan's five names
  plus the runtime spelling `ask_user_question` (the sketch predates
  the tool inventory; `inspect_context`/`diagnose_execution` have no
  runtime tools yet but inherit the guarantee by name). Recovery tools
  are kept before any capability verdict is consulted.
- Tool↔capability join — the catalog's in-process carriers
  (`"module:attr"`) resolve to tool names via `importlib` (cached by
  `sys.modules`; these modules are already imported by agent assembly).
  The T7 binary capabilities contribute no agent tool (bare binary
  names) and therefore never enter the filter.
- Shadow hook — `build_tools()` calls `record_exposure_shadow(role,
  result)` right after T0's `record_tool_exposure`: never raises, never
  mutates, logs one `exposure_shadow` JSON record (current vs proposed
  names, filtered entries with reasons, counts) — the T11 diff data.
  `summarize_exposure_result` is the pure, shared summary shape (also
  consumable directly by T11 evaluation scripts).
- Deviations from the sketch, deliberate: `resolve_active_tools` takes
  the caller's current tool list (the sketch omitted where
  `ExposureResult.current_tools` comes from); `phase` is the UKC slug
  and is `None` in the build-time hook (no phase exists yet at agent
  assembly — the hook logs the assembly-time diff; phase-aware diffs
  are caller-supplied via the parameter).

Test surface: new `tests/unit/tooling/test_exposure.py` — 15
deterministic tests (unmapped tools always proposed, recovery
guarantee beats an ineligible verdict, role/phase/requirement/
availability filter paths each with a reason, affinity ranking vs the
hard `allowed_phases` constraint, `available_executors` probe override
keeping PARTIAL, summarize shape with no parameter values, env gating,
the hook never raising while the direct call raises loudly, and the
`build_tools` static-list contract with shadow on — the same patching
pattern the T0 telemetry test pins). 15/15 pass; the T0/agents suites
(`test_tool_exposure`, `test_build`) re-ran green (51/51) after the
`build.py` hook landed. ruff clean; basedpyright 0 errors / 0 warnings
on the new module.

---

### Wave T10 — Bounded worker execution ✅ DONE

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

**Outcome: `WorkerSpec`/`WorkerRegistry` + `BoundedWorkerRunner` under
`raptix/execution/workers/`, plus the plan's own example capability in
the catalog (`exploit.unknown_service`).**

- `spec.py` — honors the frozen T2 invariant verbatim instead of
  redesigning it: a `WORKER` `ImplementationSpec` carries only
  `worker_id`; the scoped-toolset allowlist lives on `WorkerSpec`
  (`allowed_primitives`, capped at the plan's ≤10 via
  `MAX_WORKER_PRIMITIVES`), plus the plan's other policy fields
  (`model_policy`, narrowing-only `step_budget`, `description`).
  `worker_id` resolves through `WorkerRegistry` or the implementation
  is UNAVAILABLE — `resolves` doubles as the T6
  `AvailabilityEvaluator` check callable, never an unscoped toolset.
  Duplicate `worker_id` registration is rejected, mirroring
  `CapabilityRegistry`.
- `runner.py` — `BoundedWorkerRunner` dispatches one request for the
  resolvable WORKER implementation and runs the bounded loop:
  - toolset resolved up-front from exactly `allowed_primitives`
    (all-or-nothing — a missing primitive refuses the start), and a
    planner step naming a non-allowed primitive fails closed (worker
    stops, step never executes);
  - `CompletionSpec.max_steps` is the hard bound; `WorkerSpec.step_budget`
    may only narrow it (`min()`); `success_observations` /
    `failure_conditions` are early-exit signals matched against the
    observation kinds each step produces; a planner yielding `None`
    before any success observation counts as incomplete, never success;
  - every executed step becomes one `ExecutionRecord` (T2's
    `CapabilityResult.executions`) with `implementation_id` copied from
    the resolved `ImplementationSpec`;
  - a step artifact flows through the T3 `ParserRegistry` — the
    standard normalization pipeline — before its observations enter the
    result; a parse failure is recorded on that step's record and the
    worker continues, never a silent skip;
  - the planner is an injected `WorkerPlanner` protocol (`next_step`
    returns the next `WorkerStep` or `None`): the real LLM-backed
    planner plugs in without reshaping the loop, and the deterministic
    tests drive a scripted one. Eligibility/authorization are
    deliberately NOT evaluated here — they stay the separate state
    and invocation-time guards.
- `catalog.py` — adds `exploit.unknown_service`, the plan's T10
  example, verbatim: single `WORKER` implementation
  (`exploit_worker`), `CompletionSpec(max_steps=10,
  success_observations=("authentication.success",))`, HIGH risk,
  `parallel_safe=False`, exploit-role only. It is honestly UNAVAILABLE
  (and the default startup `health_check` gate fails) until a
  deployment wires a `WorkerRegistry` resolving `exploit_worker` —
  the gate test now injects a worker registry alongside the PATH
  probe, and a new test pins the without-a-registry gate rejection.

Test surface: new `tests/unit/workers/test_workers.py` — 25
deterministic tests (no LLM, no network; scripted planners, fake
resolvers, and the real `ParserRegistry` over canned nmap XML):
registry round-trip/duplicate/validation, the frozen T2
unregistered-worker-is-UNAVAILABLE invariant end to end through the T6
evaluator, dispatch, allowlist-scoped toolset, fail-closed primitives,
hard-budget/success/failure termination, parse-failure continuation,
per-step provenance, and two catalog-truth tests driving the real
`exploit.unknown_service` manifest through the runner.
`test_capability_registry.py` re-pins the 21-manifest catalog with a
`T10_CAPABILITIES` set, the
worker-implementation-pins-bounded-completion shape, and the
with/without-worker-registry health-gate pair. 149 tests pass across
the affected suites (workers, capabilities, adapters, sandbox tool
profiles, exposure); ruff clean; basedpyright 0 errors / 0 warnings /
0 notes on the new modules.

---

### Wave T11 — Tool-selection + end-to-end evaluation ✅ DONE

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

**Outcome: a pre-registered, deterministic-first evaluation harness under
`benchmarks/tool_eval/` (`scenarios.py` + `metrics.py` + `thresholds.py`
+ `evaluate.py` + `__main__.py`, entry `python -m benchmarks.tool_eval`),
scenario corpora at `packages/raptix-core/tests/fixtures/capabilities/`
(`dev.jsonl` 6 scenarios, `held-out.jsonl` 4), frozen thresholds, and
the two evidence reports (`benchmarks/results/tool-eval/report-2026-10-07-{dev,held-out}.json`).**

- **Pre-registration discipline held.** Fixtures were authored first,
  thresholds frozen second (`thresholds.py`, `FROZEN_AT = 2026-10-07`,
  derivation basis = T0 variance only — the T0a/T0b captures are
  deterministic per commit, so the only variance source is the
  availability probe; a 0.05 margin absorbs a single probe flake),
  evaluation ran third. The held-out corpus was opened only after the
  freeze, and one gate genuinely failed on it (below) — reported
  un-relaxed, which is the discipline working as designed.
- **Tiers A and C are deterministic and computed, not asserted:**
  Tier A checks every scenario's capability expectations against the
  real T6 evaluators (role, hard phases, AKG requirement answers from
  `graph_state`, executor probes from the scenario's declared
  inventory — never PATH); Tier C drives the real chain request →
  `AdapterResolver` → `ExecutionSpec` → canned artifact → T3
  `ParserRegistry` → observations, asserting argv heads, observation
  kinds, and the declared hard-error paths (an undeclared executor →
  `AdapterResolutionError`, never bash fallback; `impacket_txt` with no
  parser → `UnknownFormatError`, never a silent skip). Numeric results:
  **Tier A pass_rate = 1.000 (7 + 8 expectations), Tier C pass_rate =
  1.000 (4 + 1 cases) on dev and held-out respectively.**
- **Tiers B and D report PENDING, never fabricated.** Tier B is a
  `SelectionPolicy` protocol scored by the five selection metrics; the
  bundled `ScriptedSelectionPolicy` (policies carry an explicit
  `live` flag) replays each scenario's declared `expected_selection`
  and is labeled "scripted (pipeline validation only)" in every report
  — its numbers measure the scoring plumbing. A live-LLM policy plugs
  into the same protocol without reshaping the harness. Tier D needs
  the live stack and is recorded as `pending_live_run: true`.
- **Exposure comparison (the LLM-free ablation), numeric results:**
  config A = pinned T0b surfaces; config B = T9's
  `resolve_active_tools` over config A; config C = today's static
  surface completed with every eligible catalog capability tool, plus
  T0b middleware names. Dev: A recall_min = 0.000 (the T0 surface
  predates `detect_tech_stack`/`research_cve`/`lookup_payload`/
  `generate_report` — the T4/T5 gap quantified), B = A (filtering
  structurally cannot add), **C recall_min = 1.000, forbidden = 0,
  task-success proxy = 1.000, latency_max = 5**. Held-out: A/B/C
  recall_min all = 1.000, forbidden = 0, proxy = 1.000; **C
  latency_max = 6 → the frozen `DISCOVERY_LATENCY_MAX = 5` gate
  FAILS** — `research.web_fetch` declares no `phase_affinity`, so
  ranking never promotes it past position 6. Threshold left frozen;
  the finding feeds T12 (ranking needs affinity data for unrestricted
  capabilities). Non-regression (every scenario: recall(B,C) ≥
  recall(A) − 0.05) holds on both corpora.
- **H2 (schema-token reduction) is NOT validated on the static layer,
  reported honestly:** config C's measured static schema chars
  (14,947–43,256 across roles) exceed config A's T0a static numbers
  (9,555–31,498) — today's semantic tools carry richer schemas, and C
  deliberately trades schema tokens for capability coverage (recall
  0.5 → 1.0 on dev). The hypothesis remains open for the live tiers,
  where per-turn surfaces (not the static layer) are the object.
- **Wiring gap surfaced by the harness (not fixed here, one concern
  per wave):** the catalog declares `recon.detect_tech_stack`, but no
  standard role's static surface carries the tool — config C reaches
  recall 1.0 exactly because the capability-abstraction surface is
  catalog-driven. Wiring it into recon's static list is a T12+ change.
- **Loader strictness:** pydantic `extra="forbid"`, cross-field
  set-overlap rejection (required ∩ forbidden/optional,
  forbidden ∩ optional, expected_selection ∩ forbidden), duplicate
  scenario-id rejection, unknown expectation-value rejection — a
  typo'd fixture fails loudly instead of silently skewing metrics.
  32 deterministic tests in
  `packages/raptix/tests/unit/benchmark/test_tool_eval.py`; ruff
  clean; basedpyright 0 errors / 1 warning on the new package.

---

### Wave T12 — Enable dynamic exposure ✅ DONE

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

**Outcome: a three-mode flag (`RAPTIX_DYNAMIC_TOOL_EXPOSURE=shadow|active|off`,
default `off`) with a stage-gated role rollout in
`raptix/intelligence/tooling/exposure.py` + the `build_tools()` hook in
`raptix/intelligence/agents/build.py`.** Default behavior is unchanged:
`off` does nothing at all — no logging, no filtering — so the previous
zero-cost property holds.

- **Mode resolution** — `resolve_exposure_mode(role)` returns
  `ExposureMode(mode, role_active)`: `off` (default, and the fail-safe
  for ANY unrecognized value), `shadow` (log-only — the T9 behavior and
  the rollback target), `active` (serve the filtered set, but ONLY for
  roles inside the rollout stage). The T9 legacy
  `RAPTIX_EXPOSURE_SHADOW=1` keeps working as an alias for `shadow`.
- **Rollout** — `ROLLOUT_ORDER = (recon, exploit, postexploit,
  ad_operator, analyst)` per the plan, gated by
  `RAPTIX_EXPOSURE_ROLLOUT_STAGE` (default 0 = no roles; stage N serves
  the first N; non-integer/negative fails safe to 0). `ad_operator` is
  served through the plugin path today, so its entry stays inert until
  that path adopts the flag — the order still encodes the plan's
  sequence, and analyst is last (largest surface).
- **`active_exposure_tools(role, tools)`** — never raises and never
  returns an empty toolset: any resolution failure or empty proposal
  falls back to the caller's list unchanged. Dynamic exposure remains a
  UX optimization, never a security control; recovery-surface and
  no-exclusion guarantees come from the T9 resolver unchanged.
- **Monitoring stays on** — `record_exposure_shadow` now logs in every
  non-`off` mode (either env var enables it), so active mode keeps
  producing the T11 diff record; in active mode the served set IS the
  record's proposed set.
- **Rollback** — `active → shadow` is exactly one env-var value change,
  pinned by a test that flips the flag mid-flight and re-builds.
- **Held-out re-run (step 5):** the harness's config-B rows ARE the
  active-mode computation (the same `resolve_active_tools` the runtime
  calls) — the regenerated
  `benchmarks/results/tool-eval/report-2026-10-07-held-out.json` shows
  non-regression holding (recall(B) = recall(A) = 1.000, forbidden = 0,
  success proxy = 1.000) with the one pre-registered miss still open:
  `DISCOVERY_LATENCY_MAX = 5` fails at 6 for unrestricted capabilities
  that carry no `phase_affinity` (T11's documented finding — threshold
  left frozen, ranking improvement deferred to the live-tier work).
- **Deliberate scope line:** activation here means the runtime MECHANISM
  exists and is flag-gated; no deployment in this repo flips it on by
  default. Staged enablement (raising `ROLLOUT_STAGE` per environment)
  is an operator decision informed by the T11 evidence, not a code
  change.

Test surface: `tests/unit/tooling/test_exposure.py` extended to 42
deterministic tests — mode resolution (default/invalid/legacy-alias/
stage matrix incl. negative and non-integer stages), `active_exposure_tools`
(filter path, never-empty fallback, resolution-failure fallback), and
the `build_tools` integration against the REAL catalog (off serves
static, pre-stage serves static, in-stage serves filtered with the
real `blue_cell_scan` capability removed for exploit, recovery surface
survives, shadow logging persists alongside active, rollback flips
back, and the new var alone enables the monitoring record). The
T0/agents suites re-ran green (93/93 across `test_build`,
`test_tool_exposure`, `test_exposure`). ruff clean; basedpyright
0 errors / 0 warnings / 0 notes on both touched modules.

---

### Wave T13 — Domain pluginization (physical move) ✅ DONE

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

**Outcome: the plugin ownership the sketch assumed was already largely in
place (ADR-0038 — plugins own definitions, prompts, and offline
analyzers via `raptix_{domain}` packages); T13 closed the remaining
physical gaps by moving the three pure-stdlib domain modules still
sitting in core, with re-export shims everywhere.** New plugin pack:
`plugins/defense` (`raptix_defense`).

- **Moved (git mv, history preserved, canonical homes now in plugins):**
  - `execution/tools/reversing/ghidra.py` →
    `plugins/reversing/raptix_reversing/ghidra.py` (the Ghidra/r2 recon
    bridge — stdlib only);
  - `execution/tools/ad/bhce_client.py` →
    `plugins/active-directory/raptix_active_directory/bhce_client.py`
    (the BloodHound CE REST client; `httpx` now declared in that
    plugin's deps — already in the environment, declaration-only);
  - `execution/tools/defense/{conops,edr,elastic,sentinel,splunk}.py` →
    `plugins/defense/raptix_defense/` (CONOPS resolution + the
    SIEM/EDR detection builders — all stdlib).
- **Shims** at every historical path re-export the full surface —
  public names AND the private helpers tests reach (`_load_conops` via
  direct import, `_GHIDRA_FUNC_KEYS`, `_YARA_*` patterns) — so the
  never-delete rule holds and every old import keeps working. Runtime
  consumers and the moved-code tests were repointed to the canonical
  plugin imports; no string-form `mock.patch` targets referenced the
  moved modules, so no patch target silently missed.
- **Deliberately NOT moved, with reasons:**
  - the `@tool` wrapper layers (`ad/tools.py`, `ad/bh_tools.py`,
    `cloud/tools.py`, `contracts/tools.py`, `reversing/tools.py`,
    `defense/tools.py`) — they are the runtime's LangChain adapter
    surface; plugins import stdlib + SDK/core only, so wrappers
    structurally stay in the runtime (same tier as
    `execution/adapters/`);
  - the KG-integrated ingest/post modules (`ad/bloodhound.py`,
    `ad/adcs_post.py`, `contracts/slither.py`) — they depend on the
    runtime `KGStore`; making them plugin-owned is a T3-style
    Observation[] refactor (behavior change), not a physical move;
  - `defense/blue_cell.py` + `defense/brief.py` — the blue_cell
    detection loop is the runtime's Offensive Vaccine machinery
    (`raptix.blue_cell` + engagement state), not domain analysis;
    AGENTS.md's plugin roster deliberately excludes defense.
  - `cloud/` and `contracts/` had nothing left to move — their
    analyzers were already plugin-owned; the dirs are wrappers only.
- **`plugins/defense`**: library pack (stdlib + raptix-sdk dep, wheel
  config, no bundle entry points — the defense agent is the runtime's
  `blue_cell`; entry points land if/when defense gets its own
  subagent). Declared as a workspace member (`plugins/*`) and as a
  `raptix` dependency, matching the other eleven domain packs; `uv.lock`
  updated.
- **Lint config:** TID251's per-file-ignores (the banned-api scope)
  gained `"plugins/**"` — the rule targets raptix-core's
  langchain/httpx-free guarantee; plugin packs are the same legitimate
  user category as apps/benchmarks.

Test surface: new `packages/raptix/tests/unit/tools/test_domain_pluginization.py`
— 6 drift guards (shim identity for all three move groups, private-name
reachability through shims, defense-plugin workspace membership +
runtime dependency declaration, and a no-runtime-imports scan over
every moved module). 1,040 tests pass across the affected suites
(tools, ad, reversing, blue_cell, agents); `uv sync --dev` installs the
new pack; ruff clean; basedpyright 0 errors on the new/moved modules.

**Fix (boundary honesty + encoding repair, both caught in review):**
two real defects shipped in the first cut.

- *The plugin boundary was violated by 5 of the 6 moves.*
  `plugins/tests/test_domain_packs.py` enforces "plugin packs import
  stdlib + SDK/core only", and the SIEM/EDR detection pushers
  (`edr`/`elastic`/`sentinel`/`splunk` — nested `import requests`) and
  the BHCE REST client (`bhce_client` — `import httpx`) are HTTP
  executors, not offline analyzers. They moved back to the runtime
  (`raptix.execution.tools.{defense,ad}.*` are again canonical, shims
  deleted), `requests` is now a declared runtime dep, the
  active-directory plugin's `httpx` declaration is dropped, and the
  defense plugin keeps exactly what is genuinely offline — CONOPS
  resolution — with its metadata saying so. The first cut's "all
  stdlib" claim about the defense builders was simply wrong, and the
  boundary guard (which the first cut never ran) now passes.
- *The move session corrupted Unicode.* cp1252-mojibake was baked into
  comments/docstrings of ~10 files (including `raptix.md`, corrupted
  already in T5) and a UTF-8 BOM into several test modules; all
  reversed losslessly (git-history restore + cp1252→utf-8 inversion),
  and a repo-wide signature scan is clean outside one intentional
  `U+FFFD` assertion in `test_http_branches.py`.

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
