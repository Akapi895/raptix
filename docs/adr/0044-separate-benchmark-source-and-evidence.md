# 0044. Separate benchmark source, scenarios and evidence

- **Status:** Proposed
- **Date:** 2026-10-09
- **Related:** [Repository structure](../architecture/repository-structure.md)

## Context

The benchmark directory mixes a shared challenge engine, independent suites,
operator guides and individual engagement exports. Output defaults also differ
between suites, making generated runs hard to distinguish from published evidence.

## Decision

- Place shared implementation in `benchmarks/engine/`, provider adapters in
  `providers/`, and independent CVE-Bench, DreadGOAD and tool-eval implementations
  in `suites/`. Keep `benchmarks.runner`, `python -m benchmarks` and root type
  exports as the shared runner's public entrypoints.
- Group executable configs by suite under `configs/`; archive proposed configs
  under `docs/archive/`. Store operator guides in `docs/`, scenario inputs in
  `scenarios/`, and operator-managed upstream checkouts in ignored `external/`.
- Write new runs under `results/runs/<suite>/<run-id>/`; retain selected,
  versioned evidence under `results/published/<suite>/`. Frozen tool-eval
  baselines stay beside their evaluator and are moved without regeneration.
- Resolve repository-owned fixtures and defaults from package locations, so a
  package move cannot silently redirect fixture loading or create output elsewhere.

## Consequences

- Imports of internal benchmark modules move to `benchmarks.engine.*` and
  `benchmarks.suites.*`; suite CLI commands use the latter namespace.
- Existing reports retain their payloads, provenance and scoring semantics.
  Published reports are not automatically rewritten by new runs.
- Structural and offline execution checks cover relocated fixtures, output
  containment and the retained shared runner entrypoints. Live lab lifecycle and
  runtime safety boundaries retain their existing behavior.

## Alternatives considered

- Keep the flat layout: rejected because source and run evidence remain mixed.
- Merge all suites into one provider interface: rejected because challenge,
  AD-grid and capability evaluations have different lifecycle/scoring contracts.
