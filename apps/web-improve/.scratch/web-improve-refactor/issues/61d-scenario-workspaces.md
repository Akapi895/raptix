# 61d: Scenario launcher and workspace selection

**What to build:** Move `ScenariosPage`/`WorkspacesPage` from `src/screens/scenarios.tsx` into `src/screens/demo/pages.tsx` (route keys `scenarios`/`workspaces`, route-inventory rows 52–53, OUTSIDE_SHELL public pages). Persona selection and workspace sign-in flow through the ticket-06 auth actions and the single `signIn` entry; the Reset Demo State action runs the ONE authority reset chain (store `resetDemo` → `services.reset(variant)` → Scheduler clear + clock anchor restore + `authority.reset(variant)`, Query bridge treats corr `reset` as wholesale invalidation) and cancels owned demo timers; the public pages render their own confirm/toast host (the shell chrome they render outside of does not exist on OUTSIDE_SHELL routes — a pre-existing dead control on the reset button, fixed here). `src/screens/scenarios.tsx` becomes a compatibility barrel; retired with the demo wrappers in 66.
**Blocked by:** 61c. **Completion leaf of the ticket 61 split — carries the umbrella's outgoing blocker: [62](62-responsive-audit.md).**
**Status:** resolved
**Owner:** System/demo feature and route coverage closure; fourth leaf of the ticket 61 split (umbrella: [61](61-system-demo-surfaces.md)).
**Contract:** [execution.md](../execution.md).

- [x] `scenarios` and `workspaces` render outside the shell at their keys (public behavior preserved) and their launch/reset/persona controls work.
- [x] Scenario reset uses the one authority, cancels previous timers and re-arms the migrated deadline workflows against the fresh dataset (verified twice in one mount).
- [x] Approval/stop/grant workflows drive coherently after reset: the seeded approval queue, stop state and grant lifecycle re-arm without stale callbacks or duplicate subscriptions.
- [x] Leaf diff fits the cap; checks stay green.

## Evidence

**Commit** `feat(web-improve): scenario launcher and workspaces (ticket 61d)` — branch `wi/61-demoworks`:

- `src/screens/demo/pages.tsx` (new, ~347 lines) — `ScenariosPage` + `WorkspacesPage` + the demo tables moved; persona `<select>`/role-matrix switches → `switchPersona`; Enter app / Open Workspace → the ticket-06 `signIn` (single auth entry) + guarded navigation; Reset Demo State → confirm modal + `resetDemo('default')` (the one authority chain; owned demo timers cancelled; Query cache cleared by the corr-`reset` bridge); `DemoChrome` renders the confirm modal + toast list on the public pages (their previous confirm/toast calls rendered into a chrome that was not mounted there).
- `src/screens/scenarios.tsx` — compatibility barrel for the lazy slice record; retired in 66.
- `src/screens/demo/demo.test.tsx` (extend) — OUTSIDE_SHELL behavior: `#/scenarios` and `#/workspaces` render without shell landmarks unauthenticated; workspace selection signs in with the chosen org and lands on the console; reset coherence: mutate → reset → the seeded approval queue/stop state/grant lifecycle re-arm → second reset on the same mount stays coherent (no duplicate subscriptions/toasts).

Runtime accounting: new-file lines ~347 + net across edited files (scenarios.tsx 4/−362) = **−11 runtime lines**, 4 touched files.

Checks: typecheck clean; lint ≤ baseline; full suite green; build green (exact numbers in the commit's final run).

**Gaps:** browser walkthrough not performed (optional per AGENTS.md § Windows Temporary Process Safety).
