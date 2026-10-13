# 61: System pages, workspaces and demo walkthrough

**What to build:** Complete semantic system/demo modules: 403/404/500/offline/session-expired, workspaces, states gallery, scenario launcher and guided walkthrough using canonical reset/navigation APIs.
**Blocked by:** 15, 23, 30, 33, 37, 40, 42, 44, 47, 49, 51, 53, 55, 58, 60.
**Status:** ready-for-agent
**Owner:** System/demo feature and route coverage closure.
**Contract:** [execution.md](../execution.md).

- [ ] Each system/demo entry is reachable at its existing key/alias and has meaningful failure/recovery behavior.
- [ ] Scenario reset uses the one authority, cancels previous timers and drives migrated approval/stop/grant workflows coherently.
- [ ] Walkthrough/keyboard focus and states gallery remain functional; workspace selection preserves public-route behavior.
- [ ] Every source screen/route is assigned a semantic owner; missing links or unretired readers become explicit blocking leaves before contraction.

## Split

The system/demo migration exceeded the ≤400-line cap as a single leaf, so before coding it was split into bounded leaves [61a](61a-system-error-pages.md) → [61b](61b-states-gallery.md) → [61c](61c-guided-walkthrough.md) → [61d](61d-scenario-workspaces.md) (chain; the outgoing blocker 62 was transferred to the completion leaf 61d). The coverage audit also filed [61e](61e-retire-raw-hash-writers.md) (two remaining raw hash-location writers in f-report/g-common, now blocking contraction batch B via 66) and recorded the semantic-owner map: every source screen/route resolves to a semantic owner (src/auth 06, src/screens/system 61a/61b, src/screens/dashboard 14, src/screens/tasks 15, src/features/wizard 17–19, src/screens/project-detail 20/23, src/features/{operations,agents,assets,library,findings,reports,settings,aichat,plans,trace,branches,workers,c2,estop,notices,copilot} 21–60, src/screens/demo 61c/61d); the legacy slice records/screen files (a*, b*–h*, scenarios/demo-guide barrels) remain bridged consumers with their retirement path in 65–67.
