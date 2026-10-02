# Correct-source frontend visual delivery — 2026-10-01

This scope is the user's correction: copy `clients/web-correct` and expose only the
13 requested workspace sidebar entries. Backend integration is intentionally outside
this delivery. It supersedes the earlier single-user capability/navigation decisions.

## Implemented checklist

- [x] Canonical source kept unchanged; selected source screens/components copied to `web-raptix`.
- [x] ENGAGEMENT: Charter & ROE, Scope & Boundary.
- [x] EXECUTION: Operator Console, Vector Campaigns, C2 & Sessions.
- [x] INFRASTRUCTURE & DATA: Infrastructure & Data, Assets & Inventory, Credentials Vault.
- [x] OUTCOMES: Findings & Evidence, Operations Log, Reports.
- [x] Members and Settings active as frontend-demo pages.
- [x] Exactly 13 sidebar controls, correct order/group names and URL mappings.
- [x] Home only selects/creates projects; default Charter; console CTA/New Chat route to Console.
- [x] Overview, Root Agent, Graphs and standalone Evidence have no mounts/routes.
- [x] Eleven previous extra screen files archived out of `src/screens` under `docs/design-reference/pre-web-correct/screens`.
- [x] Source member avatars/roles, source fixture counts and full source panels restored; no old empty/read-only capability gating in these pages.
- [x] Frontend demo indication; no API requests during page/render/demo-action browser checks.
- [x] Shared dialog Escape/focus/label behavior; dismissing HITL never records a decision.
- [x] Mobile sidebar, viewport height, wide-column containment, report table pan and terminal tab pan fixes.
- [x] Independent scope/fidelity/responsive reviews complete; HEAD handled remaining fixes directly after the user requested no further agents.

## Deliberate small changes beyond source copy

- Navigation omits source Overview and renames Environment Map to Infrastructure & Data;
  Scope & Boundary and Findings & Evidence match the user's labels.
- Header project breadcrumb and Home secondary CTA lead to Charter; console CTA opens Console.
- Source dialogs use the shared accessible wrapper without replacing the dark visual design.
- Console terminal sample escaping and Findings PoC string escaping fixed to compile/lint correctly.
- Embedded evidence metadata made visible in the source Finding detail modal; no separate Evidence screen added.
- Campaign generation timer gets cleanup; Edit Draft/Deploy provide explicit local-demo feedback.
- Assets selection's Update Scope control navigates to Scope & Boundary. This control existed
  in the source; it was not a new target-only visual addition (review classification corrected).
- Source fixed viewport heights resolve to the workspace content height. Mobile wide layouts
  pan rather than squeeze; report header/rows share an accessible horizontal scroll area.

## Current verification

Run from `D:\.VTNet\redteam\raptix`, Node 24.18.0/npm 11.16.0, Windows:

| Check | Result |
|---|---|
| Typecheck/browser/tooling/tests | Pass |
| Production build | Pass; 42 modules, initial JS 256.32 kB / 75.95 kB gzip |
| ESLint | Pass; 0 errors, 38 source-inherited unused import/variable warnings |
| Vitest | 17/17 pass; includes corrected routing and source-fixture preservation checks |
| Production browser scenarios | 8/8 pass; 16.3 seconds |
| Real-mode no-fallback guard | 1/1 pass |
| Visual captures | All 13 desktop workspace pages plus six mobile views; no browser runtime errors |
| Backend request assertion | Zero `/api/` requests while rendering all pages and using campaign/C2/vault demo controls |

Browser scenarios cover exact sidebar membership/order, every route render, source new-project
form/reload, console CTA/breadcrumb/history, exclusion of retired pages, local member invite,
HITL dismissal/deny, mobile navigation, campaign generation/deploy feedback, local terminal
input and credential reveal. Screenshots are generated under ignored `test-results/`.

The active preview at `http://127.0.0.1:5284/projects/1/charter` and its new JS bundle
were checked over HTTP and both returned 200. This is a frontend visualization acceptance,
not backend/RBAC/vault/orchestration/C2/report-service acceptance.

## Known demo-only limits

Source samples simulate status/metrics/activity. Source controls that originally only
displayed local toasts/visual feedback still do so; no real execution, invitations,
secret persistence, deployment, external integration, report signing or PDF/DOCX service
is connected. Full backend work can follow after this corrected visual baseline is accepted.
