# 0023. Bound iterative surface-exploit re-expansion

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** Decepticon maintainers
- **Related:** `summary/impl-plan-chaining.md`, `docs/adr/0020-coverage-matrix-objectives.md`, `docs/adr/0021-b0-session-isolation-gate.md`, `docs/adr/0022-sequential-surface-exploit-dispatch.md`

## Context

B5 creates a finite initial coverage matrix and B6 dispatches its cells
sequentially. A confirmed cell can reveal a new endpoint, parameter, host, or
auth surface. Re-reading the KG after that result is useful for chaining, but
unbounded re-expansion can exhaust the recursion limit or grow the OPPLAN
without converging.

PR-A adds the convergence mechanism before PR-B teaches the specialist to
write new surfaces and provenance into the KG. The helper must therefore be
pure and testable from fixtures.

## Decision

After a confirmed cell is updated to `completed`, the orchestrator may
re-query `kg_surface_inventory` and pass the resulting cells through
`plan_reexpansion`. Any resulting children are expanded under the open B5
root objective `Surface exploit — Initial Foothold (web/API)`, not under the
completed cell. The confirmed cell is recorded in each child's `via_cell`
notes field; this is lineage metadata and not a parent edge. The helper:

- removes every cell whose `cell_id` already appears in OPPLAN, regardless of
  objective status;
- accepts only cells at or below `max_generations` (default `3`);
- caps `len(existing_objectives) + len(new_cells)` at `max_total_cells`
  (default `50`), with deterministic priority/generation ordering; and
- returns an empty list when no bounded new work remains.

Re-expansion occurs only after `confirmed`, never after `ruled_out` or
`open_proof_gap`. The completed cell remains terminal, and the root remains
open until its original and chained children are terminal. Each expansion
remains a single sequential OPPLAN mutation, and B6's
one-`surface_exploit`-task-per-turn rule remains unchanged. Parallel fan-out
stays gated by the manual ADR-0021 live runbook.

## Consequences

- **Easier:** chaining has a hard convergence proof independent of prompt
  compliance and is straightforward to replay with KG fixtures.
- **Harder:** deep or broad attack chains are intentionally truncated by the
  generation and total-cell caps and require explicit follow-up planning.
- **Given up:** automatic parallel exploration and specialist-written surface
  provenance in this PR; those belong to later gates/PR-B.

## Alternatives considered

- **Rely on the prompt to stop:** rejected because prompt discipline cannot
  guarantee termination under recursive discoveries.
- **Run a fresh recon pass for every confirmed cell:** rejected because PR-A
  should consume the inline KG state without adding another dispatch lane.
- **Expand after ruled-out or open-proof-gap results:** rejected because those
  outcomes do not establish a new foothold lineage.
- **Attach chained cells to the confirmed cell:** rejected because OPPLAN
  completed objectives are terminal and must not accept new children.
