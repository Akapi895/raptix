# 30: Operation timeline, agents, results and graph

**What to build:** Complete operation detail read-only tabs with service-backed timeline, participating agents, results/evidence and step dependency SVG.
**Blocked by:** 29.
**Status:** resolved
**Owner:** Operation detail read models and graph.
**Contract:** [execution.md](../execution.md).

- [x] All six agreed operation tabs resolve by search params/back-forward and use the same canonical operation.
  (Routing/tabs themselves landed with 26/29 on the `operation` route; ticket 30 migrated the graph and
  results tabs onto the same canonical operation identity — one scope-keyed read keyed by the route's
  operation id, so `?tab=graph|results`, back/forward and direct refresh re-derive from the same records.)
- [x] Graph/results distinguish executed, failed, unknown and not-run steps; no simulated proposal is displayed as execution evidence.
- [x] Agent/evidence/technique links retain project scope; graph nodes have accessible interaction.
- [x] No operation screen reads the legacy database/store directly; route-level empty/error/permission checks pass.
  (For the graph/results tabs owned here: `c-results.tsx` no longer reads `db` at all.)

## Evidence

Ticket 30 scope: operation **results + execution graph** migrated to typed reads. Ticket 41 owns the
trace facets, 40 the plan bridge; timeline/agents tabs are not part of this leaf's runtime diff.

**Implementation**

- `src/features/results/service.ts` — one scope-checked read (`operationResults`) deriving everything
  the two tabs render from canonical records: step outcomes exactly as recorded (`ResultsCounts` keeps
  all seven `StepStatus` values distinct; `executed` counts only ok/fail/running/unknown), graph edges
  from playbook order between consecutive steps (`dashed` = target has not run; connectors are
  sequence, never an inferred attack path), recorded branch runs per step, recorded sessions,
  evidence, verified findings vs `ai_suggested` proposals (listed separately, never as evidence),
  referencing reports, and policy-derived sensitive-output masking for the requesting actor.
- `src/features/results/query.ts` — `useOperationResults`; key `['operation', scope, 'results', id]`
  embeds the auth scope at position 1, so a persona/project switch reads a different entry and the
  superseded scope's in-flight read is cancelled before a delayed response can restore visibility.
- `src/screens/c-results.tsx` — both tabs run on the typed read with feature-local loading (skeleton),
  error (refusal reason + Retry) and empty (not-enough-events) states; the SVG graph keeps its
  keyboard-operable node buttons (focus reveals the same StepDrawer as pointer click) plus aria-labels;
  sessions render under the canvas; links (`technique`, `finding`, `ai-branch`, `c2-session`,
  `analysis`) resolve through migrated route keys and never change the active project.
- `src/domain/service-factory.ts` — append-only wiring `results(actor, projectId): ResultsService`
  through the shared superseded-scope read guard.

**Checks** (run in `apps/web-improve`)

- `npm run typecheck` — 0 errors (0 new).
- `npm run lint` — 198 warnings, 0 errors (baseline allowance ≤202; two stale unused imports removed).
- `npm test -- --run` — 55 files, **781 passed** (769 prior + 12 new), 0 failed.
- `npm run build` — succeeded.

**Tests** (`src/features/results/results.test.tsx`)

- Read model: counts/edges/branch/session/finding derivation from canonical records; masking derived
  per actor (operator vs viewer); non-member read is `not-found` without an existence leak; a
  cross-project address returns the switch-target entity without leaking data.
- Graph screen: 12 canonical nodes with finite geometry (svg width/height and every node's left/top
  finite); pointer click and keyboard focus reveal the same inspector; not-enough-events empty state;
  out-of-scope refusal renders the reason without a leak.
- Bridge: a **legacy** execution event committed via `authority.commit` (correlation `legacy-step-event`)
  publishes the `operation` ChangeSet and the Query-backed graph refetches — S11 flips Needs review →
  Failed without a reload.
- Isolation: a gated (delayed) read for the `all` scope is superseded by a project switch; the stale
  query's data stays `undefined` and the switched view never shows the delayed response.
- Results screen: outcome summary with failed-branch attribution, verified/AI-proposed finding split,
  evidence masking for the viewer role; technique and finding links resolve to the migrated
  `technique`/`finding` routes with the project scope kept.

**Gaps**

- Browser verification of the real preview route (`#/operation/OP-014?tab=graph|results`) was not
  performed: per AGENTS.md § Windows Temporary Process Safety the optional preview HTTP check was
  skipped (recorded as a gap, not a pass). Unit/interaction tests above are the executed evidence.
