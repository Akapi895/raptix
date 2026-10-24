# UI/UX acceptance report

## Checks run

| Check | Scope | Result | Evidence |
|---|---|---|---|
| UI/UX matrix (`uiux-matrix.mjs`) | 7 real routes (Overview, Projects, Team, Governance, Findings, Reports, Infrastructure) at 1440×900, 1024×768, 834×1112 and 390×844; signed in as the owner | **28 of 28 PASS**: no uncaught page error, no horizontal page scroll (tolerance 1 px), a page heading present | `evidence/acceptance/uiux-matrix.json`, screenshots in `uiux-shots` (two kept in `evidence/acceptance/`) |
| Layout check (`layout-click.mjs`) | Real layout | 11 of 11 | `evidence/full-stack-run/flows-layout-click.json` |
| Workspace click-through (`workspace-click.mjs`) | Real navigation, back button, phone width, dark mode | 12 of 12; overview at 390 px: horizontal overflow 0 px; overview renders in dark mode with the sidebar | `evidence/full-stack-run/flows-workspace-click.json` |
| Route smoke, mock | 56 routes | 56 of 56, no new failures | `evidence/full-stack-run/smoke-mock.json` |
| Route smoke, real | 56 routes | 0 new failures; 14 routes declared with a named cause (runtime, C2, or fixture not seeded); 1 declared cause did not occur | `evidence/full-stack-run/smoke-real.json` |
| Runtime gate surfaces (real) | AI workspace, AI trace, fleet, operations, C2 grants | 5 of 5 surfaces state their gate | `evidence/full-stack-run/flows-runtime-gate-click.json` |
| Governance controls by role | Unit tests, two new | 7 of 7 in the governance tab suite; viewer and author cases added | `apps/web` test run, see REGRESSION-REPORT.md |

The matrix is signed in as the owner only. Role-specific layouts for viewer, operator and reviewer were checked by the workflow scripts (controls and text), not by the matrix.

## Defects found in this area

| Id | Where | Finding | Status |
|---|---|---|---|
| UX-A1 | Governance, plan table | Controls shown that the member cannot use (viewer: Approve, Reject, Propose, Revise, the draft form; author: Approve) | FIXED in `fdceb370` (BUGS-FIXED BF-01) |
| UX-A2 | Governance, execution threads card | When the runtime is absent, the card shows the server's own text "Route GET …/threads not found" as an error | OPEN (OI-03). The runtime gate elsewhere shows a plain "not available" statement; this card should do the same |
| UX-A3 | Governance, preflight | After a new scope revision is submitted, the preflight says "No approved ROE revision exists yet." and does not say that a pending revision is the cause | OPEN (OI-02) |
| UX-A4 | Overview, "Awaiting decisions" | The figure counts all projects, not the selected one, and the label does not say so | OPEN (OI-06) |
| UX-A5 | Overview | The figure can lag by up to 30 seconds during in-app navigation; the card has a read-time label | Observed, no change (see DATA-CONSISTENCY-REPORT) |
| UX-A6 | C2 console address | The "No interactive console in this build" banner is accurate for an interactive terminal, but the address gives no way to dispatch a command; the command form is on Infrastructure → Sessions | OPEN (OI-07) |

## Not verified

- No automated accessibility audit (no axe run) and no keyboard-only walkthrough of the new governance controls. Reviewers should run one before deployment review.
- Real drawer navigation at tablet and phone width with a live runtime; the drawer was checked only with the mock data set in earlier rounds.
- Light theme in every route; dark theme was checked on the overview by the workflow flow.
- Visual review of the empty and error states on routes that need the runtime (they show the gate text, which the runtime-gate check reads).
- Locale and text overflow for long engagement names beyond the seeded ones.

## Visual observations (from the screenshots)

- Governance at 390 px: the preflight list and its status chips wrap cleanly; the business plan table is reachable below it. The chip texts are the server's own sentences, which are long for a phone. Acceptable for acceptance; copy review recommended.
- The project name appears twice in the breadcrumb and under the page title ("Stack verification project" after the project id). This was reviewed in an earlier round and kept as a layout choice.
