# 0026. Bound parallel surface-exploit fan-out

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** Raptix maintainers
- **Related:** `docs/adr/0021-b0-session-isolation-gate.md`,
  `docs/adr/0023-bounded-iterative-surface-reexpansion.md`

## Context

ADR-0022 limited `surface_exploit` to one cell per turn until a live sandbox
test demonstrated session isolation. ADR-0021 now records a B0 isolation **GO**:
two simultaneous sessions used separate workdirs and marker files without stale
state, timeout, or cross-session leakage. The B5 matrix can therefore increase
throughput, but an unbounded fan-out would overload the shared sandbox and grow
the matrix's active work without limit.

## Decision

Dispatch at most `max_in_flight=3` pending `surface_exploit` cells in one
orchestrator turn. Select them deterministically by priority, require a distinct
session and output directory for every cell, and transition each selected cell
to `in-progress` with sequential OPPLAN calls before issuing the task batch.

Only task launch is parallel. After the batch returns, process each cell's
OPPLAN outcome sequentially. For every confirmed cell, run
`kg_surface_inventory(base_generation=<that cell's generation>)` and any
`objective_expand` sequentially before moving to the next confirmed cell. Do
not merge generations or relax ADR-0023's deduplication, generation, or total
cell bounds.

This decision does not change specialist exploit execution, safety-critical
middleware slots, RoE, egress, HITL, bash tools, or sandbox runtime.

## Consequences

- **Easier:** independent high-priority cells can make bounded parallel
  progress while retaining deterministic batch selection.
- **Harder:** orchestrator post-processing remains deliberately serialized, and
  three simultaneous sessions add bounded load to one sandbox.
- **Given up:** unlimited fan-out and parallel OPPLAN/generation accounting.

## Alternatives considered

- **Keep one cell per turn:** rejected because ADR-0021's B0 gate has passed.
- **Parallelize OPPLAN updates and re-expansion:** rejected because concurrent
  status and generation accounting can race.
- **Use a larger batch:** rejected because a small hard limit constrains sandbox
  load and matrix sprawl.
