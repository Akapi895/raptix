# Execution contract: frontend-backend integration

Status: approved 18-ticket graph, with product/domain decisions gated by ticket 01.
Read [spec.md](spec.md) and [coverage.md](coverage.md) before implementation.

Precommit verification (2026-10-14): tickets 01-06 have been reopened;
[verification-01-06.md](verification-01-06.md) records blocking source findings
and 13 reproduced failing acceptance regressions. Earlier green test results
do not waive these failures or the unexecuted runtime E2E. Individual commits
remain blocked until the acceptance gate is satisfied.

Follow-up verification: [regression-fixes-and-live-flow.md](regression-fixes-and-live-flow.md)
resolves the 13 acceptance regressions and records a real runtime first flow.
Schema/deployment and remaining live HITL/cancel gates are still tracked;
the historical precommit failure report is not the current regression verdict.

## 1. Entry prerequisites

1. Confirm source paths, manifests and HEAD before editing. Preserve unrelated
   working-tree changes. Existing refactor tickets describe history, not proof
   that the real backend implements their demo contracts.
2. Resolve spec decisions D1-D6 for the affected slice. Do not turn an unresolved
   multi-user identity, operation mapping or persistence choice into code by
   assumption. Record any approved staged feature exclusions in coverage.md.
3. Record Proposed ADRs for new public API/subsystem boundaries before those
   boundaries land. Use root architecture/dependency rules and GLOSSARY.md.
4. Freeze the relevant API request/response/error/status mapping and source of
   truth. Name the real enforcement site for every invariant in the slice.
5. Work the frontier of the approved 18 tickets indexed in coverage.md. Ticket 01
   resolves decisions before affected implementation; requirements R01-R12 and
   milestone headings are not additional tickets. A blocked ticket may be read
   for planning but its feature must not be implemented ahead of its prerequisites.

## 2. Directory replacement without losing the backend

- Inventory tracked files and consumers under both application directories.
  Preserve `apps/web/server` source, Prisma schema/migrations and server tests.
- New UI replaces the old browser app; retain needed runtime/contract/deployment
  tests and tools. Classify old files before removal; backend files are not old
  frontend debris. Preserve existing data volumes and workspace contents.
- Reconcile manifests/dependencies using npm only. Before cutover, run the new
  app's scripts in `apps/web-improve`; it is not a root workspace. After cutover,
  use `@raptix/web-raptix` and the root lockfile. Do not leave two packages with
  the same workspace name or two competing install authorities.
- Preserve server workspace identity and independent build. Browser tsconfig,
  lint, test and Vite scopes must exclude server source/generated Prisma clients.
- Update paths in root scripts, Makefile, CI, Dockerfiles/Compose/proxy and
  launcher/desktop consumers that actually reference the changed surface.
  Preserve image/service names unless an explicit separate decision changes them.
- Carry `.scratch/frontend-backend-integration/` to the canonical app with the
  rename. Update app instructions for the new baseline in that implementation
  step; historical instructions do not authorize discarding the server.

## 3. Delivery size and shared write ownership

Each future change must fit the repo's one-concern, <=400 runtime-line / <=10-file
budget or be explicitly approved/split. Renames and deletions are not presumed
exempt. Separate packaging/supply-chain changes from feature behavior.

Keep the agreed 18 tracker work packages. A package may land several bounded,
independently verified patches/PRs recorded in that ticket; this is not permission
to exceed the per-PR budget. Do not create a ticket for every component, test,
warning or verification run. If the approved scope cannot be delivered safely
within this graph, ask before adding/merging/splitting tracker tickets.

| Shared surface | Coordination rule |
|---|---|
| Root/app manifests, locks, CI and container builds | Tooling/integrator owns serialized edits |
| Shared wire contracts and error/event DTOs | Contract owner reviews extensions before both consumers change |
| Bootstrap/providers/data mode, router and shell | Integrator serializes composition changes |
| Identity/authorization and scoped server access | Server identity owner; no client-side authority shortcuts |
| Prisma migrations and business lifecycle storage | Schema/domain owner; source-of-truth decided before migration |
| Runtime ownership, dispatch, stream cursor/recovery | Runtime-integration owner; preserve existing ledger/provenance semantics |
| Feature read models, screens, routes and handlers | Feature owner, with declared shared-file dependencies |

