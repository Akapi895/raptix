# 20: Graph và asset inventory live consistency

**What to build:** Infrastructure/Assets hiển thị cùng kiến thức thật của engagement và mọi search/filter/detail/refresh có outcome đúng.
**Blocked by:** None (can start immediately).
**Priority / Profile:** P1 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Inventory supported graph/inventory controls and current APIs; identify display-only controls requiring wiring or explicit removal.
2. Trace actual tool output → normalization → KG → scoped graph/asset projections; preserve canonical identities/dedupe.
3. Complete search/filter/detail/pagination/refresh, expose evidence reference/provenance where available.
4. Synchronize cross-page updates using actual server results, not guessed asset counts.
5. Handle unavailable, partial/truncated graph and foreign engagement state; no fabricated empty graph on outage.

## Acceptance criteria
- [ ] Actual benign ingestion appears in both views with matching host/service identity.
- [ ] Filters/detail return scoped records and truthful provenance/cap status.
- [ ] KG outage is unavailable; unknown counts not changed to zero.

## Test / expected result
L09 real KG/tool pipeline, duplicate observation, project switch and stopped KG. DTO redaction and foreign node denial via API tests.

## Completion evidence
Actual observation/asset IDs, cross-view comparison, provenance and failure/refresh traces.
