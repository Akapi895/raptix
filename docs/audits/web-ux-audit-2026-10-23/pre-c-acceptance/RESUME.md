# Resume: pre-Phase-C acceptance

Last updated: 2026-10-24. Branch `frontend`.

## Where things stand

- Commits of this pass (no push): `fdceb370` governance control gating; `576384a8` flow expectations; `8be34174` stack hold mode, operator member, approved ROE fixture, folder guard; `9091a84a` acceptance scripts. The record folder is committed as the last commit on the branch (`git log -1 -- docs/audits/web-ux-audit-2026-10-23/pre-c-acceptance`).
- Gates on the tree: web typecheck, server typecheck, web lint, boundaries strict (408, baseline), web unit tests 190 files and 1666 tests, server unit tests 64 files and 623 tests, both Vite builds, full stack run exit 0 with 158 PASS and 0 FAIL, acceptance pass on a fresh stack (authorization 51, plan approval 5, decisions 10, actor isolation 10, export 7 PASS + 1 PARTIAL + 1 NV, UI/UX 28, prelab 8, runtime gate 5, workspace 12, assets library 26).
- Classification: READY_FOR_MANUAL_UAT and READY_FOR_STAGING. Not production, not deployment review yet.

## Environment state at the end of this pass

- No verification stack is running. No container carries the `raptix.verification=stack` label, running or stopped.
- The owner's services were not touched: the 5273 dev server responds (HTTP 200); the 3001 container runs `ghcr.io/akapi895/raptix-web-raptix-ui:d3225f63` and responds (HTTP 200). Nothing was redeployed.
- Scratch folder: `C:\Users\tuanp\AppData\Local\Temp\claude\D---VTNet-redteam-raptix\806bd77d-1171-4916-a4e9-6d63d58bc85f\scratchpad\`. All `hold.json` and `fixtures.real.json` copies (they hold test passwords) were deleted. Result folders there hold no credential values; the evidence in this folder was scanned against every value collected from those files, with no hit.
- Uncommitted files that were not part of this pass are untouched and not staged: `GLOSSARY.md`, ADR-0095, 0098, 0099, the C2 PTY proposal, the R03 screenshot (modified in an earlier session), `docs/adr/0097-…`, and the untracked notes, archives and folders (`apps/web/.scratch/web-real-ui/`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`, `now.txt`, `infra-test.log`, and the other `docs/…` drafts).
- **Owner action**: delete `D:\Program Files\Git\edit-export.py` by hand (0 bytes; created by a stopped command in this session; see OPEN-ISSUES OI-11).

## Next steps, in order

1. Owner decides OI-01 (ROE time windows and emergency contact at approval, and the empty-window rule in `roeWindowAllows`) and OI-02 (supersede-on-submit and its wording).
2. Owner decides OI-04 (scope decisions and notices), OI-07 (where a command is entered), OI-05 and OI-06 (labels).
3. Owner decides BL-02 (ADR-0095, 0098, 0099) and D-03.
4. Run the NV rows on an isolated stack with a runtime and a C2 provider, under the engagement rules. Nothing live.
5. Accessibility pass on the governance controls; extend `uiux-matrix` to the viewer, operator and reviewer roles (NV-06).
6. Add a PDF text check (OI-08) and a live finding change check for exports (OI-09).
7. A person runs MANUAL-UAT.md on a held stack and records the results.
8. Owner decides DEP-1 (redeploy 3001) after step 7.
9. Owner decides on `docs/audits/web-ux-audit-2026-10-23/structural-execution.zip` (ZIP-1).

## How to re-run the evidence

From `apps/web`, with `<scratch>` the scratch folder above and `<outside>` a folder outside the repository:

```
node tools/verify/stack.mjs --modes mock,real --out <outside>/final-full          # full run, exit 0 at writing
node tools/verify/stack.mjs --modes real --hold --hold-dir <outside>/hold --out <outside>/hold-out
# wait for the connection file <outside>/hold/hold.json, then in another terminal:
node tools/verify/acceptance/authz-matrix.mjs --fixtures <outside>/hold-out/fixtures.real.json --hold <outside>/hold/hold.json --out <outside>/acc/authz-matrix.json
node tools/verify/acceptance/wf-plan-approval.mjs ...   # same arguments
node tools/verify/acceptance/wf-decisions.mjs ...
node tools/verify/acceptance/wf-actor-isolation.mjs ...
node tools/verify/acceptance/wf-report-export.mjs ...
node tools/verify/acceptance/uiux-matrix.mjs ...
touch <outside>/hold/STOP                                                          # then delete hold.json by hand
```

Gate commands are listed in REGRESSION-REPORT.md.

## Caveats to keep in mind

- A scope revision submitted during a run supersedes the approved ROE until it is decided. Restart the stack for a clean ROE (OI-02).
- The Overview task figure is cached for up to 30 seconds during in-app navigation. The acceptance script forces a full load before reading it (BF-08).
- The PDF check reads the file structure, not the report text (PARTIAL).
- The live-change snapshot check was not run (NV).
- The matrix and the workflow scripts write test records to the stack; they are not for production.
