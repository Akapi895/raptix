# 50: Asset catalog and detail

**What to build:** Migrate asset inventory/detail and scope-classification reads through typed services, keeping import/scope mutations bridged until 51.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Asset read models and catalog/detail surfaces.
**Contract:** [execution.md](../execution.md).

- [x] Search/type/scope filters/pagination and detail links show only accessible assets with loading/empty/error states.
- [x] Ports, findings, evidence and ROE relationships remain scoped; sensitive data respects role masking.
- [x] Pending/out/unclassified assets are visibly distinct from execution-eligible in-scope assets.
- [x] Operation/project mutations update asset relationships across the shared authority; compatibility import links remain usable.

## Implementation

- `src/features/assets/service.ts` — read model over the shared authority: `listAssets` (search/type/scope filters, server pagination PAGE_SIZE 10, whole-scope KPI counts, legacy-add bridge via `authority.listAll(assets)` for the compatibility import), `getAsset` (detail with scoped ops/findings/evidence/agents/approvals/history, sensitive masking, technique refs resolved from library), `getAssetScope` (scoped rows + resolved project/operation contexts), `createAssetService(authority, guard)`.
- `src/features/assets/query.ts` — `assetKeys` entity keys, `AssetReadError` (denial kinds: `denied-access`/`not-found`/`forbidden`), hooks `useAssetList` / `useAssetDetail` / `useAssetScope`.
- `src/domain/service-factory.ts` — ticket-50 wiring: `assets(actor, projectId)` interface method, `forAssets` guard block, return wiring (append-only).
- `src/screens/d-assets.tsx` — `AssetList`, `ScopeDiff`, `AssetScope`, `AssetDetail` migrated to typed reads; pagination server-side (`Pager` over `read.page`); catalog bulk selection is now page-scoped (selection resets on page/filter change — required because rows paginate server-side); mutations (scope change, tag/notes/import, audit) stay on legacy `A.*` actions until 51; non-member reads render "Asset not found" with no existence leak; member-but-different-project renders Blocked with a "View all projects" switch; detail history is filtered to the asset's project (stricter than legacy, avoids cross-project leak); `go('approval', ...)` legacy route key preserved as-is.

## Evidence

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — 217 warnings, 0 errors (base 217 → 0 new).
- `npm test -- --run` — 36 files / 488 tests passed (base 467 + 21 new in `src/features/assets/query.test.tsx`).
- `npm run build` — success (pre-existing >500 kB chunk warning only).
- LOC: new runtime files 263 (`service.ts`) + 81 (`query.ts`); `service-factory.ts` +28/0; `d-assets.tsx` +118/−97. Net +393 (≤400 budget), 5 touched files (≤10).
- Scoping proof: Riley Brooks (analyst, member of RT-2026-014 only) sees 14 assets across 2 pages and KPIs {in:12, out:1, pending:1, unclassified:0}; Casey Nguyen (viewer) reads masked evidence on AS-0143 while Taylor Chen (viewSensitive) sees real names; non-member catalog/detail are denial states without leaking asset or project identifiers.
- Bridge proof: legacy `A.addAssets` catalog import and `A.setAssetScope` classification writes remain live through `authority` collections and still emit `changed` collections, so `ChangeSetBridge` invalidates the `asset` query prefix; compatibility link lists still resolve via `listAll(assets)`.
- Gates: viewer/analyst scope mutations render reason strings from `policy` (e.g. "Only Red Team Managers and Admins can change asset scope.") instead of submitting.
