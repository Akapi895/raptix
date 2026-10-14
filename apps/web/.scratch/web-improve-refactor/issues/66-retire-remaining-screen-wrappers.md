# 66: Retire remaining feature screen wrappers

**What to build:** Remove zero-caller infrastructure/intelligence/report/AI/C2/demo legacy wrappers in bounded contraction batches.
**Blocked by:** 65, 61e (the last raw hash-location writers must be gone before this batch deletes or rewrites the f/g screen files).
**Status:** resolved
**Owner:** Contraction batch B.
**Contract:** [execution.md](../execution.md).

- [x] All source screen exports have semantic replacements and preserved route/tab aliases; no runtime/test/demo caller still needs a retired wrapper.
- [x] Each actual deletion leaf touches at most eight wrappers within the line cap; create additional leaves and completion blockers before coding if needed. *(Split into three commits on `wi/66-retirescreens`: 2 + 1(+5 dead exports) + 4 retired definitions, 6 + 7 + 2 touched files, all under the caps.)*
- [x] Cross-feature evidence/technique/plan/session links and lazy boundaries remain wired after removal.
- [x] Baseline tests for these groups run through final interfaces, not deleted Context adapters.

## Retired wrappers

An import/route sweep of every export of the remaining f/g/demo screen files
(callers via `git grep`, including tests/demo/aliases) classified each export as
route screen (registry-backed), cross-screen shared seam (live callers), or
zero-caller wrapper. Only the zero-caller group was deleted, in three commits:

1. `59d5114` — demo barrels + report shim (6 files, +5/−27):
   - `src/screens/demo-guide.tsx` — ticket-61c compatibility barrel; the only
     caller (`shell/shell.tsx`) now imports `DemoGuide` from the semantic
     module `screens/demo/guide`. The barrel's other re-exports
     (`jump`/`launchGuide`/`stopGuide`/`GUIDES`/types) had zero callers.
   - `src/screens/scenarios.tsx` — ticket-61d compatibility barrel; the router
     registry's lazy slice now points directly at `screens/demo/pages`.
   - `src/screens/f-report.tsx` re-export shim
     (`reportChecks`/`closureEvidence`/`type NoFind`/`type RCheck`) — the typed
     report service is the one implementation; the legacy catalog screen
     (`f.tsx`) imports `reportChecks`/`NoFind` from
     `features/reports/service` directly. `useNoFind` stays as a
     module-local helper of the report screens (four internal call sites).
2. `a90b129` — AI screen adapters (7 files, +16/−179):
   - `src/screens/ai-copilot.tsx` — the legacy raw-db copilot drawer; zero
     runtime callers (the real mount site `router/host.tsx` fills the
     `copilotDrawer` slot with the migrated ticket-60 drawer). The shell's
     omitted-slot default now resolves to `features/copilot/drawer` — the last
     caller migrated to the semantic module. `features/copilot/drawer.tsx`'s
     slot-contract note updated accordingly.
   - `src/screens/g-common.tsx` dead exports — `toolFlow` + `execTone`
     (superseded by the ticket-41 typed trace derivation in `g-trace.tsx`),
     `ModeSwitch` and its private `moveRadio` helper (mode switching lives in
     `g-workspace.tsx` `ConversationHeader` since ticket 38). Unused
     `Db`/`AiModeBadge`/`ReactKeyboardEvent` imports dropped with them.
   - `src/screens/g-fanout.tsx` `AiTeamView` forwarding export — the workspace
     Inspector (`g-workspace.tsx`) imports `WorkerTeamView` from
     `screens/g-workers` directly; the workers bridge test now renders the same
     migrated view at the workspace entry point (assertions preserved).
3. `9520b69` — residual zero-caller screen helpers (2 files, −16):
   - `src/screens/d-shared.tsx` — `useProjectName`, `useVisibleAgents`
     (superseded by the agents typed reads), `wsLabel` (zero callers; the
     `Agent` type import was theirs).
   - `src/screens/c-common.tsx` — `opBranches` (zero callers; `stepBranches`
     is the live selector).

## Kept intentionally (not this ticket)

- The lazy slice records `a/b/d/e/g.tsx` (and the routes records inside
  `c/f/h.tsx` + the full f/g screen files) — the registry is their caller and
  the route-inventory contract (rows 1–53) binds the 53 keys/tabs/aliases to
  them; all 53 keys resolve unchanged (registry-manifest sweep in
  `system.test.tsx` stays green). No free-standing compatibility barrel is
  left in `src/screens/`.
- Cross-screen shared seams with live callers (`FanOutCard`, `AllocationView`,
  `BranchStatus`, `BranchDrawer`, `Composer`/`Thread`/`EligBadge`/`NoProject`,
  `PlanCard`, `ReplanPanel`, …) — they are consumed by c-console, the copilot
  drawer and the g workspace; their final UI-layer contraction belongs to 67
  together with the store/Context bridge.

## Evidence

- `npm run typecheck` — 0 diagnostics (after each commit).
- `npm run lint` — 0 errors; 196 warnings at the ticket base → 182 after (14
  findings removed with the deleted files/exports; no new findings).
- `npm test -- --run` — 69 files / 926 tests green at every commit. One
  transient single-test failure occurred on the first post-edit run and did
  not reproduce in four consecutive full re-runs (all 926 green; the same
  pre-existing parallel-load flake recorded by tickets 22/65).
- `npm run build` — succeeds (pre-existing chunk-size warning only).
- Grep proof (post-batch tree): retired files `demo-guide.tsx`,
  `scenarios.tsx`, `ai-copilot.tsx` → 0 in `git ls-files`; retired exports
  `AiTeamView|toolFlow|execTone|ModeSwitch|useProjectName|useVisibleAgents|wsLabel|opBranches`
  and the f-report re-export line → 0 hits in `git grep`; module-local
  `useNoFind` remains with no `export`. No `src/screens` file is a
  re-export-only barrel anymore (`export … from './…'` sweep clean).
- Behavior-identical evidence: no route key, tab alias, link target, lazy
  boundary or handler changed — every retired definition had zero callers or
  was re-pointed to the exact same implementation it forwarded to (the workers
  test renders `WorkerTeamView`, the view the forward resolved to; the shell
  default renders the ticket-60 drawer that the host already mounted; reports
  import the typed service `reportChecks` the shim re-exported). All baseline
  suites pass with assertions kept.
- Browser route exercise: skipped — preview HTTP check optional per AGENTS.md
  § Windows Temporary Process Safety (recorded as a verification gap; route
  resolution and the navigation outcomes are covered by the router/registry
  suites, the rendered route-host regressions and `npm run build`).
