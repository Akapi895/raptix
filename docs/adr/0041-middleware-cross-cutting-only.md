# ADR-0041: Middleware holds cross-cutting concerns only

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @PurpleCHOIms
- **Related:** ADR-0040 (mission context ownership), §27 rule 6

## Context

After the W16–W18 migration, `middleware/engagement.py` and
`middleware/opplan.py` are shims that redirect to
`orchestration/mission/`. The middleware package now contains only
cross-cutting adapters (budget, filesystem, HITL, KG, RoE, skills,
prompt-injection, etc.) and no subsystem state owners.

## Decision

1. Middleware files must be cross-cutting adapters, not subsystem state
   owners. Any file that owns domain state (engagement lifecycle,
   objective tracking, phase transitions) belongs under its owning
   subsystem.
2. A structural test enforces that `engagement.py` and `opplan.py`
   under `middleware/` remain shims (≤20 lines, contain
   `sys.modules` redirect).

## Consequences

- Future contributors who add domain state to middleware will be
  caught by the tripwire test.
- Legitimate cross-cutting AgentState extensions (model override,
  proxy key, subagent transcript) remain in middleware — they carry
  configuration channels, not domain state.
