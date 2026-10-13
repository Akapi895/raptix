# 61b: States gallery semantic module

**What to build:** Move `StatesGallery` from `src/screens/a-system.tsx` into `src/screens/system/gallery.tsx` (route key `states`, route-inventory row 7) and retire `a-system.tsx` — `src/screens/a.tsx` imports the whole system slice from `src/screens/system/`. Gallery actions (simulate-reload timer, sample navigation, switch-project, toasts) run through the module's router seam and the ticket-05 shared authorities; the reload timer is disposed on unmount.
**Blocked by:** 61a.
**Status:** resolved
**Owner:** System/demo feature and route coverage closure; second leaf of the ticket 61 split (umbrella: [61](61-system-demo-surfaces.md)).
**Contract:** [execution.md](../execution.md).

- [x] `states` renders its samples (loading/empty/error/denied/read-only/stale/partial/no-data) and the full status legend at the existing key.
- [x] Gallery controls work through the shared authorities; the simulate-reload timer cannot fire after unmount.
- [x] `src/screens/a-system.tsx` is deleted with zero remaining callers; the manifest still resolves `states`.

## Evidence

**Commit** `feat(web-improve): states gallery semantic module (ticket 61b)` — branch `wi/61-demoworks`:

- `src/screens/system/gallery.tsx` (new, 95 lines) — `StatesGallery` moved verbatim; `go`/`toast`/`setSwitcherOpen` now come from the system nav seam + `useToastStore`/`useUiStore`; the 1.2 s simulate-reload timeout is tracked and cleared on unmount.
- `src/screens/a-system.tsx` — deleted (zero callers after `a.tsx` rewires).
- `src/screens/a.tsx` — `states` imports from `./system/gallery`; the auth/system slice record keeps its export shape, so the registry is untouched.
- `src/screens/system/system.test.tsx` (extend) — the `states` deep link renders the gallery with the status legend and every sample heading; reload shows the loading skeleton; gallery sample actions navigate/toast.

Runtime accounting: new-file lines 95 + net across edited files (a-system −99 deleted, a.tsx +2/−1) = **−3 runtime lines** (a net deletion), 4 touched files.

Checks: `npm run typecheck` clean; `npm run lint` 197 warnings / 0 errors; `npm test -- --run` 884 passed (880 + 4 new); `npm run build` green.

**Gaps:** browser walkthrough not performed (optional per AGENTS.md § Windows Temporary Process Safety).
