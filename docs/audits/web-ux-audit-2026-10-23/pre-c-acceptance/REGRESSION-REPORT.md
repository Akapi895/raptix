# Regression report

Gates run on the tree at the last commit of this pass (`9091a84a` plus the record folder). Each line gives the command, the exit code and the count. Raw logs are in `evidence/gates/` and `evidence/full-stack-run/`.

## Static and unit gates

| Gate | Command (in `apps/web` unless noted) | Exit | Result |
|---|---|---|---|
| Web typecheck | `npx tsc --noEmit -p tsconfig.json` | 0 | No errors |
| Server typecheck | `cd server && npx tsc --noEmit -p tsconfig.json` | 0 | No errors |
| Web lint | `npx eslint .` | 0 | No findings |
| Boundaries (strict ratchet) | `node tools/check-boundaries.mjs --strict` | 0 | 408 total, equal to the baseline in every category (deep-feature-import 216) |
| Web unit tests | `npx vitest run --maxWorkers=3` | 0 | **190 files, 1666 tests passed** (1664 before the governance tests) |
| Server unit tests | `cd server && npx vitest run --config vitest.config.ts` | 0 | **64 files, 623 tests passed** |
| Build, default flags | `npx vite build --outDir <scratch>/build-default --emptyOutDir` | 0 | Built |
| Build, prototype and asset-map flags | `VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 npx vite build …` | 0 | Built |

## Full verification stack run (mock and real)

Command: `node tools/verify/stack.mjs --modes mock,real --out <scratch>/final-full`. Exit **0**. The log has **158 PASS lines and 0 FAIL lines**.

| Part | Result |
|---|---|
| Route smoke, mock | 56 routes; 0 new failures |
| Route smoke, real | 56 routes; 0 new failures; 14 declared (the cause is named on each: runtime not started, C2 server not started, or fixture not seeded by the stack); 1 declared cause did not occur |
| Mock click-throughs | assets 5/5; reports 1/1; settings 2/2; projects 1/1; analysis 1/1; operations 7/7; agents 8/8; integration path 24/24 |
| Real click-throughs | assets 5/5; reports 4/4; settings 5/5; projects 4/4; analysis 2/2; workspace 12/12 |
| Real checks | layout 11/11; runtime gate 5/5 surfaces; reports checklist 27/27 operations; assets and library checklist 26/26 operations |
| Prelab (real producer, capture, curation, fixture C2) | 8 PASS |
| Not verified by design | operation execute, submit, pause, resume, cancel; AI conversation; C2 command dispatch and session console; agent detail and branches (config-gated: no runtime or C2 server) |

## Acceptance pass on a fresh held stack

Run after the fixes of this pass, on a stack started for the purpose and stopped afterwards. Raw output in `evidence/acceptance/`.

| Script | Result | Exit |
|---|---|---|
| `authz-matrix.mjs` | 51 PASS | 0 |
| `wf-plan-approval.mjs` | 5 PASS | 0 |
| `wf-decisions.mjs` | 10 PASS (the first run on this stack gave 9 PASS and 1 FAIL from a stale Overview read, fixed as BF-08; the rerun is the one kept) | 0 |
| `wf-actor-isolation.mjs` | 10 PASS | 0 |
| `wf-report-export.mjs` | 7 PASS, 1 PARTIAL (PDF structure only), 1 NV (live snapshot change) | 0 |
| `uiux-matrix.mjs` | 28 PASS (7 routes × 4 widths) | 0 |
| `flows/prelab.mjs` | 8 PASS | 0 |
| `flows/runtime-gate-click.mjs` | 5 of 5 | 0 |
| `flows/workspace-click.mjs` | 12 of 12 | 0 |
| `flows/assets-library.mjs` | 26 of 26 | 0 |

## Changes this pass and what they could touch

| Change | Touches | Regression check |
|---|---|---|
| Governance plan controls (`fdceb370`) | Governance tab only; server unchanged | Governance tab suite 7/7; WF-04 5/5; full run |
| Flow expectations (`576384a8`) | Verification flows only | Each changed flow run on the held stack and in the full run |
| Stack hold mode, operator, ROE, folder guard (`8be34174`) | Verification stack only | Full run uses the same stack code; hold run used for the acceptance pass |
| Acceptance scripts (`9091a84a`) | Verification tooling only | Each script run on the held stack |

## Not run

- `make quality`, `make quality-strict`, `make ci-test` and `make webraptix-quality`: the Makefile needs a POSIX shell, and this pass ran the same underlying commands directly.
- Python packages and the root test suite (no Python change in this pass).
- The CLI and desktop apps (no change).
