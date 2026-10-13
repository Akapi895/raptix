# 61a: Semantic system error pages

**What to build:** Move the 403/404/500/offline/session-expired screens out of `src/screens/a-system.tsx` into `src/screens/system/pages.tsx` as the semantic owners of the route keys `forbidden`, `notfound`, `error`, `offline`, `session-expired` (route-inventory rows 2–6). Navigation goes through the router seam (`useNavigate` + `toHref`, mirroring ticket 14's `useConsoleGo`); persona writes through the ticket-06 auth actions; panels/toasts through the ticket-05 shared authorities. Retry/reconnect timers are tracked and disposed on unmount. `src/screens/a.tsx` imports the pages from the new module; `a-system.tsx` keeps only the states gallery (moved in 61b).
**Blocked by:** 60 (last of the umbrella's resolved blockers: 15, 23, 30, 33, 37, 40, 42, 44, 47, 49, 51, 53, 55, 58, 60).
**Status:** resolved
**Owner:** System/demo feature and route coverage closure; first leaf of the ticket 61 split (umbrella: [61](61-system-demo-surfaces.md)).
**Contract:** [execution.md](../execution.md).

- [x] Each error page renders at its existing key via the real route host with its failure reason and recovery actions.
- [x] Recovery behavior works: eligible-persona switch + simulated access request (forbidden), requested path + navigation (not-found), two-phase retry (500), reconnect (offline), sign-in return (session-expired); unmounted pages dispose their timers.
- [x] No system page reads the legacy store context; every write goes through the shared authorities and the router stays the single location writer.
- [x] Leaf diff fits the cap (accounting below); typecheck/lint/test/build stay green.

## Evidence

**Commit** `feat(web-improve): semantic system error pages (ticket 61a)` — branch `wi/61-demoworks`:

- `src/screens/system/nav.ts` (new, 25 lines) — `useSystemGo`/`useSystemRoute`: the router navigation seam and the location→Route projection for the system module.
- `src/screens/system/pages.tsx` (new, 152 lines) — `ErrorFrame` + `Forbidden`/`NotFound`/`ServerError`/`Offline`/`SessionExpired`, markup verbatim from `a-system.tsx`; reads are `useAuthStore`/`useUiStore`/`useToastStore` + `personaRole`, writes are `switchPersona`/`signOut` (ticket 06 actions); the local `ROLE_LABEL` copy follows the feature-service convention (store-cycle avoidance). Retry (500) and reconnect (offline) timeouts are now collected in a ref and cleared on unmount — the legacy versions could navigate after unmount.
- `src/screens/a.tsx` — the five error-page keys import from `./system/pages`; registry manifest and route keys untouched (keys/aliases unchanged).
- `src/screens/a-system.tsx` — error pages removed; keeps `StatesGallery` until 61b.
- `src/screens/system/system.test.tsx` (new, 13 tests) — deep-link each key through the real route host (auth guard → quick-pick sign-in): every page renders its failure frame, help line and enabled recovery action; persona switch updates the shared auth authority and lands on `#/command-center`; access request toasts; not-found shows the requested path and recovers to `#/projects`; 500/offline two-phase retry (fake timers) asserts the warn toast, then recovery + navigation; session-expired signs out and returns to `#/login`; route-coverage closure asserts all 53 inventoried keys resolve to a screen component and unknown keys resolve to nothing.

Runtime accounting (ticket-42 convention): new-file lines 177 (nav 25 + pages 152) + net across edited files (a-system −117, a.tsx +3/−1) = **62 runtime lines**, 5 touched files (≤10).

Checks: `npm run typecheck` clean (0 new); `npm run lint` 197 warnings / 0 errors (baseline 197); `npm test -- --run` 880 passed (867 baseline + 13 new); `npm run build` green.

**Gaps:** browser/preview walkthrough not performed (optional per AGENTS.md § Windows Temporary Process Safety — skipped and recorded, covered by the rendered jsdom cases through the real route host).
