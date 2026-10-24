# Execution plan and what was done

Start state: HEAD `88aa5540`, branch `frontend`. The owner's uncommitted work (ADR-0095, 0098, 0099, the C2 PTY proposal, `GLOSSARY.md`, untracked notes and archives) was left as it was and is not part of this pass.

## Loop used

DISCOVER → BUILD TEST ENVIRONMENT → SEED FIXTURES → EXECUTE WORKFLOW → VERIFY BACKEND STATE → IDENTIFY BUG → FIX → REGRESSION → COMMIT → NEXT WORKFLOW

## Phases

| Phase | Work | Result |
|---|---|---|
| A0 Discover | Read the route, service and policy code for each workflow; read the existing verify flows and the stack script | Done. The stack, flow and route inventories are in TEST-FIXTURES.md |
| A1 Environment | Isolated stack (`tools/verify/stack.mjs`): own PostgreSQL and Neo4j containers with a `raptix.verification=stack` label, free ports, API from source, Vite web, seeded project | Done. Hold mode added so one stack can serve many runs |
| A2 Baseline | Full run on the untouched tree: mock and real route smoke, every flow | Done. Four real flows failed (prelab, runtime gate, workspace, assets library) and one mock step failed (the infrastructure tab label). All five were stale expectations in the flows, not product faults; classified in BUGS-FIXED.md |
| A3 Fixtures | Added the operator member and an approved in-scope ROE revision to the seed. Without it no plan can be proposed, because proposal pins the approved ROE | Done |
| A4 Workflow scripts | Wrote and ran authorization, plan approval, decisions, actor isolation, report export, and UI/UX matrix checks against the API, the browser, and the database | Done. Several harness faults were found and fixed while running them |
| A5 Product fix | Governance plan controls gated by the signed-in member's role and authorship; two unit tests | Done. Verified by WF-04 before and after |
| A6 Gates | Typecheck, lint, unit tests, boundaries, builds, full stack run, acceptance pass on a fresh stack | Done (REGRESSION-REPORT.md) |
| A7 Documents | This folder | Done |
| A8 Manual UAT preparation | Start, read credentials, reset, stop: each command run once | Done (MANUAL-UAT.md) |
| A9 Packaging | Share ZIP without secrets; git status | Done (see RESUME.md) |

## Commits made in this pass

Each commit covers one concern and stages only the files of that concern. Owner files were not staged. No push.

| Commit | Concern |
|---|---|
| `fdceb370` | fix(web): governance plan controls shown only to roles that can use them, with tests |
| `576384a8` | test(web): repaired flow expectations (C2 form route, grants tab, Operations label, Runtime agents label, library path, ROE scope) |
| `8be34174` | test(web): stack hold mode, operator member, approved ROE fixture, refusal of folders inside the repository |
| `9091a84a` | test(web): pre-Phase-C acceptance scripts (authorization, approval, decisions, isolation, export, UI/UX) |
| (this commit) | docs(web): pre-Phase-C acceptance record and share package |

## Left out on purpose

- Real operation execution, AI conversation, C2 command dispatch and sessions against a real provider: these need the runtime and a C2 server, which this environment does not start, and no target may be touched. They are reported as NV, not as passed.
- Redeploying the 3001 container: not requested, and it would change a running system. See DEPLOYMENT-READINESS.md.
- Changes to ADR-0095, 0098 and 0099: they stay Proposed.
- Changes to authorization or the ROE rules. Two behaviours are reported as open decisions in OPEN-ISSUES.md rather than changed.
