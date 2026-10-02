# Independent web integration — phase gates

Guide: `summary/impl-guide-web-raptix-integration.md` (independent backend revision).

Each WP is a phase. Only the current phase may be implemented; the next starts after
HEAD verifies its exit gate. Agents own small named slices; HEAD reviews/tests.

## W00 — accepted by HEAD

- Read-only API/schema/runtime/deployment inventories received.
- Existing unrelated checkout changes are preserved.
- Actual ports observed: legacy web 3000/3003, LangGraph 2400, PostgreSQL 5433,
  Neo4j 7688/7475. Do not assume default ports.
- Runtime `/info` reports API 0.10.0 / LangGraph Python 1.2.4; catalog includes
  `decepticon` and `soundwave` but not the source-only `raptix` alias. No run submitted.
- Controlled capture will use its own test DB/role and temporary workspace, not the
  live `raptix_web` DB or shared production workspace.
- Legacy image API capture is a reference-only test lane, not a new-stack upstream.

Gate results:

- Controlled HTTP capture22/22 passed (API5290, dedicated test DB/workspace).
- Source-emitter capture in isolated no-network container: all assertions passed.
- Captured live catalog only info/discovery; no model/tool execution.
- Capture-contract/model suite21/21 passed; typecheck/build passed.
- Mock production browser8/8 passed (13-page navigation preserved).
- Lint0 errors /38 source-inherited warnings.
- Source/data/deployment inventory and backup/ownership plan reviewed in w00-inventory.md.

Capture provenance distinguishes image-container HTTP evidence, actual repository
emitter evidence, synthetic fixture inputs and read-only live catalog metadata.
No source-HEAD-exact/live assessment claim is made from these fixtures.

## W01 — accepted by HEAD

Delivered: Fastify server skeleton/ADR, pure shared web-contracts, raw streaming
fields + safe normalizer, explicit root workspace/default scripts, browser/server
TS/eslint/Tailwind boundaries. No project/DB/runtime business API fabricated yet.

HEAD gate:

- New server typecheck/lint/build pass; bootstrap9 tests pass.
- Shared contracts26 tests and streaming16 tests/typecheck/build pass.
- CLI typecheck passes against nullable/raw-field additions.
- Frontend21 tests +8 production-browser scenarios pass; 13 tabs unchanged.
- Actual API HTTP: liveness200, readiness503, capabilities200 all businessfalse,
  projects endpoint404 until W02. See w01-http.json.
- Fresh isolated checkout omitted clients/web: npm ci, shared/frontend/server builds
  and server tests passed. See w01-independence.json.
- Initial clean build exposed ambient ancestor @types pollution; explicit types
  boundaries fixed the reproduced error. API tests initially inherited frontend
  Vitest config; own server config fixed it. Normalizer field-loss/key collision and
  public project DTO leaks were corrected before acceptance.
- npm audit exposed existing/shared dev dependency advisories; fast-uri was updated
  compatibly because the new API uses it. Remaining16 findings are recorded for
  dependency maintenance; no force-downgrade/blanket audit fix performed.

## W02 — accepted by HEAD

Delivered: own Prisma7.8 client/schema/migration history, nullable displayName +
unique(userId,name) additive migration, safe workspace/project policy/local identity,
owner-scoped repository and GET/POST/detail/PATCH project APIs, lifecycle/health.

HEAD gate:

- Fresh test DB applied all3 migrations; logical production-data copy applied only
  the additive migration. Live raptix_web was not migrated.
- Legacy migration checksums preserved; original row/target/auth/workspace/thread/
  timestamp fingerprint equals production (1 row, hash2c534dc4d6d4c8034c8dd3de3024a461).
- Real PostgreSQL-backed HTTP gates passed for fresh and oldcopy lanes: public DTO,
  invalid400, duplicate409, immutable patch rejection, safe list and concurrent
  same-slug POST race201+409. See w02-fresh-api.json/w02-oldcopy-api.json.
- Server typecheck/lint/build and116 tests passed.
- Clean install/generated-own-client/build/server116 tests/frontend build without
  clients/web passed again. See w02-independence.json.
