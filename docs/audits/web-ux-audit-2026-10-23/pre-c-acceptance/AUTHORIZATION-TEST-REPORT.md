# Authorization test report

Result: **51 of 51 checks PASS** (`authz-matrix.mjs`, exit 0, run on a fresh stack; raw output in `evidence/acceptance/`). Plus the actor isolation (10 of 10, WF-01), the four-eyes checks in the plan and scope workflows, and the server's own unit suite (64 files, 623 tests).

## What the matrix checks

Each write is sent as each of five actors. The expected outcome follows the rank floor the server declares:

- A member at or above the floor passes the authority check. The request then fails on its own validation or state (400 or 409), so nothing changes. This proves the authority check, not the write itself; the writes are proven by the workflow scripts.
- A member below the floor gets **403**.
- A non-member gets **404**, so the project's existence is not revealed.

| Action | Floor | Owner | Operator | Reviewer | Viewer | Outsider |
|---|---|---|---|---|---|---|
| Create plan | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Decide plan | reviewer | pass (409, draft) | pass (409, draft) | pass (409, draft) | 403 | 404 |
| Create scope revision | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Create curated finding | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Create report | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Create library proposal | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Request C2 grant | operator | pass (400) | pass (400) | 403 | 403 | 404 |
| Manage members | owner | pass (400) | 403 | 403 | 403 | 404 |
| Read plans | viewer | 200 | 200 | 200 | 200 | 404 |
| Read members | viewer | 200 | 200 | 200 | 200 | 404 |

The plan-decide row uses a draft plan, so the state check answers 409 before the independence check. That is why the independence check below uses its own proposed plan.

## Four-eyes rule

| Check | Result |
|---|---|
| The operator who proposed a plan decides it | **403**, message "The plan decision requires an independent actor: … submitted this item and cannot decide it.", plan stays `proposed` |
| The operator who submitted a scope revision decides it | **403**, revision stays `pending` (WF-05) |
| The reviewer decides a plan proposed by the operator | Approved; `decidedBy` is recorded (WF-04) |
| The author of a finding or closure decides it | Not in this matrix. The server applies the same guard (`requireIndependentActor`) at those sites; the finding review and closure paths were not exercised in this pass (see REAL-WORKFLOW-MATRIX, WF-07 and WF-03) |

The server checks the state before the independence guard. A decision on a draft therefore answers 409, not 403. Any test of independence must use a proposed item.

## UI control gating (not a server check)

Before this pass the governance tab showed every decision and drafting control to every member. The server refused those actions, so a viewer saw Approve, Reject, Propose, Revise and the draft form, and the author of a proposal saw Approve. The controls now follow the same floors: operators and above see drafting, proposing and revising; reviewers and owners see the decision buttons, except on plans they wrote; the author and the other members see the reason in place of the buttons. Two unit tests cover the viewer and the author cases; WF-04 covers the author on the real stack. See BUGS-FIXED.md, BF-01.

## Actor isolation (WF-01)

Ten checks on one browser: the owner's owner-only project is visible to the owner, cleared from browser storage on sign-out, never shown to the viewer (no sample of the name in four seconds after sign-in), absent from the viewer's list and from the viewer's API read, absent from the viewer's storage, visible again after the owner signs in, and gone from the first tab when the viewer signs in on a second tab. No uncaught page error during the run.

## Gaps in this matrix

- Decisions on C2 grants, closures, findings review and emergency stops are not in the matrix; they are covered only by their server unit tests.
- Reads other than plans and members are not in the matrix.
- Token or session expiry under a different actor was not exercised.
- The matrix does not prove a write takes effect; the workflow scripts do that.
