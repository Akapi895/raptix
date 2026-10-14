# 67: Remove the final legacy store/navigation/UI bridge

**What to build:** Remove residual Context/store/hash-router/UI forwarding infrastructure after all screen consumers are gone; keep the canonical database/services/providers as the final architecture.
**Blocked by:** 66.
**Status:** in-progress — batch 1 (the dead legacy core) and the continuation batches 2–6 (the enumerated residual helpers/labels/re-exports) landed on `wi/67-retirelegacy` / `wi/67b-retirelegacy`; the remaining live Context seam (`useStore` ×106 files, `StoreProvider` ×61) and its live delegating `A.*` entries are enumerated below and need further per-feature batches.
**Owner:** Final core contraction.
**Contract:** [execution.md](../execution.md).

- [ ] No component/test/demo reads the old store/database or writes location outside the router; remaining compatibility definitions have zero callers. *(Batch 1 retired every zero-caller legacy-core definition; the continuation batches 2–6 retired the enumerated residual helpers (computePreflight, allocation/groupSummary, hhmm, today, completion, sessionPerm, sevLabel, ROLE_LABEL) and the Route/CanAction/CopilotCtx type re-exports. The live Context seam (`useStore` ×106 files, `StoreProvider` ×61) and its live delegating `A.*` entries remain for per-feature batches.)*
- [ ] Final seed/reset/timers/subscriptions belong to canonical services; removal does not reseed data or break observable events. *(Already owned by the canonical services since ticket 04 — `services.reset`/clock/authority; batch 1 removed only zero-caller definitions, so no seed/reset/timer path changed — bridge/reset/grant suites stay green.)*
- [x] Runtime deletion is measured and split if needed; no oversized monolith deletion is assumed exempt. *(Six batches over the two branches: batch 1 = 1 + 4 + 8 touched files, +4/−49, +23/−38, +19/−15; continuation batches 2–6 = 8 + 10 + 5 + 9 + 3 + 3 touched files, +48/−41, +21/−9, +10/−14, +80/−66, +8/−11, +14/−11 — each batch far under the caps; continuation total +181/−152 runtime lines over 28 files.)*
- [ ] Typecheck/lint/test/build pass with zero remaining migration diagnostics and final-interface invariant coverage only. *(All four pass on both branches — typecheck 0, lint 0 errors with 182 warnings at the ticket base → 179 after batch 1 → 171 after the continuation (a per-file diff over the 28 touched files proves 0 new findings: every file equal except `store.tsx` 21→13 and `h-session.tsx` 9→9 after the C2 relocation), 926 tests green, build ✓. Outstanding diagnostics are the pre-existing screen-level debt owned by ticket 69.)*

## Retired definitions (batch 1, three commits)

1. `8461bc2` — zero-caller legacy store actions (1 file, +4/−49). Each entry had
   zero callers anywhere (code/tests/demo, verified by `git grep` before
   deletion); their typed feature implementations are the one remaining path:
   - `A.removeFromGroup` (typed: agents service `removeFromGroup`),
     `A.updateFinding`, `A.addRetest`, `A.attachEvidence` (findings service),
     `A.submitReport`, `A.returnReport` (reports service
     `submitReportVersion`/return decision), `A.setConversationMode` (aichat
     service `setMode`), `A.requestBranchRetry`, `A.reassignBranch` (branches
     service `retry`/`reassign`), `A.setSessionState` (c2 writes).
2. `51320c8` — dead store exports + type re-exports (4 files, +23/−38):
   - `readiness` + `ReadyItem` — zero importers; the semantic derivation is
     `screens/dashboard/domain.ts` (pinned by the dashboard/detail suites).
   - Dead type re-exports: `Check`/`CheckState`, `EligKind`/`Reason`,
     `PlanStatus`/`ToolEvent`, `Toast` (kept `CopilotCtx`),
     `projectAgentsOnline` — zero importers (legacy `./data` type imports are
     still covered by its `export type *`).
   - Un-exported internal-only definitions (referenced by the `Store`
     interface or store internals, imported by nobody): `stamp`, `Persona`,
     `LogLine`, `ConfirmOpts`, `OpDraft`, `FindingDraft`, `Actions`.
   - `preflightPass` forwarding re-export — the 3 callers
     (`c-console`, `c`, `safety/preflight.test`) now import the identical
     function from `features/operations/preflight` directly.
