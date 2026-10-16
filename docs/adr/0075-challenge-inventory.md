# 0075. Derive challenge-family coverage cells from the mission's own scoreboard

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** operator (raptix workspace)
- **Related:** docs/exploitation-effectiveness-diagnosis-2026-10-15.md, ADR-0021 (bounded fan-out), ADR-0067 (dispatch concurrency ceiling)

## Context

The surface coverage matrix (``kg_surface_inventory`` →
``build_coverage_matrix``) derives cells from a normalized
``(endpoint, vuln_class)`` space. A benchmark run against an OWASP Juice
Shop deployment showed this space does not cover every scoreboard
family: after two hours and 21 objectives, the OPPLAN contained zero XSS
cells even though the target's own challenge list named XSS challenges
and recon had recorded the surfaces; the entire Sensitive Data Exposure
category (17 challenges) could never become a cell because
information-hunting work does not reduce to an endpoint proof; and the
availability/deserialization family was silently skipped without a
recorded RoE-cited reason. The mission's own documents demanded
scoreboard movement, but nothing in the runtime bridged "scoreboard
category" to "dispatchable objective".

## Decision

Add a read-only, orchestrator-only ``challenge_inventory`` tool (with a
matching ``raptix.md`` **Challenge-family sweep** flow) that turns the
mission's own scoreboard snapshot into bounded ``surface_exploit``
cells — exactly one cell per **unsolved scoreboard entry**, so every
cell maps 1:1 onto one verifiable win-condition. The tool obeys an
objectivity contract, documented in ``_challenge_registry.py`` and
enforced by unit tests:

1. All content is the target's own data (entry names, categories,
   difficulty, solved flags from its scoreboard endpoint). No payload,
   endpoint, credential, answer, or hint text may appear in the module —
   hint ingestion is deliberately absent because discovery-mode
   engagements must not be fed the target's own walkthroughs.
2. The only static table is a generic **keyword → methodology-skill**
   mapping that mirrors the platform's existing skill taxonomy. Unknown
   categories fall back to the generic sensitive-information-disclosure
   methodology instead of being dropped.
3. Dispatch priority derives from the target's own difficulty ranking
   (cheapest unsolved entry first).
4. Availability-family categories (keyword ``deseriali*``) are still
   generated but pinned to ``ROE_GATED_PRIORITY`` so they dispatch last
   and only when the mission RoE permits; the orchestrator must record
   an RoE-cited skip otherwise.
5. The obligation is a **terminal outcome per entry** (solved /
   attempted-failed with reason / skipped with reason) — never a solve
   guarantee, and never an inline technique hint beyond the cited
   skill. A skipped or attempted-failed outcome must carry bounded
   empirical evidence (request/response showing the win condition is
   inert); target-reported availability markers are advisory only —
   the codebase already saw a "disabled" entry flip in production.

## Consequences

- **Easier:** every scoreboard entry gets at least one dispatched
  cell or a recorded skip; XSS, information-hunting, account-takeover
  chains, and availability tests stop depending on operator heroics;
  coverage becomes measurable (entries with terminal outcomes); a
  stalled or crashed cell can only lose one entry's work.
- **Harder:** OPPLAN grows by up to one cell per unsolved entry — the
  orchestrator must run the sweep on a cadence (prompt-enforced) and
  keep deduplication honest via ``cell_id``.
- **Given up:** the strictly endpoint-derived nature of the coverage
  matrix; entry cells are deliberately outside the KG surface space
  (their ``surface_key`` is ``challenge::<category>_<name>``).
- **Migration:** none for existing engagements — the tool is dormant
  unless a challenge snapshot exists on disk and the orchestrator is
  instructed by its own prompt; no schema changes.

## Alternatives considered

- **Operator-authored per-run updates** (as used on the 2026-10-15 v2
  run): worked, but is neither systematic nor auditable and was the
  exact gap this ADR closes. Rejected as the primary mechanism.
- **Target-specific mapping table** (category → endpoint/payload):
  rejected — biases the agent and feeds answers.
- **Extending ``kg_surface_inventory``**: rejected — its contract is
  read-only KG surface derivation; the challenge snapshot is a
  different data source with different privacy semantics (target-authored
  hint text).
- **Forcing the LLM to enumerate categories from prose**: rejected —
  non-deterministic, untestable, and easily skipped under load.