- HEAD caught plan-dir symlink/junction escape and poisoned-slug display-name PATCH;
  regression tests failed before fixes then passed. Legacy invalid targets now mark
  needs_review, not verified. Public paths/userId are omitted, counters remain null.

Intentional legacy deviations: read-only GET(no auto-import), validated targets,
immutable slug/authority fields, unsupported DELETE, unknown counters=null and
target-change gate draft/no linked thread. No frontend real binding yet.

## W03 — accepted by HEAD

Delivered: explicit real HTTP/project API provider, DTO validation/error handling,
scoped abort/dedup cache, real source-styled Projects/New Project/local-operator
workspace and native 13-route composition. Mock source UI remains unchanged.

HEAD gate:

- New-API/PostgreSQL live browser creates acknowledged201 project, navigates server
  ID, reloads correct metadata, duplicate-slug409 stays in form, switches projects
  without data leak; intercepted503 remains error with no fixture fallback (2/2).
- Mock13-tab production-browser regression8/8 passed.
- Frontend typecheck/build,54 tests,lint0 errors/38 retained-source warnings passed;
  shared contracts26 and backend116 tests/typecheck passed after error boundary alignment.
- HEAD found body-read timeout/cancel escaping its deadline and stale list GET after
  mutation; tests failed before fixes and passed after. Atomic create guard, lateACK
  navigation suppression/history-close and mobile focus management also fixed.
- Public error codes now shared across server/client, field detail preserved; real
  projects never render mock avatars/roles/counters. Unconnected real features
  explicitly remain unavailable until their own phases, not source-fixture success.

## W04 — accepted by HEAD

Delivered: owner-scoped read-only plan-docs/opplan APIs, versioned typed public
projection, per-document ready/missing/invalid/unavailable states, eight-document
planning readiness and real Charter/Scope rendering with cancellation/reload/error
states. Planning capability reflects the implemented service/database availability.

HEAD gate:

- Server typecheck/lint/build and120 tests pass; shared contracts28 tests pass.
- Frontend typecheck/build/54 tests pass; lint0 errors/38 retained-source warnings.
- PostgreSQL-backed HTTP/browser gate on new API5281 + real Vite5277 passes:
  missing/partial/valid/invalid/unavailable, Charter/Scope reads and reload, OPPLAN
  objectives/dependencies, project isolation, cross-project junction rejection,
  secret omission, unsupported writes404, intercepted503 and wrong-ID200 rejection.
- Full eight-document bundle is ready without OPPLAN. Persisted authorization,
  reviewed target, common non-empty document name, authorization reference and
  exact RoE target are checked; runtime handoff remains explicitly not_observed.
- Mock production-browser regression8/8 passes; exactly13 source tabs retained.
- Clean npm ci/own Prisma generation/server120 tests/server+frontend builds with
  clients/web omitted pass. See w04-independence.json. First install attempt hit an
  npm registry ECONNRESET; fresh retry with --prefer-offline passed.
- HEAD reproduced an omitted-scope500 caused by Pydantic factory defaults missing
  from JSON schema. Export now includes runtime list/dict factory defaults; omitted
  scope correctly returns target_not_in_scope. Schema --check passes against source.

Evidence/commands and contract decisions: w04-planning.md. The test lane uses only
the existing dedicated fresh DB and a new temporary workspace; no migration needed.
User requested no further agent spawns; HEAD performed this phase directly.

## W05 — accepted by HEAD

Delivered: additive EngagementThread/WebRequestLedger persistence and immutable
context lock, owner-scoped binding/request service, canonical bounded intent
fingerprints, durable per-thread active-slot uniqueness and recovery read APIs.
Creating/accepted/uncertain/rejected transitions are reservation-token protected;
stale creating sweep runs at API startup/every30s without dispatching runtime work.

HEAD gate:

- New migration applied only to the dedicated fresh/oldcopy test databases. Existing
  engagement-row fingerprints and migration checksums preserved; oldcopy retained
  all3 pre-migration rows. No legacy thread-pointer auto-adoption/backfill.
- Real PostgreSQL service/HTTP gates pass8 groups per lane:8 simultaneous bindings,
  12 same-intent submissions/one winner, distinct-intent same-thread contention,
  six first-binding/target-PATCH races, owner/project/context mismatch rejection,
  private-token transitions, uncertainty/accepted active-slot retention and release.
