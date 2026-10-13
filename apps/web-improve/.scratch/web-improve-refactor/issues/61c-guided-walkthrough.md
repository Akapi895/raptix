# 61c: Guided walkthrough demo module

**What to build:** Move the guided walkthrough out of `src/screens/demo-guide.tsx` into `src/screens/demo/`: `guides.ts` owns the GUIDES corpus and the `Dest`/`Guide`/`GStep`/`DemoKit` contracts; `launch.ts` owns the walkthrough state authority (module-local) and the `launchGuide`/`jump`/`stopGuide` entries; `guide.tsx` owns the `DemoGuide` panel. The panel keeps its keyboard-operable controls (Prev/Next/Finish/collapse, aria labels); persona/auth flow through the shared authorities; navigation through the store's guarded `go`; the WF-F simulated actions take a narrow `DemoKit` (lose/restore agent + toast) instead of the whole legacy store. `src/screens/demo-guide.tsx` becomes a compatibility barrel (retired with the other demo wrappers in 66).
**Blocked by:** 61b.
**Status:** resolved
**Owner:** System/demo feature and route coverage closure; third leaf of the ticket 61 split (umbrella: [61](61-system-demo-surfaces.md)).
**Contract:** [execution.md](../execution.md).

- [x] Walkthrough launches from a scenario, renders the panel with persona/step state, auto-advances on reaching the next screen, and every control is keyboard-operable.
- [x] `DemoKit` decouples the guide corpus from the store type; simulated actions still run through the bridged demo actions.
- [x] Leaf diff fits the cap (accounting below); checks stay green.

## Evidence

**Commit** `feat(web-improve): guided walkthrough demo module (ticket 61c)` — branch `wi/61-demoworks`:

- `src/screens/demo/guides.ts` (new, 259 lines) — the E2E-01…11 + WF-A…G corpus moved verbatim; `run` callbacks take `DemoKit { loseAgent; restoreAgent; toast }`; `Dest` re-exports the router `Route` type, so the corpus imports no store symbol.
- `src/screens/demo/launch.ts` (new, 45 lines) — the walkthrough state authority (module-local `gs` + `useSyncExternalStore`, no persistence) and the launch entries: `launchGuide`, `jump` (persona/login/project on the store's guarded bridge, then one `go`), `stopGuide`.
- `src/screens/demo/guide.tsx` (new, 96 lines) — the `DemoGuide` panel (markup verbatim); identity/authed via `useAuthStore`, toasts via `useToastStore`, route via the router-location projection, navigation via `jump`, simulated actions via `kitOf` (bridged `A.loseAgent`/`A.restoreAgent` + toast).
- `src/screens/demo-guide.tsx` — compatibility barrel for the module (shell slot default + scenarios imports keep resolving); retired in 66.
- `src/screens/demo/demo.test.tsx` (new, 8 tests) — launch renders the panel with guide id/persona/step (`E2E-03`, `WF-F`); launching from signed-out enters the app (jump's `login`) and the panel appears; Prev/Next/Finish with disabled Prev at step 1; every control is a focusable named button (tabIndex 0, focus asserts); auto-advance fires when the next step's screen is opened (`go('preflight', { id: 'OP-DRAFT-017' })` → Step 2/3); collapse/expand pill; WF-F's simulated actions flip AG-008 to `lost` and back to `online` through the kit with the demo-data toasts; End clears the panel.

Runtime accounting: new-file lines 400 (guides 259 + launch 45 + guide 96) + net across edited files (demo-guide.tsx barrel 6/−339) = **67 runtime lines**, 5 touched files.

Checks: `npm run typecheck` clean (0 new); `npm run lint` 196 warnings / 0 errors (baseline 197 — the split removed one); `npm test -- --run` 891 passed (883 + 8 new; the known pre-existing agents/writes flake passed on re-run); `npm run build` green.

**Gaps:** browser walkthrough not performed (optional per AGENTS.md § Windows Temporary Process Safety).
