# 0037. UKC phase is runtime state, not a source tree

- **Status:** Proposed
- **Date:** 2026-10-05
- **Related:** `raptix-repository-architecture.md` §2.3, §7, §16, §32 (W7); W8 (skill `ukc_phases` metadata)

## Context

The Unified Kill Chain groups activity into three macro-phases: initial
foothold, network propagation and action on objectives. A naive
migration organises the repo into `initial_foothold/`,
`network_propagation/` and `action_on_objectives/` trees. That hard-codes
the phase into the physical layout: agents and skills straddle phases, a
single capability (e.g. credential access) serves several phases, and
every re-classification becomes a code move instead of a metadata edit.

## Decision

Phase lives under `orchestration/phases/` as runtime state only:

- `UKCPhase` — exactly three members with stable slugs
  (`initial_foothold`, `network_propagation`, `action_on_objectives`)
  that double as the `ukc_phases` metadata vocabulary for skills,
- `PhaseStateMachine` — per-engagement state with a bounded transition
  history, shipped in **shadow mode**: denied transitions are recorded
  and logged, nothing in the runtime gates on them,
- `PhasePolicy` / `DefaultPhasePolicy` — transitions are policy
  decisions (default: forward or re-affirm, never backward), not
  hard-coded control flow,
- `PhaseTransition` — immutable audit record,
- slug helpers shared with skill metadata so W8 can validate
  `ukc_phases` entries without importing framework internals.

Agents, skills and tools remain organised by capability/domain. The
stdlib-only module set imports no framework and nothing else in the
runtime imports it yet.

## Consequences

- Re-classifying an activity across phases is a metadata change (W8),
  never a file move.
- Phase gating (blocking/pruning) stays out of scope until a
  policy is benchmarked; enforcement only becomes reachable by flipping
  `shadow=False` in a later, separately-reviewed wave.
- The phase contract may graduate to `raptix_core.types` once external
  plugins need it; the runtime module stays the orchestration owner.
