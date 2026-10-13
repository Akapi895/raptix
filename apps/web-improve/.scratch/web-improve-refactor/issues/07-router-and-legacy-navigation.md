# 07: Router, route inventory and legacy navigation adapter

**What to build:** Introduce React Router, lazy route wrappers, auth/404/error handling and the `go()` compatibility adapter. Record all source route keys and their canonical URLs/tabs before changing routing. Shell and UI extraction follow separately.
**Blocked by:** 06.
**Status:** resolved
**Owner:** Router, route inventory and serialized manifest registration.
**Contract:** [execution.md](../execution.md).

- [x] The inventory captures the source's 53 keys, entity IDs and tab aliases, with command-center home and no invented dashboard alias.
- [x] Direct navigation/refresh, old hash links, browser back/forward and base-path deployment resolve consistently; unauthenticated access preserves a safe return destination.
- [x] Legacy `go()` and route readers forward to the new router; no duplicate hash listeners or competing location writers remain.
- [x] Lazy loading, route crashes, not-found, dirty-navigation blocking and project detail transitions have rendered smoke tests.

## Evidence

**Inventory** — `route-inventory.md` records exactly **53 keys** (9 auth/system
`a`, 3 projects `b`, 5 operations `c`, 10 agents/assets/library `d`, 6
analysis/findings `e`, 6 reports/settings `f`, 8 AI `g`, 4 C2 `h`, 2 public
`s`) with entity-ID params, tab values and legacy tab aliases
(`project` TAB_ALIAS, `assets?tab=scope-map`, `agents` pool/groups/health,
`ai-plan` step deep links). `command-center` is home; the shell's
`match: ['command-center','dashboard','tasks']` array is documented as nav
highlighting, not a route key; no dashboard alias was invented.

**Router** — `createHashRouter` (React Router 7, splat route) in `src/App.tsx`;
`src/router/{history,active,registry,host}.tsx` add the codecs, the
active-router pointer, the append-only manifest registry and the route host.
URL format is unchanged (`#/page/id?tab=`), so pre-migration deep links work
verbatim; hash routing also survives base-path deployments (vite `base` may be
a public sub-path). `router.navigate` receives the path form (`toHref`);
`#/...` remains the address-bar form (`toHash`).

**Adapter & single writer** — `store.navRaw` forwards to
`router.navigate(toHref(route))` when the router is active (one location
writer); the legacy state+hash write survives only as the router-less fallback
(tests). The store's `route` is a projection of the router location via
`router.subscribe` — the store's own `hashchange` listener was removed (one
listener, owned by the router). `go()` keeps its legacy signature and
dirty-guard semantics for all screens; `setPid` no longer writes
`location.hash` inside a `setRoute` updater (the ledger G-note): the redirect
is computed from the committed route and written once — regression-tested in
both orders.

**Guard** — unauthenticated visits to protected URLs render the login screen
in place, preserving the requested URL as the safe return destination; after
sign-in the same URL resolves (unknown destinations fall back to
command-center). Deep links no longer auto-authenticate: the auth store
(ticket 06) is the single authorization authority.

**Checks** (in `apps/web-improve`): `npm run typecheck` clean (0 new);
`npm run lint` 0 errors / 226 warnings (= baseline 226, 0 new); `npm test --
--run` 13 files, **123 passed** (112 baseline + 11 new route smoke tests);
`npm run build` succeeds with the feature slices split into lazy chunks
(b/c/d/e/f/g/h/scenarios/ui).

**Rendered smoke tests** (`src/router/routes.test.tsx`): deep link with entity
id (`#/agent/AG-009`), tab deep link (`#/settings?tab=policies`), protected
deep link → login in place → sign-in returns to the same URL
(`#/project/RT-2026-014?tab=scope`), unknown key → not-found (and unknown
post-login → command-center), back/forward via real history, in-app dirty
navigation held by the unsaved-changes modal (Stay/Discard), dirty popstate
held then proceeding on discard, `setPid` single-write redirect on a detail
route with a delayed-clobber probe, per-page error boundary containment, and
the root router error boundary.

**Real app** — `vite preview` (built app): `/`, `/project/RT-2026-014`,
`/c2-session/SS-041` return 200 with the app shell and the entry bundle
serves. Gap: hash deep-link resolution and the back/forward/dirty flows are
verified by rendered jsdom tests, not by clicking in a real browser — browser
verification remains a gap for an integrator/reviewer with a browser session.