Delegate only when explicitly requested or required by applicable instructions.
Overlapping writers must be serialized. Before any authorized commit, inspect
status, full intended diff and recent log; stage only the intended files. Commit,
push and PR creation require an explicit request.

## 4. Per-slice implementation sequence

1. Identify UI reads, writes, sync projections and side effects; compare each
   against the real endpoint/service behavior in coverage.md.
2. Specify any contract/schema addition and its migration/compatibility behavior.
   Do not use the demo `Db`, actor name, local wall clock or fake IDs as a wire DTO.
3. Implement server/runtime enforcement and persistence where required, with a
   meaningful boundary/failure regression observed failing before the fix.
4. Implement the browser adapter/read model; keep mock and real implementations
   isolated and preserve existing visual behavior.
5. Wire the real screen/action and exercise success plus denial/outage/conflict
   through the layers changed. Stop after the slice's acceptance gate is met.
6. Record exact commands, environment, IDs and observed results; update coverage
   only after evidence exists. A blocked live check remains a named gap.

Browser mock timers and transactions cannot stand in for a runtime/provider's
acknowledgement. Runtime and server business gates remain responsible for real
scope, approval and deadline enforcement even if the UI predicts a refusal.

## 5. Test selection: affected scope only

The requester requires targeted testing. Do not run the full application or repo
test suite by default, including at a final milestone. For shared changes, name
the affected consumers and select their suites explicitly. A wider/full run
requires a separate requester decision; do not reinterpret "finish the gate" as
permission to override this constraint. CI may still execute its configured lane;
report CI evidence separately from local checks.

Every implementation ticket must resolve its verification selection to named
existing/new suites and actual commands before running them. Unfiltered
`npm test`, unfiltered `pytest` and selecting all test files as a disguised full
run are not the default. Typecheck/lint run on affected packages; rebuild only
when compilation/packaging changed or a live artifact is needed. A shared-source
edit requires justified affected consumers, not automatically all repository tests.

| Change | Local selection |
|---|---|
| Docs only | Links, source paths, requirement references and route-count consistency |
| Feature UI/adapter | Changed feature's component/query/contract tests and affected rendered route flows |
| Providers/mode/identity | Provider, scope-cancellation, mode-isolation and affected feature consumers |
| Runtime commands/streams | Policy, request fingerprint/ownership, stream/history/interrupt tests and affected UI stream flows |
| Server API/schema | Owning route/service/repository tests, migration behavior and live scoped request |
| Packaging/deploy | Workspace builds/type/lint plus affected build/proxy/deployment smoke |
| Python runtime | Relevant focused Python tests at the real enforcement site, plus the crossing E2E flow |

Use the scripts from the owning manifest. Example commands (select existing test
paths for the actual slice, not a fabricated placeholder path):

```powershell
# Before the rename: run these in apps/web-improve
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm test -- --run --maxWorkers=2 src/state/services.test.tsx

# Repo root: shared packages export dist, so build them first
npm run build --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server -- tests/projects.test.ts

# After cutover, use the canonical frontend workspace
npm run typecheck --workspace=@raptix/web-raptix
npm run lint --workspace=@raptix/web-raptix -- --max-warnings=0
npm run build --workspace=@raptix/web-raptix
```

Prisma generation is not migration. API startup requires explicit configuration
and does not generate/migrate automatically. Existing server regression suites
under `apps/web/server/tests` are retained and selected according to the change;
select existing test filenames from that directory rather than copying them
into a new mock test system. Build/typecheck success alone is not proof of
integration.

## 6. Live verification environments

- **Mock smoke:** new UI without API/database/runtime. Exercise demo data,
  navigation, dirty guards and reset isolation.
