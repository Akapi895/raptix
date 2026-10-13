# 05: Shared UI stores and Query providers

**What to build:** Establish auth, active-project, theme, toast and UI Zustand authorities plus the Query provider/change bridge. Legacy consumers forward to the same shared state; server entities remain in services/Query.
**Blocked by:** 04.
**Status:** resolved
**Owner:** Shared stores/providers/cache integration.
**Contract:** [execution.md](../execution.md).

- [x] Both legacy and migrated consumers observe persona/project/theme/toast/UI changes without duplicate state.
- [x] Query keys include actor/authorization scope and project; committed changes invalidate matching consumers.
- [x] Project/persona switching cancels stale reads; a delayed old response never restores cross-project visibility.
- [x] Demo reset clears related caches and UI state; subscription/timer teardown works across repeated provider mounts.

## Evidence

Implementation: `src/state/stores.ts` (Zustand authorities: auth/persona, active project, theme, toast, transient UI; `resetSharedStores` restores initials + disposes toast timers), `src/state/keys.ts` (`QueryScope`, `consoleKeys`, `useQueryScope`, `createConsoleQueryClient`), `src/state/query.tsx` (`ConsoleProviders` = QueryClientProvider + `ChangeSetBridge` + `ScopeCancelBridge`), wired in `src/App.tsx` inside `StoreProvider`. `src/store.tsx` reads persona/auth/org/project/theme/toasts/UI panels from the shared authorities and forwards all legacy writes into them (single source; no duplicate state). Chosen direction: the Zustand stores are the authority and the legacy context delegates reads/writes to them, because a one-way forward (legacy → mirror) could not satisfy "change through the shared store reflects in legacy consumers".

- Duality resolved both directions: `src/state/stores.test.tsx` — persona via `useAuthStore` observed by legacy `useStore()` consumers and vice versa; project both directions (same `project` object derived); theme toggles document class from either side; toasts raised on either side land in one list; copilot/notices exclusivity + aiMode consistent.
- Scoped keys: `consoleKeys` embed `{ actor, role, project }` at key position 1; `query-bridge.test.tsx` "embed actor, authorization role and project so scopes never collide".
- ChangeSet → invalidation: commit via `authority.commit` refetches a `['project', scope, 'list']` consumer with fresh authority data; a project-scoped commit also refetches aggregate views (predicate over embedded scope, skipping kinds already covered by the kind-prefix pass). `corr: 'reset'` cancels queries, removes inactive cache entries and invalidates all.
- Scope-cancel: switching project/persona via the shared store cancels the superseded scope's in-flight Query fetch (asserted via aborted `AbortSignal`), calls the ticket 04 seam `services.cancelScope`, and the late delayed response is dropped — the B view still shows only B data and no A cache entry holds the late value.
- Demo reset: `resetDemo` → `ChangeSet(corr 'reset')` clears the Query cache and refetches from the reseeded authority (pinned flag reverts to seed), clears shared toast/UI state; toast timers are disposed on provider teardown and never fire into a later mount (fake timers). Bridge teardown proven by a subscribe spy: listener removed on unmount, remount rewires exactly once per commit.

Checks (in `apps/web-improve`): `npm run typecheck` 0 errors; `npm run lint` 226 warnings (baseline, 0 errors); `npm test -- --run` 91 passed (76 baseline + 15 new); `npm run build` succeeds. Real app: `npm run build` + `vite preview` served HTTP 200 with the mounted root div; interactive browser walkthrough of persona/project switching was not possible in this environment (no browser tooling) — recorded as a gap below.

Gaps: none known beyond the browser-interaction check above. `cancelScope` role fallback uses `USERS` lookup at cancel time; ticket 06's stable actor ids supersede the name-keyed scope.
