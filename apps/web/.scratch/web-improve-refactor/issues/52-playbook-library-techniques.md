# 52: Playbook library and technique detail

**What to build:** Migrate library/playbook/technique reads and step/technique navigation through typed services.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Tradecraft read models and detail surfaces.
**Contract:** [execution.md](../execution.md).

- [x] Library search/status/kind filters and pagination distinguish approved versions from pending revisions.
- [x] Technique references from operation steps/playbooks/analysis resolve to the existing detail route.
- [x] Detail retains version/steps/techniques and scoped role/read-only explanations.
- [x] Legacy review entry points remain functional until 53; no component directly mutates tradecraft data.

## Implementation

- **Read models** (`src/features/library/service.ts`): feature-local `LibraryService` with `list` (library cards + tab badge counts + technique catalog rows with scoped used-by counts + active-project detection overlay), `getPlaybook` (active version, pending revision, scoped usage, version history, attach-compat) and `getTechnique` (catalog entry + scoped steps/findings/detection). Factory wires `services.library(actor, projectId)` behind the shared superseded-scope guard (`src/domain/service-factory.ts`, ticket-48 append pattern).
- **Versioning read model:** committed state is the active (approved/draft) version; `revision` is always a separate pending projection — cards and detail show "v2.4 pending review · v2.3 stays approved" from canonical state, and an unapproved revision is never presented as an operation target (read-side guarantee; enforcement stays with the operations owners' wizard/preflight checks, ticket 25/26/53).
- **Sharing scope:** 'Organization' → every actor; 'Project <id>' → that project's members + elevated roles; 'Team only' → elevated roles. Denied reads are `not-found` (no existence leak). Technique catalog entries are reference data readable by every persona; their per-project projections (steps, findings, detection) narrow to the request scope — a non-member specific-project read yields an empty projection.
- **Screens** (`src/screens/d-library.tsx`): `Playbooks`, `PlaybookDetail` and `TechniqueDetail` consume the Query hooks (`src/features/library/query.ts`, keys `['playbook', scope, …]` / `['technique', scope, id]`); loading/empty/error states with retry; pagination via the shared `Pager`. `PlaybookReview` is untouched legacy (ticket 53); its entry points (Review Playbook / Compare Versions / banners) still navigate to `playbook-review`. No component mutates tradecraft data — the service is read-only.

## Evidence

- `npm run typecheck` — clean (0 new diagnostics).
- `npm run lint` — 218 warnings (baseline 218; budget ≤219; `d-library.tsx` keeps its 5 baseline refresh warnings, no new).
- `npm test -- --run` — 369 passed (347 baseline + 22 new in `src/features/library/query.test.tsx`); one unrelated flake under parallel load reproduced green on rerun (same flakiness present at baseline).
- `npm run build` — success.
- Required tests (all in `src/features/library/query.test.tsx`):
  - Library filters: kind tabs, search, status filter, tab badge counts stay unfiltered; pagination across pages (12 seeded + 12 committed rows).
  - Technique detail from references: playbook step chip (`title`-identified) resolves `#/technique/T1082` through the route host and renders scoped steps (OP-014/OP-015).
  - Playbook detail: approved v2.3 steps read-only with the v2.4 pending-revision banner; draft PB-004 offers Preview Draft and no "Use in operation".
  - Scoped reads: non-member (Riley Brooks) list hides PB-003/PB-004; direct `#/playbook/PB-003` deep link renders "Playbook not found"; non-member specific-project technique read yields empty projections.
  - Bridge: legacy `A.setPlaybookStatus`/`A.decidePlaybookRevision` changes appear in the new list and detail views without a reload (kind-keyed ChangeSet invalidation).
- Preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety (process safety gap; screen-level behavior covered by the route-host tests above).
- Browser verification gap: real-browser click-through from an operation step (operations screens are still legacy, owned by their migration tickets) and light/dark + width sweep not exercised; in-app navigation paths (`go('technique')`/`go('playbook')`/`go('playbook-review')`) are covered by the mounted route-host tests.
