# @raptix/web-raptix — corrected frontend visual preview

Canonical visual source: `../web-correct`. The current user correction supersedes
the earlier single-user/backend-integration UI scope. This build copies the source
design and uses frontend demo behavior only; no backend is connected.

## Exact sidebar scope

| Group | Page | URL suffix |
|---|---|---|
| ENGAGEMENT | Charter & ROE | `charter` |
| ENGAGEMENT | Scope & Boundary | `scope` |
| EXECUTION | Operator Console | `console` |
| EXECUTION | Vector Campaigns | `campaigns` |
| EXECUTION | C2 & Sessions | `sessions` |
| INFRASTRUCTURE & DATA | Infrastructure & Data | `infrastructure` |
| INFRASTRUCTURE & DATA | Assets & Inventory | `assets` |
| INFRASTRUCTURE & DATA | Credentials Vault | `credentials` |
| OUTCOMES | Findings & Evidence | `findings` |
| OUTCOMES | Operations Log | `logs` |
| OUTCOMES | Reports | `reports` |
| — | Members | `members` |
| — | Settings | `settings` |

All workspace URLs start with `/projects/:projectId/`. Home at `/projects` is the
project picker. Opening a project defaults to Charter. The Home console CTA opens
Operator Console. Overview, Root Agent, Graphs and a separate Evidence page are not
mounted or routed; previous source is archived in `docs/design-reference/pre-web-correct/`.

## Run / checks

Node >=22.12 and npm workspaces. Run from repository root `raptix/`:

```bash
npm run dev --workspace=@raptix/web-raptix
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix
npm run build --workspace=@raptix/web-raptix
npm run test --workspace=@raptix/web-raptix
npm run test:e2e --workspace=@raptix/web-raptix
npm run test:e2e:real --workspace=@raptix/web-raptix
```

Dev defaults to `127.0.0.1:5273`; preview defaults to `127.0.0.1:5274`. The currently
running user preview was verified at **http://127.0.0.1:5284/projects/1/charter**.
Mock E2E rebuilds then runs production preview on 5275. Real-mode guard runs on 5276.
Their ignored artifact directories are separate (`test-results/`, `test-results-real/`).
Install the browser once using `npx playwright install chromium` from this package.
Windows checks used `PLAYWRIGHT_BROWSERS_PATH` in the approved temporary directory.

## Source fidelity and demo boundary

- Source page bodies, full panels, data tables, role/member fixtures, vault, campaigns,
  C2 terminal and report studio are restored rather than replaced by capability placeholders.
- Shell preserves the source 240px sidebar, 60px header, red/light styling and AK persona;
  source CSS/font imports are retained, with mobile containment and focus helpers appended.
- All page actions are visual/local demos. Invite, campaign, C2 command, reveal/copy,
  report compilation/export/sign/share and settings controls have no real backend service.
  PDF/DOCX buttons currently provide demo feedback, not generated deliverable downloads.
- New project creation persists source-shaped demo metadata under a separate visual-demo
  storage key; old demo storage remains untouched. Source members/roles/counts are preserved.
- `VITE_DATA_MODE=mock` is the visual mode. Real mode reports backend integration unavailable
  and never substitutes a live-service success with demo data.

## Structure / evidence

`src/app/` owns the 13-entry navigation/router; `src/screens/` contains only canonical
source visual pages and Home. InfrastructureData serves three nav entries. `src/shared/`
contains accessible Dialog/viewport helpers; `src/mocks/` contains project preferences
and source fixtures. Older unmounted helper modules are not part of the active UI bundle.

See `docs/correct-frontend-scope.md` for source-copy deviations and current verification.
`docs/implementation-checklist.md` describes the prior delivery and is historical.
