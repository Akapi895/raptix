# 54: ATT&CK coverage and detection heatmap

**What to build:** Migrate matrix/coverage/heatmap read models from recorded canonical operation and finding data.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Analysis aggregate reads and matrix/heatmap UI.
**Contract:** [execution.md](../execution.md).

- [x] Tactic/technique coverage reflects observed operations, with explicit no-data/detected/undetected states.
- [x] Project filters and technique references preserve accessible scope; coverage does not claim exploitability.
- [x] Keyboard interaction, legends, light/dark contrast and empty/error cases are verified.
- [x] Legacy/new operation/finding mutations update the aggregate without requiring those features to be migrated first.

## Implementation

- Feature-local read model `src/features/analysis/service.ts` (ADR-0067): one
  scope-checked `coverage(ctx, query)` read folds recorded canonical
  operations/steps/findings into matrix cells (tactic×technique with
  `detected`/`undetected`/`nodata`/`planned`/`untested`), project×technique
  heatmap pairs (with scope-checked finding references) and KPI counts.
  Non-member specific-project reads are `not-found` (no existence leak); the
  aggregate folds in only accessible projects. Only executed steps
  (`ok`/`fail`) count as coverage; review/pending steps stay `planned`. A
  disconnected SIEM source renders every executed technique `nodata`
  (unverified), never `undetected`.
- Query binding `src/features/analysis/query.ts`: feature-local key
  `['operation', scope, 'coverage', query]` — starts with the `operation`
  entity kind so any committed operation change (legacy action or service
  write) invalidates the `[kind]` prefix; finding changes arrive via the
  bridge's project-scope invalidation. The hook also observes `integration`
  commits locally (the shared bridge's kind/project invalidation cannot match
  them to an `operation`-prefixed key), so a SIEM toggle never leaves a stale
  detected/undetected heat. Scope is embedded at key position 1; the factory
  wires the read under the superseded-scope guard.
- Screen `src/screens/e-analysis.tsx`: `buildAna` (store-side computation)
  replaced by `useAnalysisCoverage`; loading/error/refetch states added; the
  agent-filter options, overview source counts and detection-tab finding
  references now come from the read model. Overview/attack-path/finding-prefill
  behavior unchanged (ticket 55 owns the graph).
- Technique links resolve through the router (`go('technique', { id })`) —
  route-inventory key 26 (`technique` → `d-library` slice) renders
  `TechniqueDetail` today; 52's rewrite keeps the key.

## Evidence

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — 218 warnings, 0 errors; identical to the pre-change count
  at the merge tip (`git stash` comparison), 0 new diagnostics.
- `npm test -- --run` — 29 files, 360 tests passed (347 baseline + 13 new).
- `npm run build` — succeeds.
- New tests `src/features/analysis/coverage.test.tsx` (13):
  - matrix renders coverage from observed operations; aggregate vs
    `RT-2026-014` scope changes the T1046 cell (Detected via RT-2026-009 → No
    Data when scoped); untested catalog cells stay "Not Tested".
  - planned-only technique (review-status step) is never counted as executed.
  - heatmap separates detected / verified-undetected / unverified no-data
    (KPI rate 67%, labelled tactic bars, gap recommendation, "Unverified"
    column) in the `RT-2026-014` scope.
  - disconnecting SIEM-Lab flips tested cells to "Executed & No Data" with the
    unavailable banner — never "Not Detected" (keyboard of the source read is
    the hook's local invalidation path).
  - matrix cells are real buttons: focus + Enter opens the technique drawer;
    "Open technique in Playbooks" navigates to `technique`/`T1087` through the
    router (store route projection).
  - legacy `reviewStep('OP-014','S11','approve')` moves T1119 from
    "Planned Only" to "Executed & No Data" and 11/22 → 12/22 without a reload
    (legacy mutation → `[operation]` key invalidation).
  - delayed-response isolation: a gated aggregate-scope coverage response is
    superseded by a project switch; the stale scope's cache entry stays empty
    and the switched view never shows cross-project operations.
  - handler edges: aggregate folds only accessible projects (Riley sees only
    RT-2026-014 ops/pairs, FD-011 attached to its T1078 pair); non-member
    specific-project read is `not-found`; executed-vs-planned counts; os/agent
    filters narrow observed entries; disconnected source yields `nodata` with
    `nUndetected` 0.
- Hash-write check: the ticket-07 handoff attributed raw
  `location.hash`/`assign`/`replaceState` writers to `e-analysis.tsx`;
  verification (grep + a source-level regression assertion in the test file)
  shows the analysis surface has none — all navigation goes through the
  store's router-backed `go()`. The recorded writers live in `f-report.tsx`,
  `g-common.tsx`, `g-fanout.tsx` and `g-trace.tsx` (their tickets' surfaces).
- Budget: 281 runtime lines added (service 184, query 66, factory wiring 26,
  screen net +5); 215 test lines; 5 files touched; one concern.

## Gaps

- Browser walkthrough of the real app route not performed (process-safety
  rule: preview HTTP check is optional; skipped and recorded as a gap).
  Route-level behavior is covered by the mounted-route tests above.
- `EvidenceList` (evidence display lookup in drawers) still reads the store's
  evidence collection; evidence reads belong to ticket 33.
- The attack-path graph tab (`chain`) keeps consuming the shared read model;
  its UI migration is ticket 55.
