# Real workflow matrix

Status per workflow, with what was checked and what was not. Presentation and behaviour are reported separately where both matter. "Evidence" names the file under `evidence/`.

Summary: **5 PASS** (WF-01, WF-02, WF-04, WF-05, WF-07), **5 PARTIAL** (WF-03, WF-06, WF-08, WF-09, WF-10). No workflow FAIL on the final run. Each PARTIAL row names the missing part.

| WF | Workflow | Status | Checked | Not checked (NV or gap) |
|---|---|---|---|---|
| WF-01 | Authentication and actor isolation | **PASS** | Ten checks: owner-only project never reaches the viewer (list, API read, browser storage, first-tab replacement); owner sign-out clears storage; no page error | Credential policy, MFA and lockout (out of this pass) |
| WF-02 | Project lifecycle | **PASS** | Projects click-through 4 of 4 (real); project creation by the owner via the API and the fixtures; project list and open | Archive or close flows beyond the closeout route |
| WF-03 | Charter, scope and governance | **PARTIAL** | Governance plan lifecycle (WF-04); scope revision submit, approve and refuse (WF-05); preflight states shown (runtime gate) | Charter or brief editing through the UI was not exercised; the ROE preflight wording after a pending revision is an open issue (OI-02) |
| WF-04 | Planning and approvals | **PASS** | Draft, propose, author refused, independent reviewer approves; viewer has no decision control (unit tests); authorization matrix 51 of 51; four-eyes with 403 and unchanged state | Revise flow (the revised draft and its re-review) was not exercised end to end |
| WF-05 | Decisions and notifications | **PASS** | Pending revision counted by every role that sees the project, Overview and team tab agree, dismiss does not resolve a decision, reviewer approval clears it, author refused, no tool-approval kind in the inbox, capped inbox shows a lower bound ("26+") | Notices are written for plan decisions, closures, C2 grants and stops only; a scope decision notifies nobody (OI-04). Emergency stops and tool approvals are not decisions in this inbox by design |
| WF-06 | AI Workspace (presentation) | **PARTIAL** | The AI workspace and the AI trace state that the runtime or thread source is unavailable, with no substitute trace shown (runtime gate: 5 of 5 surfaces state their gate, including AI workspace, AI trace, fleet, operations and C2 grants) | Assistant conversation, draft chat with a thread, runtime operations: **NV**, no LangGraph runtime in the stack |
| WF-07 | Assets, findings and evidence | **PASS** | Assets click-through 5 of 5 (real); asset library checklist 26 of 26; producer import stays a draft; capture upload, classification, linking and self-review refusal; independent reviewer confirms; refresh keeps the confirmed finding and the original bytes | Finding review refusal by the author through the UI (the server guard is covered by the unit suite) |
| WF-08 | Reports and export | **PARTIAL** | Reports click-through 4 of 4 (real); reports checklist 27 of 27; export content for markdown, json and docx carries title, summary and selected finding, with the digest checked; outsider 404; unknown format 400 | PDF text is not read (compressed streams; file structure only, PARTIAL); a live finding change after the report was built is not exercised (NV) |
| WF-09 | C2 and Infrastructure (read-only presentation) | **PARTIAL** | Infrastructure tabs and states (runtime gate: C2 grants and dispatch gate text); fixture-based dispatch form: malformed argv refused before any HTTP dispatch, argv and stdout/stderr displayed, command audit read without dispatch | Real C2 provider, session list, listener and dispatch: **NV**. No listener, no command, no emergency stop was run, by rule |
| WF-10 | Organization and project settings | **PARTIAL** | Organization settings page renders for an admin; policy values read back with their versions; a changed value saved with its reason and confirmed after reload; the workspace audit records the change; an analyst sees the user list locked with its reason; a viewer's save is refused and shown | The UX-27 copy review was not asserted by a check; treated as not verified |

## Notes per workflow

**WF-01.** Credentials for the actors come from the test stack's hold file or the flow environment. None were printed or written to the evidence.

**WF-04.** The plan approval exercised the real UI and read the row back after a reload. The database check reads `BusinessPlan.status` and `decidedBy`. Before this pass the author saw an Approve control that the server refused (BF-01).

**WF-05.** Counts are read from the task endpoint filtered to the shared project; the Overview figure is compared unscoped, because the Overview is unscoped (DATA-CONSISTENCY-REPORT).

**WF-07.** Finding confirmation is the reporting precondition the seed uses; the reviewer confirms, the owner authored.

**WF-08.** Export bytes were fetched through the real export route with a viewer session and read as the file type they claim to be.

**WF-09.** Every command in the fixture is answered by a route stub in the browser test; the stub echoes the dispatched body and the browser shows the result. The stub is labelled "(fixture)" in the output. A real dispatch would need a live grant and a real provider, neither of which exists here.

## Items that are not workflows but were checked

- Route smoke: 56 routes in mock, 56 routes in real (14 declared with a named cause).
- Layout: 11 of 11.
- Phone width without horizontal scroll: 390 px on the overview and seven real routes (UIUX-ACCEPTANCE-REPORT).
