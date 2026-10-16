# Generic, safety-aware fan-out admission — implementation guide

- **Date:** 2026-10-16
- **Status:** implementation guide (pre-ADR; the Proposed ADR is step 0 below)
- **Related:** `docs/design/2026-10-12-p4-system-optimization-research.md`, ADR-0021 (bounded fan-out), ADR-0026 (concurrent-batch budget), ADR-0067 (dispatch concurrency ceiling), ADR-0075 (challenge inventory), `docs/exploitation-effectiveness-diagnosis-2026-10-15.md`
- **Problem this solves:** fan-out decisions today are (a) web/scoreboard-shaped in the prompt and (b) blind in code (`DispatchMiddleware` only counts concurrent slots). AD and network work must not be fanned out on that basis — concurrent AD actions can trip lockout policies, and parallel network scans can wedge fragile services. The goal is ONE generic admission mechanism where **domain knowledge supplies declarative facts** and **code decides**, with no per-domain code paths.

---

## 0. Design in one picture

```
FACTS            PROPOSAL                              ADMISSION (code, deterministic)
(skill metadata) (orchestrator prompt/OPPLAN)          (DispatchMiddleware + policy)
      |                    |                                    |
  "AD kerberoast     decompose objective into            admit/queue per work unit by:
   touches account,  work units; annotate each           deps · resource overlap ·
   parallel_safe=    with deps/resources/effects/        effect class · noise budget ·
   false; lockout    noise/parallel_safe                  resilience cap · ceiling
   risk"                    |                                    |
      \____________________ | ___________________________________/
                           v
              accepted: task(...) dispatched (≤ ceiling)
              rejected: structured reason to the orchestrator, logged
```

**Invariants (non-negotiable):**
1. No `if domain == "ad"` (or any domain branch) in scheduler code.
2. Domain facts live only in skill metadata and engagement plan files.
3. Every parallel admission passes through the one policy gate; the global ceiling stays as the final bound, never the only control.
4. `unknown` metadata ⇒ conservative (serialize mutating work).
5. Only metadata that code actually reads may be added to the skill schema (the skill-schema doc explicitly penalises "aspirational" metadata).

---

## 1. Data model — `packages/raptix-core/raptix_core/types/engagement.py`

`Objective` (class at L427) already carries `opsec: OpsecLevel`, `opsec_notes`, `c2_tier`, `concessions: list[str]`, `blocked_by: list[str]`, `parent_id`. Add three fields + two enums. Keep them optional so every existing plan stays valid.

```python
class EffectClass(StrEnum):
    READ = "read"            # observation only; concurrency-safe by default
    MUTATE = "mutate"        # changes state (account, policy, resource, data)
    DESTRUCTIVE = "destructive"  # availability / irreversible; RoE-final-phase only

class NoiseLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class Objective(BaseModel):
    ...
    effects: EffectClass = Field(
        default=EffectClass.MUTATE,
        description="Blast-radius class; drives fan-out admission (README: unknown ⇒ mutate)",
    )
    resources: list[str] = Field(
        default_factory=list,
        description="Shared mutable resources touched, e.g. account:svc, host:10.0.0.5, policy:GPO-x",
    )
    parallel_safe: bool | None = Field(
        default=None,
        description="true=skill declares safe to run concurrently; false=must serialize; None=unknown",
    )
```
Use the existing `opsec` level (L55 `OpsecLevel`) as the per-objective noise posture; do not add a second noise axis at objective level — `resources` carries "what", `opsec` carries "how loud". (`NoiseLevel` above is only needed if you later want per-skill noise declarations; if so, map it in the policy.)

**Why fields, not free text:** the admission gate must read machine-readable values; `opsec_notes` stays human prose. This is a **core public API change** → update `packages/raptix-core/tests/test_public_api_stability.py` manifest/count and `CHANGELOG.md` in the same PR.

