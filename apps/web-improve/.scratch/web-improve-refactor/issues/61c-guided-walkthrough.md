# 61c: Guided walkthrough demo module

**What to build:** Move the guided walkthrough out of `src/screens/demo-guide.tsx` into `src/screens/demo/`: `guides.ts` owns the GUIDES corpus and the `Dest`/`Guide`/`GStep`/`DemoKit` contracts; `guide.tsx` owns the walkthrough state authority (module-local), `launchGuide`/`jump`/`stopGuide` and the `DemoGuide` panel. The panel keeps its keyboard-operable controls (Prev/Next/Finish/collapse, aria labels); persona/auth flow through the shared authorities; navigation through the store's guarded `go`; the WF-F simulated actions take a narrow `DemoKit` (lose/restore agent + toast) instead of the whole legacy store. `src/screens/demo-guide.tsx` becomes a compatibility barrel (retired with the other demo wrappers in 66).
**Blocked by:** 61b.
**Status:** resolved
**Owner:** System/demo feature and route coverage closure; third leaf of the ticket 61 split (umbrella: [61](61-system-demo-surfaces.md)).
**Contract:** [execution.md](../execution.md).

- [x] Walkthrough launches from a scenario, renders the panel with persona/step state, auto-advances on reaching the next screen, and every control is keyboard-operable.
- [x] `DemoKit` decouples the guide corpus from the store type; simulated actions still run through the bridged demo actions.
- [x] Leaf diff fits the cap (accounting below); checks stay green.

## Evidence

**Commit** `feat(web-improve): guided walkthrough demo module (ticket 61c)` — branch `wi/61-demoworks`:

- `src/screens/demo/guides.ts` (new, ~256 lines) — the E2E-01…11 + WF-A…G corpus moved verbatim; `run` callbacks take `DemoKit { loseAgent; restoreAgent; toast }`; `Dest` re-exports the router `Route` type.
- `src/screens/demo/guide.tsx` (new, ~124 lines) — walkthrough state (module-local `useSyncExternalStore` authority), `jump`/`launchGuide`/`stopGuide`, and the `DemoGuide` panel (markup verbatim): persona via `useAuthStore`, authed via the same authority, route via the router location projection, toasts via `useToastStore`, navigation via the store's guarded `go` (the single dirty-guarded in-app writer), simulated actions via `DemoKit` over the bridged demo actions.
- `src/screens/demo-guide.tsx` — compatibility barrel re-exporting the module (shell slot default + scenarios imports keep resolving); retired in 66.
- `src/screens/demo/demo.test.tsx` (new) — launch renders the panel with the guide id/persona/step; Prev/Next/Finish and collapse/expand work; the auto-advance fires when the next step's screen is reached; WF-F's simulated action drives the agent disconnect and restore through the kit; panel controls are keyboard-operable (focusable buttons with accessible names).

Runtime accounting: new-file lines ~380 + net across edited files (demo-guide.tsx 4/−339) = **~45 runtime lines**, 5 touched files.

Checks: typecheck clean; lint ≤ baseline; full suite green; build green (exact numbers in the commit's final run).

**Gaps:** browser walkthrough not performed (optional per AGENTS.md § Windows Temporary Process Safety).
