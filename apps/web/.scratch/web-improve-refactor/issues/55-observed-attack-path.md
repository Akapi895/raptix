# 55: Observed-only attack path

**What to build:** Migrate attack-path graph derivation and evidence navigation separately from coverage aggregation.
**Blocked by:** 54.
**Status:** resolved
**Owner:** Attack-path domain/read model and SVG interaction.
**Contract:** [execution.md](../execution.md).

- [x] Only recorded execution events produce edges; missing/unknown data never yields invented lateral movement or success.
- [x] Edges/nodes retain step/session/evidence provenance and project isolation.
- [x] Keyboard/pointer selection exposes equivalent details; theme/responsive behavior and no-data state work.
- [x] Real derivation tests use recorded fixtures with expected absent edges; all analysis direct legacy readers are retired (graph derivation; remaining display-only readers are other tickets' ownership — see Gaps).

## Implementation

- Feature-local path read model `src/features/analysis/path.ts` (ADR-0067,
  additive beside ticket 54's coverage handler): one scope-checked
  `pathOf(ctx, query)` read derives the asset→step→technique chain of a
  single operation from recorded canonical records. Scope semantics mirror
  coverage — non-member specific-project reads are `not-found` (no existence
  leak), the aggregate folds in only accessible projects, and an aggregate
  read never mixes projects into one chain (findings attach per technique
  within the operation's own project).
- Observed-rule (domain vocabulary, tightened from the legacy UI): a
  step→step edge is `observed` only when **both** steps reached recorded
  outcomes (`ok`/`fail`); an asset→step anchor is observed only when the
  step is executed. Planned/running/awaiting-review hops render planned
  (dashed) — the legacy graph drew running/review hops as solid "Observed";
  the read model now refuses to present a transition without two recorded
  events, so missing/unknown data cannot invent lateral movement or success.
  The view consumes `PathEdge.observed` and never re-derives observed state.
- Provenance: `PathStep` carries the recorded step (agent/timestamp/evidence),
  the step drawer adds the operation's session id (`Session` row),
  `PathTechnique` carries step references plus scope-checked finding
  references, and edges carry kind/from/to/observed. No exploitability
  vocabulary exists anywhere in the read — `observed` means "recorded".
- Query binding `src/features/analysis/query.ts`: appended `useAttackPath`
  with key `['operation', scope, 'path', query]` — same shape as coverage, so
  operation/step commits (legacy review actions included) invalidate the
  `[kind]` prefix and the graph updates without a reload; scope sits at
  position 1 for the ScopeCancelBridge. Exposed on the analysis service
  (`path`) in `service.ts` under the factory's superseded-scope guard (no
  factory change needed).
- Screen `src/screens/e-analysis.tsx`: the `chain` tab now consumes
  `useAttackPath` (operation selector, filters, chain, counts all from the
  read) instead of the coverage read model; loading/error/refetch and
  no-data states added. Interactions preserved: hover titles, click
  selection, focus + Enter on every node (now with a visible focus ring via
  the shared `focus-visible:outline` pattern), zoom/fit/reset, status
  checkboxes, technique highlight, SVG download, keyboard/pointer drawers
  with router-resolving links (operation console, technique page, asset,
  findings, MITRE matrix, finding prefill). Step-node status maps are typed
  `Record<StepStatus, …>` (removes the last `any` on this surface).

## Evidence

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — 216 warnings, 0 errors; one below the 217 pre-change
  count at the merge tip (the surface's `ComponentType<any>` warning is
  gone), 0 new diagnostics.
- `npm test -- --run` — 36 files, 479 tests passed (467 baseline + 12 new).
  One full-suite run showed unrelated flakes under parallel worker load
  (grants/router timing tests); the same files pass in isolation and a
  second full run was fully green.
- `npm run build` — succeeds.
- New tests `src/features/analysis/path.test.tsx` (12):
  - handler, recorded fixtures with expected absent edges: OP-015's
    S01→S02 observed (ok→ok); S02→S03 planned (running, no recorded
    outcome); S03→S04 planned; asset anchors observe only executed steps;
    `nObserved` 2.
  - an operation with no recorded outcomes (OP-016) yields zero observed
    edges — no invented chain.
  - provenance: technique nodes carry step references and project-scoped
    findings (T1078 → FD-011 only in its own project; T1087 empty), session
    id and evidence survive on the read.
  - aggregate folds only accessible operations (Riley sees OP-013/OP-014);
    non-member specific-project read is `not-found` and the message leaks
    neither the project id nor its name.
  - agent filter narrows the chain to the recorded subset and every edge
    endpoint references a remaining step (graph re-derives from filters).
  - mounted graph: scoped chain renders with finite geometry — every SVG
    numeric attribute, viewBox and path coordinate asserted finite (no NaN);
    observed/planned edge titles assert the rule in the DOM; out-of-scope
    operations absent from the selector.
  - keyboard focus + Enter opens the same drawer as pointer selection (step
    provenance: observed banner, session SS-041, evidence EV-014-01; asset
    drawer via click with AS-0143 detail).
  - links resolve through the router: "Open execution step" → `operation`
    OP-014; technique drawer "Technique page" → `technique` T1078.
  - legacy `reviewStep('OP-014','S11','approve')` flips the planned S10→S11
    hop to observed and the node to "Succeeded" without a reload
    (`[operation]` key invalidation).
  - delayed-response isolation: a gated aggregate-scope path response is
    superseded by a project switch; the view keeps the switched scope's
    graph and the stale scope's cache entry stays empty.
  - source guard: the graph consumes `useAttackPath` and no longer derives
    observed state in the view.
- Budget: ~250 runtime lines added (path 187, query +33, service +8, screen
  net +20); 277 test lines; 5 code files + this ticket; one concern.

## Gaps

- Browser walkthrough of the real app route not performed (process-safety
  rule: preview HTTP check is optional; skipped and recorded as a gap).
  Route-level behavior is covered by the mounted-route tests above.
- Display-only store reads remain on the analysis surface, owned elsewhere:
  `EvidenceList` reads the store's evidence collection (ticket 33 owns
  evidence reads; gap already recorded by 54), the asset drawer reads the
  store's asset collection (ticket 50 is in flight; legacy fallback per
  dispatch), and the no-data state's readiness reasons use the store's
  project-readiness helper (ticket 21's domain). The attack-path derivation
  itself reads only the typed path model.
