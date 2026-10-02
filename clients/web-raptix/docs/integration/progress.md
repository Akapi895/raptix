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

## W07 — accepted by HEAD

Delivered: scoped thread creation/background run submission, owned root snapshots,
paginated owned run/status reads, explicit and periodic lost-ACK reconciliation,
durable dispatch proof/candidate thread identity and live thread/run capabilities.
Same-intent replay never dispatches again; different intent under an existing ID
conflicts. Runtime uses explicit multitask_strategy=reject/if_not_exists=reject.

HEAD gate:

- Actual new API5284 + PostgreSQL + LangGraph2400 passed4 groups:6 simultaneous thread
  intents/one native thread,6 simultaneous run intents/one native run, actual planning
  model status success, scoped snapshot/list/state, changed-intent/foreign-run denial,
  and accepted identity/dedup preserved after API process restart. Fixture cleaned.
- Real PostgreSQL + controlled HTTP fault-provider gates pass9 groups on fresh and
  oldcopy lanes: duplicate/preflight race, active-run and interrupted holds, lost run
  and thread ACK repair with no resubmit, known rejection, redaction, owner checks,
  bounded pagination, readiness and transaction-guarded planning/execution handoff.
- HEAD reproduced a late duplicate receiving spurious409; preflight now rechecks
  the winning intent. Deterministic barrier regression failed then passed.
- Actual runtime exposed a fresh boolean-channel defaultfalse masking configured
  authorizationtrue. Fresh-only trusted thread supersteps bootstrap fixed the live
  and controlled regression, without overwriting existing state or changing guard
  code. See docs/decisions/0004-fresh-thread-context-bootstrap.md.
- Dispatch-recovery migration applied only to dedicated fresh/oldcopy test DBs.
  Existing engagement fingerprints/migration checksums preserved; W05 PostgreSQL
  ownership/concurrency/restart regression passed both lanes under W07 handoff policy.
- Server typecheck/lint/build/140 tests and shared contracts34 tests pass. Clean
  install/generated-client/server140 tests/server+frontend builds without clients/web
  pass (w07-independence.json). First-party streaming dependency declared explicitly.
- Frontend typecheck/build/54 tests,lint0 errors/38 inherited warnings, mock-browser8/8,
  W04 real planning-browser1/1 and W06 live context/checkpoint5 groups pass.

Evidence: w07-runs.md, w07-live.json, w07-{faults,oldcopy-faults}.json,
w07-migration-{fresh,oldcopy}.json, w07-independence.json and hydration captures.
Live run was a context-only planning acknowledgement against an isolated fixture;
no assessment or offensive-target execution is claimed. No staging/commit performed.

## W08 — accepted by HEAD

Delivered: owner-scoped GET run events bridge, native join/replay client, bounded
incremental SSE/UTF8 decoder, typed public projection, pure bounded stream reducer
and browser observe/refetch/reconnect orchestration. Every attach resolves W07 run
ownership again; join is GET/cancel_on_disconnect=0 and never submits/cancels a run.

HEAD gate:

- Actual API5284/PostgreSQL/LangGraph2400 stream gate passes6 groups: early attach/
  abort, genuine native cursor reconnect, late resumable replay, reducer dedup,
  scope/cursor denial, one native execution and identity retained after API restart.
  Actual planning run ends success; owned runtime/workspace fixture cleaned.
- Fresh/oldcopy PostgreSQL + controlled HTTP gates pass10 groups each, including
  stream peer abort/reconnect, redaction,85.125 seconds/source flags, no extra create,
  no runtime cancel and no active-slot release caused by disconnect.
- Native captured join frames are metadata/values/updates with Redis-style IDs.
  Tuple/incremental message shapes and custom/parallel/interrupt/transcript cases are
  separately verified with representative producer/SDK fixtures, not claimed as
  live subagent/tool execution from the acknowledgement-only planning run.
- Cursor commits only on the final projected event of an upstream frame; control
  EOF/heartbeats never assign fake IDs. Checkpoint content stays runId=null with
  separate streamRunId for cursor ownership. Full live output wins over truncated
  checkpoint replay; private state/system/reasoning fields and sensitive args omitted.
- Streaming19 tests/typecheck/build, contracts35 tests/build, server147 tests plus
  typecheck/lint/build, frontend60 tests/typecheck/build pass. CLI typecheck passes.
  Frontend lint0 errors/38 inherited warnings; mock-browser8/8 and W04 real-browser
  1/1 pass. Clean install/generated-client/server147 tests/server+frontend builds
  without clients/web pass (w08-independence.json).

