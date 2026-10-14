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

### Enablers D+E (console read seam + demo runtime, `wi/67f-enabler-de`)

The last two store-owned behaviors the consumer waves need, landed as one
branch with two concerns:

- **D — `src/state/console.ts` (new, 104 runtime lines):** the canonical
  component-facing read seam over the one authority — `useDb` (the atomic
  snapshot via `useSyncExternalStore`), `useMe` (the seeded persona with the
  settings-committed org role override), `useAccessible`, `useActiveProject`,
  `useScoped` (the G-12 filter, moved verbatim), `useCan`/`useReadOnly`
  (policy decisions for the current persona + project). Feature data keeps
  flowing through the feature-local Query read models; this seam covers only
  the identity/project/scope/permission derivations screens need
  synchronously, so consumers leave the store context with identical
  render behavior.
- **E — `src/features/demo/runtime.ts` (new, ~230 runtime lines):** the
  demo's execution-outcome engine moves out of the provider's `A.*` entries
  verbatim — the emergency-stop simulated outcome switch (with the
  stop-outcome read from the session authority), the AI chat's 900 ms
  response timer, agent loss/restore + fast-forward simulations and the
  session-revoking delay. The provider registers its services per mount
  (`initDemoRuntime`) and `resetDemo` disposes the tracked timers
  (`resetDemoRuntime`); every scheduled timer captures its creating runtime,
  so a callback outliving its mount commits to that mount's own orphaned
  authority (the isolation the closure-bound `later` used to give).
  The `A.emergencyStop`/`retryStop`/`resolveStop`/`sendChat`/`stopChat`/
  `loseAgent`/`restoreAgent`/`fastForward`/`terminateSession` entries
  delegate to the runtime — one implementation, two entry points, until the
  store retires. The store's local timer bookkeeping (`pendingTimers`,
  `aiTimers`, `stopOutRef`, `chatApi`) is deleted with the move.
- `src/state/console.test.tsx` (new, 7 tests): the seam observes the same
  authority object the legacy store projects (identity across commits);
  `useMe` mirrors the override-aware persona across switches;
  `useAccessible`/`useCan`/`useReadOnly`/`useScoped` agree with the legacy
  seam for every seeded project; `useActiveProject` mirrors the projection
  including 'all'; the viewer persona reads scoped decisions from the same
  authority. Runtime: the emergency stop commits the same requested state
  and honors the fail outcome switch on the tracked delay; `terminateSession`
  drives revoking → terminated with revoked grants.

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
168 warnings (store.tsx 10; both new modules lint clean).
`npm test -- --run --maxWorkers=2` — 955 tests / 72 files green (951
baseline + 7 new − 3 re-enumerated navigate tests from enabler C's recount;
no existing assertion changed). `npm run build` — succeeds (pre-existing
chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap as the
previous batches; the seam derivations are pinned by the new duality suite
plus the rbac/policy suites, and the runtime paths by the estop/aichat/c-console suites that
exercise them through real screens).

### Wave 1 (features/ui/router off the store, `wi/67w1-features`)

The first consumer wave: the 10 feature/UI/router files that only consumed
read state or demo-runtime `A.*` entries leave `useStore()` entirely (the
remaining `useServices`/`useDirty` imports are canonical seams). Exactly 10
runtime files touched, +147/−78 runtime lines — far under the caps.

- `src/features/approvals/hooks.ts` (+24/−12): `useSubmitApproval` /
  `useReopen` call `submitApprovalTransaction` / `reopenProjectTransaction`
  directly via `useServices()` with the A entry's exact ctx
  (`{ actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }`,
  actor from `useMe()`), same refusals (`''`/nothing committed), same
  toasts (`r.failure.message || '<original fallback>'`), `confirm` from the
  session authority, `toast` from the toast authority, `db` from `useDb()`.
- `src/features/copilot/drawer.tsx` (+24/−11): `copilotOpen`/`copilotCtx`/
  `setCopilotOpen`/`aiMode` ← useUiStore; `pid` ← useProjectStore;
  `project` ← `useActiveProject()`; `can`/`readOnly` ← `useCan()`/
  `useReadOnly()`; `toast` ← toast authority; `go` ← router navigate;
  `A.sendChat` → `sendChat` from the demo runtime.