Round-trip requirements: `Objective` must serialize/deserialize with the new fields; OPPLAN persistence (`/workspace/plan/opplan.json`) keeps working (unknown fields already flow through pydantic, but assert it in a test).

---

## 2. Producer side — where annotations come from

Two producers, both already exist; they must populate the new fields.

### 2.1 Deterministic registries (web cells, challenge cells)
- `packages/raptix/raptix/intelligence/agents/standard/_surface_registry.py`
  - `VulnClassSpec` (L16) gains `effects: EffectClass` and `resources_template` per class (e.g. `sqli`/`xss` read-only probes → `READ`; `authz` write checks → `MUTATE`; `ssrf` to internal services → `MUTATE`).
  - `build_coverage_matrix` (L296) writes the metadata into each cell dict; `build_objective_expand_payload` (L330) carries it into the child dict.
- `packages/raptix/raptix/intelligence/agents/standard/_challenge_registry.py`
  - `build_challenge_cells` sets `effects=READ` by default (challenges are scored by harmless trigger where possible) **except** categories whose skill profile declares otherwise; the gated availability family (`roe_gated`) ⇒ `effects=DESTRUCTIVE`.

### 2.2 `objective_expand` plumbing
- `packages/raptix/raptix/execution/tools/plumbing/opplan.py` (tool at L1308 → `_objective_expand_impl`)
  - Accept `effects`, `resources`, `parallel_safe` in each child dict; validate enum values; persist.
  - Same for `add_objective`.
  - Update the tool docstrings so the LLM knows the fields exist.
- `packages/raptix/raptix/orchestration/mission/opplan.py`
  - Objective rendering (the table at ~L272 already prints `OPSEC: …`) should also render `effects`/`resources` so the orchestrator sees them when re-reading the plan.

### 2.3 Skill metadata (the domain-facts source)
Add an optional block to skill front-matter (schema in `docs/skill-schema.md`; parser in `packages/raptix/raptix/skills/audit/frontmatter.py`):

```yaml
metadata:
  fanout:
    effects: mutate            # read | mutate | destructive
    resources: ["account:*"]   # templates; * = the concrete target of this work unit
    parallel_safe: false       # false | true  (omit ⇒ unknown)
    fragile_target: true       # optional; caps per-target concurrency
    notes: "concurrent kinit/relay attempts can trip the lockout policy"
```

Examples (data only, never code):
- `standard/ad/kerberoasting/SKILL.md` → `effects: read` at the DC but `resources: ["account:*"]`, `parallel_safe: false` (lockout/noise).
- `standard/ad/ntlm-relay/SKILL.md` → `effects: mutate`, `parallel_safe: false`.
- `standard/ad/dcsync/SKILL.md` → `effects: destructive`.
- `standard/cloud/aws-iam-passrole-chain/SKILL.md` → `effects: mutate`, `resources: ["policy:*"]`.
- `standard/network/*` scanners → `effects: read`, `fragile_target: true` for embedded/single-threaded devices.

**Audit rule:** extend `packages/raptix/raptix/skills/audit/rules.py` to validate the block (enums, list types) and add it to `docs/skill-schema.md`. **Only ship this after the policy reads it** (step 4) — otherwise it is dead metadata, which the schema doc explicitly rejects.

---

## 3. The policy — new module `packages/raptix/raptix/middleware/fanout_admission.py`

Pure, deterministic, no I/O, no domain names. Single public function + a small state helper.

```python
@dataclass(frozen=True)
class WorkUnit:
    dispatch_id: str
    objective_id: str
    role: str
    effects: EffectClass
    resources: frozenset[str]      # concrete, after template expansion
    parallel_safe: bool | None
    opsec: OpsecLevel

@dataclass(frozen=True)
class AdmissionDecision:
    admitted: bool
    code: str            # "admitted" | "resource_conflict" | "effect_conflict"
                         # | "opsec_conflict" | "capacity_exceeded" | "fragile_cap"
    detail: str
    blocking: tuple[str, ...]   # ids of in-flight units it conflicts with

def decide(
    candidate: WorkUnit,
    in_flight: Sequence[WorkUnit],
    *,
    ceilings: Ceilings,      # global_max, per_target_max, engagement_opsec
    resilient: dict[str, bool],  # target -> observed-stable?
) -> AdmissionDecision: ...
```

