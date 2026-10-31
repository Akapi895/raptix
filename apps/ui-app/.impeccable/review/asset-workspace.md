# Asset workspace implementation review

## Scope

- Mode: Operate. Extend the incumbent Raptix visual system.
- Confirmed composition: Inventory and Asset Graph share one Assets page;
  Discover Assets remains a separate workflow.
- Preserve the global header, sidebar styling, brand, API contracts and stored data.
- Task path: scoped summary → actionable filters → inventory or relationship
  exploration → asset evidence. Discovery ends with selective import.
- Compact KPI strip; unboxed exposure/coverage/discovery groups; dense table.
  At narrow widths, summary and insights reflow, tables scroll within their
  own containers, and the graph explorer stacks below its canvas.

## Data boundaries

- `/api/assets` is paginated in full for scoped metrics. Inventory and summary
  use the same filters. Pagination reuses the summary until a query, write or
  explicit refresh invalidates it.
- `/api/assets/stats` remains available but is not used by this workspace:
  its current implementation ignores project filters and uses last-seen time
  for the recent count.
- Discoveries use `first_seen_at`, not `last_seen_at`.
- Services count distinct project/address/port/protocol endpoints.
- Coverage means a recorded scan timestamp, not verified successful completion.
- Graph address associations come from fields on the same saved asset record.
  No inferred DNS lookup, subnet membership or parent-domain edges.
- Finding edges require a matching project and recorded target address/endpoint.
  Sharing a scan conversation alone never creates a graph edge.
- Graph rendering covers the first 250 matching assets; the UI discloses this
  limit and recommends narrowing inventory filters. KPI counts remain complete.
- Details show target-matched findings and separately identify latest-scan
  associations, which can include other targets in a shared scan.
- The backend retains only the latest scan reference. History does not claim
  to be an append-only ledger or invent execution status.
- No asset crawl/sitemap contract exists in the inspected Go handlers and DTOs.
  Web assets show an explicit no-crawl-data state.
- Legacy overview bookmarks resolve to the unified inventory route.
- Discovery and manual file import default to the active project; explicit
  spreadsheet project mappings remain supported.

## Verification

- TypeScript, production build and demo build pass.
- 671 unit tests pass.
- All eight workspace browser tests pass, including loading failures and empty states.
- Full browser suite: 95/96 passed on the first run. The unrelated task-queue
  inline-edit test passed on its targeted rerun.
- Four isolated asset/discovery/vulnerability browser tests pass.
- Mechanical detector over the changed UI modules and scoped stylesheet: no findings.
- Captures cover 390, 1024 and 1440px, light/dark, inventory, graph exploration,
  detail tabs, discovery search, results and advanced options.
- Document width equals viewport width at the inspected sizes; no browser errors.

## Finish review — in-thread substitution

Initial disposition: fix. Final verdict below.

### Persistence

Pass: PRODUCT.md and this scoped implementation record exist. This is an
incumbent-world layout extension, not a visual-world replacement; no concept
roll, approved comp or global design-system replacement is applicable.

### Fidelity

| Element | Assessment | Evidence |
| --- | --- | --- |
| Type | Match | Incumbent system font and restrained operational hierarchy. |
| Material | Match | Existing flat console surfaces; no new illustrative assets. |
| Ground | Match | Existing light/dark surface and border tokens. |
| Header/sidebar | Match | Existing shell, branding and navigation styling retained. |
| Unified inventory | Match | Scoped KPI strip, shared filters and full inventory visible on desktop. |
| Graph | Adaptation / fix | Real relationship paths and keyboard explorer work; fitted mobile labels collide. |
| Mobile task order | Fix | Expanded supporting insights push inventory controls below the first viewport. |
| Detail copy | Missing | Overview risk badge displays `assets.risk` instead of a readable label. |
| Discovery | Match | Provider search, collapsed advanced options, review and selective import. |

### Ceiling

Operational hierarchy and brand preservation reached; mobile information
density and graph legibility require the material fixes below.

### Material fixes

1. Prevent mobile graph label collisions while preserving node selection,
   zoom/pan and the accessible node explorer.
2. Use the existing translated risk label in asset details.
3. Make secondary exposure/discovery insights collapsible on narrow screens
   so the primary inventory controls appear sooner.
4. Complete demo search response metadata from the existing fixture rows:
   absent `fields` and `total` currently hide result values and report zero.
5. Retain all inventory columns in the horizontal scrolling region instead of
   inheriting legacy breakpoint rules that hide service and project columns.

### Keep

Keep project-scoped metrics, evidence-backed edges, explicit backend limits,
the shared inventory/graph filters, and the incumbent Raptix shell.

## Post-fix verdict

### Verdict

1. Resolved: `graph-mobile.png` shows separated address/port labels and clear
   directional edges. Long service/finding labels are available through node
   selection and the keyboard explorer instead of colliding at the fit scale.
2. Resolved: `detail-desktop.png` shows the translated “Risk” label.
3. Resolved: `mobile.png` shows collapsed supporting insights and the inventory
   search controls in the first viewport. The disclosure is covered by E2E tests.
4. Resolved: `discovery-results.png` displays the existing fixture values and
   “Total 2”; the fixture rows themselves were not changed.
5. Resolved: `mobile-inventory.png` and `tablet.png` retain service and project
   columns inside a bounded horizontal scrolling region.

### Remaining

Clear for the five reviewed fixes. Disposition: ship at this fix-list scope.
Final TypeScript, lint, unit tests, production/demo builds, eight workspace
E2E tests and four isolated browser tests pass.

## Design-system boundary

The existing visual world is preserved. `asset-workspace.css` adds scoped
layout rules and reuses the incumbent surface, border, ink, accent and type
tokens. No global shell redesign or design-system replacement is required.

Documentation pass: no global design-system files changed. Compared
`src/styles/style.css`, `src/styles/asset-workspace.css`, the asset/discovery
views and the captured light/dark variants against PRODUCT.md.

- Palette: existing Raptix light/dark surfaces and red action accent.
- Type: incumbent system UI font; compact labels, 13px controls, 24–28px KPIs.
- Spacing: scoped 4/8/16/24px roles and proximity-based insight grouping.
- Structure: stable inventory table; stacked narrow-screen graph explorer.
- Interaction: visible keyboard focus, keyboard tabs/node exploration, bounded
  scrolling, explicit loading/error/empty states and mobile disclosure.

Pre-existing global design documentation is absent; this extension does not
canonize inherited decoration or repair unrelated global styling drift.