Evidence: w08-streaming.md, w08-live.json, w08-faults.json,
w08-oldcopy-faults.json and w08-independence.json. No new DB migration/collector.
Real Console rendering is W10; full checkpoint/history recovery remains W09 scope.

## W09 — accepted 2026-10-02

Owned checkpoint history/transcript recovery shipped additively:

- Thread snapshot (`GET .../threads/:thread`) now projects bounded
  `values.subagent_transcripts` history via the same redaction/preview pipeline
  as live frames: credential-shaped args redacted, `…[truncated]` producer
  marker surfaces `truncated:true`, non-array/lossy channels flagged via
  `transcriptsTruncated`, most-recent 500 entries.
- Stable thread-level attribution: every history entry is `runId:null` /
  `source:'checkpoint'` with provenance keys from the shared normalizer
  (`session::type#id`, else `@createdAt`); unprovable identity stays `key:null`.
  Parallel-branch duplicates dedupe by provenance key; key sequences are stable
  across fetches. History is never attributed to an active run.
- Root messages carry provable `messageId` (or explicit null).
- Client `mergeThreadHistory` merges one snapshot into the W08 stream state by
  provenance IDs only: messages insert-only, tools with the no-downgrade rule
  (full live content never replaced by capped replay), invocations preserve
  existing run attribution, questions dedupe, handoff stays live-only, and the
  merge is idempotent across reconnects. Bounds reuse the reducer limits.
- Contracts additive: `ThreadHistoryEvent`, `ScopedThreadMessage.messageId?`,
  `ScopedThreadView.transcripts?/transcriptsTruncated?`; validators reject
  forged attribution. `isPublicStreamPayload` extracted for reuse; event-level
  validation unchanged.

Gates: streaming19, contracts36, server154 (+typecheck/lint/build), frontend67
(+typecheck/lint/build, 0 errors) pass. CLI typecheck passes. Live
API5284/PostgreSQL/LangGraph2400 gate passes 7 groups (real planning run,
history fields, thread-level attribution, idempotent merge over genuine replay,
scope denial, restart identity); W08 lane re-run 6 groups. Controlled
PostgreSQL/HTTP lanes pass 11 groups each on fresh and oldcopy DBs: producer
representative transcripts prove dedup/full-vs-capped/redaction/stable keys
through the real HTTP service (deployed runtime image does not yet expose the
transcript channel on GET state — same pristine-state observation as W06/W07;
no runtime change made). Mock browser 8/8, W04 real planning browser 1/1,
independence clean-install gate pass.

Evidence: w09-history.md, w09-live.json, w09-faults.json,
w09-oldcopy-faults.json. No new migration; Console rendering is W10, HITL is
W11.

## W10 — accepted 2026-10-02

Delivered: source Operator Console bound to real data within the same visual
layout. New owner-scoped thread selector feed (`GET /engagements/:id/threads`,
newest-first, bounded, stale-context filtered, foreign scope denied), real-mode
Console session store (thread create via reservation ACK, W09 snapshot/transcript
hydrate, W08 GET-only SSE observe with reconnect, root-message submission with
ACK recovery), pure console view model (timeline items + inspector, provenance
kept on every item) and `RealConsole` mounting under the operator-console route
with truthful transport/run-state chips. Questions/interrupts render read-only
with an explicit W11 note; HITL approve/reject, pause/cancel/resume and OPSEC/
synthetic phase data are never faked.

HEAD gate:

- Frontend typecheck/lint/build and 70 tests pass (+3 console-view, +1 capabilities
  test now asserting Console is connected); lint 0 errors/38 retained warnings.
- Server typecheck/lint/build and 155 tests pass (+1 listThreads ownership test);
  shared contracts 37 (+1 selector-list validator), streaming 19, CLI typecheck pass.
- Mock production-browser 8/8; W04 real planning browser 1/1 still pass.
- Live HTTP gate `--w10` on API5284/PostgreSQL/LangGraph2400 passes 7 groups
  (selector feed newest-first/owner-scoped/denial + full W07-W09 run/stream/history
  regression). See w10-live.json.
- Live browser gate (real Vite 5278 + compiled API 5285 + fresh test DB + runtime
  2400) passes: New planning chat binds a real native thread, command-bar submit
  acknowledges and streams OPERATOR/AGENT cards to RUN SUCCESS, reload recovers
  the timeline from checkpoint history with HISTORY provenance and NO ACTIVE RUN,
  zero demo data throughout. Deployed runtime confirms a successful `soundwave`
  run with browser-generated `ui_request_id`; owned thread/workspace fixture
  removed afterwards. See w10-console.md.