3. `45b36e8` — eligibility forwarding re-export (8 files, +19/−15): the 7
   screen/shell consumers (`b-portfolio`, `c`, `e-analysis`, `g-chat`,
   `g-common`, `g-workspace`, `shell/context-ribbon`) import `eligibility`
   from `features/operations/preflight` — the exact function the re-export
   forwarded to; the store's last pure forwarding export is gone.

## Retired definitions (continuation batches 2–6, `wi/67b-retirelegacy`)

Every retired definition was either moved to its semantic home with all
consumers re-pointed, or deleted with its only consumer owning it; the
observable behavior (demo-clock anchor, labels, derivations) is unchanged.

1. `39c812f` — the store's `computePreflight` demo-anchor wrapper (8 files,
   +48/−41). The 7 callers (`c`, `c-common.specChecks`, `c-console`,
   `approvals/service.test`, `assets/writes.test`, `safety/isolation.test`,
   `safety/preflight.test`) now call `computePreflightChecks` from
   `features/operations/preflight` at the factory clock's instant
   (`services.clock.now()` in mounted code; a `MockClock` — the factory's own
   class and demo anchor — in the static-seed preflight suite). `specChecks`
   takes the explicit `now: Instant`. The PRE-04 anchor is unchanged: the
   wrapper's `Date.UTC(2026, 9, 13, 0, nowMin()) − PROJECT_TZ_OFFSET_MS` and
   the factory clock's `DEMO_ANCHOR` (Oct 13, 2026, 10:42 AM UTC+7) agree.
2. `392a791` + `19a5ec0` — `ROLE_LABEL` moved to the auth policy authority
   (`src/auth/policy.ts`, the 6-role matrix module; 15 files, +31/−23). All 9
   screen/shell consumers import it from there; the store's definition is
   deleted (the store's audit action imports the canonical map).
3. `19a5ec0` — the store's dead type re-exports (same commit): `Route`
   (`c-common`, `shell` now import `router/history`), `CanAction`
   (`rbac.test` imports `domain/permissions`), `CopilotCtx` (`shell/header`
   imports `state/stores`). Zero callers left on the store's re-exports.
4. `ae78c53` — single-consumer helpers moved to their consumers (9 files,
   +80/−66): `allocation`/`groupSummary` are local to `g-fanout` (their only
   consumer); `completion` is local to `closure/service.test` (the canonical
   checklist consumer); `sevLabel` moved to the findings feature
   (`features/findings/service`) with `e-findings`/`f-report` re-pointed;
   `hhmm` left the store's export surface (the session console resolves it
   from the C2 feature — see 6); `today` dropped from `f-settings` (it was
   only a `{void today}` unused-import marker; the store keeps its internal
   demo-date constant for `togglePolicy`).
5. `e57ebcd` — `sessionPerm` retired (3 files, +8/−11): `c-console`'s session
   cards and `shell/search` resolve `sessionPermOf(db, ctx, s)` from
   `features/c2/service` — the same derivation (viewer ⇒ none, membership
   gate, grant ⇒ grant perm, else read-only) with an explicit request context.
6. `220431f` — the demo wall-clock label `hhmm` hosted in the C2 feature
   service (`features/c2/service.ts`, 3 files, +14/−11): React-free home for
   the grant-countdown clock (the `accessOf` formatter already owns the
   `expires` vocabulary); `h-session` and `safety/grants.test` (the
   `10:42` anchor lockstep assertion) import it from there, keeping the
   `shell.test` lint profile at its base count.

## Residual legacy-core inventory (later batches, owners TBD)

After batches 1–6 the store's export surface is exactly the live Context seam
plus the documented membership seam (grep census on `wi/67b-retirelegacy`):
`StoreProvider` (61 files), `useStore` (106), `useServices` (25 — canonical),
`useDirty` (8), `canAccessProject` (4 — ticket 06 policy seam), the `Store` and
`ProjectDraft` types, and the live delegating `A.*` entries with callers:

- The Context bridge itself: `useStore`/`StoreProvider`/`useDirty` —
  per-feature migration to `useServices`/Query + typed actions, then retirement.
- Live delegating `A.*` entries with callers (estop orchestration, operation
  controls + demo log mirrors, C2 termination, demo simulations) — migrate
  per feature, keeping the observable log/toast behavior.