- **API integration:** configured PostgreSQL and explicit `WORKSPACE_PATH` with
  the owning migrations applied. Exercise actual supported reads/writes and
  ownership errors; missing runtime/provider features remain unavailable.
- **Runtime E2E:** explicit `LANGGRAPH_API_URL`, runtime workspace root, assistant
  selection and relevant providers. Verify planning/readiness, owned run dispatch,
  actual events, question/HITL handling, recovery and produced artifacts.

Use isolated test engagements/workspaces and record cleanup. Configure real
credentials on the server; do not place them in Vite env variables. Reuse the
existing Docker/proxy stack where suitable. A transport stub is useful for error
rendering tests but does not certify a real runtime/provider command succeeded.

On Windows, record exact server/browser PID, command line and port. Use the app's
temporary-process rules: every stop/cleanup has a hard 5-second cap, only stop
verified processes owned by the verification session, disclose survivors and
never blanket-kill Node/npm/browser processes. Run probes on the actual port.

## 7. Final acceptance evidence

Final acceptance is a ledger of the affected flows, not a mandate to repeatedly
run every test. Record the tested runtime tree/SHA and configuration alongside:

1. **Coverage disposition:** every route and route-less action in coverage.md
   resolves to verified real behavior, explicit demo-only behavior or a
   requester-approved exclusion. Required unresolved gaps block full parity.
2. **First real flow:** engagement -> planning readiness -> owned thread/run ->
   scoped events -> findings/artifacts, including refusal and outage/recovery.
3. **Persistent state:** refresh and API restart recover supported records,
   pending questions and run ownership without duplicate dispatch.
4. **Scope/authorization:** direct foreign-ID API requests and stream attempts,
   stale reads after switch, server-side enforcement and honest local-user mode.
5. **Operational invariants:** relevant four-eyes/version/deadline -1/0/+1,
   edited ROE windows, off-page expiry and truthful stop states at real handlers.
6. **UX:** all required routes render with real IDs; forms preserve drafts on
   refusal; dirty save/discard/cancel; refresh/history/base-path; themes, keyboard
   and accessibility-tree checks on affected routes. Record actual AT limitations.
7. **Deployment:** canonical workspace/source paths, independent builds,
   same-origin `/api`, unbuffered SSE and existing data retained after cutover.
8. **Performance:** actual required cold asset closure and five interactive
   samples under the declared network/CPU profile. Do not omit lazy chunks needed
   before authenticated readiness or relabel quiet-window TTI as interaction.

Store durable summaries with the implementation evidence; temporary local reports
alone are not a reproducible project test harness. Document accepted gaps with
the requester's decision and reason. Do not advance knowledge-graph metadata,
mark unavailable controls complete or certify backend parity without execution.

## 8. Evidence reuse and ticket completion

Keep evidence in the owning ticket with these fields:

- Tested commit/tree and the changed source/contracts/dependencies covered.
- Selected suites, exact commands, outcomes and relevant live flow/environment.
- Which earlier evidence remains valid because its sources and assumptions did
  not change; which evidence was invalidated and needs a targeted rerun.
- Any unverified boundary, accepted exclusion and required follow-up decision.

Do not repeat a passing check with the same relevant tree/environment just to
close the next ticket. When shared contracts, locks, schema or consumers change,
invalidate only the affected claims and rerun the corresponding selections.
An old test result may support unchanged sources across newer commits, but must
not be presented as a run executed on the newer SHA. Do not sum overlapping test
counts from different runs into a supposed final-suite result.

Ticket 18 reviews this ledger, runs missing/invalidated selections and the bounded
final deployment/real-flow/performance probes. It does not automatically rerun
every previous test or the complete browser viewport matrix. A required broader
or full run needs requester approval naming why selected checks are insufficient.

Status transitions: ready-for-agent (schedulable only when blockers complete) ->
in-progress -> complete after acceptance evidence exists. A required unexecuted
real flow stays blocked/in-progress; record the reason rather than ticking it
green. Ticket-count approval is not approval of domain exclusions or waiving a
real runtime/provider check.
