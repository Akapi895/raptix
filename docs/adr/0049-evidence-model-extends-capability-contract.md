# 0049. Evidence modeling extends the capability-layer Observation contract; AKG redesign and Exploration Planner are deferred

- **Status:** Proposed
- **Date:** 2026-10-11
- **Related:** `docs/graph-recommendation.md` (source discussion, largely superseded —
  see Context), `docs/design/2026-10-11-exploitation-reasoning-epistemic-core.md`
  (source discussion), `docs/structure-review.md` (source discussion), ADR-0014
  (observational tried-edge ledger), ADR-0037 (UKC phase is runtime state),
  ADR-0040 (mission context ownership), ADR-0041 (middleware cross-cutting only),
  `packages/raptix-core/raptix_core/types/capability.py`,
  `docs/tool-optimization-implementation-plan.md`,
  `docs/architecture/state-ownership-inventory.md` (P0 state inventory,
  added 2026-10-11 as a follow-up to this ADR — found a third and fourth
  "Evidence"-shaped concept this ADR did not account for),
  `packages/raptix/raptix/knowledge/ingest/materialize.py`,
  `packages/raptix/raptix/knowledge/ingest/registry.py`,
  `packages/raptix/tests/unit/knowledge/ingest/test_materialize.py` (P1
  provenance-linking fix, added 2026-10-11, finding 9 / decision 7)

## Context

Three informal discussion documents proposed overlapping changes to Raptix's
knowledge representation and planning architecture: `graph-recommendation.md`
(redesign the Attack Knowledge Graph around a smaller canonical schema plus a
separate planning-projection layer), the epistemic-core design note (formalize
a Hypothesis → Action → Observation → Evidence → VerifiedFact model
independent of planning policy, rolled out as three PRs), and
`structure-review.md` (a review arguing most of the above is premature).

None of the three cross-checked their claims against the live repo, and
`graph-recommendation.md` predates the W16–W18 restructuring (ADR-0040,
ADR-0041; both 2026-10-06) that resolved its central complaint. We verified
each document's claims against the current code (2026-10-11):

1. **`graph-recommendation.md` §25's complaint is moot.** It argues graph
   logic is trapped under `middleware/kg_internal/` and should move to
   `knowledge/graph/`. ADR-0041 already did the equivalent move for
   engagement/opplan state; `knowledge/graph/` already holds `store.py`,
   `ingest.py`, `migration_runner.py`, `summary.py`, `operational_state.py`,
   `ai_surface.py`, `tools.py`. `middleware/kg.py` + `kg_autoingest.py` are
   the thin adapters. No `kg_internal/` package exists.
2. **The AKG schema-collapse proposal (`graph-recommendation.md` §4–§6) would
   be a regression.** `raptix_core/types/kg.py`'s `NodeKind` already carries
   ~45 specific labels (Host, Network, Domain, Service, URL, CloudResource,
   Container, User, Group, Credential, Secret, Session, Vulnerability, CVE,
   Misconfiguration, Weakness, Candidate, Hypothesis, Finding,
   DetectionFired, DefenseAction, 13 AD-specific labels, …) — the richer
   schema that document's own later section argues is *better* than its
   proposed 11-node collapse. The repo already sits on the side of that
   internal argument the document ultimately favored.
3. **UKC phase is confirmed shadow-mode-only.** ADR-0037 (`Proposed`) and a
   corpus grep (`ukc_phases`: 0 matches across
   `packages/raptix-skills/raptix_skills/defs`) confirm the epistemic-core
   document's claim exactly.
4. **The capability layer already defines `Observation`/`Artifact` as frozen
   contract types**, and neither source document accounts for this.
   `raptix_core/types/capability.py` defines `Artifact` (id, artifact_ref,
   sha256, producer, metadata) and `Observation` (kind, data,
   source_artifact_id, parser_id, confidence) as part of the capability-layer
   migration (`docs/tool-optimization-implementation-plan.md`: T0/T1 FROZEN,
   T2 GO). The epistemic-core document's "Evidence contract v0" proposes a
   second, independent `Observation` concept. Implemented as written, this
   creates the exact "duplicated canonical state" failure mode
   `structure-review.md`'s own Principle 1 ("one owner per state") warns
   against — a problem `structure-review.md` did not itself catch, because it
   checked the proposal against KG node kinds only, not the capability layer.