- `src/features/estop/ui.tsx` (+31/−19): the 4 sites — `useStopMachine`/
  `StopProgress`/`EmergencyStopDialog` read `db` via `useDb()`;
  `EmergencyStopDialog` + `StopStatePanel` use runtime `emergencyStop`/
  `retryStop`, `useMe()`, `useCan()`, toast store, session store
  (`stopOutcome`/`setStopOutcome`) and navigate `go`; the estop-`ctx` /
  acknowledge-now logic and every toast byte are unchanged.
- `src/features/notices/header-notices.tsx` (+10/−3): useUiStore
  (`noticesOpen`/`setNoticesOpen`/`setCopilotOpen`), `useMe()`, toast +
  session (`confirm`) stores, navigate `go`.
- `src/features/notices/query.ts` (+5/−4) and
  `src/features/settings/query.ts` (+8/−6): `me` (and settings' `useOrgActor`)
  re-pointed to `useMe()` from `state/console` — same override-aware
  authority, same `[me.name, me.role]` memo for the actor ref.
- `src/features/wizard/use-project-wizard.ts` (+24/−12): `create` runs
  `createProjectTransaction` directly (ctx `{ actor, projectId: '', corr:
  'legacy' }`), refusal keeps `''`-semantics (nothing committed, draft kept,
  same error copy), committed creation performs the raw pid write via
  `useProjectStore.getState().setPid(res.data.id)`; `db` ← `useDb()`,
  `me` ← `useMe()`, `go` ← navigate, `toast` ← toast store.
- `src/ui/guard.tsx` (+4/−2) + `src/ui/use-guard.ts` (+9/−5):
  `PersonaHint` reads `useMe()` + `useAuthStore((s) => s.setMe)`;
  `useGuard` composes `useReadOnly`/`useMe`/`useDb`/`useProjectStore` with
  the identical reason cascade.
- `src/router/host.tsx` (+8/−4): `DirtyNavBlocker` reads
  `dirty`/`guarded`/`setDirty` from the session authority; `BoundaryFallback`
  and `RouteHost` use navigate `go()`/`useRoute()` plus
  `useAuthStore((s) => s.authed)`.

Checks: `npm run typecheck` — 6 diagnostics, ALL pre-existing at base
`b02622c` (verified by stashing the wave and re-running; they are the six
TS2345 `'edit-project'` findings in `src/state/console.test.tsx`, a test
file this wave must not touch — 0 new, recorded as a gap below).
`npm run lint` — 168 warnings / 0 errors, unchanged from the enabler-D+E
tip; all 10 touched files lint clean individually (`$LASTEXITCODE` 0).
`npm test -- --run --maxWorkers=2` — 955 tests / 72 files green,
`$LASTEXITCODE` 0, the known parallel-load flake pair did not surface.
`npm run build` — succeeds, `$LASTEXITCODE` 0 (pre-existing chunk-size
warning only).

Gaps: the six TS2345 `'edit-project'` errors in
`src/state/console.test.tsx` predate this wave (present at the base with
the wave's changes stashed) and sit in a test file outside this wave's
touch scope — they belong to the enabler-D evidence record / console-suite
owner. Browser route exercise skipped (same optional HTTP-check gap as the
earlier batches; the migrated reads/writes are pinned by the drawer, estop,
notices, settings, wizard, composed-ui and route-host suites that exercise
them through real mounted screens, and `npm run build` covers the module
graph).
### Wave 2 (shell off the store, `wi/67w2-shell`)

The shell consumers leave the legacy store context: 8 shell/console surfaces
(`context-ribbon`, `nav`, `project-switcher`, `search`, `sidebar`, `shell`,
`header`, `screens/d-shared`) plus the resetDemo canonicalization, 10 touched
files, +181/−75 — one concern, far under the caps. Every replacement is the
canonical hook the enablers host, and the observable behavior (toasts,
confirms, refusals, log mirrors, audit rows, corr values, the shell loading
gate, the dirty guard and the switcher close) is unchanged.

- `context-ribbon.tsx` (6 sites): `db`→`useDb`, `project`→`useActiveProject`,
  `me`→`useMe`, `pid`→`useProjectStore`, `route`→`useRoute`, `can`→`useCan`,
  `setFilter`→`useSessionStore`, `go`→navigate; `A.emergencyStop`/
  `A.retryStop`/`A.resolveStop` are demo-runtime entries → the same-name
  runtime functions (the `void go` lint-silencer and the `(A as any)` cast
  left with them); `ProjectHeader`'s prop type resolves `Project` directly
  instead of `ReturnType<typeof useStore>['project']`.
- `nav.ts`: `db/scoped/me/can` → `useDb`/`useScoped<Operation>()`/`useMe`/
  `useCan` (the seam's `useScoped` is generic at the hook; the one call site
  instantiates the element type).
- `project-switcher.tsx`: `db/accessible/project/can/me` → console hooks;
  `pid`→`useProjectStore`; `switcherOpen/setSwitcherOpen`→`useUiStore`;
  `loading`→`useSessionStore`; `route`→`useRoute`; `setPid`→`selectProject`
  (the store entry's own implementation — guard/redirect/450 ms loading gate/
  switcher close identical); `go`→navigate.
- `search.tsx`: console hooks + navigate; a one-line local generic adapter
  keeps the memo's five scoped-read call sites typed like the store's generic
  `scoped` (the seam's hook returns its filter for one element type), and the
  module-level `go` (a stable outer value) left the memo deps — pure memo,
  same recomputation inputs otherwise.
- `sidebar.tsx`: `route`→`useRoute`, `go`→navigate.
- `shell.tsx` (4 sites): confirm/unsaved/toasts/loading → session/toast
  authorities; `route`→`useRoute`; `project`→`useActiveProject`;
  `me`→`useMe`; `copilotOpen/setNoticesOpen/setSwitcherOpen`→`useUiStore`;
  `go`→navigate. The `Route` type re-export and the compatibility re-exports
  on the shell root are unchanged.
- `header.tsx` (5 sites): `me`→`useMe` + `useAuthStore((s) => s.setMe)` for
  the persona write; `theme/setTheme`→`useThemeStore`; `aiMode/setAiMode`/
  `noticesOpen/setNoticesOpen/setCopilotOpen`→`useUiStore`;
  `toast`→`useToastStore`; `stopOutcome/setStopOutcome`/`confirm`→session
  store; `route`→`useRoute`; `go`→navigate; `logout` is the store entry
  verbatim (`signOut()` + `navRawRoute({ page: 'login' })`); `resetDemo` is
  the runtime's canonical function (below); `A.markNoticesRead` — the store
  implementation is one unscoped 'legacy' commit, so `Notices` mirrors it
  through the canonical `useServices()` authority commit instead of the
  typed `markAllRead` handler (which scopes to the persona — a behavior
  change this surface does not take).
- `screens/d-shared.tsx`: `loading`→`useSessionStore`;
  `setSwitcherOpen`→`useUiStore`.
- **resetDemo canonicalization (enabler E extension):** `resetDemo(scenario?)
  ` moved verbatim into `src/features/demo/runtime.ts` — the runtime's
  `demand()` services, `resetDemoRuntime()` timers disposal, the logs rebuild
  (`buildLogs` moved from the provider into the runtime module, next to the
  log mirrors it seeds; the provider's mount effect imports it), the
  session/UI/toast clears in the exact order (setLogs → session
  clearTransient → raw pid 'all' → UI clearTransient → toast clear → final
  info toast, including the e2e01 message) and loading/stopOutcome left
  untouched. The provider's `dbRef` sync happens through the authority's
  synchronous 'reset' publication as before. The store's `resetDemo` is now a
  one-line delegate (`demoResetDemo(scenario)`) — the only store.tsx change
  in this wave besides repointing `buildLogs` for the mount effect.
- `src/state/console.test.tsx` type errors: pre-existing at the tip
  (`edit-project` CanAction, 6 errors, verified by typechecking the stashed
  base) — test files are out of this wave's scope, untouched, still the
  ticket's outstanding diagnostics.

Checks: `npm run typecheck` — 0 new diagnostics (the 6 pre-existing
console.test errors above are the only output). `npm run lint` — 0 errors;
168 → 167 warnings. File-level diff over the 10 touched files (base linted
before the edits): every file unchanged except `context-ribbon.tsx`
(12 → 11 — the `(A as any)` cast left with the demo-runtime call) — 0 new
findings. `npm test -- --run --maxWorkers=2` — 955 tests / 72 files green in
two full runs; the known parallel-load flake pair did not surface (no timer/
fake-clock assertion changed). `npm run build` — succeeds (pre-existing
chunk-size warning only).

Gaps: browser route exercise skipped (optional HTTP-check gap per AGENTS.md
§ Windows Temporary Process Safety, same as the earlier batches; the migrated
surfaces are pinned by the shell, navigate, console-seam, session-duality,
estop, aichat and demo suites that exercise them through real screens, and
`npm run build` covers the module graph).

### Wave 3 (a/b screens off the store, `wi/67w3-ab`)

The a/b screen batch leaves the legacy store context entirely: the 6 screens
`a-dashboard` (MyTasks), `a-login`, `b-portfolio`, `b-wizard`, `b-detail`
(12 sites) and `b-detail2` (3 tabs) — 6 touched files, +170/−47 raw
(≈ +143/−47 runtime after the migration comments), far under the caps. Every
replacement is the canonical hook the enablers host, and the observable
behavior (toasts, confirms, refusals, audit rows, corr values, the loading
gate and the safe-return login navigation) is unchanged.

- `a-dashboard.tsx` (MyTasks): the `A.decidePlan`/`A.decideApproval`/
  `A.decideSessionRequest` entries run their transactions directly
  (`features/plans/service`, `features/approvals/service`, `features/c2/grants`)
  with the store's exact request context (`corr: 'legacy'`, the override-aware
  persona, the plan/access-request project lookups from the one authority at
  call time, the same not-found copy) and the same Res bridge; `confirm`/
  `toast` come from the session/toast authorities. The context resolves at
  call time, not render (see Checks — the pinned failing-aggregate-read error
  state must survive a throwing authority snapshot).
- `a-login.tsx`: the store's `login` entry mirrored —
  `signIn(useAuthStore.getState().meName, org)` + the safe-return check
  (`isKnownPage`/`OUTSIDE_SHELL` + `currentRoute()`, `clearDirty()` in the
  known-page branch) + the `command-center` fallback through `navRawRoute`;
  `me` → `useMe()`.
- `b-portfolio.tsx`: `db`/`me`/`can` → `useDb`/`useMe`/`useCan`; `pid` →
  `useProjectStore`; `go` → navigate; `toast` → toast authority;
  `persistFilters`/`setFilter` → session authority. Pinning already runs the
  typed `handlers.setPinned` write (ticket 16) — kept; this screen has no
  `A.updateProject` path.
- `b-wizard.tsx`: `db`/`me` → `useDb`/`useMe`, `go` → navigate.
- `b-detail.tsx` (12 sites): navigate module (`go`/`useRoute`/`selectProject`
  for the guarded via-switch), `useMe`, `useCan`, toast authority,
  `useProjectStore`; the one-time raw switcher sync on entry
  (`useProjectStore.getState().setPid`) stays as documented.
- `b-detail2.tsx` (3 tabs): the same mapping plus the A entries — ScopeTab's
  `A.submitApproval`/`A.editScope` → `submitApprovalTransaction`/
  `reviseScopeTransaction`; TeamTab's `A.decideApproval`/`A.confirmClose` →
  their transactions, and `A.updateProject`/`A.audit` → the same two raw
  `'legacy'` commits (the member write stamped, then the audit row with the
  RT-2026-014 SS/AR corr rule, actor/role from the override-aware `useMe()`);
  CloseTab's `A.confirmClose`/`A.requestClose` → `confirmCloseTransaction`/
  `requestCloseTransaction`. Same ctx, same Res bridge, same refusal/toast
  copy.

Checks: `npm run typecheck` — 0 diagnostics (`$LASTEXITCODE` 0). `npm run
lint` — 0 errors; 167 warnings, unchanged from the wave-2 tip; all 6 touched
files lint clean individually (`$LASTEXITCODE` 0) — 0 new findings.
`npm test -- --run --maxWorkers=2` — 955 tests / 72 files green. The first
full run surfaced `tasks.test.tsx`'s failing-aggregate-read case: an earlier
iteration read the persona through `useMe()` (a render-time authority
snapshot), which crashes under that test's throwing `snapshot` spy where the
legacy provider's captured `me` did not — fixed by resolving the decide
context at call time (no authority read on this render path); the suite then
passed in two consecutive full runs and the file passes in isolation (23/23).
No existing assertion changed. `npm run build` — succeeds (pre-existing
chunk-size warning only).

Gaps: browser route exercise skipped (optional HTTP-check gap per AGENTS.md
§ Windows Temporary Process Safety, same as the earlier waves; the migrated
surfaces are pinned by the auth/login, tasks, portfolio, wizard,
project-detail, console-seam and session-duality suites that exercise them
through real mounted screens, and `npm run build` covers the module graph).
### Wave 5 (d screens off the store, `wi/67w5-d`)

The three "d" screens (agents/assets/library) leave `useStore()` entirely —
19 sites across 3 screens; 4 files touched, +200/-46 runtime lines (including
the one new transaction), far under the caps.

- `src/features/agents/writes.ts` (+20): new `setAgentStatusTransaction` —
  the legacy raw `A.setAgentStatus` entry moved verbatim: two commits in the
  same order (mutate, then the 'Disabled agent'/'Enabled agent' audit row
  bound to the agent's own project) with the store helper's exact row shape
  (COR-014-01 corr for RT-2026-014 SS/AR agents, `stamp()` demo time,
  `ROLE_LABEL` actor) and no eligibility gate (the entry had none — the
  screen owns the role/read-only reasons, and the disable reason is audited
  separately by the caller).
- `src/screens/d-agents.tsx` (8 sites): db/accessibles/me/can/pid/toast/
  confirm/route/setFilter → the console/authority seams; `A.submitApproval`
  (AssignDrawer, replacement request) → `submitApprovalTransaction` with the
  A entry's exact ctx; `A.setAgentStatus` (doDisable/doEnable) →
  `setAgentStatusTransaction`; `A.restoreAgent`/`A.loseAgent` → the canonical
  demo-runtime functions; `now()` → `stamp()`; `setPid('all')` →
  `selectProject('all')`; `setSwitcherOpen` → useUiStore. FailurePanel's
  `A.updateOperation` + `A.audit` are mirrored exactly through the one
  authority as 'legacy' commits (the store's private OpDraft step-rebuild is
  a verbatim module-level `stepsFrom`, header.tsx wave-2 precedent — the
  typed draft update adds role gates and audit rows this path does not
  take); AgentDetail mirrors `A.audit` the same way.
- `src/screens/d-assets.tsx` (7 sites): the same seams; `A.submitApproval`
  (AssetScope request) → `submitApprovalTransaction` verbatim;
  `setPid('all')` → `selectProject('all')`; `route` → `useRoute`; module
  `go` (a stable outer value) let AssetNew's redirect effect drop its now-
  stale `eslint-disable-line react-hooks/exhaustive-deps`; the canonical
  `useServices`/`useDirty` store imports stay.
- `src/screens/d-library.tsx` (4 sites): the same seams;
  `A.audit` ×3 + `A.notify` ×1 (requestApproval/dup/attach) mirrored exactly
  as 'legacy' commits (the store helper's exact audit/notice row shapes,
  including the todo notice); `persistFilters['operation-new.assets']`
  gains the `as string[] | undefined` cast (the session store types
  persistFilters as `Record<string, unknown>`); `setSwitcherOpen` →
  useUiStore.

Gap: the wave instructions' `setPlaybookStatusTransaction`/
`decidePlaybookRevisionTransaction` for `features/library/service.ts` were
NOT added — the d-library screen has zero callers of
`A.setPlaybookStatus`/`A.decidePlaybookRevision` (only test files reach them
via `h.store()`), so the transactions would be dead code; the screen's review
flow already runs through the typed `usePlaybookReview` (ticket 53). If a
later wave retires the raw entries, the transactions belong with their first
real caller.

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
167 warnings (baseline; file-level over the touched files: d-agents 9,
d-assets 1, d-library 5, writes.ts 0 — unchanged, 0 new findings).
`npm test -- --run --maxWorkers=2` — 955 tests / 72 files green.
`npm run build` — succeeds (pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap per
AGENTS.md § Windows Temporary Process Safety as the earlier waves; the
screens are pinned by the agents, assets, library, console-seam and
session-duality suites exercising them through real renders, and the build
covers the module graph).

### Wave 6 (e/f screens off the store, `wi/67w6-ef`)

The five e/f screens (findings inventory + analysis, reports, settings)
leave `useStore()` entirely — 50 sites across 5 screens; 7 files touched,
+313/−81 raw (migration comments included), far under the caps. Every
replacement is the canonical hook the enablers host, and the observable
behavior (toasts, confirms, refusals, audit rows, corr values, the
dirty-guard ordering) is unchanged.

- `src/features/findings/service.ts` (+14): new `addFindingCommentTransaction`
  — the legacy raw `A.addFindingComment` entry moved verbatim (one 'legacy'
  commit pushing the `{ by, at: stamp(), text }` history row; no status/
  audit/`updated` side effects; the re-read snapshot returned).
- `src/features/reports/service.ts` (+16): new
  `setReportFindingsLegacyTransaction` — the raw `A.setReportFindings` entry
  verbatim (`r.findings = ids; r.updated = stamp()`); the typed
  `setReportFindings` keeps its validation path for typed callers.
- `e-analysis.tsx` (10 sites) / `e-findings.tsx` (12) / `f.tsx` (4) /
  `f-report.tsx` (11) / `f-settings.tsx` (13): the console/authority seams
  (`useDb`/`useMe`/`useCan`/`useReadOnly`/`useActiveProject`/
  `useAccessible`/`useScoped`), the shared authorities (project/ui/toast/
  session/auth/theme stores), navigate (`go`/`useRoute`) and `stamp()`.
  `e-analysis`'s `export type { Store }` surface is unchanged; `e-findings`'
  AiActions dismiss + FindingDetail comment run the new transaction,
  AddToReport runs the legacy report one, and FindingDetail's destructure
  drops its two unused entries; `f-report`'s AiExclusion reads the typed
  `useScoped<Finding>()`; the Settings logout mirrors the store entry
  (`signOut()` + `navRawRoute({ page: 'login' })`) and NotifTab resolves the
  theme authority directly; `persistFilters` reads gain explicit casts
  (the session store types it `Record<string, unknown>` — the d-library
  wave-5 precedent).
- Raw audit mirrors: the 11 `A.audit` call sites (e-findings 2, f 3,
  f-settings 6) keep the store helper's exact row (the RT-2026-014 SS/AR
  COR-014-01 corr rule, `stamp()` demo time, `ROLE_LABEL` actor) through 8
  local `audit` helpers committing one 'legacy' change each.
- Delayed navigation: the three `setPid` + 80 ms redirect switches
  (FindingDenied/EvidenceInspector) and the finding-form finish navigate
  through a local `useDelayedNav` liveness guard. The module `go` always
  writes, and a captured redirect outliving its provider must not move a
  later mount's projected route — the isolation the store's epoch-scoped
  `go` used to give (router enabler B); the evidence suite's sequential
  provider mounts pin it (with the unguarded module `go`, the stray
  redirect flipped a later test's route to EV-014-02 mid-read, resetting
  its detail query to pending). The guard restores the base behavior; it
  is the component-mount equivalent of the provider's epoch (mounted ⇒
  same epoch).

Checks: `npm run typecheck` — 0 diagnostics. `npm run lint` — 0 errors;
167 → 165 warnings. File-level over the 7 touched files: e-analysis 15 →
12, e-findings 6 → 4 (the two unused-var findings left with the dropped
destructure), f.tsx 5 → 5, f-report/f-settings/services 0 → 0 — 0 new
findings. `npm test -- --run --maxWorkers=2` — 955 tests / 72 files green;
the evidence file passes 5 consecutive runs (15/15). `npm run build` —
succeeds (pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (same optional HTTP-check gap per
AGENTS.md § Windows Temporary Process Safety as the earlier waves; the
screens are pinned by the analysis, findings evidence, reports editor/
query/review, settings and ai-proposals suites exercising them through
real renders, and `npm run build` covers the module graph).
### Wave 4 (c screens off the store, `wi/67w4-c`)

The four "c" screens (operations list/wizard/preflight/schedule/detail, the
shared c-common helpers, the live console and the results/graph tabs) leave
`useStore()` entirely — 21 hook sites across 4 files, +210/−51 raw lines
(≈ +196/−51 runtime after the migration comments), far under the caps. No new
feature transactions were needed: the typed create/update already owned the
wizard's writes (`useCreateOperation`/`useUpdateOperation` →
`createOperationDraft`/`updateOperationDraft`), so the wave instructions'
verbatim `createOperationTransaction`/`updateOperationTransaction` move had
nothing left to own — the screen's only remaining raw entry was
`A.executePlan`.

- `src/screens/c.tsx` (8 sites): `db`/`project`/`can`/`me` → `useDb`/
  `useActiveProject`/`useCan`/`useMe`; `pid` → `useProjectStore`; `route` →
  `useRoute`; `go` → navigate; `setPid` → `selectProject`;
  `persistFilters`/`setFilter`/`setDirty` → session authority;
  `setSwitcherOpen` → `useUiStore`; `toast` → toast authority; `now()` →
  `stamp()`; the two `ReturnType<typeof useStore>['db']` prop types → `Db`.
  The list banner's `A.executePlan` is mirrored: the plan's project binding
  resolves from the one authority at call time and
  `createOperationFromPlanTransaction` runs with the store's exact ctx
  (`corr: 'legacy'`, override-aware persona), same Res bridge and not-found
  copy — the toast/navigation flow around it is unchanged.
- `src/screens/c-common.tsx` (2 sites): `OpGate` (`db`/`route`/`me`/`pid`,
  `setPid` → `selectProject`, navigate `go`) and `RuntimeStatus` (`useDb`);
  the `canAccessProject` policy-seam import stays.
- `src/screens/c-console.tsx` (9 components): OpBanner, OpControls,
  SessionCards, PlanCard, OverviewTab, StepDrawer, ConsoleTab, AgentsTab and
  TimelineTab move to the console/session/ui/toast seams plus navigate
  (`now()` → `stamp()` for the elapsed header; the unused `now` destructure
  left with the migration). `A.pauseOp`/`A.resumeOp`/`A.stopOp`/
  `A.completeOp` → the typed lifecycle handlers
  (`pauseOperation`/`resumeOperation`/`stopOperation`/`completeOperation`)
  called directly with the store's exact request context, and the demo log
  mirrors stay at the call site — session-store `pushLog` with the exact
  `hhmm()+':'+pad(seconds)` ts format and the same lines
  (`Operation paused by ${me.name}` WARN, `Operation resumed by ${me.name}`
  INFO, `Operation completed` INFO); the entry's op lookup reads the
  authority at call time exactly like the store's `dbRef` (a missing op
  silently returns for pause/stop, `Operation not found.` for resume/
  complete), and the resume recheck keeps `computePreflightChecks` at the
  factory clock's instant. `A.loseAgent`/`A.restoreAgent`/`A.fastForward` →
  the canonical demo-runtime functions. TimelineTab's `A.audit` → one
  'legacy' commit with the store helper's exact row shape (the RT-2026-014
  SS/AR corr rule, `stamp()`, override-aware persona).
