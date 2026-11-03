# 14: Brief revision và project workflow lifecycle

**What to build:** Briefing, planning readiness, handoff, execution và OPPLAN tiến triển nhất quán trong Home/Console/Settings.
**Blocked by:** 03 — Handoff; 13 — Revalidation/reapproval.
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Define supported lifecycle transitions and brief revision/edit policy; no target/authorization mutation bypass after runtime context lock.
2. Persist brief changes and link planning request to effective revision; editing brief identifies whether re-planning is needed.
3. Preserve one-click initial brief send, route landing and late-ACK guards; expose actual workflow next action.
4. Present OPPLAN created/progress/reason-blocked from actual orchestrator state, not required before planning handoff.
5. Align list/detail/settings/console refresh and counters; unknown counts stay unknown, not invented zero.

## Acceptance criteria
- [ ] Project reload preserves brief revision and shows truthful next action.
- [ ] Immutable target/context policy remains enforced.
- [ ] Eight-doc ready and absent OPPLAN do not falsely block planning confirmation; OPPLAN progress reflects actual state.

## Test / expected result
L01/L07/L17: edit brief before/after binding, submit, reload/switch project, inspect real OPPLAN creation. Invalid transition conflicts without deleting previous state.

## Completion evidence
Lifecycle/brief matrix, request snapshots, cross-page reload and actual orchestrator objective state.
