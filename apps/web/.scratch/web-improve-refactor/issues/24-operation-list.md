# 24: Operations inventory

**What to build:** Migrate the operations list to typed services/Query with status/technique filters and categorized counts.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Operation list/read handlers.
**Contract:** [execution.md](../execution.md).

- [x] Counts/filter/search/pagination reflect only accessible canonical operations; loading/empty/error states work.
- [x] Creation/detail/preflight/schedule links preserve project context and may use bridged legacy routes.
- [x] Role/read-only gates and late-response isolation are verified.
- [x] Legacy-created operations appear in the migrated inventory without reseeding or page reload.

## Evidence

**Implementation** (branch `wi/24-operations`):

- `src/features/operations/service.ts` — feature-local read handler: pure
  `listOperations(db, ctx, query)` returning one `OperationListRead` (page of
  enriched rows, categorized counts, owner/project filter options, ready
  approved plans) plus `createOperationService(authority, guard)`.
- `src/features/operations/query.ts` — feature-local key namespace
  `operationKeys.list(scope, query)` = `['operation', scope, 'list', query]`
  (entity-kind-first so ChangeSet `[kind]` invalidation reaches it) and the
  `useOperationList` hook via the factory scope + `useQueryScope`.
- `src/domain/service-factory.ts` — minimal append block: `operations(actor,
  projectId)` on `ConsoleServices` wired with the same superseded-scope guard
  as `forScope`, so `cancelScope` covers in-flight operation reads. The file
  was the only UTF-16 (git-binary) source in the app; the edit normalized it
  to UTF-8 — byte-identical content, verified by all checks, and it makes the
  shared factory text-mergeable for parallel workers (14/16/31).
- `src/screens/c.tsx` — `Operations` (OP-01) now consumes `useOperationList`;
  category pills render live counts; loading/empty/error (with failure kind
  message + Retry) states added; everything else (wizard/preflight/schedule/
  detail) untouched for owners 25–30.
- `src/features/operations/query.test.tsx` — 14 tests (see below).

**Read-model scoping:** the handler derives one accessible base set per
request via `projectAccessible` (elevated roles reach every project; others
need a membership entry). Specific-project reads deny non-members with
`not-found` (no existence leak, matching the project read precedent); the
`'all'`/aggregate scope folds in only accessible projects. Rows, counts,
owner/project options and ready plans all project from that base set — a
non-member's data can never appear in counts or options. Filters preserve
legacy semantics including the `operations.status`/`operations.technique`
persisted-filter deep links written by context-ribbon/d-library/e-analysis.

**Bridge proof:** a legacy `A.createOperation` commits through the shared
`DbAuthority`, publishes a ChangeSet with kind `operation`, and the
ChangeSetBridge invalidates the `[operation]` key prefix — the migrated list
shows the new operation and updated counts without reseed or reload
(test: "a legacy-created operation appears in the migrated inventory without
a reload"). The reverse direction is covered by ticket 05's bridge tests.

**Late-response isolation:** the query key embeds actor/role/project at
position 1; on a project switch the ScopeCancelBridge cancels the superseded
scope's Query fetches and the factory guard marks the in-flight read
superseded. A gated aggregate (`'all'`) response resolved after switching to
RT-2026-014 leaves the view on RT-2026-014 rows only, with no data restored
into the stale cache entry (test: "a delayed response for a superseded scope
never pollutes the switched view").

**Checks** (`npm run` in `apps/web-improve`):

| Check | Result |
|---|---|
| `typecheck` | 0 errors (0 new) |
| `lint` | 221 warnings / 0 errors — identical to the ticket-01 baseline; `src/features/operations/*` contribute 0 findings; `c.tsx` findings identical to baseline (same rules, shifted lines) |
| `test -- --run` | 219 passed (205 baseline + 14 new) |
| `build` | success |

**New tests** (`src/features/operations/query.test.tsx`): accessible-only
aggregation with counts; category/search/technique filters; pagination across
pages; detail/creation links preserve `pid`; read-only (viewer) and no-run
(analyst) creation gates with reasons; legacy-create bridge appearance;
delayed superseded-scope response isolation; out-of-scope project error
state; empty project state; handler edges (needs-approval categorization,
page clamping, non-member `not-found` denial, ready-plan references).

**Gaps / deviations:**

- Browser verification of the real route (success/refusal outcomes at
  768/1024/1280/1440) was not run — preview HTTP lifecycle checks are
  optional per AGENTS.md § Windows Temporary Process Safety and were skipped
  rather than risk an unbounded server. Screen behavior is covered by the
  mounted-screen tests above; recorded as a gap, not a pass.
- Per-row "eligibility" labels and the project-level locked banner still read
  the legacy `eligibility()` helper through the shared store projection
  (display-only decoration; `RuntimeStatus`/`c-common` helpers keep their own
  store access until owners 25/26 migrate them). The authoritative list read
  (rows/counts/filters/pagination/ready-plans) is fully on the typed service.
- `A.executePlan` (create-from-plan) and `A.createOperation` remain legacy
  actions by design — creation belongs to owner 25; this ticket only proves
  the read side observes their commits.