Evidence: w10-console.md, w10-live.json and the console browser screenshot in
test output. No new migration; question resume and HITL are W11.

## W11 — accepted 2026-10-02

Question resume, file-backed tool HITL and pause/cancel controls. Additive server
surface: `POST .../threads/:thread/resume` (validated scoped graph-interrupt resume,
new run identity via `command.resume`, replay idempotent, no-pending → 409),
`POST .../runs/:run/cancel` (runtime interrupt, truthful settled view),
`GET/POST .../approvals` (producer-contract JSONL in the engagement workspace,
public view without producer metadata, serialized decision append → duplicate 409).
Contracts add `PendingInterruptView` (snapshot-restored picker on
`ScopedThreadView.pendingQuestion`) and `ApprovalRequestView`/`ApprovalsView`;
`capabilities.approvals` is now implemented. Frontend: server-validated answer form
on question cards (single/multi/Other, only for the exact server-observed pending
interrupt), engagement-scoped HITL approvals panel with in-flight disabling and
409-refresh, and a truthfully labelled interrupt control; send/resume bind the live
run view so header status and controls work during execution. No migration, no demo
data, no fabricated decisions. Gates: server 172 tests, contracts 38, frontend 70 +
browser lanes 8/8 + 6/6 + 1/1 + 1/1 + 1/1, live verifier `--w11` 10 groups including
a real approvals file round trip; live resume happy path recorded `resumeRoundTrip:
false` (deployed model never interrupted — happy path proven in controlled service
lanes, W09 precedent). All verifier phases w07–w11 pass. See w11-controls.md,
w11-live.json.

## W12 — accepted 2026-10-02

Findings & Evidence on real data. Server: findings projection parses
`FIND-*.md` from the engagement workspace with legacy parser semantics and
explicit parser-quality flags (parsed defaults are flagged, never presented as
analyst-confirmed; malformed findings stay viewable via bounded raw source);
artifact browser lists the allowlisted `recon|exploit|post-exploit|findings|
report` folders non-recursively and serves UTF-8 text/JSON content with a
tightened boundary the legacy API lacked (realpath/symlink containment, 256 KB
cap, binary rejection, traversal rejected 400, engagement scoped by owned id).
`capabilities.findings` and `capabilities.artifacts` are implemented. Frontend:
source-screen visual language (severity summary bar, table, detail modal) bound
to real data only — no status/report/assign workflow states, no Run-PoC timer,
no fake exports; rows carry parser-quality provenance and the modal embeds the
artifact preview. Gates: server 178 tests, contracts 39, frontend 74 + browser
lanes 8/8 + 8/8 + 1/1 (new findings live gate), verifier `--w12` 9 groups
including a real findings/artifact workspace round trip; all phases w07–w12
pass. See w12-findings.md, w12-live.json.

## W13 — accepted 2026-10-02

Infrastructure & Assets on the real graph. Server: engagement-scoped Neo4j
projection over the HTTP transaction endpoint with the public projection
applied before the response — property allowlist, credential-like keys dropped
entirely, credential-looking values redacted, bounded nodes/edges/properties
(`truncated` means bound truncation only); assets derive from the same read
with hostname+ip dedupe; graph-store failure answers 503 while a scoped empty
graph stays 200-empty; `capabilities.graphs` implemented; optional
NEO4J_PASSWORD env refuses the documented public default outright. Frontend:
Infrastructure (node table, relations summary, redacted node detail) and
Assets (source-screen counters/tabs/search/inspect) render only public data —
no Tag/Update Scope/Export docks, no fabricated compromise claims. Gates:
server 183 tests, contracts 40, frontend 77 + browser lanes 8/8 + 10/10 + 1/1
(new W13 live gate against real Neo4j), verifier `--w13` 9 groups proving
redaction, isolation and dedupe on the real store; all phases w07–w13 pass.
See w13-graph.md, w13-live.json.

## Subsequent phases — pending (not started)

W14–W16 logs/reports/settings/deployment; W17–W19 additional providers; W20
legacy retirement.

Deployment-agent recommendations are evidence to review, not authority over the
guide: production data may be preserved with a single new migration owner. A new DB
is used for this capture lane, not a requirement to discard existing production data.
Never take an uncoordinated raw copy of running PostgreSQL files as a valid backup;
use logical pg_dump or a verified PostgreSQL-consistent backup/restore procedure.