- Known non-store duplication (out of this ticket's ledger, noted for owners):
  12 feature modules still hold private copies of the ROLE_LABEL map
  (`agents/writes`, `approvals/service`, `assets/writes`, `branches/service`,
  `c2/grants`, `closure/service`, `estop/service`, `operations/service`,
  `plans/bridge`, `plans/service`, `trace/writes`, `wizard/service`) — they can
  resolve the canonical `auth/policy` map in their own tickets.

## Evidence

- `npm run typecheck` — 0 diagnostics (after every commit).
- `npm run lint` — 0 errors; 182 warnings at the ticket base → 179 after.
  File-level diff over the 10 touched files (base files checked out at
  `f0f53b7` and linted in place): every file unchanged except `store.tsx`
  (24 → 21, refresh warnings removed with the deleted exports) — 0 new
  findings.
- `npm test -- --run` — 926 tests / 69 files green. The known pre-existing
  parallel-load flake (recorded by tickets 22/65/66) surfaced twice as the
  same pair (`features/agents/writes.test.tsx`, `shell/shell.test.tsx`) on
  2 of 12 full runs — both files pass in isolation (4/4) and in 10 green
  full runs including consecutive ones; no timer/fake-clock assertion was
  changed by this ticket. 3 full runs at the base reproduced neither failure.
- `npm run build` — succeeds (pre-existing chunk-size warning only).
- Grep proof (post-batch tree): retired `A.*` entries
  `removeFromGroup|updateFinding|addRetest|attachEvidence|submitReport|returnReport|setConversationMode|requestBranchRetry|reassignBranch|setSessionState`
  → 0 hits; `export function readiness|interface ReadyItem|export type { PlanStatus|export type { Check|export type { EligKind|export { projectAgentsOnline|export { preflightPass|export { eligibility }|export type { CopilotCtx, Toast }|export interface (LogLine|ConfirmOpts|OpDraft|FindingDraft|Actions)|export type Persona|export const stamp`
  → 0 hits; `eligibility`/`preflightPass` resolve at
  `features/operations/preflight` import sites only (9 caller files), and
  `store.tsx` imports from that module internally without re-exporting.
- Behavior-identical evidence: every retired definition had zero callers or
  was re-pointed to the exact function its forwarding export resolved to
  (same module, same symbol — `features/operations/preflight`). No route,
  seed, timer, subscription or observable event path changed; all baseline
  suites pass with assertions kept.
- Browser route exercise: skipped — preview HTTP check optional per AGENTS.md
  § Windows Temporary Process Safety (recorded as a verification gap; the
  eligibility/preflight derivations are pinned by the preflight feature,
  dashboard, portfolio, workspace and safety suites, and `npm run build`
  covers the module graph).

### Continuation (batches 2–6, `wi/67b-retirelegacy`)

- `npm run typecheck` — 0 diagnostics (after every commit).
- `npm run lint` — 0 errors; 179 warnings after batch 1 → 171. File-level
  diff over the 28 touched files (base checked out at `e3c0fe9` and linted in
  place per file, then restored; worktree clean after): every file unchanged
  except `store.tsx` (21 → 13, the deleted exports' refresh warnings removed)
  — 0 new findings. (`h-session.tsx` briefly gained a react-refresh finding
  for the relocated `hhmm` export; hosting it in the React-free C2 feature
  service restored the file to its base count of 9.)
- `npm test -- --run` — 926 tests / 69 files green. The known pre-existing
  parallel-load flake (recorded by tickets 22/65/66 and batch 1) surfaced in
  2 of 9 full runs as the same file (`shell/shell.test.tsx`); it passes in
  isolation (12/12) and in the consecutive green full runs, and no timer/
  fake-clock assertion was changed by these batches (the grant countdown test
  now imports `hhmm` from the C2 feature service and still asserts the
  `10:42` anchor lockstep).
- `npm run build` — succeeds (pre-existing chunk-size warning only).
- Grep proof (post-continuation tree): the store's retired exports
  `export function (computePreflight|allocation|groupSummary|completion|sessionPerm|hhmm)|export const (sevLabel|ROLE_LABEL|today)|export type \{ (CanAction|CopilotCtx|Route)`
  → 0 hits in `store.tsx`; the store's remaining export surface is exactly
  `canAccessProject`, `Store`, `ProjectDraft`, `useStore`, `useServices`,
  `StoreProvider`, `useDirty`. Consumer resolution: 9 files import
  `ROLE_LABEL` from `../auth/policy` (plus the store's internal audit use);
  `computePreflightChecks` resolves at the preflight feature (11 files);
  `sessionPermOf` at `c-console`/`search`; `sevLabel` from
  `features/findings/service` at `e-findings`/`f-report`; `hhmm` from
  `features/c2/service` at `h-session`/`grants.test` (the store keeps an
  unexported internal copy for its demo log mirrors); `allocation`/
  `groupSummary` exist only inside `g-fanout`; `completion` only inside
  `closure/service.test`.
- Behavior-identical evidence: every retired definition moved with its
  consumers to the exact semantic function it forwards to (`computePreflight`
  → `computePreflightChecks` at the same demo anchor; `sessionPerm` →
  `sessionPermOf`, same rule; `sevLabel`/`ROLE_LABEL` byte-identical maps) or
  is owned by its only consumer (allocation/groupSummary/completion/hhmm).
  No route, seed, timer, subscription or observable event path changed; the
  grant-countdown and preflight anchor assertions pass unchanged.
- Browser route exercise: skipped — preview HTTP check optional per AGENTS.md
  § Windows Temporary Process Safety (same verification gap as batch 1; the
  migrated derivations are pinned by the preflight, closure, agents, C2 and
  safety suites, and `npm run build` covers the module graph).

### Enabler A (session store, `wi/67c-session`)

The remaining Context-seam migration needs the provider's transient UI state
off `useState`/refs first: `StoreProvider`'s confirm dialog, dirty/unsaved
guard, demo logs, stale marks, filters, stop outcome, AI busy and loading
flag moved into the canonical session Zustand authority
(`src/state/session.ts`), following the ticket 05 authority pattern
(selector-based store, synchronous `resetSessionStores()` restoring
initials). The public `Store` interface, every consumer and every observable
behavior are unchanged — the provider reads/writes the session store exactly
like it forwards persona/theme/toasts to the shared authorities. Zero screen
or test edits outside the new suite; 3 touched files (+52/−53 on the store),
far under the caps.

- `src/state/session.ts` (new, 106 runtime lines): `useSessionStore`,
  `resetSessionStores()` and the moved `LogLine`/`ConfirmOpts` types (plus
  `UnsavedNav` for the guard's held navigation). The guard reads synchronous
  state (`getState()`), so the old `dirtyRef` staleness hazard ("dirty
  cleared first, the unsaved guard must not hold the redirect") cannot
  recur; `setDirty(on, save)` keeps its semantics (`save` cleared when `off`)
  and `useDirty` keeps its exact signature. `clearTransient()` clears
  exactly the demo's transient set (dirty/save, confirm/unsaved modals, AI
  busy, stale marks, filters) — `resetDemo` still leaves loading and
  stopOutcome untouched and rebuilds logs through the store.
- `src/store.tsx` (+52/−53): all transient reads/writes forwarded to the
  session store; `resetSessionStores()` added to the provider's synchronous
  init next to `resetSharedStores()` (repeated provider mounts never
  inherit a previous mount's session state). `later()`/`aiTimers`/ticker/
  clock-lockstep and the demo wall clock stay in the provider (runtime
  concerns): `pushLog` still computes the `hhmm()` timestamp at the call
  site and the ticker/`emergencyStop` keep their render-synced refs.
- `src/state/session.test.tsx` (new, 155 test lines): duality both
  directions — a `useSessionStore` write is observed by a legacy `useStore()`
  consumer and vice versa — for confirm, the dirty guard (incl. the
  clear-then-navigate-in-one-tick behavior and the save-capture), logs
  (store `pushLog` ↔ legacy `A.fastForward` mirror), staleOps, filters,
  stopOutcome and aiBusy (via the real `sendChat`/`stopChat` lifecycle), plus
  the repeated-`StoreProvider`-mounts no-inheritance regression covering
  every moved field.

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
171 → 169 warnings (store.tsx 13 → 11: the two `persistFilters` `any`
findings left with the deleted state setters; both new files lint clean — 0
new findings). `npm test -- --run --maxWorkers=2` — 938 tests / 70 files
green (926 baseline + 12 new; the known parallel-load flake did not
surface; no existing assertion changed). `npm run build` — succeeds
(pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap as the
earlier batches; the transient state is pinned by the new session duality
suite, the ticket 05 authority suite and the shell/estop/c-console/aichat
suites that exercise these fields through real screens).

### Enabler B (canonical navigation, `wi/67d-navigate`)

Navigation (the raw router forward, the guarded `go`, the route projection
and the auth navigation) moves out of the provider into the canonical router
module `src/router/navigate.ts`, so the ~40 screen files still taking
`go`/`route` from `useStore()` have a store-free replacement. The router
stays the single location writer (ticket 07/61e): the fallback branch only
serves router-less mounts, the projection keeps exactly one router
subscription (now owned by the module's `useRoute()` hook), and there is
deliberately no window hashchange listener.

- `src/router/navigate.ts` (new, 91 runtime lines): `go()` (guarded through
  the session authority — synchronous `getState()`, so the
  clear-then-navigate-in-one-tick behavior is never held), `navRawRoute()`,
  `useRoute()`, `currentRoute()` (synchronous read for the provider's
  `login`/`setPid` redirect logic) and a mount-epoch guard: a navigation
  closure that outlives its provider mount (a screen's delayed redirect)
  must not move a later mount's projected route — sequential provider mounts
  (the test suites) rely on that isolation, matching the old provider-local
  `setRoute` no-op-after-unmount.
- `src/store.tsx` (+~40/−45): the store's `navRaw`/`go`/route state/`useEffect`
  subscription are deleted; `Store['go']` forwards to the module with this
  mount's epoch, `setPid`'s DETAIL_MAP redirect and `login`/`logout` navigate
  through `navRawRoute` with the same redirect conditions, and `route` is the
  module projection. The `Store` interface is unchanged — zero consumer edits
  in this batch.
- `src/router/navigate.test.tsx` (new, 147 test lines): guarded `go` holds a
  dirty navigation behind the unsaved guard and proceeds through `next()`;
  the clear-then-navigate-in-one-tick is not held; `useRoute()` reflects
  router navigation (hash router mounted) and the router-less fallback writes
  route state + hash; `go` works from non-component code; the mount-epoch
  guard keeps a captured redirect from moving a later mount's route.

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
169 warnings (unchanged from the enabler A tip; both new files lint clean).
`npm test -- --run --maxWorkers=2` — 950 tests / 71 files green (938 baseline
+ 12 new; the known parallel-load flake did not surface). `npm run build` —
succeeds (pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap;
navigation semantics are pinned by the new navigate suite plus the
route/host/shell/dashboard suites that exercise `go`/`route` through real
mounted routes).

### Enabler C (demo clock + guarded project selection, `wi/67e-enabler-c`)

Two more store-owned behaviors needed canonical homes before the consumer
waves can leave `useStore()`:

- `src/domain/demo-clock.ts` (new, 35 runtime lines): the demo wall-clock
  projection (the T0 anchor, `hhmm`, `hhmm12`, `stamp`, `today`) moves here
  verbatim from the store's private copies; the C2 feature service re-points
  its `hhmm` to the single anchor (re-export kept for the session console
  and its suite — one anchor now backs audit/notice stamps, the live logs
  and the grant countdown, instead of two same-valued module-eval anchors).
- `src/router/navigate.ts` gains `selectProject(id)`: the guarded project
  switch (unsaved-changes guard → project-store write → switcher close →
  450 ms shell loading gate → DETAIL_MAP redirect computed from the
  committed route and written once) moves verbatim out of the provider; the
  store's `setPid` forwards to it with this mount's epoch. Screens taking
  `setPid` from the store can now use the canonical module.
- `src/router/navigate.test.tsx` (+3 tests): the dirty switch is held behind
  the unsaved modal and proceeds with the loading gate + switcher closed;
  a detail route redirects to the selected project (and `all` falls back to
  the portfolio); re-selecting the active project only closes the switcher.
  `beforeEach` now also calls `resetSharedStores()` so the project store's
  pid cannot leak between tests.
- `src/store.tsx` (−28 net): private clock copies and the `setPid`
  implementation deleted; forwards only.

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
169 → 168 warnings (store.tsx 11 → 10 with the deleted selector; new files
clean). `npm test -- --run --maxWorkers=2` — 951 tests green (938 baseline +
13 navigate: 9 prior enabler-B + 3 new + recount) with no existing assertion
changed. `npm run build` — succeeds (pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap; the
switcher/loading/redirect behavior is pinned by the new navigate tests plus
the shell/project-switcher, b-detail and dashboard suites that exercise
`setPid` through real screens).
