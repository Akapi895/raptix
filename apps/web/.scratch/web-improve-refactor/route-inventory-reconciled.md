# Route inventory — reconciled (P00, 2026-10-19)

Reconciled against the live registry (`src/router/registry.tsx` MANIFEST) and the real-mode tables
(`src/router/route-table.ts` FEATURE_ROUTE_SURFACES and MIGRATED_ROUTES, `src/router/host.tsx` REAL_PAGES,
`src/real/not-integrated.tsx` REAL_INTEGRATED_ROUTES). The frozen 53-key list from ticket 07 is superseded:
`overview` (real home) and `infrastructure` (global resource) were added later, and `agents` and `c2` are
served by the `i` slice. The MANIFEST holds **55 keys**, matching the plan.

Modes: **real** = a real-mode panel renders the route; **shared** = a migrated screen reads through the
feature ports in both modes; **system** = an error or auth page with no console data; **mock-only** = real
mode renders the honest `RealNotIntegrated` panel and the demo screen is not used.

| Key | Registry slice | Real-mode status |
|---|---|---|
| `login` | `a` | real (direct panel) |
| `forbidden` | `a` | system (no console data) |
| `notfound` | `a` | system (no console data) |
| `error` | `a` | system (no console data) |
| `offline` | `a` | system (no console data) |
| `session-expired` | `a` | system (no console data) |
| `states` | `a` | mock-only (RealNotIntegrated) |
| `overview` | `a` | real (direct panel) |
| `command-center` | `a` | real (direct panel) |
| `tasks` | `a` | real (direct panel) |
| `projects` | `b` | real (direct panel) |
| `project-new` | `b` | real (direct panel) |
| `project` | `b` | real (direct panel) |
| `operations` | `c` | real (feature panel) |
| `operation-new` | `c` | real (feature panel) |
| `preflight` | `c` | real (feature panel) |
| `operation-schedule` | `c` | real (feature panel) |
| `operation` | `c` | real (feature panel) |
| `infrastructure` | `i` | real (global resource) |
| `agents` | `i` | real (feature panel) |
| `agent` | `d` | real (feature panel) |
| `assets` | `d` | shared (migrated screen on ports) |
| `asset-new` | `d` | shared (migrated screen on ports) |
| `asset-scope` | `d` | shared (migrated screen on ports) |
| `asset` | `d` | shared (migrated screen on ports) |
| `playbooks` | `d` | shared (migrated screen on ports) |
| `playbook` | `d` | shared (migrated screen on ports) |
| `technique` | `d` | shared (migrated screen on ports) |
| `playbook-review` | `d` | shared (migrated screen on ports) |
| `analysis` | `e` | real (feature panel) |
| `findings` | `e` | shared (migrated screen on ports) |
| `finding-new` | `e` | shared (migrated screen on ports) |
| `finding` | `e` | shared (migrated screen on ports) |
| `evidence` | `e` | shared (migrated screen on ports) |
| `evidence-inspector` | `e` | shared (migrated screen on ports) |
| `reports` | `f` | shared (migrated screen on ports) |
| `report-new` | `f` | shared (migrated screen on ports) |
| `report` | `f` | shared (migrated screen on ports) |
| `report-preview` | `f` | shared (migrated screen on ports) |
| `report-review` | `f` | shared (migrated screen on ports) |
| `settings` | `f` | shared (migrated screen on ports) |
| `ai-operator` | `g` | real (direct panel) |
| `ai-plan` | `g` | real (feature panel) |
| `ai-plan-review` | `g` | real (feature panel) |
| `ai-plan-compare` | `g` | real (feature panel) |
| `ai-trace` | `g` | real (direct panel) |
| `ai-history` | `g` | real (direct panel) |
| `ai-fanout` | `g` | real (feature panel) |
| `ai-branch` | `g` | real (feature panel) |
| `c2` | `i` | real (feature panel) |
| `c2-channel` | `h` | real (feature panel) |
| `c2-session` | `h` | real (feature panel) |
| `c2-console` | `h` | real (feature panel) |
| `scenarios` | `s` | mock-only (RealNotIntegrated) |
| `workspaces` | `s` | mock-only (RealNotIntegrated) |

Totals: 55 keys — real 28, shared 19, system 5, mock-only 3.

## Mock-only keys still open
- `states`: component showcase; dev/demo only. Decide: keep mock-only and document it, or remove from the release route set.
- `scenarios`, `workspaces`: demo slice (`screens/demo/pages`). Decide the same way; they are not part of any real workflow.

## Gate note
`route-manifest-check.mjs` FROZEN was updated to this inventory; the earlier 53-key list is retained in git history.
