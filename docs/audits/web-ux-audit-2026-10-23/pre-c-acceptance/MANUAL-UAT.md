# Manual UAT: Raptix web console (test stack)

Who: a person who knows the console. Time: about 60 minutes. Environment: an isolated test stack started from this repository. **Never use production, the 3001 container, or the 5273 dev server for this run.** No target outside the stack may be touched, and no C2 command, listener or Emergency Stop is run.

## 1. Start the stack

Step by step, in Windows PowerShell:

1. Make sure Docker Desktop is running (wait until it has fully started).
2. Create two empty folders outside the repository:

   ```
   New-Item -ItemType Directory -Force -Path C:\raptix-uat\hold
   New-Item -ItemType Directory -Force -Path C:\raptix-uat\out
   ```

3. Go to the web app folder: `cd D:\.VTNet\redteam\raptix\apps\web`
4. Run the start command, and keep this window open for the whole session:

   ```
   node tools/verify/stack.mjs --modes real --hold --hold-dir "C:\raptix-uat\hold" --out "C:\raptix-uat\out"
   ```

5. Wait. The first start can take a few minutes, and the window may stay quiet. The stack is ready when this line appears: `holding stack; the connection file is C:\raptix-uat\hold\hold.json; ...`
6. Open `C:\raptix-uat\hold\hold.json` in Notepad. Take the `"app"` value and add `/?dataMode=real#/login` to the end, for example `http://127.0.0.1:3015/?dataMode=real#/login`. Without this suffix the browser opens the demo sign-in page ("Work email", "Continue"), which is not the test page. Sign in with the Username `verifier` and the Password `"adminPassword"`. The `viewer`, `reviewer` and `operator` entries each have a `username` and `password`.

If the command refuses with `must be outside the repository`, choose folders outside `D:\.VTNet\redteam\raptix`. If the hold folder still holds a `STOP` file from an earlier run, the stack stops right after it starts: delete that `STOP` file first, or use new folders. Do not press Ctrl+C during the session; stop as described in section 4.

## 2. Get the test credentials safely

- Open `hold.json` in the `--hold-dir` folder in a text editor. It holds `app` (the URL), `owner` (`verifier`) and `adminPassword`; `viewer`, `reviewer` and `operator` each have a `username` and a `password`.
- Do not paste these values into chat, tickets, screenshots or the repository. They are random for each start.
- Sign in with the owner account at the `app` URL plus `/?dataMode=real#/login` (see step 6 of section 1). Use the other accounts for the checks that need them.
- To switch accounts: open the account menu (the round avatar at the top right, `Account menu`), choose `Account / sign out`, then click `Sign out`.

## 3. Reset

Stop and start again (section 4, then section 1). Each start has a new database. A reset is always a restart; there is no partial reset. Scope changes made during a session supersede the approved ROE (see OPEN-ISSUES OI-02), so a fresh start is also the way to get the seeded ROE back.

## 4. Stop the stack

Create an empty file named `STOP` in the `--hold-dir` folder (in PowerShell: `New-Item C:\raptix-uat\hold\STOP`). The terminal prints the stop lines and returns. Then delete `hold.json` by hand; the stack does not delete it. Confirm nothing is running:

```
docker ps --filter label=raptix.verification=stack
```

It should print only the header line.

## 5. Checkpoints

Mark each row PASS, FAIL, or NOT RUN with the reason. Add a note for FAIL.

| # | Journey | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Sign in as owner | Sign in with the owner account | Project list shows "Stack verification project" | |
| 2 | Overview figure | Open Overview | "Awaiting decisions" shows a number, or "26+" if a capped inbox exists; never blank | |
| 3 | Viewer scope | Sign out, sign in as `viewer` | The shared project is listed; no other project's name appears | |
| 4 | Viewer controls | After row 6 (a proposed plan must exist), sign in as `viewer`; Governance tab | No Approve, Reject, Propose or Revise button, and no draft form | |
| 5 | Operator drafts a plan | Sign in as `operator`; Governance → Draft plan | Row shows `draft` | |
| 6 | Operator proposes | Propose the draft | Row shows `proposed` after reload | |
| 7 | Author cannot approve | As operator, look at the proposed row | No Approve or Reject button; the row says "You wrote this plan; an independent reviewer decides it." | |
| 8 | Reviewer approves | Sign in as `reviewer`; Approve the proposed plan | Row shows `approved` after reload | |
| 9 | Scope revision | As operator, submit a scope change in Scope & ROE | Team tab shows a pending decision; Overview count rises by one | |
| 10 | Reviewer decides the revision | As reviewer, approve it from the Team tab | Count falls back; the revision is approved | |
| 11 | Findings | Open Findings | "Stack verification finding" is listed as confirmed | |
| 12 | Assets | Open Assets | `stack-host-01.verify.example.test` is listed | |
| 13 | Report export | Open the report on the Reports page. The export buttons (`Export PDF`, `Export DOCX`) appear only after the report is approved (see note 2) | The DOCX opens and contains the report title and the finding title | |
| 14 | Phone width | Browser at 390 px: Overview and Governance | No horizontal scrolling | |
| 15 | C2 form, no dispatch | Infrastructure → Sessions | Form and labels show; **do not press Dispatch** | |

Notes:

1. Items 2, 4 and 10 depend on earlier steps in the same run. Item 4 needs the proposed plan from items 5 and 6. Item 10 needs the pending revision from item 9.
2. Item 13 is not fully specified. The report page offers `Export PDF` and `Export DOCX` only for an approved report, and approval is a separate step (submit for review, then the reviewer's `Approve Report`). The approval path was not walked through in this pass, so it is marked NOT RUN unless you do it yourself. The markdown export is an API format, not a button in the UI.
3. After step 9, the Governance preflight may say that no approved ROE exists until the revision is decided (OI-02). This is expected, not a failure.

## 6. Defect record

Use one entry per defect:

```
ID:        UAT-<number>
Checkpoint: <row number>
Role:      owner | operator | reviewer | viewer
Width:     <px>
Steps:     <what you did>
Expected:  <what should happen>
Actual:    <what happened, with the exact message text>
Evidence:  <screenshot file outside the repo, or none>
```

## 7. Conclusion

Choose one and write the reason in one sentence:

- **PASS**: every checkpoint passes.
- **PASS WITH ISSUES**: every checkpoint passes except copy or layout defects that do not block a journey.
- **FAIL**: a checkpoint fails in an authorization, data or approval rule.

A PASS here means the journeys work on the test stack. It is not production readiness, and it says nothing about live runtime, operations, AI conversation, or the C2 provider; those are not on the stack (see OPEN-ISSUES NV-01 to NV-03).

## Commands in this guide

Verified in this pass: the start command (section 1), the hold file fields (section 2), the `STOP` file and the container check (section 4), and the restart as reset (section 3). Each was run on a stack that started and stopped cleanly.