- Compiled API5282 was stopped/restarted in each lane. Accepted identity persisted;
  an aged creating record became uncertain at startup, with no replay or slot reset.
- Server typecheck/lint/build and122 tests pass; shared contracts31 tests/typecheck
  pass. Clean npm ci/Prisma generation/server122 tests/server+frontend builds without
  clients/web pass (w05-independence.json).
- Frontend typecheck/build/54 tests,lint0 errors/38 inherited warnings pass; mock
  production-browser8/8 and W04 real PostgreSQL-backed planning browser1/1 pass.
- A new sparse-array fingerprint regression failed before the fix then passed;
  unsupported JSON values cannot alias an empty-array intent fingerprint.

Evidence and scope decisions: w05-ownership.md, w05-fresh.json, w05-oldcopy.json.
Runtime IDs in this phase's DB tests are synthetic fixtures, not remotely created
LangGraph resources; no runtime submission or runtime-state reconciliation claimed.

## W06 — accepted by HEAD

Delivered: explicit runtime URL/topology/allowlist configuration, bounded read-only
runtime adapter, trusted configurable/context resolver, full immutable binding proof,
reachable assistant catalog and sanitized context preflight APIs. Browser overrides
of workspace/config/auth/sandbox/graph/language are rejected. Runtime reachability is
now reflected in agents capability and dependency readiness; run APIs remain gated.

HEAD gate:

- Exact five-field CLI configurable was captured by executing the real submit
  source block. Installed-runtime hydration helper produces the same fields and
  preserves existing context; replay tests verify the source-block hash.
- Live API5283 + PostgreSQL + LangGraph2400 passed5 groups: actual mount-file hash,
  acknowledged owned runtime thread/checkpoint, persisted full proof, context/catalog/
  readiness HTTP reads, browser/owner/assistant rejection, actual remote metadata/
  hydrated-target mismatch, missing proof and unavailable runtime behavior.
- Actual allowlisted reachable graph IDs are soundwave/decepticon; no raptix alias
  fallback fabricated. Explicit bound assistant is retained; kind/assistant switch
  in an existing thread conflicts. OPPLAN remains excluded from planning readiness.
- HEAD reproduced live reserved assistant_id metadata filtering and empty optional
  checkpoint fields; regression failed before fix. Contract uses ui_assistant_id
  plus graph_id, verifies checkpoint graph identity and treats empty optional
  defaults correctly. Same-root workspace junction regression also failed then passed.
- Nullable runtimeConfigHash migration applied only to dedicated fresh/oldcopy lanes;
  existing engagement fingerprints and all4 prior migration checksums preserved.
  W05 PostgreSQL concurrency/ownership/process-restart regression passed both lanes.
- Server typecheck/lint/build/135 tests, shared contracts32 tests/typecheck pass.
  Frontend typecheck/build/54 tests,lint0 errors/38 inherited warnings, mock-browser
  8/8 and W04 real planning-browser1/1 pass. Clean install/generated-client/server135
  tests/server+frontend builds without clients/web pass (w06-independence.json).

Evidence and configuration: w06-runtime-context.md, w06-live.json,
w06-migration-fresh.json/w06-migration-oldcopy.json and tests/fixtures/w06.
The live gate created only an owned context/checkpoint fixture, then deleted that
remote thread and its unique workspace; no graph runs, models or tools were invoked.
Actual assessment execution and runtime run reconciliation are W07+ gates.

## W07 — authorized after W06 gate (not started)

Next scope: scoped thread/run submit/state/recovery APIs using the trusted context
and persistent intent ledger; one acknowledged run per accepted intent.

## Subsequent phases — pending (not started)

W08–W11 stream/history/console/HITL; W12–W16
outcomes/settings/deployment; W17–W19 additional providers; W20 legacy retirement.

Deployment-agent recommendations are evidence to review, not authority over the
guide: production data may be preserved with a single new migration owner. A new DB
is used for this capture lane, not a requirement to discard existing production data.
Never take an uncoordinated raw copy of running PostgreSQL files as a valid backup;
use logical pg_dump or a verified PostgreSQL-consistent backup/restore procedure.
