# Coverage and ownership

These are revised leaf IDs, not the old 24-ticket IDs. Each story below has an explicit
owner; execution.md defines the inherited quality, bridge and retirement requirements.

## Story coverage

| Spec stories | Owner leaves | Deliverable |
|---|---|---|
| 1, 6 | 05–06 | Shared auth/persona authority, login and RBAC |
| 2, 58 | 07, 61 | Guarded routes, system pages and per-feature boundaries |
| 3–4 | 05, 07–08 | Shell, project scope, providers and navigation |
| 5 | 19, 35 | Wizard/editor dirty guards; every form inherits the contract |
| 7 | 14 | Command Center, KPIs, readiness/completion/activity |
| 8 | 15 | My Tasks and approval inbox |
| 9–10 | 16–19 | Portfolio and full five-step wizard |
| 11–12 | 21 | Approvals and immediate scope invalidation |
| 13 | 20, 23 | All six required detail tabs and retained secondary tabs |
| 14–15 | 22 | Closure checks and independent confirmation |
| 16–18 | 24–26 | Operation list, wizard/schedule and eight preflight gates |
| 19–22 | 27–28 | Controls, stop outcomes and no automatic resume |
| 23–24 | 29–30 | Live, review gate, timeline/agents/results/graph |
| 25–26 | 48–49 | Agent fleet, health, assignment and groups |
| 27–28 | 50–51 | Asset catalog/import/scope approval |
| 29 | 52–53 | Library, techniques and independent revision review |
| 30–31 | 54–55 | Coverage/heatmap and observed-only attack paths |
| 32–34 | 31–32 | Findings inventory/forms/lifecycle/AI draft import |
| 35 | 33 | Evidence inspector, masking and capture integrity |
| 36–37 | 34–35 | Report catalog/templates and editor/preview |
| 38–40 | 36–37 | Report review/version pinning/export/delivery |
| 41–43 | 38–40 | AI workspace/proposals, approval expiry and operation bridge |
| 44–46 | 41–42 | Trace facets, plan diff and conversation history |
| 47–48 | 43–44 | Fanout actions and worker DAG |
| 49–52 | 45–47 | C2 infrastructure/channels, requests/grants and console |
| 53–54 | 56–58 | Six settings tabs and audit log |
| 55–56 | 59–60 | Notifications and context-aware copilot |
| 57 | 61 | Scenarios, walkthrough and workspaces |
| 59 | 09–13, 62–64 | Accessible primitives and responsive/dark/accessibility audits |
| 60 | All feature leaves, 65–67 | Semantic modules and bounded legacy contraction |
| Cross-cutting | 01–04, 68–69 | Tooling, baseline, contracts/bridge, performance/final verification |

## Shared write owners

| Surface | Owner / coordination |
|---|---|
| Dependencies, npm lockfile, test/type/lint scripts | 01; later additions get a separate tooling leaf |
| Baseline test adapters / coverage ledger | 02; integrator serializes adapter moves |
| Shared entity/permission/service types | 03; additions negotiated with the contract owner |
| Canonical database, transactions, subscriptions, factory/clock | 04 |
| Shared Zustand stores, Query provider/cache bridge | 05 |
| RBAC policy and login | 06 |
| Route inventory, router/go adapter and manifest registry | 07 + integrator |
| Sidebar/header/project-switcher composition | 08 + integrator |
| Shared UI and tokens | 09–13; later changes by integrator/62–64 |
| Project governance / closure | 21 / 22 |
| Operation gates / controls / emergency-stop machine | 26 / 27 / 28 |
| Plan approval and expiry | 39; 40 uses the operation API, never rewrites it |
| Grant authorization and expiry | 46; 47 consumes it |

Project detail's mandatory tabs are overview/scope/operations/findings/reports/team.
Leaf 20 owns overview/scope/team; 23 owns related entity panels and preserves existing
objectives/activity/plans/sessions/evidence/audit/close links through typed services.
The close panel delegates governance to 22. Feature leaves also preserve their current
route IDs/aliases, including operation-schedule, asset-scope, playbook-review and both
evidence aliases. Leaf 07 records the source registry's 53 keys before migration.

## Superseded 24-ticket mapping

Old filenames have been replaced; resolve historical references with this table.

| Old ID / group | Revised leaves |
|---|---|
| 01 harness/invariants | 01–02 |
| 02 types/services | 03–05 plus per-feature handlers |
| 03 router/shell/design system | 07–13 |
| 04 auth/RBAC | 05–06 |
| 05 projects foundation | 16–20, 23 |
| 06 project governance | 21–22 |
| 07 operation creation/preflight | 24–26 |
| 08 controls/estop/live | 27–30 |
| 09 findings | 31–32 |
| 10 evidence | 33 |
| 11 report authoring | 34–35 |
| 12 report governance | 36–37 |
| 13 AI chat/plans | 38–40 |
| 14 AI accountability | 41–42 |
| 15 fanout/workspace | 43–44 |
| 16 C2/grants | 45–46 |
| 17 console | 47 |
| 18 agents/assets | 48–51 |
| 19 tradecraft | 52–53 |
| 20 analysis | 54–55 |
| 21 settings/notifications/copilot | 56–60 |
| 22 responsive/dark/performance | 62–63, 68 |
| 23 accessibility/demo | 61, 64 |
| 24 retirement/final verification | 65–67, 69 |

P0 is tooling/bridge/providers/router/shared UI (01–13). Feature workflows own their
quality checks as they land; 14–61 cover the P1–P4 functional scope without imposing
phase-only dependencies. Audits/contraction/final gate are 62–69. Git/ADR prerequisites
precede this graph. Initial graph frontier after those prerequisites is 01 only.