5. **Reusing existing KG node kinds (`structure-review.md`'s recommendation)
   is confirmed sound.** `Candidate`, `Hypothesis`, `Finding`, `Session`
   already exist in `NodeKind`.
6. **RoE enforcement across the `task()` delegation path is already
   structurally guaranteed — finding 6 as originally written (below) was
   wrong, caught while scoping decision 3's implementation.** The original
   claim was that `test_roe.py`'s >100 cases exercise only direct tool-call
   interception and that the delegation path was unverified. Tracing the
   actual assembly chain shows otherwise: `MiddlewareSlot.ROE_GUARDRAIL` is
   part of `_BASE_SLOTS` in `raptix_core/contracts/slots.py`, which every
   entry in `SLOTS_PER_ROLE` is built from (`_BASE_SLOTS | {...}` or
   `_BASH_AGENT_SLOTS | {...}`, itself `_BASE_SLOTS`-derived) — there is no
   role that can omit it without a bespoke frozenset. Every
   `standard/<role>.py:graph` module (`recon.py`, `exploit.py`,
   `postexploit.py`, `analyst.py`, … — checked all 11 files that call
   `build_middleware`) calls it uniformly as
   `build_middleware(role=_ROLE, ...)`. `build.py`'s `_check_safety_gate`
   raises `SafetyOverrideViolation` if any override tries to disable or
   replace the `ROE_GUARDRAIL` slot without `RAPTIX_ALLOW_SAFETY_OVERRIDES=1`.
   And `test_roe.py::TestSlotRegistration::test_slot_is_in_enum_and_safety_critical`
   already asserts, for every role in `SLOTS_PER_ROLE`, that
   `MiddlewareSlot.ROE_GUARDRAIL in slots` — which is every subagent role
   dispatched via `task()`, since each one is a `standard/<role>.py:graph`
   built the same way as the orchestrator. There is no untested execution
   path here. (The RoE guardrail is also explicitly documented as
   defense-in-depth, not the sole gate — `middleware/roe.py`'s module
   docstring: the authoritative boundary is sandbox network egress,
   compiled from the same `machine_enforcement` rules, so a command the
   parser misses still cannot reach the network. The guardrail additionally
   blocks the *local* side effect before egress is even reached.)
7. **No typed `Finding` lifecycle enum exists, but there is also no current
   consumer that needs one — finding 7 as originally scoped (adding a
   `candidate`/`validated`/`verified`/`reported` enum) does not clear
   `structure-review.md`'s own Principle 5 ("prove the need for
   abstraction").** `knowledge/graph/migrations/V002__...cypher` already
   indexes `Finding.status` (`engagement_finding_status`), and
   `intelligence/prompts/standard/analyst.md` already documents one
   convention value (`props.status = "confirmed"`). But `kg_record`
   (`knowledge/graph/tools.py`) is an intentionally generic, schema-free
   write surface — `props` is arbitrary JSON, validated only for reserved
   provenance keys — and a repo-wide check of every `execution/tools/
   reporting/*.py` renderer (`sarif.py`, `hackerone.py`, `bugcrowd.py`,
   `executive.py`, `cvss.py`) found zero reads of `Finding.status`: nothing
   downstream branches on it today. Introducing a 4-value enum now would
   mean either (a) validating against a vocabulary that conflicts with the
   one value every analyst prompt already documents, breaking existing
   agent behavior for no downstream consumer, or (b) adding a vocabulary
   nothing reads — the "abstraction with no consumer" `structure-review.md`
   itself warns against. `graph-recommendation.md` §14's proposal is sound
   *in form* (status as a property, not three node types) but has no
   evidenced need yet.
8. **`middleware/tried_edges.py`'s reuse of the `Candidate` label is already
   an ADR'd decision, not an oversight.** ADR-0014 explicitly chose to store
   tried-edge ledger entries on a `MAPS_TO` relationship between two
   `Candidate` nodes, distinguished by `tried_ledger=true` and reserved
   `tried::` keys, specifically "to reuse existing schema without making a
   failure edge traversable by the attack-chain planner." This was initially
   flagged as a schema smell during this review; re-reading ADR-0014 showed
   it is intentional and already justified. No action needed here.
9. **A real provenance-linking gap, found while scoping
   `docs/architecture/state-ownership-inventory.md`'s P1 follow-up.**
   `knowledge/ingest/registry.py`'s `ParserRegistry._run` already stamps
   every `Observation` with `source_artifact_id` and `parser_id` (via
   `_stamp`) for the live Wave-T3 auto-ingest path
   (`middleware/kg_autoingest.py` → `subfinder`/`dnsx`/`ffuf`/`masscan`/
   `gobuster`). But `knowledge/ingest/materialize.py`'s two materializers —
   `apply_observations` (in-memory `KnowledgeGraph`) and
   `observations_to_records` (`KGStore.record_observations`, the real
   write path) — both discarded `source_artifact_id`/`parser_id` before
   the KG node was written: `apply_observations` only read
   `data.get("props")`, and `observations_to_records` returned
   `dict(observation.data, kind=observation.kind)`, neither of which
   touches the `Observation` dataclass's own provenance fields. This is
   not the legacy pre-T3 `knowledge/graph/ingest.py` adapter path
   (nmap/httpx/nuclei/katana/arjun) — that path never constructs
   `Observation` instances at all and is out of scope here.
10. **The remaining provenance leg (`Artifact` → tool/adapter/parser-version
    chain) cannot be closed yet — its own prerequisite does not exist in
    any production code path.** `capabilities/provenance.py`'s own
    docstring names its intended caller as "the T7 adapters / T10
    workers." Traced both: `execution/adapters/*.py` (`CommandAdapter`
    and every subclass — nmap, sqlmap, gobuster, nuclei, nikto, subfinder,
    snmpwalk, john, slither, netexec, impacket, responder,
    bloodhound_collect) only build an `ExecutionSpec` — by design, per
    `base.py`'s module docstring, an adapter "never executes, never
    parses output"; none constructs an `Artifact`.
    `execution/workers/runner.py` (Wave T10, marked `✅ DONE` in
    `docs/tool-optimization-implementation-plan.md`) only *receives* an
    `Artifact` on `PrimitiveOutcome.artifact` — `artifact_content=` (the
    paired raw bytes field) has zero assignments anywhere in
    `packages/raptix/raptix/` outside the dataclass's own default
    (`b""`), and the module's own docstring says "the real LLM-backed
    planner plugs in later... the deterministic tests inject a scripted
    one." T10 "done" means the bounded-worker loop and contract are
    built and tested with injected doubles, not that a live sandbox
    execution produces a real `Artifact` anywhere today. A repo-wide
    grep for `Artifact(` construction (excluding tests) finds exactly one
    production site: `execution/tools/research/ingest_services.py` —
    which `provenance.py` does not name as its caller, and which (like
    `kg_autoingest.py`) has zero downstream readers of a tool-version
    field, the same "no consumer" trap findings 6 and 7 already hit
    twice. Wiring provenance into either real `Artifact` construction
    site would mean using `capabilities/provenance.py` outside its
    documented scope to populate a field nothing reads — not completing
    decision 7, but repeating the mistake decision 7 corrected.