**Algorithm (the whole generic rule):**

1. If `candidate.effects is DESTRUCTIVE` → admitted only if `ceilings.allow_destructive` (set by the mission's sanctioned availability phase) **and** no other unit is in flight. Code `effect_conflict` otherwise.
2. If `candidate.effects is READ` → skip resource checks (reads may overlap), but still apply noise/resilience/ceilings (steps 4–6).
3. If `candidate.effects is MUTATE` → reject when **any** in-flight unit shares a resource (`resource_conflict`, list blocking ids); additionally reject when either side is `parallel_safe is False` (`effect_conflict`).
4. `opsec`: reject when the candidate's level is louder than a stricter in-flight unit's (HIGH + anything stricter than STANDARD, …) or when the engagement OPSEC tier forbids concurrent high-noise work (`opsec_conflict`). Map `OpsecLevel` → ordering here; keep the table tiny and explicit.
5. Resilience: for each target in `candidate.resources`, when `resilient[target] is False` (observed fragile) or the skill declared `fragile_target` → cap that target's in-flight units at `ceilings.per_target_max` (default 1) → `fragile_cap`.
6. Capacity (the existing behaviour, kept as the outer bound): `len(in_flight) >= ceilings.global_max` → `capacity_exceeded`.

`parallel_safe is None` ⇒ treated as `False` for MUTATE steps (3), `True` for READ (step 2). That is the "unknown ⇒ conservative" invariant.

**Test the rule, not the domains.** Fixtures live in the test file as AD/network/web-shaped `WorkUnit`s; the policy module itself must contain no `"ad"`, `"kerberos"`, `"aws"` strings — assert that in a test (mirrors the registry-objectivity test in `test_challenge_registry.py`).

---

## 4. Wiring — `packages/raptix/raptix/middleware/dispatch.py`

`DispatchMiddleware._prepare` (L146) is the single admission point for every `task()`. Replace the blind capacity branch (L207–214) with a policy call; keep the structured-reply style (`_reply(runtime, code, detail)` at L120) so the orchestrator gets a machine-readable reason.

```python
# inside _prepare, after the ledger/identity checks, while holding self._lock:
candidate = _work_unit_for(runtime, objective_id, role)   # reads objective from state
decision = fanout_admission.decide(
    candidate,
    self._in_flight_units(scope),          # derived from self._active + a side map
    ceilings=self._ceilings,               # from env/RoE (see below)
    resilient=self._resilience.get(scope, {}),
)
if not decision.admitted:
    return _reply(runtime, f"dispatch_{decision.code}", decision.detail)
self._active.add(key); self._active_units[key] = candidate
```

Notes:
- Keep an `_active_units: dict[key, WorkUnit]` next to `_active` so admission can inspect in-flight metadata.
- `_work_unit_for` reads the objective from `runtime.state["objectives"]` (already available — L156 uses the same source) and expands skill resource templates (`account:*` → concrete target from the objective's `target_value`/notes).
- Ceilings: `global_max` = existing `RAPTIX_MAX_CONCURRENT_DISPATCHES` (default 3); `per_target_max` = new `RAPTIX_MAX_CONCURRENT_PER_TARGET` (default 1); `allow_destructive` = set when the mission's RoE prose declares the sanctioned final phase (mirror how `raptix.md` already keys off conops prose; do **not** hardcode a target).
- Telemetry: emit one `event_logging` record per decision (`dispatch_admission` with code, blocking ids, candidate objective) so admission is auditable and measurable. Rejections already surface to the LLM as tool replies — keep them terse and instructive ("wait for OBJ-012 to finish; it mutates account:svc_web").
- Feature flag for rollout: `RAPTIX_FANOUT_ADMISSION` (default `0` = old blind-ceiling behaviour) so the change can land before being switched on. When off, behaviour is byte-for-byte today's.

---

## 5. Progressive widening (generalises the hardcoded fragility list)

Today `_surface_registry.FRAGILE_UNDER_CONCURRENCY = frozenset({"werkzeug"})` hardcodes one web stack. Generic replacement:

- Engagement state gains `fanout_resilience: dict[str, bool]` (target → observed-stable), **excluded from the LLM input schema** (same pattern OPPLAN uses for internal state).
- Update rule (in the policy or a small middleware): start each new target at `per_target_max=1`; after N consecutive clean rounds (no dispatch failure, no latency spike, no reset) mark `True` and allow `global_max`; on a failure/reset on that target, mark `False` and drop to 1 for a cooldown.
- The old `werkzeug` constant becomes a **seed**: on an observed tech stack matching a fragile-seed table, start at 1 (keep the table short, evidence-anchored, as the current comment demands).
- This keeps the property you care about: cautious entry into unknown AD/network targets, widening only on observed stability.

---

## 6. Prompt — `packages/raptix/raptix/intelligence/prompts/standard/raptix.md`

Add ONE generic section (keep the existing web/scoreboard specifics as *candidate sources*, not as the mechanism):

```markdown
**Decomposition & dispatch scheduling (all domains)**: before dispatching, split the
current objective into work units with a bounded scope. For each unit, record on the
objective: `effects` (read/mutate/destructive), `resources` (the shared mutable things it
touches), and `parallel_safe` — sourced from the cited skill's `metadata.fanout` block when
the skill declares one; otherwise leave it unset. Dependencies go in `blocked_by`.

Then dispatch the ready, independent set up to the concurrency ceiling. The runtime's
admission gate is authoritative: if a dispatch is rejected with `resource_conflict`,
`effect_conflict`, `opsec_conflict`, `fragile_cap` or `capacity_exceeded`, do NOT retry the
same intent — finish the blocking unit(s), then retry. Unset `parallel_safe` means
"unknown": mutating work is serialized. Destructive/availability work runs only in a
mission-sanctioned final phase and always alone.

Sources of candidate units are interchangeable: the surface coverage matrix, the challenge
scoreboard inventory, router-skill classification, or your own objective breakdown. The
scheduling rules above are identical for every domain (web, AD, cloud, network, …).
```

Placement: Section B, after "First-dispatch is recon" and before the coverage-matrix trigger. The web/scoreboard paragraphs stay as-is; add one line to each noting that their children must carry the metadata fields.

---

## 7. RoE / OPSEC integration

- `middleware/roe.py` already exposes `evaluate_command`, `evaluate_target`, `evaluate_time_window`. The admission policy should treat the RoE-derived engagement OPSEC tier as `ceilings.engagement_opsec` (source: the mission's `plan/roe.json` prose + `OpsecLevel` on objectives — do not invent a new config surface).
- `sanctioned_availability_tests.phase == final-only` in `plan/roe.json` is what flips `ceilings.allow_destructive`. Reuse the existing "conops names it" pattern already used for the win-condition oracle.

---

## 8. Phased implementation (PR-sized, per QUALITY_BAR: ≤400 runtime lines, ≤10 files each)

| PR | Scope | Files | Tests |
|---|---|---|---|
| **0** | Proposed ADR-0076 "Generic fan-out admission" | `docs/adr/0076-*.md` | — |
| **1** | Core types: `EffectClass`, `Objective.effects/resources/parallel_safe` | `raptix_core/types/engagement.py`, `test_public_api_stability.py` manifest, `CHANGELOG.md` | round-trip + plan persistence |
| **2** | Policy module (pure) | `middleware/fanout_admission.py` (new) | multi-domain unit fixtures; no-domain-strings assertion; decision matrix table |
| **3** | Dispatch wiring + telemetry + flag | `middleware/dispatch.py`, `middleware/event_logging.py` (event kind) | reject codes; flag-off == legacy behaviour; concurrency unchanged when all `read` |
| **4** | Producers: registries + `objective_expand`/`add_objective` fields | `_surface_registry.py`, `_challenge_registry.py`, `execution/tools/plumbing/opplan.py`, `orchestration/mission/opplan.py` | children carry fields; rendering shows them |
| **5** | Skill metadata contract + audit + schema doc | `skills/audit/rules.py`, `docs/skill-schema.md`, a handful of representative skills (AD/network/web) | audit strict passes; policy consumes declared facts |
| **6** | Progressive widening + resilience state | `middleware/fanout_admission.py` or new `fanout_resilience.py`, state schema | start-at-1 → widen after clean rounds → drop on failure |
| **7** | Prompt section | `raptix.md` | prompt-contract test if the repo has one for prompt rules |

Gate for every PR: `make ci-lint` on changed paths, `uv run pytest` on the touched unit trees, and (PR 3+) a regression test proving **no decision change while `RAPTIX_FANOUT_ADMISSION=0`**.

---

## 9. Verification — objective, minimal, and cross-domain

1. **Unit (no lab):** admission decision matrix — for each (effects × resource overlap × parallel_safe × opsec × ceiling) tuple, assert the same code path yields the expected decision. Fixtures are data, not domains; the module must contain no domain string.
2. **Integration (fake subagents):** register two dummy `SUBAGENT_SPEC`s whose objectives mutate the same `account:*` resource; assert the second `task()` is rejected with `resource_conflict`, then admitted after the first finishes. Repeat with distinct resources → both admitted (proves parallelism is data-driven, not domain-driven).
3. **Web regression:** re-run the juice-shop fan-out path (surface + challenge cells) with the policy ON at `global_max=3` and all cells `effects=read` → identical throughput/decision counts to today.
4. **AD lab (GOAD or equivalent, later):** run one objective that requires ≥2 auth-mutating actions; assert they are serialized (`parallel_safe=false` from the AD skills), and assert zero lockouts attributable to concurrency. Record the admission log.
5. **Network lab (later):** scan two fragile hosts; assert `per_target_max=1` and that the resilience state widened only after clean rounds.
6. **Acceptance metrics:** admission-decision log shows (a) no `resource_conflict` between read-only units, (b) 100% serialisation for `parallel_safe=false`, (c) widening only after ≥N clean rounds, (d) identical web throughput. Store as a short evidence note under `docs/design/` or `tests/local/artifacts/`.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LLM omits annotations → everything "unknown" | Defaults are conservative and correct (mutating serialized); no correctness loss, only less parallelism. Prompt + tool docstrings teach the fields; admission log shows how often they are used. |
| Skill metadata added but never read (aspirational) | Ship the policy first (PR 2–3), schema/audit after (PR 5); schema doc already forbids dead metadata. |
| Over-serialisation kills web throughput | READ skips resource checks; web cells are mostly `read`; PR 3 regression test pins throughput. |
| Domain leakage into code | Unit test asserts the policy module contains no domain tokens; review checklist item. |
| Breaking existing engagements/plans | All fields optional with safe defaults; flag off = today's behaviour; plan round-trip test. |
| Destructive work sneaking through | `DESTRUCTIVE` requires `allow_destructive` (mission prose) **and** an empty in-flight set. |

---

## 11. Definition of done

- ADR-0076 accepted; core fields shipped with manifest/CHANGELOG updates.
- One policy module, no domain branches, covered by the decision-matrix tests and the no-domain-strings test.
- `DispatchMiddleware` rejects with the new, instructive codes; `RAPTIX_FANOUT_ADMISSION=0` reproduces legacy behaviour exactly.
- Skill `metadata.fanout` validated by the strict audit and consumed by the policy; schema doc updated.
- Prompt section shipped; web regression green; AD/network labs produce the admission evidence with no concurrency-caused lockouts/wedges.
