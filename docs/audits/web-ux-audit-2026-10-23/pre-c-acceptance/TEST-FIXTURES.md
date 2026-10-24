# Test fixtures and the isolated stack

Every write in this pass ran on a stack created by `apps/web/tools/verify/stack.mjs` and destroyed when the run ends (or when a held run is stopped). Nothing was written to production, to the 3001 container, to the 5273 dev server, or to any container the owner runs.

## Stack

| Part | How it runs | Isolation |
|---|---|---|
| PostgreSQL | Container `raptix-stack-<id>`, label `raptix.verification=stack`, `tmpfs` data directory, migrations applied at start | Own container; port chosen at random on 127.0.0.1 |
| Neo4j (knowledge graph) | Container `raptix-stack-<id>-graph`, same label, `tmpfs`, seeded from the checked-in skill graph | Own container; library routes depend on it |
| API | `tsx src/main.ts` from source, loopback port chosen at random | Own process |
| Web | Vite dev server from source, loopback port chosen at random | Own process |
| Mock web | Separate Vite instance with an unreachable backend (full run only) | Own process |

Stop: the stack removes its containers and child processes on exit. In hold mode, creating the `STOP` file in the hold folder does the same. Restart gives a new database, so fixtures are fresh.

The stack refuses a `--out` or `--hold-dir` folder inside the repository (commit `8be34174`), because those folders hold the test passwords.

## Actors

| Actor | Membership in the shared project | Account | Credential source |
|---|---|---|---|
| owner | Project owner | `verifier` (bootstrap account) | random per run, in the hold file or the flow's environment |
| operator | operator | `operator` | random per run |
| reviewer | reviewer (independent of the operator) | `reviewer` | random per run |
| viewer | viewer | `viewer` | random per run |
| outsider | viewer of a different project only | created by `authz-matrix.mjs` and `wf-report-export.mjs` | random per run |

Membership rank used by the server: owner 4, operator 3, reviewer 2, viewer 1 (`apps/web/server/src/auth/membership-policy.ts`).

## Seeded data (shared project)

| Item | Value | Why |
|---|---|---|
| Project | `stack-verify`, display name "Stack verification project", target `https://verification.invalid` | The `.invalid` TLD cannot resolve; no target contact is possible |
| Finding | "Stack verification finding", medium, author owner, confirmed by reviewer | A confirmed finding is the reporting precondition |
| Evidence | `stack-fixture.txt`, classification standard, linked to the finding | Capture upload and classification |
| Report | "Stack verification report" | Export checks |
| Asset | `stack-host-01.verify.example.test`, host, imported | Asset detail route |
| Scope revision v1 | Submitted by the operator, approved by the reviewer; ROE window 2026-01-01 to 2027-12-31 UTC; emergency contact `stack-verification-contact` | Plan proposal pins the approved ROE; without this no plan can be proposed |
| Library | Proposal created from a skill in the checked-in graph (full run only, when the graph is present) | Library routes |

## Data created by the acceptance scripts

Each script creates its own records with a per-run stamp, so reruns do not collide. These records stay in the stack until it is stopped.

- Plans: one draft and one proposed plan (authz matrix); one plan drafted, proposed and approved (plan approval).
- Scope revisions: one pending and approved by the reviewer (decisions); one pending and refused for the author (decisions); 26 pending in a second project for the capped inbox.
- Projects: an owner-only project (actor isolation); an authz matrix project and an outsider project; a capped-inbox project; an export outsider project.
- A report with the seeded finding selected (export).

Important: submitting any scope revision supersedes the approved ROE at once (`scope-service.ts`, "Invalidation happens at submission"). After the decisions script, the shared project therefore has a pending revision and no approved ROE until a new revision is approved. This is the designed fail-closed behaviour; it is reported as an observation in OPEN-ISSUES.md (OI-02). Restart the stack to get the seeded ROE back.

## Credentials

- Values are random UUIDs created by the stack at start.
- They are written only to the hold file (`hold.json`) in the folder given by `--hold-dir`, and to the fixture manifest in the `--out` folder. Both folders are outside the repository.
- The flows receive them in child-process environment variables. Nothing is printed by the stack.
- The stack's fixture manifest (`fixtures.real.json`) contains the passwords. It is not part of any share package. The evidence in `evidence/` was scanned and holds none.
- Production credentials were not used anywhere in this pass.

## Reset

- Stop the held stack: create `STOP` in the hold folder and wait for the process to exit; containers are removed.
- Start again: `node tools/verify/stack.mjs --modes real --hold --hold-dir <outside repo> --out <outside repo>`.
- A reset is always a restart. The database is a `tmpfs`; there is no partial reset.
- Delete the old hold file after a stop. The stack does not delete it.
