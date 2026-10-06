# ADR-0040: Move engagement context and objective tracking to orchestration/mission

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @PurpleCHOIms
- **Related:** `raptix-repository-architecture.md` §7 (orchestration/mission),
  §11 (middleware holds cross-cutting only), ADR-0037 (UKC phase is runtime state)

## Context

`middleware/engagement.py` (497 lines, `EngagementContextMiddleware`) and
`middleware/opplan.py` (445 lines, `OPPLANMiddleware`) define subsystem
state — engagement lifecycle management and objective tracking — not
cross-cutting adapters. This violates §27 rule 6: middleware must not
own subsystem state.

The architecture doc §7 names `orchestration/mission/` as the owner of
engagement/mission context, objective management, and lifecycle
start/stop/resume. The two files are the concrete implementation of
that ownership.

The files share a circular coupling: `engagement.py` imports two
private reducer functions from `opplan.py` that are semantically
identical to the existing `state_reducers.reduce_converging_value`.
This duplication must be removed before either file can move
independently.

`Objective`/`ObjectivePhase` types already live correctly in
`raptix_core.types.engagement`. `execution/tools/opplan.py` (tool
implementations and persistence) stays in `execution/tools/` — it is
not middleware and is correctly placed.

## Decision

1. Delete the duplicate reducers `_reduce_engagement_name` and
   `_reduce_workspace_path` from `middleware/opplan.py`; replace all
   usages with `state_reducers.reduce_converging_value`.
2. Create `orchestration/mission/` with a README declaring its
   responsibility boundary.
3. Move `middleware/engagement.py` → `orchestration/mission/engagement.py`.
4. Move `middleware/opplan.py` → `orchestration/mission/opplan.py`.
5. Leave re-export shims at the old middleware paths.

## Consequences

- **Easier:** middleware is clearly cross-cutting only; orchestration
  owns mission state; the engagement/opplan coupling is eliminated.
- **Harder:** call sites that construct these middleware classes
  (`intelligence/agents/middleware_slots.py`) must update imports
  (or use shims during transition).
- **Migration:** shims stay until a future compat-retirement wave
  confirms no in-tree callers use the old paths.
