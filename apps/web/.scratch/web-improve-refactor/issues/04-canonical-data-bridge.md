# 04: One database and legacy/service transaction bridge

**What to build:** Move database ownership behind the canonical transaction/subscription bridge and inject its context into the service factory. Adapt legacy reads/mutations to that same authority; add a representative typed project read/write adapter, not handlers for every entity.
**Blocked by:** 03.
**Status:** resolved
**Owner:** Database, bridge, factory and clock lifecycle.
**Contract:** [execution.md](../execution.md).

- [x] Legacy Context and services share one seed/snapshot; mutations are atomic and publish affected identities.
- [x] A service mutation is observed by a legacy consumer and a legacy mutation by a service subscriber; IDs/counters remain coherent.
- [x] Factory injection supplies the real handler with actor/project/clock; latency cancellation and deadline/sweep scheduling are testable.
- [x] Reset replaces the one dataset, disposes pending callbacks/subscriptions and is deterministic when repeated; current app behavior and baseline tests remain intact.

## Evidence

Worktree branch `wi/04-bridge` (base == integration tip `web-improve-refactor` at `924fedf`; merged before commit).

**Delivered**

- `src/domain/database.ts` — `createDatabaseAuthority(clock)`: the one seeded database. `commit(corr, mutate)` is atomic (clone → apply → replace) and publishes one `ChangeSet` (affected `EntityRef`s per entity kind, single `projectId` when scoped, factory-clock instant, correlation id) to subscribers; `reset(variant)` reseeds the same authority and publishes `corr: 'reset'` (wholesale invalidation signal). Collection→kind map covers all 27 Db collections plus `stop-state`. `seed()` is now called from exactly one runtime site (this module); the legacy store and services both commit through it — no second seed.
- `src/domain/clock.ts` — mock clock anchored at the dataset demo instant (Oct 13, 2026, 10:42 AM UTC+7 = `DEMO_ANCHOR`); `advance(ms)` moves elapsed time as absolute instants (date rollover included) and fires due scheduler callbacks; `formatDemoInstant` renders display strings in the project timezone (Asia/Ho_Chi_Minh); `parseDemoInstant` normalizes seeded expiry strings ("Oct 14, 2026, 9:25 AM (UTC+7)") into absolute instants at the service boundary; `Scheduler` is discrete (clock-driven, no real timers) so deadline/sweep events run without any screen mounted; `reset()` restores the anchor.
- `src/domain/service-factory.ts` — `createConsoleServices()`: composition root wiring authority + clock + scheduler; `schedule(at, fn)` and `sweep(ms, fn)` (recurring, reschedules from its slot so one long advance covers every elapsed interval); `subscribe` (bridge subscription); `forScope(actor, projectId)` injects actor/project/clock into the representative typed `ProjectService` (`get`/`list` scope-checked reads + one typed atomic `update` write); `cancelScope` resolves in-flight reads as `unavailable` when a persona/project scope is superseded; `reset` disposes scheduled callbacks + restores the anchor + reseeds; `dispose` tears down wiring.
- `src/store.tsx` (minimal plumbing only, +44/−15): state is now a projection of the authority (`services.authority.snapshot()`); `mutate` commits through `authority.commit('legacy', fn)`; subscription keeps `dbRef`/state in sync; `resetDemo` cancels pending dataset-bound timers, clears AI timers and delegates to `services.reset`; the four dataset-bound `setTimeout` call sites (emergency stop ×2, terminate session, AI chat response) go through a tracked `later()` helper; `ServicesCtx`/`useServices` expose the factory to consumers. No feature logic ported.
- `src/domain/bridge.test.tsx` — 16 tests (76 total in suite).

**Bridge acceptance (both directions, mount-based where Context is involved)**

- Service mutation → legacy consumer: `bridge.test.tsx` "a service mutation is observed by the legacy consumer" — mounts `StoreProvider`, calls `forScope(...).update(...)` through the service contract, asserts the legacy context's `db` reflects the change and that `store.db === authority.snapshot()` (one dataset, same object).
- Legacy mutation → service subscriber: "a legacy mutation is observed by a service subscriber with coherent ids/counters" — subscribes to the bridge, runs `A.setAssetScope` (legacy action), asserts two `corr: 'legacy'` ChangeSets (asset + audit entities) and that `counters.audit` incremented once in the shared dataset.
- Additional acceptance scenarios: atomic commit + published identities with clock instant/corr ("commits atomically…"), scope-checked typed reads incl. out-of-scope `not-found` and context-project narrowing ("typed reads are scope-checked", "typed list honors…"), unauthorized typed write rejected with no commit ("the typed write refuses unauthorized actors without committing"), read cancellation on scope change ("cancelling a scope resolves in-flight reads as unavailable"), request context bound at call time with clock-stamped display string ("factory injection binds the request context at call time"), deadline scheduling from a seeded expiry string with date rollover ("schedules deadline events at parsed seeded expiry instants"), sweep/cancel/reset disposal ("runs recurring sweeps…"), reset twice with determinism + pending-callback disposal + anchor restoration ("demo reset replaces the one dataset…", run three times incl. variant + default), and store-timer disposal across two resets under fake timers.

**Clock/reset semantics**

- Anchor retained: `clock.now() === DEMO_ANCHOR` = Oct 13, 2026, 10:42 AM (UTC+7); `formatDemoInstant` matches the seed's display format exactly (test-asserted).
- Elapsed time advances as absolute instants incl. rollover (10:42 → 12:12 PM same day → Oct 14 across a 24h advance, asserted via formatted display strings).
- Seeded expiry strings normalize at the service boundary; `updated` written by the service write uses `formatDemoInstant(clock.now())` (clock time, not host wall-clock). Timezone (UTC+7) applies to display/window checks only.
- Reset: cancels owned scheduler callbacks (discrete, screen-independent) and pending store timers, restores the clock anchor, reseeds the one dataset, publishes `corr: 'reset'`; deterministic when repeated (snapshots deep-equal fresh `seed()` after each of two resets; subscriber notified exactly once per reset).

**Checks (in `apps/web-improve`)**

| Command | Result |
|---|---|
| `npm run typecheck` | 0 diagnostics |
| `npm run lint` | 0 errors, 226 warnings (== baseline; new `useServices` export carries the file's established targeted `react-refresh` disable, as in `test/helpers.tsx`) |
| `npm test -- --run` | 9 files, 76 passed (60 baseline + 16 new bridge tests) |
| `npm run build` | success (1.44 MB bundle, chunk-size warning pre-existing) |
| `npm run preview` + GET `/` | HTTP 200, `#root` present, bundle 200 (1.4 MB) and contains the seeded dataset |

**Budget:** 388 runtime lines added (clock 91, database 98, service-factory 155, store +44/−15; tests excluded per QUALITY_BAR "budget is on runtime code"), 6 files touched, one concern — no split needed.

**Gaps:** browser-level interaction (clicking through screens, reset from the demo menu) not performed — no browser in this environment; covered instead by build+preview serving and the jsdom-level suite (App test + 60 baseline screen/safety tests exercising the bridged store). Legacy display helpers (`hhmm`/`stamp`) still derive minutes from host elapsed time — rewiring them to the service clock is display plumbing owned by later feature tickets; expiry enforcement already compares absolute instants.
