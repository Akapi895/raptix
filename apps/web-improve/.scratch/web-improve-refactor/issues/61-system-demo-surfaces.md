# 61: System pages, workspaces and demo walkthrough

**What to build:** Complete semantic system/demo modules: 403/404/500/offline/session-expired, workspaces, states gallery, scenario launcher and guided walkthrough using canonical reset/navigation APIs.
**Blocked by:** 15, 23, 30, 33, 37, 40, 42, 44, 47, 49, 51, 53, 55, 58, 60.
**Status:** resolved
**Owner:** System/demo feature and route coverage closure.
**Contract:** [execution.md](../execution.md).

- [x] Each system/demo entry is reachable at its existing key/alias and has meaningful failure/recovery behavior.
- [x] Scenario reset uses the one authority, cancels previous timers and drives migrated approval/stop/grant workflows coherently.
- [x] Walkthrough/keyboard focus and states gallery remain functional; workspace selection preserves public-route behavior.
- [x] Every source screen/route is assigned a semantic owner; missing links or unretired readers become explicit blocking leaves before contraction.

## Split

The system/demo migration exceeded the ≤400-line cap as a single leaf, so before coding it was split into bounded leaves [61a](61a-system-error-pages.md) → [61b](61b-states-gallery.md) → [61c](61c-guided-walkthrough.md) → [61d](61d-scenario-workspaces.md) (chain; the outgoing blocker 62 was transferred to the completion leaf 61d). The coverage audit also filed [61e](61e-retire-raw-hash-writers.md) (two remaining raw hash-location writers in f-report/g-common, now blocking contraction batch B via 66) and recorded the semantic-owner map: every source screen/route resolves to a semantic owner (src/auth 06, src/screens/system 61a/61b, src/screens/dashboard 14, src/screens/tasks 15, src/features/wizard 17–19, src/screens/project-detail 20/23, src/features/{operations,agents,assets,library,findings,reports,settings,aichat,plans,trace,branches,workers,c2,estop,notices,copilot} 21–60, src/screens/demo 61c/61d); the legacy slice records/screen files (a*, b*–h*, scenarios/demo-guide barrels) remain bridged consumers with their retirement path in 65–67.

## Evidence

All four leaves resolved on branch `wi/61-demoworks` (`dc81ce4` 61a → `2535735` split docs → `ac92488`/`c3affea` 61b → `146af31`/`e576661` 61c → the 61d commits). Coverage closure: all 53 route keys in `.scratch/web-improve-refactor/route-inventory.md` have a semantic owner, asserted by the registry-manifest sweep in `src/screens/system/system.test.tsx`; the only gaps found (raw hash writers in f-report.tsx/g-common.tsx) are filed as blocking leaf 61e. Per-leaf runtime accounting (ticket-42 convention): 61a +62, 61b +2, 61c +67, 61d +60 = **191 runtime lines**. Cumulative checks: typecheck clean; lint 198 warnings / 0 errors (gate ≤198); `npm test -- --run` 896 passed (867 baseline + 29 new: 16 system + 13 demo); build green.

**Follow-ups:** 61e (raw hash writers, blocks 66); 65–67 retire the bridged slice records/barrels.
