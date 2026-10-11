# State ownership inventory

- **Date:** 2026-10-11
- **Scope:** `packages/raptix/raptix/` runtime state only (not `apps/*`).
- **Origin:** `docs/structure-review.md` §5, priority P0 ("Inventory các
  nguồn state hiện có — biết chỗ nào trùng lặp, thiếu dữ liệu"), the one P0
  item [ADR-0049](adr/0049-evidence-model-extends-capability-contract.md)
  left open. Feeds Principle 1 ("one owner per state") and gates any future
  P1 work (evidence contract, provenance linking) on knowing what already
  exists.

This is a survey, not a decision. Where it finds two modules that look like
they own the same thing, it says so and defers the call on what to do about
it — consolidating would be its own ADR with its own evidence.

## State concepts and their current owner

| # | State concept | Owner | Mechanism | Lifecycle | Consumers |
|---|---|---|---|---|---|
| 1 | Mission / objective tracking | `orchestration/mission/opplan.py` (`OPPLANMiddleware`) | in-memory + checkpointed `AgentState` | per-engagement | planner, `DispatchMiddleware` |
| 2 | Engagement context (name, workspace, benchmark mode) | `orchestration/mission/engagement.py` (`EngagementContextMiddleware`) | state channel, hydrated from `config.configurable` | per-engagement | OPPLAN, filesystem, prompt injection |
| 3 | Dispatch-local objective attribution | `orchestration/mission/objective_context.py` (`ObjectiveContextState.active_objective_id`) | langgraph state channel, converging reducer | per-dispatch | `DispatchMiddleware` |
| 4 | UKC phase | `orchestration/phases/` (`UKCPhase`, `PhaseStateMachine`) | shadow-mode runtime state (ADR-0037) | per-engagement | none by design (shadow) |
| 5 | Semantic engagement graph (host/service/cred/session/finding/vuln/…) | `knowledge/graph/` + Neo4j (`NodeKind`/`EdgeKind`) | graph, engagement-scoped | per-engagement | agents via `kg_record`, reporting tools, `defense/blue_cell.py` |
| 6 | Derived "what can I reach" projection | `knowledge/graph/operational_state.py` (`build_operational_state`) | bounded, read-only KG projection | per-call | "opt-in planner experiment" (own docstring) |
| 7 | Normalized tool execution output | `raptix_core/types/capability.py` (`Observation`, `Artifact`) | frozen dataclass contract | per-execution | capability-layer migration (Parser/Normalizer → Verifier/AKG, T2 GO) |
| 8 | Capability catalog / availability / eligibility | `capabilities/{catalog,registry,availability,eligibility,health,resources,tool_versions,inventory}.py` | in-process registry + manifests | process lifetime | capability resolver (in-flight migration) |
| 9 | Execution provenance (tool/adapter/parser/tool-data version chain) | `capabilities/provenance.py` (`build_execution_provenance`) | plain dict embedded in execution metadata | per-execution | T7 adapters, T10 workers |
| 10 | Attempt/failure ledger ("tried edges") | `middleware/tried_edges.py` → `Candidate`+`MAPS_TO` (ADR-0014) | bounded, opt-in KG ledger | per-engagement, per-role | injected back into the same role's system prompt |
| 11 | Dispatch dedup/fingerprint/attempt-count | `middleware/dispatch.py` (`DispatchContext`) | in-memory, per-run | per-run | `DispatchMiddleware` itself |
| 12 | RoE decision audit | `middleware/_audit_sink.py` (`RoEAuditSink`) | HMAC-chained append-only JSONL, local file | per-engagement | compliance / out-brief, never read back by the agent |
| 13 | Crash-resume event log | `execution/session/event_log.py` (`events.jsonl`) | append-only, cross-platform file-locked | per-engagement | future `--resume` CLI (not yet end-to-end per its own docstring) |
| 14 | Full-fidelity record/replay | `execution/session/recording.py` | append-only JSONL, env-gated (`RECORD` slot) | per-run | benchmark/lab bisection, CI determinism |
| 15 | Specialist capability evidence validation | `specialist_contracts/evidence.py` (`validate_evidence`, `EvidenceValidation`) | pure function, positive-proof-vs-negative-control pattern match | per-evaluation | `specialist_contracts/scorecards.py` |
| 16 | Specialist capability scorecards | `specialist_contracts/scorecards.py` (`EvaluationRecord`, `LaneScorecard`) | aggregated records | per held-out evaluation run | benchmark reporting |
| 17 | Skill corpus graph (Skillogy) | `middleware/skillogy.py` + skill engine server | separate Neo4j-backed graph (Skill/Phase/Technique/Tool) | long-lived, not per-engagement | `find_skill`/`load_skill`/`traverse` tools |
| 18 | Continuous-replay engagement snapshot | `execution/session/cart.py` (`EngagementSnapshot`, `Watcher`) | stable hashable snapshot | aspirational — not wired into the main dispatch/KG flow yet | future CART loop only |

## Overlaps and near-duplicates found

**A. "Evidence" names four unrelated things.** Besides the two ADR-0049
already flagged —  `capability.Observation`/`Artifact` (#7, normalized tool
output) and the KG's `Candidate`/`Hypothesis`/`Finding` (#5, graph claims) —
this pass found a **third and fourth**: `specialist_contracts/evidence.py`'s
`EvidenceValidation` (#15, offline benchmark certification via
positive-proof-vs-negative-control regex matching) and its consumer
`scorecards.py` (#16). #15/#16 are a different lifecycle (certifying a
specialist capability against a held-out benchmark, not verifying a live
engagement hypothesis), so this is not the same duplication risk ADR-0049
flagged for #7 vs the epistemic-core doc's proposal. But if an Evidence
contract is ever scoped per ADR-0049 decision 2, **`validate_evidence`'s
positive/negative-control pattern is the existing, tested mechanism for
"supported vs. contradicted" that `structure-review.md`'s own example
(§4, the `verification_contract` YAML) and the epistemic-core doc's
Evidence Assessment step both want** — reuse it rather than inventing a
second verification technique.

**B. "Provenance" names three unrelated things, at three layers, none
redundant but easy to conflate.** KG provenance fields (`created_by`,
`source_episode_id`, `firstseen`, `lastupdated`, auto-injected per `kg_record`
call) answer "which agent/episode wrote this fact." `capabilities/
provenance.py` (#9) answers "which tool/adapter/parser/tool-data *version*
produced this observation." `RoEAuditSink` (#12) answers "what RoE decision
was made and when, tamper-evident." A future contributor reaching for
"provenance" should check which of these three questions they're actually
answering before adding a fourth.

**C. Three independent append-only-JSONL-with-locking implementations**
(#12 `RoEAuditSink`, #13 `event_log.py`, #14 `recording.py`), each with a
different guarantee (HMAC chain vs. crash-safe resume vs. replay-hash
lookup) and a different consumer. Not a bug — the guarantees genuinely
differ — but a fourth bespoke implementation should not appear without
checking these three first.

**D. Two attempt ledgers at two different scopes** (#10 `tried_edges`,
per-engagement/per-role, cross-run; #11 `DispatchMiddleware`'s dedup
ledger, per-run, per-objective). Different enough in scope to both be
legitimate today. Anyone building the Exploration Planner that ADR-0049
decision 5 defers should read both before adding a third "have I tried
this" mechanism.

**E. #6 (`build_operational_state`) is the existing seed of the "planning
projection" both `graph-recommendation.md` and the epistemic-core document
propose building from scratch.** It is explicitly scoped as "an opt-in
planner experiment" that "never infers liveness or a usable foothold" — a
bounded, read-only KG→projection step already exists. If ADR-0049 decision
5's evidence bar is ever met, this is the extension point, not a green
field.

**F. Capability Availability/Eligibility (#8) and OPPLAN objective tracking
(#1) answer different questions and are correctly separate** — "can this
technically run" vs. "should this run now for this objective" — matching
the three-way Availability/Eligibility/Authorization split `CLAUDE.md`
documents. Noted here only so the two are not mistaken for the same state.

## What this does not cover

`apps/*` (CLI/web/launcher state), the Docker/compose layer, and
plugin-contributed state outside `packages/raptix/raptix/` were out of
scope for this pass. `execution/adapters/`, `execution/workers/`, and
`execution/backends/` were not individually inventoried — they are
execution-path code, not state owners, per this doc's scope.

## How this feeds P1

`structure-review.md`'s P1 ("Evidence contract tối thiểu" + "Provenance
linking") should now be scoped against rows 5, 7, 9, 12, 15 together, not
against #7 alone as ADR-0049 decision 2 originally implied. Concretely: a
provenance chain from a reported `Finding` (#5) back to the `Observation`/
`Artifact` that supports it (#7) and the tool-version chain that produced it
(#9) does not exist end-to-end yet — that is the gap worth scoping next, not
a new node type.
