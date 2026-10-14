# 03: Shared domain and service contracts

**What to build:** Extract entity/status/permission types and define typed async service results, pagination and explicit actor/project context. Preserve existing imports through compatibility exports. Implementations belong to feature owners.
**Blocked by:** 02.
**Status:** resolved
**Owner:** Shared contracts.
**Contract:** [execution.md](../execution.md).

- [x] Each domain type has one definition; legacy imports remain valid through re-exports.
- [x] Service contracts specify success/error, not-found/forbidden and pagination behavior without `any` or ambiguous optional success data.
- [x] Actor, project, absolute deadlines and entity-change identities support the single-authority bridge and fake clock.
- [x] The Proposed boundary ADR is referenced; findings/evidence contracts preserve opaque references and capture-integrity vocabulary.

## Evidence

Branch `wi/03-contracts`, base = integration tip `c7a52a6` (verified equal before work; no merge needed).

### What was extracted

New module `apps/web-improve/src/domain/` (5 files, 361 written lines, all type-only — zero runtime additions; ≤400-line/≤10-file budget met):

- `entities.ts` (106) — 20 status/enum unions and 37 entity/read-model interfaces moved verbatim from `src/data.ts` (incl. `Facets`). `APR`, `BRANCH_LABEL`, `BRANCH_TERMINAL`, `planVer`, `toolFacets`, `USERS`, `TACTICS`, `TECHNIQUES`, `seed`, `SeedVariant` and `Db` remain in `data.ts` (runtime seed/demo constants, implementation-tied).
- `permissions.ts` (27) — the 19-action `CanAction` union moved out of `src/store.tsx`.
- `service.ts` (155) — new contracts: `Instant`, `Clock`, `Deadline`, `ActorRef`, `RequestContext` (actor/project/corr supplied by the factory, not callers), `ServiceErrorKind` (`not-found`/`forbidden`/`conflict`/`validation`/`unavailable`), `ServiceFailure`, `ServiceResult<T>` (required `data` on success — no ambiguous optional success payload), `PageRequest`/`Page<T>`/`ListResult<T>`/`ReadResult<T>`, `EntityKind`/`EntityRef`/`ChangeSet` (committed-mutation identities driving Query invalidation and the legacy subscriber), `EntityReader<T>` (async get/list seam for ticket 04's per-entity services).
- `evidence.ts` (54) — GLOSSARY-aligned vocabulary, naming only: `EvidenceReference` (opaque), `ClaimId` (recorded claim), `ProducerInvocationId`/`ProducerLineage` (producer lineage), `CaptureIntegrityStatus`/`CaptureIntegrity` (capture integrity); documents the mechanical mapping from entity string fields.
- `index.ts` (19) — barrel; module-root doc comment references ADR-0067 (`docs/adr/0067-web-console-service-domain-boundary.md`) and states the contracts-only rules.

### Compatibility re-export sites

- `src/data.ts` — `export type * from './domain/entities'` keeps every legacy `./data` type import valid; internal uses import the 39 needed names explicitly. Net −56 lines (444 → 388).
- `src/store.tsx` — `export type { CanAction } from './domain/permissions'`; legacy `import { type CanAction } from '../store'` (e.g. `safety/rbac.test.tsx`) unchanged. Net +3/−1.

All 47 existing `from '../data'` / `from './data'` import sites and both `CanAction` import sites were inventoried; none required edits.

### Checks (in `apps/web-improve`)

| Command | Baseline | Result |
|---|---|---|
| `npm run typecheck` | 0 diagnostics | 0 diagnostics (clean) |
| `npm run lint` | 0 errors, 226 warnings | 0 errors, 226 warnings (no new) |
| `npm test -- --run` | 60 passed (8 files) | 60 passed (8 files) |
| `npm run build` | green | green (built in ~8s; pre-existing >500 kB chunk warning only) |
| `npm run preview -- --port 8599 --strictPort` + `GET http://localhost:8599/` | — | HTTP 200, `id="root"` present; app serves |

No `any` in `src/domain/` (verified by grep); `isolatedModules`/`strict` typecheck passes.

### Gaps

- Browser click-through of the running app could not be performed (no browser in this environment); only the HTTP smoke test above was run. No behavior changed (type-only move), and the 60 baseline tests cover rendered screens.
- Ticket 02's ledger gaps (G-1…G-12) are enforcement gaps owned by later tickets; untouched here by design.
