# 0024. Wire bounded re-expansion into KG surface inventory

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** Raptix maintainers
- **Related:** `docs/adr/0023-bounded-iterative-surface-reexpansion.md`

## Context

ADR-0023 introduced `plan_reexpansion` as the convergence mechanism for
surface-exploit chaining. The orchestrator is an LLM and cannot execute the
Python helper itself, so describing that call in the prompt left deduplication
and bounds outside the runtime path.

## Decision

`kg_surface_inventory` invokes `plan_reexpansion` before returning cells or
`objective_children`. It reads OPPLAN objectives from injected state and
accepts optional `base_generation`. With that argument, the helper stamps each
candidate as `base_generation + 1` before applying generation and total-cell
bounds. `build_objective_expand_payload` persists the resulting `gen` in child
notes so a confirmed cell supplies the next inventory call's base generation.

An initial B5 call omits `base_generation`; derived cells retain their KG
generation, which is `0` for recon-origin surfaces. Re-expansion calls provide
the confirmed cell's persisted generation. The tool remains read-only and
sequential; it neither expands OPPLAN nor dispatches a specialist.

## Consequences

- **Easier:** convergence controls are enforced by code rather than LLM prompt
  compliance, and generation provenance survives the OPPLAN round trip.
- **Harder:** callers must parse the confirmed cell's `gen` notes before a
  re-expansion call.
- **Given up:** specialist KG provenance writes remain deferred to PR-B2.

## Alternatives considered

- **Keep planning in the prompt:** rejected because an LLM cannot invoke the
  pure Python helper.
- **Trust KG-provided generation on re-expansion:** rejected because code must
  own generation accounting for the convergence guarantee.