## Decision

1. **Do not redesign the AKG schema.** Keep the current `NodeKind`/`EdgeKind`
   taxonomy in `raptix_core/types/kg.py`. `graph-recommendation.md`'s
   schema-collapse proposal is rejected as a regression relative to the
   repo's current state (finding 2). Its organizational complaint (finding 1)
   is already resolved and needs no further action.

2. **Do not build a second Action/Evidence/Observation node model.** Future
   evidence/epistemic work (epistemic-core document, PR2) must be specified
   as an *extension* of `raptix_core.types.capability.Observation`/`Artifact`
   — e.g. additional fields, or a `Hypothesis`/`VerifiedFact` wrapper that
   references existing `Observation` instances by id — never a parallel type
   with the same name or role. A genuine gap in `capability.Observation`
   (e.g. no confidence-propagation path for multi-observation corroboration)
   is fixed on that frozen contract itself, with the
   `test_public_api_stability.py` manifest/count update and CHANGELOG entry
   the frozen-contract process already requires — not via a new module.
   `docs/architecture/state-ownership-inventory.md` §A additionally found
   `specialist_contracts/evidence.py`'s `validate_evidence` — reuse its
   positive-proof-vs-negative-control verification technique for the
   "supported vs. contradicted" step rather than inventing a second one.

