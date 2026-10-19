# P09 parity checklist (mock action → real-mode status)

Generated 2026-10-19 from the mock screens in `src/screens/*.tsx` (buttons with plain-English labels) and checked against the real-mode code (`src/features/**`, `src/real/**`, `src/ui/**`).

**Method and limits.** A label is marked *evidence* when a specific real-mode file contains the concept. This is not proof of parity: the label, its guard, and its effect must be confirmed on the real panel in the browser (P09 exit). Single-word matches were rejected as evidence because words like "approve" occur throughout the code.

Statuses: **evidence** = concept found in named file, verify the label and effect; **verify** = no specific evidence yet, check the real panel; **mock-only** = not a real workflow by design.

| Mock screen | Action (label) | Status | Note |
|---|---|---|---|
| `a-login.tsx` | Continue with organization SSO | mock-only | SSO is a mock-only login path; real login uses the API session |
| `a-tasks.tsx` | Review finding | verify | no specific real evidence yet |
| `a-tasks.tsx` | Review report | verify | no specific real evidence yet |
| `b-wizard.tsx` | Check Scope | verify | no specific real evidence yet |
| `c-console.tsx` | Create Finding Draft | verify | no specific real evidence yet |
| `c-console.tsx` | Decide in Live Workspace | verify | no specific real evidence yet |
| `c.tsx` | Clear all | verify | no specific real evidence yet |
| `c.tsx` | Clear filters | mock-only | simulated or UI-only control |
| `c.tsx` | Save schedule | verify | no specific real evidence yet |
| `d-agents.tsx` | Clear filters | mock-only | simulated or UI-only control |
| `d-agents.tsx` | Create Group | verify | no specific real evidence yet |
| `d-agents.tsx` | Disable Agent | verify | no specific real evidence yet |
| `d-agents.tsx` | Enable Agent | verify | no specific real evidence yet |
| `d-assets.tsx` | Approve Change | verify | no specific real evidence yet |
| `d-assets.tsx` | Choose playbook | evidence | playbook term in features/library (verify UI) |
| `d-assets.tsx` | Clear filters | mock-only | simulated or UI-only control |
| `d-assets.tsx` | Import as Pending | evidence | import flow in features/assets/import-read.ts |
| `d-assets.tsx` | Mark out of scope | evidence | out_of_scope present in features/assets |
| `d-assets.tsx` | Propose Scope Change | evidence | revision/propose terms present in features/assets |
| `d-assets.tsx` | Request Scope Approval | verify | no specific real evidence yet |
| `e-analysis.tsx` | Download image | verify | no specific real evidence yet |
| `e-analysis.tsx` | Reset filters | mock-only | simulated or UI-only control |
| `e-analysis.tsx` | View operation | verify | no specific real evidence yet |
| `e-findings.tsx` | Create finding from evidence | verify | no specific real evidence yet |
| `e-findings.tsx` | Record result | verify | no specific real evidence yet |
| `e-findings.tsx` | Reset filters | mock-only | simulated or UI-only control |
| `e-findings.tsx` | Return for Changes | evidence | changes_requested status in real reports adapter |
| `f-report.tsx` | Approve Report | evidence | approve action in real reports adapter (verify label) |
| `f-report.tsx` | Fill empty sections with simulated text | mock-only | simulated or UI-only control |
| `f-report.tsx` | Insert confirmed findings | verify | no specific real evidence yet |
| `f-report.tsx` | Mark as Delivered | evidence | delivery recording in real reports adapter (verify label) |
| `f-report.tsx` | Return with Comments | verify | no specific real evidence yet |
| `f-settings.tsx` | Clear filters | mock-only | simulated or UI-only control |
| `f-settings.tsx` | Export Audit Log | evidence | export present in features/audit (verify UI) |
| `f-settings.tsx` | Save preferences | verify | no specific real evidence yet |
| `f-settings.tsx` | Send invitation | verify | no specific real evidence yet |
| `g-fanout.tsx` | Cancel branch | verify | no specific real evidence yet |
| `g-fanout.tsx` | Keep branch | verify | no specific real evidence yet |
| `g-fanout.tsx` | Reset filters | mock-only | simulated or UI-only control |
| `g-fanout.tsx` | Submit request | verify | no specific real evidence yet |
| `g-plan.tsx` | Add Step | verify | no specific real evidence yet |
| `g-plan.tsx` | Create operation & run preflight | mock-only | simulated or UI-only control |
| `g-plan.tsx` | Save Plan | verify | no specific real evidence yet |
| `g-plan.tsx` | Validate Scope | verify | no specific real evidence yet |
| `g-trace.tsx` | Clear filters | mock-only | simulated or UI-only control |
| `g-trace.tsx` | View Operation | verify | no specific real evidence yet |
| `h-session.tsx` | Back to sessions | verify | no specific real evidence yet |
| `h-session.tsx` | Revoke my access | verify | no specific real evidence yet |
| `h-session.tsx` | Submit request | verify | no specific real evidence yet |
| `h.tsx` | Request change | verify | no specific real evidence yet |

Totals: 50 candidates — evidence 9, verify 31, mock-only 10.

## Mock-only surfaces still open
- Approval inbox in the mock Team & Approvals tab (the real side has governance approvals and the workspace HITL approvals; the mock inbox is not mapped).
- Plan review (`g-plan.tsx`) and session console (`h-session.tsx`, `c-console.tsx`) remain mock screens; real mode renders the operation and C2 panels instead.

## Next step
Walk each *verify* and *evidence* row on the real panel in the browser and move it to done, or record the gap with its owner. This needs the live stack, so it waits for the current run to finish.
