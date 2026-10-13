# 67: Remove the final legacy store/navigation/UI bridge

**What to build:** Remove residual Context/store/hash-router/UI forwarding infrastructure after all screen consumers are gone; keep the canonical database/services/providers as the final architecture.
**Blocked by:** 66.
**Status:** in-progress — first contraction batch (the dead legacy core) landed on `wi/67-retirelegacy`; the remaining live Context/store surface is enumerated below and needs further bounded batches.
**Owner:** Final core contraction.
**Contract:** [execution.md](../execution.md).

- [ ] No component/test/demo reads the old store/database or writes location outside the router; remaining compatibility definitions have zero callers. *(Batch 1 retired every zero-caller legacy-core definition; the live Context seam (`useStore` ×100 files, `StoreProvider` ×54) and its live delegating `A.*` entries remain for later batches.)*
- [ ] Final seed/reset/timers/subscriptions belong to canonical services; removal does not reseed data or break observable events. *(Already owned by the canonical services since ticket 04 — `services.reset`/clock/authority; batch 1 removed only zero-caller definitions, so no seed/reset/timer path changed — bridge/reset/grant suites stay green.)*
- [x] Runtime deletion is measured and split if needed; no oversized monolith deletion is assumed exempt. *(Split into three commits: 1 + 4 + 8 touched files, +4/−49, +23/−38, +19/−15 — each batch far under the caps; total +38/−94 runtime lines over 10 files.)*
- [ ] Typecheck/lint/test/build pass with zero remaining migration diagnostics and final-interface invariant coverage only. *(All four pass — typecheck 0, lint 0 errors with 182→179 warnings and a file-level diff proving 0 new findings, 926 tests green, build ✓. Outstanding diagnostics are the pre-existing screen-level debt owned by ticket 69.)*

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

## Residual legacy-core inventory (later batches, owners TBD)

Every remaining store export has ≥1 importer (grep-census after batch 1):

- The Context bridge itself: `useStore` (100 files), `StoreProvider` (54),
  `Store`/`useServices`/`useDirty` — per-feature migration to
  `useServices`/Query + typed actions, then retirement.
- Live delegating `A.*` entries with callers (estop orchestration, operation
  controls + demo log mirrors, C2 termination, demo simulations) — migrate
  per feature, keeping the observable log/toast behavior.
- Single-consumer helpers: `allocation`/`groupSummary` (`g-fanout`),
  `hhmm` (`h-session`), `today` (`f-settings`), `completion`
  (`closure/service.test` — the canonical-checklist consumer),
  `computePreflight` (7 callers; the demo-anchor wrapper — callers must move
  to `computePreflightChecks` + the factory clock, watch the PRE-04 anchor),
  `sessionPerm` (2), `sevLabel` (2), `ROLE_LABEL` (9), `Route`/`CanAction`/
  `CopilotCtx` re-exports (1–2 each).

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
