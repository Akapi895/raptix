# Bugs and faults fixed in this pass

Count: **one product defect** (BF-01) and **thirteen test, fixture or harness faults** (BF-02 to BF-14). Each one has its evidence and, for BF-01, a regression test.

## Product

### BF-01 · Governance controls shown to members who cannot use them · P1 (authorization presentation)

- **Observed**: on a proposed plan a viewer saw Approve, Reject and Propose; on a draft a viewer saw Propose and the draft form; on an approved plan a viewer saw Revise. The author of a proposal saw Approve. Each click was refused by the server with a 403 or 409, so the control always failed.
- **Cause**: `features/governance/tab.tsx` rendered every control without reading the member's role or authorship. The server's floors are: draft, propose and revise from operator; decide from reviewer; no one decides a plan they wrote (`governance-service.ts`, `requireIndependentActor`).
- **Fix**: controls follow the floors. Drafting and revising need operator or above; deciding needs reviewer or above and the decider must not be the author. The author and the other members see a short reason in place of the buttons. The server is unchanged; it stays the authority.
- **Evidence before the fix**: WF-04 ran the author step on a proposal and found the Approve control present; the click reached a refusal (the test failed on the author check). After the fix the author sees "You wrote this plan; an independent reviewer decides it." and no Approve control; WF-04 passes 5 of 5.
- **Regression tests**: `tab.test.tsx` gained two cases: a viewer sees no decision, draft or propose controls; the author of a proposal sees no Approve control and the reason. The existing approve and refusal tests still pass with the owner role. Web unit suite: 1666 tests, up from 1664.
- **Commit**: `fdceb370`.

## Test fixtures and stack

### BF-02 · No approved ROE in the seeded stack · P2 (test coverage gap)

- **Observed**: proposing a plan answered 409 "Proposing a plan requires an approved scope revision (ROE) to pin." on every stack, so no plan workflow could run.
- **Fix**: the seed has the operator submit an in-scope revision and the reviewer approve it. The fixture's approved ROE names the seeded host.
- **Commit**: `8be34174`.

## Flow expectations that had gone stale

These flows expected routes or labels from before the structural rounds. The product behaved correctly; the expectation did not match.

| Id | Flow | Stale expectation | Current behaviour | Commit |
|---|---|---|---|---|
| BF-03 | prelab | Command form on the `c2-console` address | The form moved to Infrastructure → Sessions in `c5ceef2c`; the flow now opens that tab | `576384a8` |
| BF-04 | runtime-gate-click | Session grants card on the `c2` route | Grants card is on Infrastructure → Grants | `576384a8` |
| BF-05 | workspace-click | Sidebar item "Execution" | The item is "Operations" (WS-1) | `576384a8` |
| BF-06 | agents-click (mock) | Infrastructure tab "Execution agents" | The mock tab is "Runtime agents"; the real global view uses "Execution agents" | `576384a8` |
| BF-07 | assets-library | Adapter at `features/library/remote.ts`; host scope "pending" | Adapter moved to `features/capabilities/remote.ts`; the host is "in" scope because the seeded ROE names it | `576384a8` |

## Acceptance harness faults found and fixed while running it

| Id | Script | Fault | Effect before the fix | Fix |
|---|---|---|---|---|
| BF-08 | wf-decisions | The Overview was read after a hash-only change, which reuses the app's 30-second task cache | Cap check read "1" while the endpoint counted 26 | The page is left for `about:blank` first, so the next read is a full load |
| BF-09 | wf-decisions | Scope revisions submitted without `rationale` | HTTP 400, nothing submitted | Rationale added |
| BF-10 | wf-decisions | Notice check looked at the reviewer's notices; none exist for the reviewer | NV, no check run | The check reads the operator's notice (a plan decision notice from WF-04) |
| BF-11 | wf-decisions | Counts compared across the whole stack; a capped project from an earlier run changed the totals | Relative checks broke on a reused stack | Counts are filtered to the shared project; the Overview comparison stays unscoped |
| BF-12 | wf-decisions | Approval of a revision without a ROE window left the approved ROE empty | Preflight showed no approved ROE | The revision carries the stack's ROE window; the empty-ROE behaviour stays in OI-01 |
| BF-13 | authz-matrix | The four-eyes probe used a draft plan, which answers 409 before the guard | The check passed for the wrong reason | The probe proposes a plan first and expects 403 with the independence message and an unchanged `proposed` status |
| BF-14 | wf-report-export | The DOCX check used the Git-for-Windows `tar`, which cannot read zip archives | "content missing report text" on a correct file | Uses the Windows `bsdtar`; the PDF check is reported as PARTIAL because its text is compressed |

## Safety guard added to the stack

### BF-15 · Stack folders inside the repository · P2 (credential hygiene)

- **Observed**: `--hold-dir` and `--out` were documented as outside the repository but nothing enforced it; both hold the test passwords.
- **Fix**: `stack.mjs` refuses either folder inside the repository before it starts any container.
- **Verified**: a run with `--out` inside the repository exits before creating anything.
- **Commit**: `8be34174`.

## Baseline failures classified

| Baseline item | Classification |
|---|---|
| prelab: fill of `#c2-console-session` timed out | BF-03 (stale expectation). The form is still there, on another tab |
| runtime-gate: C2 grants text missing | BF-04 |
| workspace-click: "Execution" missing and not opened | BF-05 |
| assets-library: module import failed | BF-07 (stale path), a test fault, not a runtime fault |
| agents mock: 2 of 3 tab labels | BF-06 |

Nothing in the baseline was a product regression in the routes the flows exercised.
