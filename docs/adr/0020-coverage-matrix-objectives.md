# 0020. Derive Initial Foothold coverage from the KG into OPPLAN children

- **Status:** Proposed
- **Date:** 2026-09-29
- **Deciders:** Raptix maintainers
- **Related:** `summary/impl-plan-surface-exploit.md`, `docs/adr/0018-recon-surface-inventory.md`, `docs/adr/0019-parameterize-surface-exploit-cells.md`

## Context

Recon now records typed web/API surface inventory in the engagement KG. The
parameterized `surface_exploit` specialist needs a deterministic work list,
but the orchestrator must not infer coverage from free-form model text or
spawn work directly from raw observations. OPPLAN already serializes objective
state and enforces sequential mutations.

## Decision

Expose a read-only, engagement-scoped `kg_surface_inventory` capability only
to the Raptix orchestrator. It normalizes Endpoint nodes and their typed
children, applies the single vulnerability registry, and returns stable
coverage cells plus `objective_expand` child payloads. The orchestrator adds
the Initial Foothold parent and submits those children through one sequential
`objective_expand` call. This change derives planning data only; it does not
dispatch specialists or alter exploit execution and guardrails.

## Consequences

- **Easier:** coverage is reproducible, inspectable in OPPLAN, and keyed to
  one vulnerability class, surface, and session per child.
- **Harder:** incomplete or stale KG inventory produces an incomplete matrix;
  later reactive expansion must handle newly discovered surfaces.
- **Given up:** autonomous exploit dispatch directly from the inventory read.

## Alternatives considered

- **Let the model create children from prose:** rejected because applicability
  and ordering would not be deterministic.
- **Add a separate matrix database:** rejected because OPPLAN is already the
  durable task ledger and source of objective status.
- **Dispatch from the KG tool:** rejected because B5 is planning-only and B6
  must own fan-out after session-isolation validation.
