# Open issues

Priority: **P0** blocks Phase C; **P1** must be decided or verified before Phase C or deployment review; **P2** should be fixed before a wider UAT; **P3** copy or polish. "Decision" means the owner decides the behaviour; this pass did not change it.

## New in this pass

| Id | Pri | Kind | Issue | Evidence | Next step |
|---|---|---|---|---|---|
| OI-01 | P1 | Decision (safety policy) | **The ROE time check passes when the approved revision has no time windows.** `roeWindowAllows` returns `ok: true` when `windows.length === 0`, and the server accepts an approval whose ROE has no windows and no emergency contact. The preflight then reports the missing contact, but nothing blocks the approval. | `server/src/services/scope-service.ts:401-406`; `governance-service.ts:307-311`; the acceptance run before BF-12 left an approved ROE with no contact (the preflight reported it) | Owner decides: require at least one window and one contact at approval, and whether an empty window list means "no time limit". No change made here |
| OI-02 | P2 | Behaviour and copy | **Submitting any scope revision supersedes the approved ROE at once**, by design (`scope-service.ts`, "Invalidation happens at submission"). Until the revision is decided the project has no approved ROE. The preflight says "No approved ROE revision exists yet." and does not name the pending revision as the cause. | Inspection probe: v2 approved, then superseded when v3 was submitted; governance preflight screenshot in `evidence/acceptance/governance-390.png` (from the earlier run) | Owner confirms the rule; then the preflight should say a pending revision is the cause |
| OI-03 | P3 | Copy | The execution-threads card on Governance shows the server's own text ("Route GET …/threads not found") when the runtime is absent. | Refusal text seen in the WF-04 run | Show the runtime-unavailable statement used elsewhere |
| OI-04 | P2 | Behaviour (notifications) | **A scope revision decision does not notify its author.** Notices are written only for plan decisions, closure requests and confirmations, C2 grant decisions and emergency-stop resolutions. | `createNotice` call sites in `server/src/services` | Owner confirms whether scope decisions should notify the author |
| OI-05 | P3 | Copy and intent | A viewer's "Awaiting decisions" count includes a scope revision the viewer cannot decide (the server answers 403). | WF-05 counts: viewer 2 → 3 on one new decision | Confirm the intent; if it is awareness, say so in the label |
| OI-06 | P3 | Copy and provenance | The Overview "Awaiting decisions" figure counts every project the member can see; the label does not say so. Project pages show project-scoped data. | DATA-CONSISTENCY-REPORT; capped figure "26+" | Add the scope to the label |
| OI-07 | P2 | Ownership and navigation | The `c2-console` address shows the "No interactive console in this build" notice and the session list, but no command form. The command form is on Infrastructure → Sessions (moved in `c5ceef2c`). A user who types the address has no dispatch path. | `features/c2/workspace/view.ts`; `provider-tab.tsx`; BUGS-FIXED BF-03 | Owner decides the address (ties to BL-02 and D-03) |
| OI-08 | P3 | Test gap | PDF export text is not read by any check (compressed streams); the check verifies the file structure only. | `evidence/acceptance/wf-report-export.json` (PARTIAL) | Add a PDF text extraction step before relying on PDF content review |
| OI-09 | P3 | Test gap | Live change of a finding after a report was built is not exercised; the snapshot guarantee is not checked by a run. | `wf-report-export.json` (NV) | Add a finding edit step to the export check |
| OI-10 | P2 | Test gap | No automated accessibility audit and no keyboard walkthrough of the governance controls. | UIUX-ACCEPTANCE-REPORT | Run one before deployment review |
| OI-11 | P3 | Housekeeping | A 0-byte file `edit-export.py` was created in the Git-for-Windows root (`D:\Program Files\Git\edit-export.py`) by a command that was stopped during this pass. The same root also held two temporary files from earlier in the session, which the owner was asked to delete by hand. Automated removal of root-level paths is blocked by the safety check. | Session log | **The owner deletes this file by hand** |

## Carried from earlier rounds

| Id | Pri | Issue | Next step |
|---|---|---|---|
| DEP-1 | P0 for any deployment | The 3001 container runs `d3225f63`; HEAD is 27 commits ahead; a redeploy changes a running system | Owner decides; recommended after MANUAL-UAT |
| BL-02 | P0 for Phase C | ADR-0095, 0098 and 0099 are Proposed; the interactive C2 console, controller lease and runtime dispatch depend on them | Owner accepts or rejects; this pass did not change their status |
| BL-03 | P1 | The task aggregate does not include closure and library tasks | Authorization review before adding them |
| PROV-1 | P2 | Source time per count is not returned by the server | Server contract change, to be designed |
| MFA-1 | P3 | The demo sign-in notice accepts any code other than 000000 | Product owner decides; left as is |
| CA-1 | P3 | Asset-map view positions are kept per actor and not cleared on sign-out | Intentional; documented |
| PSEED-1 | P3 | An old planning-seed flag is ignored after deploy | Documented |
| ZIP-1 | P3 | `docs/audits/web-ux-audit-2026-10-23/structural-execution.zip` is a stale archive that this session did not create | Owner decides whether to keep it |
| MOCK-1 | P3 | `MOCK_PROJECT_TABS` kept on purpose for the demo | No action |

## Not verified in this environment (NV)

| Id | Pri | Area | Why | Needed |
|---|---|---|---|---|
| NV-01 | P0 for Phase C | Operation execution, pause, resume, cancel | No runtime in the stack | A runtime on an isolated stack with no target |
| NV-02 | P0 for Phase C | AI conversation, draft chat with a thread | No LangGraph runtime | Same as NV-01 |
| NV-03 | P0 for Phase C | C2 session list, command dispatch under a live grant, session console | No C2 server (Sliver) in the stack; dispatch and listeners are excluded by rule | A C2 provider on an isolated stack, with the engagement's own approval |
| NV-04 | P1 | Overview with live runtime data | Runtime absent | As NV-01 |
| NV-05 | P2 | Real drawer navigation at tablet and phone width | Checked earlier with mock data only | Run `uiux-matrix` with the drawer open |
| NV-06 | P2 | Viewer, operator and reviewer layouts for each route | The matrix signs in as the owner | Extend the matrix to each role |
