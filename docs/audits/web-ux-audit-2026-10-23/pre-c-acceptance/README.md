# Pre-Phase-C acceptance: Raptix Web console

Date: 2026-10-24. Branch `frontend`. Scope: the real-mode Raptix web console (`apps/web`, `apps/web/server`) on an isolated test stack, before Phase C (Authorized Red Team E2E).

This folder is the acceptance record. It answers what was run, what passed, what did not, and what a human still has to check. It does not claim production readiness.

## Status in one paragraph

Acceptance passes on the isolated stack for the authorization matrix, the plan approval and decision workflows, the actor isolation, the report export contents, and the route, layout and phone-width checks. The full stack run (mock and real) finished with 158 PASS and 0 FAIL, exit 0. One product defect was fixed: governance plan controls were shown to members who could not use them. Real runtime behaviour (operation execution, AI conversation, C2 dispatch against a real provider) was not exercised, because the stack has no runtime and no C2 server. The result is **READY_FOR_STAGING** (see DEPLOYMENT-READINESS.md), not production.

## Read in this order

1. [FINAL-ACCEPTANCE-REPORT.md](FINAL-ACCEPTANCE-REPORT.md): answers to the ten questions.
2. [REAL-WORKFLOW-MATRIX.md](REAL-WORKFLOW-MATRIX.md): WF-01 to WF-10 with a status for each.
3. [OPEN-ISSUES.md](OPEN-ISSUES.md): what is still open, and which items need an owner decision.
4. [MANUAL-UAT.md](MANUAL-UAT.md): how a person starts the stack and checks the main journeys.
5. [RESUME.md](RESUME.md): state of the environment and the next steps.

Other files:

| File | Content |
|---|---|
| [EXECUTION-PLAN.md](EXECUTION-PLAN.md) | Phases, what each one produced, and what was left out on purpose |
| [TEST-FIXTURES.md](TEST-FIXTURES.md) | Stack, actors, seeded data, and how to reset |
| [AUTHORIZATION-TEST-REPORT.md](AUTHORIZATION-TEST-REPORT.md) | Role floors, the 51-check matrix, and the four-eyes rule |
| [DATA-CONSISTENCY-REPORT.md](DATA-CONSISTENCY-REPORT.md) | Persisted state read back from the database; counts and provenance |
| [UIUX-ACCEPTANCE-REPORT.md](UIUX-ACCEPTANCE-REPORT.md) | Widths, overflow, errors, dark mode, and the visual observations |
| [BUGS-FIXED.md](BUGS-FIXED.md) | Each defect or harness fault fixed in this pass, with its evidence |
| [REGRESSION-REPORT.md](REGRESSION-REPORT.md) | Gates and their exact results |
| [DEPLOYMENT-READINESS.md](DEPLOYMENT-READINESS.md) | Classification and the delta from the deployed image |
| [evidence/](evidence/) | Raw JSON and logs from the runs (no credentials) |

## Status legend

- **PASS**: verified by a check that reads the rendered page, the API response, or the database.
- **FAIL**: a check ran and the expected result did not happen.
- **FIXED**: failed before this pass; fixed in this pass; passes now.
- **PARTIAL**: part of the claim is verified; the rest is named in the same row.
- **NV**: not verified in this environment (for example, it needs a runtime or a real C2 provider).
- **BLOCKED**: could not run, with the reason.
- **NOT_APPLICABLE**: does not apply to this build.

Presentation checks (a page shows a state or a control) are reported separately from behaviour checks (the server did the thing and the database holds it). A presentation check alone is never called a workflow pass.

## Commands that produced the evidence

Run from `apps/web` unless noted. Each command was run on HEAD of this pass.

```
node tools/verify/stack.mjs --modes mock,real --out <scratch>/final-full      # full stack run
node tools/verify/stack.mjs --modes real --hold --hold-dir <scratch>/hold-x --out <scratch>/hold-x-out
node tools/verify/acceptance/authz-matrix.mjs --fixtures <f> --hold <h> --out <o>
node tools/verify/acceptance/wf-plan-approval.mjs ...      # likewise for the other acceptance scripts
npx vitest run --maxWorkers=3          # web unit tests
npx tsc --noEmit -p tsconfig.json      # web typecheck; server: cd server && npx tsc --noEmit -p tsconfig.json
npx eslint .                           # web lint
node tools/check-boundaries.mjs --strict
npx vite build --outDir <scratch>/build-default --emptyOutDir
VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 npx vite build --outDir <scratch>/build-optin --emptyOutDir
cd server && npx vitest run --config vitest.config.ts
```

`<scratch>` is the session scratch folder outside the repository. `<f>`, `<h>` and `<o>` are the fixture manifest, the held connection file, and the output file; the held connection file contains test credentials and is never copied into this folder.

## What this folder does not contain

No credential values, token, cookie, `hold.json`, or `fixtures.real.json` (the stack writes the test passwords into that one). The evidence was scanned for password fields before it was copied.
