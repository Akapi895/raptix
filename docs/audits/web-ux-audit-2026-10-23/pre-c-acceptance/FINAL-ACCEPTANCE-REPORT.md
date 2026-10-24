# Final acceptance report: Raptix web console before Phase C

Date: 2026-10-24. Branch `frontend`. Phase C (Authorized Red Team E2E) was not started and nothing in it was built.

**Headline.** The web console's workflows on the real API and database pass where they can be run without a runtime or a C2 provider. One product defect was fixed (governance controls shown to members who cannot use them). The run is ready for manual UAT on an isolated test stack, and ready for staging. It is not ready for deployment review or production, because two behaviours of the ROE rules need an owner's decision and the runtime and C2 workflows have not been run.

Ready for manual UAT is not ready for production. This report does not treat them as the same.

## 1. How many workflows PASS?

**5 of 10**: WF-01 authentication and actor isolation; WF-02 project lifecycle; WF-04 planning and approvals; WF-05 decisions and notifications; WF-07 assets, findings and evidence.

## 2. How many are PARTIAL or NV?

**5 PARTIAL**: WF-03 charter, scope and governance (charter editing not run); WF-06 AI Workspace (presentation only, runtime NV); WF-08 reports (PDF text not read; live snapshot change not run); WF-09 C2 and Infrastructure (fixture-based, real provider NV); WF-10 settings (UX-27 copy not asserted).

No workflow is wholly NV. The NV parts are the runtime and the C2 provider: operation execution, AI conversation, command dispatch and sessions. See REAL-WORKFLOW-MATRIX and OPEN-ISSUES NV-01 to NV-06.

## 3. How many bugs were fixed?

- **One product defect**: BF-01, governance plan controls shown to members who cannot use them (fixed in `fdceb370`, regression tests added).
- **Thirteen test, fixture or harness faults**: BF-02 (no approved ROE in the stack), BF-03 to BF-07 (stale flow expectations), BF-08 to BF-14 (faults in the new acceptance scripts found while running them).
- **One safety guard**: BF-15, the stack refuses hold and output folders inside the repository.

Total entries: 15. Details and evidence in BUGS-FIXED.md.

## 4. Which flows are still blocked?

Blocked by the environment (the stack has no runtime and no C2 server; no target is allowed):

- Operation execute, submit, pause, resume and cancel.
- AI conversation send and stream; draft chat with a thread.
- C2 command dispatch, session console, listeners.
- Agent detail and branches.

Blocked by a decision (the code works, the rule is undecided):

- The ROE rules at approval (OI-01): an approved revision with no time window passes the time check, and approval does not require an emergency contact.
- The "submission supersedes the approved ROE" behaviour and its wording (OI-02).

Nothing was BLOCKED because of a failing product workflow.

## 5. What did the real backend check?

The real API (`apps/web/server`, from source) against a real PostgreSQL and Neo4j, both in containers created for the run:

- Sign-in, the membership rank floors and the independence rule: 51 authorization checks; four-eyes refusals keep the state unchanged.
- Business plans: draft, proposal pinned to the approved ROE, refused decision by the author, approval by an independent reviewer; `decidedBy` recorded.
- Scope revisions: submission, pending state, approval, refusal of the author's own decision, supersede on submission and on approval.
- The task inbox: counts per role, agreement with the Overview, dismissal of notices, lower bound when capped.
- Notices for plan decisions.
- Findings: producer import stays a draft; capture upload, classification and linking; self-review refused; reviewer confirms; refresh keeps the confirmed state and the original bytes.
- Assets: import and the scope value after the approved ROE.
- Reports: the four export formats, with digests checked; markdown and json and docx carry the content; outsider 404.
- Settings: a policy change saved with its reason, read back after reload, recorded in the audit; viewer's change refused.
- Library: 26 operations through the real adapters inside the running app, against the knowledge-graph container (export, amend refused on a stale version, submit).
- Route smoke over 56 real routes; layout; phone width.
- Actor isolation: no owner-only data reaches another actor in the same browser.

Not backed by the real backend: the C2 pages (stubbed in the browser for the fixture dispatch check), and every runtime-dependent surface, which shows its gate state.

## 6. What UI/UX problems remain?

- The governance execution-threads card shows the server's own text when the runtime is absent (OI-03).
- The preflight wording after a new scope revision does not name the pending revision as the cause (OI-02).
- The Overview "Awaiting decisions" figure counts all projects and does not say so (OI-06); a viewer's count includes decisions the viewer cannot make (OI-05).
- The C2 console address has no command form; the form is on Infrastructure → Sessions (OI-07).
- No accessibility audit has been run; the drawer was not checked with live data; the matrix signs in only as the owner (OI-10, NV-05, NV-06).

Details in UIUX-ACCEPTANCE-REPORT.md.

## 7. Are there P0 or P1 items not resolved?

**Yes.**

- **P0 for Phase C**: BL-02, ADR-0095, 0098 and 0099 are still Proposed; the interactive C2 console and the runtime dispatch depend on them. Owner decision.
- **P0 for Phase C**: NV-01 to NV-03, the runtime and C2 workflows, are not verified.
- **P0 for any deployment**: DEP-1, the 3001 container runs `d3225f63` and HEAD is ahead. Owner decision; this pass did not touch it.
- **P1**: OI-01, the ROE time check passes with no windows and approval does not need a contact. This is a safety-policy question; the code was not changed.
- **P1**: BL-03, the task aggregate omits closure and library tasks.
- **P1**: NV-04, the Overview with live runtime data.

## 8. Is it ready for manual UAT?

**Yes: READY_FOR_MANUAL_UAT.** MANUAL-UAT.md gives the start, credential, reset and stop steps (each verified on this pass) and fifteen checkpoints. A person runs it on an isolated stack. The result is recorded there, not here.

## 9. Is it ready for deployment review?

**Not yet.** The level reached is **READY_FOR_STAGING** (DEPLOYMENT-READINESS.md). Before a deployment review:

1. The owner decides OI-01 and OI-02.
2. The NV rows run on an isolated stack with a runtime and a C2 provider, under the engagement rules, with no live target.
3. An accessibility pass runs on the governance controls.
4. MANUAL-UAT is completed by a person.
5. The owner decides whether to redeploy 3001 (DEP-1).

## 10. What is still missing before Phase C?

- The owner decisions in OPEN-ISSUES: OI-01, OI-02, OI-04 (scope decisions do not notify the author), OI-07 (where a command is entered).
- The ADR decisions (BL-02) and D-03, the ownership of the C2 console.
- A runtime and a C2 provider on an isolated stack, and runs of the NV rows under the engagement rules.
- Role-by-role layout checks for every route (NV-06) and the accessibility pass.
- A PDF text check and a live-change check for exports (OI-08, OI-09).
- The authorization review for BL-03 before the task aggregate adds closure and library tasks.
- Owner housekeeping: delete the stray file `D:\Program Files\Git\edit-export.py` (OI-11); decide on the stale `structural-execution.zip` (ZIP-1); the owner's uncommitted work was not touched.
- Phase C itself is not started.

## Commits in this pass

`fdceb370`, `576384a8`, `8be34174`, `9091a84a`, and the record commit. No push. See EXECUTION-PLAN.md.