3. **No RoE test-coverage PR.** Finding 6 shows the delegation path is
   already covered by `test_roe.py::TestSlotRegistration` plus the
   `_BASE_SLOTS`/`_check_safety_gate` structural guarantee. Closed, no
   action.

4. **No `Finding.status` enum PR, for now.** Finding 7 shows there is no
   current consumer and the proposed vocabulary would conflict with the one
   value already documented in `analyst.md`. Revisit only when a concrete
   consumer appears — e.g. a reporting renderer that needs to filter
   `Finding` by lifecycle stage, or a triage workflow that needs more than
   one boolean. At that point, design the vocabulary from that consumer's
   actual need, not from `graph-recommendation.md` §14's unvalidated
   four-value guess.

5. **Defer, pending evidence from (3):** an Exploration Planner, an
   AttackState planning-projection layer, Action/Evidence as first-class
   graph nodes, frontier/best-first search, Information-Gain utility
   scoring, and graph-driven phase gating. None of these may be scoped into a
   PR until a trace, benchmark, or decision-harness run (epistemic-core
   document §8) shows OPPLAN, `DispatchMiddleware`, and the capability
   layer's existing `Observation` model are insufficient for a concrete,
   named failure case. This restates `structure-review.md`'s P3/P4 gating,
   now grounded in the fact that the primitives these proposals would
   duplicate already exist and are unproven-insufficient, not merely
   not-yet-built.

6. **No change to `middleware/tried_edges.py`.** Finding 8 shows its
   `Candidate`-label reuse is deliberate and already governed by ADR-0014.

7. **Implemented: propagate `source_artifact_id`/`parser_id` from
   `Observation` into both materializers (finding 9).**
   `knowledge/ingest/materialize.py` now builds node `props` through a
   shared `_props_with_provenance` helper that copies the two fields onto
   the node when the `Observation` carries them, in both
   `apply_observations` and `observations_to_records`.
   `Observation.confidence` is deliberately NOT propagated — at least one
   parser (`slither_json`) already writes a domain-specific
   `props["confidence"]` string (Low/Medium/High), and overwriting it with
   the parser's float confidence would be a silent regression, not a
   provenance improvement. Covered by
   `packages/raptix/tests/unit/knowledge/ingest/test_materialize.py`
   (10 cases: propagation on both materializers, the `confidence`
   non-propagation + existing-value-preserved regression guard, omission
   when unstamped, and non-mutation of the input `Observation`). Verified
   against the existing suites that exercise this path end to end:
   `test_registry.py`, `test_adapter_output_parsers.py`, and
   `test_kg_autoingest.py` (87 tests total, all passing, no regressions).

8. **No PR for the `Artifact` → tool-version leg, for a different reason
   than decisions 3/4: not "no consumer" but "no producer."** Finding 10
   shows the T7/T10 call sites `capabilities/provenance.py` names as its
   intended caller do not construct `Artifact` instances in any production
   path today. Revisit only once a real executor exists that turns an
   `ExecutionSpec` + sandbox output into an `Artifact` — at that point,
   wire `build_execution_provenance`/`provenance_for_tool` in at that
   construction site, not into `kg_autoingest.py`/`ingest_services.py`.

## Threat model

No guard rail is weakened and none is touched. This ADR makes no changes to
`SafeCommand`, `EngagementContext`, `RoEGuardrailMiddleware`, egress
enforcement, or any `.semgrep/raptix-no-*` rule — finding 6 confirms the
existing RoE guard rail already covers the delegation path by construction,
so no new test or code was needed there. Decisions 1, 2, 4, 6, and 7 touch
knowledge-representation and middleware-adapter code only, not RoE/scope
enforcement. Decision 7's change is additive (two new optional `props`
keys on nodes written through the Wave-T3 auto-ingest path) — it does not
change `KGStore.record_observations`'s reserved-key stripping, which still
only covers `engagement`/`firstseen`/`lastupdated`/`created_by`/
`source_episode_id`.