- `src/screens/c-results.tsx` (2 sites): GraphView/ResultsView on the
  navigate/console/session/toast seams; `A.audit` ×3 (graph export, results
  export, sign-off) → the same exact 'legacy' audit mirror;
  `A.addEvidence` → the same two-commit mirror (the live-count `EV-` id
  derivation, the exact evidence row, then the 'Uploaded evidence' audit
  row); the screen's local `stamp()` (the sign-off wall-clock label) stays,
  so the demo stamp imports under the `demoStamp` alias.

Checks: `npm run typecheck` — 0 diagnostics (`$LASTEXITCODE` 0). `npm run
lint` — 0 errors; 167 → 166 warnings. File-level diff over the 4 touched
files (baseline linted before the edits: c.tsx 10, c-common 23, c-console
14, c-results 0 = 48 warnings): after, c.tsx 10, c-common 23, c-console 13,
c-results 0 = 46 — c-console's only change is the removed unused-`now`
destructure warning; 0 new findings (an intermediate `useProjectStore`
unused-import finding was caught by the file-level diff and removed).
`npm test -- --run --maxWorkers=2` — 955 tests / 72 files green
(`$LASTEXITCODE` 0); the known parallel-load flake pair did not surface and
no assertion changed. `npm run build` — succeeds (`$LASTEXITCODE` 0,
pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (optional HTTP-check gap per AGENTS.md
§ Windows Temporary Process Safety, same as the earlier waves; the migrated
surfaces are pinned by the operations query/write/lifecycle/workspace,
results, bridge and session-duality suites that exercise these screens
through real mounted routes — including the `A.pauseOp`/typed-review bridge
acceptance and the legacy `A.stopOp` fleet-observability cases — and
`npm run build` covers the module graph).

### Wave 7 (g screens off the store, `wi/67w7-g`)

The seven g screens (operator chat, the shared g-common chat/plan kit,
fanout branches, the plan builder, trace, workers and the workspace rail)
leave `useStore()` entirely — 46 hook sites across 7 screens, plus the 15
raw `A.*` entries they called; 7 files touched, +241/−78 raw (migration
comments included), far under the caps. No new feature transactions were
needed: every raw entry the screens used already had a canonical owner.
The observable behavior (toasts, refusals, pins, audit rows, corr values,
stamps) is unchanged.

- `g-workers.tsx` (2 sites): WorkerDetail/WorkerTeamView `go` → the navigate
  module; the file was otherwise typed already.
- `g-fanout.tsx` (11 sites): useLinks/FanOutCard/AllocationView → `useDb`,
  BranchBody → `useCan`, the retry/reassign/cancel modals → the toast
  authority, BranchPage/BranchDrawer/FanOutPage → `useRoute`; every branch
  mutation was already typed.
- `g-trace.tsx` (4 sites): AiTrace/AiHistory (`pid` → the project store,
  `can` → `useCan`, `route` → `useRoute`) and Inspector's toast → the toast
  authority; Grouped's dead destructure left with the migration.
- `g-workspace.tsx` (3 sites): LeftRail/Inspector/ConversationHeader on the
  console/authority/ui seams; `A.togglePinConv` mirrors the store entry
  exactly — `createChatHandlers(services, { id: me.name, role: me.role },
  'all').setPinned(convId)` per call, so the handler corr stays
  `chat-pin-1`.
- `g-chat.tsx` (1 site): AiOperator on the console/authority/session seams
  (`guarded` → the session authority); both `A.sendChat` call sites (the
  starter chips and the locked-plan-outline draft button) → the canonical
  demo-runtime `sendChat`.
- `g-common.tsx` (12 sites): EligBadge, useReplan, ReplanPanel, ExecBanner,
  AiSubNav, NoProject, PlanCard, useTraceLink, ToolProposalCard, Msg,
  Thread and Composer on the console/authority/session seams, the
  demo-runtime `sendChat`/`stopChat`, navigate (`go`/`useRoute`) and
  `stamp()`. The ReplanPanel mirrors `A.revisePlan`/`A.editPlan` inline with
  the store's exact semantics: the revise result's `planId` (`''` on
  refusal) feeds the toast, and the refused-edit path still runs whenever
  the project resolves (the no-commit edit of a foreign plan's draft), same
  copy. `useTraceLink` is now hook-less (returns the module `go` closure);
  its callers are unchanged. The exports `drawer.tsx` consumes
  (`Composer`/`EligBadge`/`NoProject`/`Thread`) are untouched.
- `g-plan.tsx` (13 sites): usePlan, useCrumbs, StepDrawer, Validation,
  ReviseDialog, Builder, PlanDetail, PolicyChecks, StepGroups,
  ApprovalImpact, ReviewBody, CompareBody and the `stepState`/`detailOf`
  helpers (`ReturnType<typeof useStore>['db']` → the `Db` type import) on
  the console/authority seams and navigate. A local `usePlanActions` hook
  mirrors the seven raw plan entries (request approval ×2 call sites,
  decide, withdraw, revise, edit draft, discard, execute) with the store's
  exact call-time persona (override-aware, `corr: 'legacy'`), the
  authority snapshot's plan→project binding, `executePlan`'s
  `{ ok, opId?, error? }` Res bridge and the not-found copy
  `` `Plan ${planId} does not exist.` `` — `revise` keeps returning
  `res.ok ? res.data.planId : ''`. `usePlan`'s exported shape is preserved
  (`setPid` now `selectProject`; no external consumers), and the
  foreign-project switch is the same plain `selectProject` the c screens
  use.

- Delayed navigation: the audit found exactly one `setTimeout` across the
  seven screens — AiHistory's 60 ms scroll restore
  (`document.querySelector('main')?.scrollTo?.(0, saved.y)`), which writes
  no route and escapes no provider, so it stays unguarded (the base had no
  guard; adding one would change behavior). Every `go`/`selectProject` call
  is a synchronous in-click handler.

Checks: `npm run typecheck` — 0 diagnostics (`$LASTEXITCODE` 0). `npm run
lint` — 0 errors; 164 → 164 warnings. File-level over the 7 touched files
(baseline linted before the edits: g-chat 0, g-common 6, g-fanout 1, g-plan
1, g-trace 0, g-workers 0, g-workspace 4 = 12): after, the same 12
(line shifts only) — 0 new findings. `npm test -- --run --maxWorkers=2` —
955 tests / 72 files green (`$LASTEXITCODE` 0); the known flake pair did
not surface and no assertion changed. `npm run build` — succeeds
(`$LASTEXITCODE` 0, pre-existing chunk-size warning only).

Gaps: browser route exercise skipped (optional HTTP-check gap per AGENTS.md
§ Windows Temporary Process Safety, same as the earlier waves; the migrated
surfaces are pinned by the ai-operator query, ai-history pin, plan
compare/trace writes, branches and workers suites exercising them through
real mounted routes, and `npm run build` covers the module graph).
