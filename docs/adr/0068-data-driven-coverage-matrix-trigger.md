# 0068. Trigger the surface-exploit coverage matrix on data, not objective wording

- **Status:** Proposed
- **Date:** 2026-10-15
- **Related:** ADR-0021, ADR-0023, ADR-0026, ADR-0067, ADR-0049

## Context

`intelligence/prompts/standard/raptix.md` gated the whole coverage-matrix
workflow on the approved objective's text containing the literal phrase
"Initial Foothold". Real engagement objectives are phrased "initial access
and foothold" (lower case, different wording) — a direct grep across the
9 real engagements analyzed for
`docs/proposals/2026-10-14-auto-fanout-dispatch-mechanism.md` found
`kg_surface_inventory` called **zero** times, including at the first
dispatch where the matrix would be most useful. The failure is not a
casing typo to patch — it is a category error: a tool whose underlying
Cypher query is entirely phase-agnostic (`kg_surface_inventory` scopes only
by `engagement`, never by phase) was wired to fire on exactly one specific
objective wording. A later pivot into an internal network that surfaces a
second, independent web application would never reach this workflow either,
for the same reason.

ADR-0067 separately closes the concurrency-safety gap this workflow can
trigger (an unbounded number of concurrent `surface_exploit` dispatches
against a possibly single-worker target) but does not touch when the matrix
gets built in the first place — that question is this ADR.

`docs/design/2026-10-12-p4-system-optimization-research.md` (2026-10-13
decision) already concluded **not** to force free-form exploitation into a
matrix for the hardest observed case — chained, dependency-heavy
vulnerability sequences (TypeORM injection → JWT race condition → Socket.IO
sniffing) — because free-form reasoning handled that case better than a
fixed 10-class matrix. This decision does not reopen that call: the trigger
below actively *excludes* chain-dependent cells (`via_cell` lineage) from
the count that enables fan-out, protecting exactly the case that decision
was about. It targets the opposite case that decision never tested —
many genuinely independent, orthogonal surfaces (e.g. one host with 40
unrelated endpoints) — which real engagements analyzed so far happen not to
have exercised yet, but which the matrix mechanism already existed to serve
before its trigger condition made it unreachable.

## Decision

Replace the objective-wording gate with a data-driven one, read from the
KG at call time instead of guessed from phase or phrasing:

1. `_surface_registry.py` gains `independent_cell_count()` (cells with no
   `via_cell` lineage — i.e. not produced by re-expanding a just-confirmed
   parent), `server_resilience_cap()` (returns `1` when any observed
   surface's `technologies` match a short, evidence-anchored
   `FRAGILE_UNDER_CONCURRENCY` set — today just `{"werkzeug"}`, the
   technology that actually wedged in the incident ADR-0067 documents —
   else the prior default of `3`), and `recommended_in_flight()` =
   `min(independent_cell_count, server_resilience_cap)`.
2. `kg_surface_inventory` (`knowledge/graph/tools.py`) returns
   `independent_count` and `recommended_in_flight` alongside the existing
   `surfaces`/`cells`/`objective_children`.
3. `raptix.md`'s orchestrator instructions call `kg_surface_inventory` after
   **any** `recon`, `osint_operator`, or pivot-sourced dispatch is
   classified — not conditioned on phase or objective wording — and only
   build the matrix (`objective_expand`) when `recommended_in_flight >= 2`.
   The surface-exploit dispatch loop selects up to `recommended_in_flight`
   (never more than 3) pending cells per batch instead of an unconditional 3.

`recommended_in_flight` is advisory, read by the orchestrating model to
decide whether fanning out is worth the coordination cost at all. It does
not replace ADR-0067's enforcement: `DispatchMiddleware`'s per-engagement
concurrency ceiling still rejects any attempt to exceed the real cap
regardless of what this number suggests.

## Consequences

- **Easier:** the coverage matrix is now reachable through the mandatory,
  unconditional first-recon dispatch (`raptix.md`'s "First-dispatch is
  recon" rule) instead of a brittle phrase match — it fires for the exact
  real-engagement wording that previously never matched, and for a later
  in-engagement pivot that finds a second independent surface.
- **Harder:** the orchestrator prompt now depends on a returned numeric
  field (`recommended_in_flight`) rather than a plain-English condition —
  slightly more state for the model to track across the trigger call and
  the dispatch-loop call that follows it.
- **Given up:** nothing. No prior capability is removed; a previously
  unreachable code path becomes reachable.
- **Migration:** none. The new JSON fields are additive; the parallel
  recon+osint intake heuristic (gated on objective wording, a narrower,
  separate first-dispatch speed optimization) is unchanged — this ADR does
  not touch it.

## Alternatives considered

- **Fix only the string literal** (match "initial access and foothold" too,
  or lower-case the comparison): rejected — it repairs today's observed
  phrasing but leaves the same category error in place for the next
  objective wording or the next domain that reaches this code path; the
  underlying tool has no phase dependency, so the gate should not invent one.
- **Score fan-out value with an LLM-estimated marginal-value model** (per
  the research review in `docs/proposals/temp.md`): rejected for this
  change — `independent_count`/`server_resilience_cap` are already
  deterministic, code-computed signals available from existing KG data;
  adding a learned or LLM-estimated scorer is the "V2/V3" tier that same
  research explicitly recommends deferring until a "V1 rule/greedy" policy
  like this one is shown insufficient by real data (ADR-0049 discipline).
- **Fold `server_resilience_cap` detection into `DispatchMiddleware`
  (ADR-0067) instead of the surface registry**: rejected — the dispatch
  middleware has no visibility into KG-observed `technologies`; duplicating
  that lookup there would require either a new dependency from
  `middleware/` into `knowledge/graph/` or a second, divergent technology
  list. The registry-level signal stays advisory; ADR-0067's ceiling stays
  the sole enforced backstop.
