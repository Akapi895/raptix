# 44: AI worker dependency graph

**What to build:** Migrate the worker/DAG presentation and branch dependency read model separately from branch actions.
**Blocked by:** 43.
**Status:** resolved
**Owner:** Worker read model/SVG graph.
**Contract:** [execution.md](../execution.md).

- [x] Worker nodes/status/dependencies reflect recorded canonical data and remain project-scoped.
- [x] Keyboard/focus navigation reveals the same node detail as pointer interaction; labels and theme contrast remain legible.
- [x] Empty/error/missing dependency cases are explicit; graph state never grants execution permissions.
- [x] Existing fanout/workspace entry points stay reachable; graph-specific legacy readers are retired.

## Evidence

Implementation (branch `wi/44-branchexport`):

- `src/features/workers/service.ts` — feature-local worker dependency read
  model over the one database authority (ADR-0067). `listWorkers` is
  scope-checked like the branch reads (a non-member's specific-project read is
  `not-found` without an existence leak; `'all'` aggregates only the actor's
  accessible projects). Each `WorkerRow` carries the recorded worker plus
  resolved joins: dependency levels (1-based depth; memoized with a visiting
  guard so dependency cycles terminate), deps and parent resolved against the
  worker's own project (`missing` when the referenced id has no recorded
  worker — never dropped, never treated as satisfied), and branch
  dependencies resolved from the recorded `BR-` inputs (`missing` when no
  branch row exists). States are reported exactly as recorded — nothing is
  inferred as success and the read grants nothing. Read-only feature: no
  worker writes exist in this ticket, so there is no legacy-mutation bridge
  case (grep-verified: no legacy action mutates `aiWorkers`); a runtime
  commit touching `aiWorkers` publishes the `ai-worker` ChangeSet (kind
  registered in `src/domain/database.ts`) that the Query binding observes.
- `src/features/workers/query.ts` — feature-local key namespace
  (`['ai-worker', scope-with-effective-project, 'list']`, scope at position
  1) and `useWorkers(projectId)`; failures rethrow as `WorkerReadError` so
  the screen renders kind + message.
- `src/domain/service-factory.ts` — append-style `workers(actor, projectId)`
  wiring following the ticket-56 pattern; reads share the factory's
  superseded-scope guard (cancel-on-switch).
- `src/screens/g-workers.tsx` — `WorkerTeamView` (the migrated AI-team view):
  Graph/Table segmented views over the same typed read. The graph is a
  read-only layered DAG (columns are dependency levels, SVG beziers are
  resolved dependency/parent edges); every node is a native button whose
  aria-label carries id, state and dependencies (`…, depends on AW-014-99
  (missing)`), and both pointer click and keyboard focus reveal the same
  detail panel (role/task/model/parent/inputs/output, dependency chips with
  missing records called out, branch dependencies linking through the router
  to `ai-branch`). Missing dependency records get a graph-level warning
  banner plus per-node/detail callouts. Empty (no workers in an accessible
  project), error (out-of-scope read, with Retry) and missing-dependency
  states are explicit. The surface grants nothing: it carries no action
  buttons and states "Graph state is informational — it never grants
  execution permissions." Tone/label classes reuse the shared semantic
  tokens (text-warn/bg-warn-soft/…, text-bearing state pills, not
  color-only); full 768–1440 width and dark sweeps remain with the 62/63
  audits.
- `src/screens/g-fanout.tsx` — the AI-team body moved out; the file's raw
  `db.aiWorkers` reader (the graph-specific legacy reader, old line 537) is
  retired, and `AiTeamView` is now a forwarding re-export of
  `WorkerTeamView`, so the workspace Inspector's import
  (`src/screens/g-workspace.tsx`) is unchanged and the entry point stays
  reachable. FanOutCard/AllocationView seams untouched.

Checks (all run in `apps/web-improve`):

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — 218 warnings, 0 errors (baseline 218; no new diagnostics).
- `npm test -- --run` — 36 files, 476 tests passed (467 baseline + 9 new).
- `npm run build` — succeeds (pre-existing >500 kB chunk advisory only).
- New tests: `src/features/workers/workers.test.tsx` — the read model
  reports recorded levels/deps/parent/branch inputs (including a failed
  branch dependency, never inferred as success); non-member specific-project
  reads are `not-found` without leaks; aggregate reads exclude an
  inaccessible project's workers (committed synthetic `AW-015-01` visible to
  the admin, absent for the single-project member); missing dependency
  records are explicit and dependency cycles terminate; the graph renders
  node buttons with state/dependency labels and pointer click and keyboard
  focus reveal the same detail panel; the missing-dep banner and per-node
  `(missing)` label render; the table view stays reachable; the
  "never grants execution permissions" line is present; a committed
  `ai-worker` state change publishes a ChangeSet and the Query-backed view
  refetches (runtime commit → Query bridge proof); out-of-scope reads render
  the error state without a leak; worker-less projects render the empty
  state; the `g-fanout` forwarding export is identity-equal to
  `WorkerTeamView` and renders.
- Grep evidence: no `db.aiWorkers` reader remains in `src/screens/` (only
  the retirement note in g-fanout's comment).
- Browser verification: not exercised in a live preview (per dispatch, the
  preview HTTP check is optional under AGENTS.md § Windows Temporary Process
  Safety) — recorded as a gap. Route/component coverage is via the mounted
  view tests above.

Deviations:

- The dispatch brief described this ticket as "branch detail + export
  (markdown bundle, `exportData` policy)". That description matches no
  tracker leaf: the only `44-*` file is this ticket (the dispatch's own
  fallback rule), branch detail was already migrated by ticket 43, and no
  branch-export/markdown/`exportData` feature exists in the codebase. The
  tracker ticket was implemented as written above.
- The worker graph lives in the workspace Inspector's AI-team view (the
  surface `AiTeamView` already occupied); no new route key was needed, so
  the route inventory is unchanged.