## Consequences

- **Easier:** future evidence/epistemic work has one unambiguous home for
  "normalized observation" (`capability.Observation`) — no risk of two
  incompatible meanings of "Observation" entering the codebase. Contributors
  revisiting the three source discussions have a dated checkpoint stating
  which parts are already done, which are rejected, and which are gated on
  evidence, instead of re-deriving this from a stale chat transcript each
  time.
- **Harder:** any future PR proposing a new "Evidence"/"Observation"/"Action"
  abstraction must first show why `capability.Observation` cannot be
  extended — intentionally raises the bar for that specific class of
  proposal.
- **Given up:** the AKG schema-collapse and Exploration-Planner/frontier-
  search directions described in `graph-recommendation.md` and the
  epistemic-core document are not pursued under their original framing. They
  remain available if a future PR brings the evidence decision 5 requires.
  The epistemic-core document's PR1 (RoE path coverage) and the
  `Finding.status` lifecycle field are also not pursued — not deferred for
  later, but found during this ADR's own implementation pass to already be
  satisfied (PR1) or to lack any current consumer (`Finding.status`).
- **Migration:** none for decisions 1–6. Decision 7 is a small, additive
  code change (see below) — no migration, since it only adds optional
  `props` keys going forward; existing KG nodes written before this change
  simply lack them.

## Alternatives considered

- **Adopt `graph-recommendation.md`'s AKG redesign wholesale** — rejected:
  its central organizational complaint is already fixed (finding 1), and its
  schema-collapse proposal is a documented regression relative to the richer
  schema already in place (finding 2).
- **Adopt the epistemic-core document's Evidence contract v0 as a new
  standalone module** — rejected as specified: it would duplicate
  `capability.Observation`/`Artifact`, which it does not reference. Accepted
  in modified form (decision 2) as an extension of the existing frozen
  contract.
- **Ship the RoE test-coverage PR and the `Finding.status` enum PR as
  originally scoped** — rejected after attempting to scope them (findings 6,
  7): the RoE gap does not exist (the delegation path is already covered by
  construction and by `test_roe.py::TestSlotRegistration`), and the
  `Finding.status` enum has no reader anywhere in the reporting tools, so
  validating against an unevidenced 4-value vocabulary would either break
  the one documented convention (`status="confirmed"`) or add dead
  machinery. Writing either PR to "complete the task" would itself be the
  over-engineering this ADR exists to screen out.
- **Take no action on any of the three documents** — rejected: rejecting the
  AKG redesign and the standalone Evidence model (decisions 1, 2) are
  themselves actions, backed by findings 1, 2, and 4; this ADR is the
  record of that, not a no-op.

## Action items

1. [x] When an evidence-model extension is next scoped, open it against
   `raptix_core/types/capability.py` (`Observation`/`Artifact`) with the
   required `test_public_api_stability.py` + CHANGELOG update, referencing
   this ADR. (Standing guidance for future work — nothing to open now.)
2. [x] Add a one-line pointer to this ADR at the top of
   `docs/graph-recommendation.md`,
   `docs/design/2026-10-11-exploitation-reasoning-epistemic-core.md`, and
   `docs/structure-review.md` (done alongside this ADR; see those files).
3. Decisions 3 and 4 closed as "already satisfied" / "no current consumer"
   during this ADR's own implementation pass — see findings 6 and 7.
4. [x] Propagate `Observation.source_artifact_id`/`parser_id` through
   `knowledge/ingest/materialize.py` (finding 9 / decision 7) — done;
   closes the Finding→Observation/Artifact leg of
   `docs/architecture/state-ownership-inventory.md`'s P1 follow-up.
5. [x] Investigate the remaining leg (`Artifact`→tool-version chain,
   finding 10 / decision 8) — not implemented, by design: its prerequisite
   (a real executor constructing `Artifact` from T7/T10) does not exist in
   production code yet. Not left open as "someone should get to this" —
   left open as "this cannot be done correctly until T10's executor
   wiring lands"; re-open only after that.
