# W07 scoped thread/run APIs — accepted 2026-10-02

## Delivered API

All resource paths are prefixed by `/api/engagements/:id` and resolve server identity:

| Method/path | Contract |
|---|---|
| POST /threads | requestId, kind, optional allowlisted assistantId; durable thread ACK |
| POST /threads/:thread/runs | requestId, exact bounded message;202 request/run ACK |
| GET /threads/:thread | sanitized bounded root-message snapshot, raw thread status |
| GET /threads/:thread/runs | owned ledger-backed run page, offset/limit<=25 |
| GET /threads/:thread/runs/:run | owned runtime identity/raw status/timestamps |
| GET /requests/:requestId | persisted creating/accepted/uncertain/rejected recovery |
| POST /requests/:requestId/reconcile | owner-scoped remote metadata recovery, no overrides |

GET reads set no-store. Snapshot labels historyScope=root_messages_only and explicit
truncation; system/tool messages, provider config/kwargs/keys and raw state are not
forwarded. Full transcript/history rendering is W09. SSE is W08; resume/cancel/HITL
actions are still separately gated. This phase does not mount the real Console UI.

## Submission and concurrency

1. Validate strict request/body/identifier allowlists; message max16000 UTF8 bytes.
2. Recover identical intent before discovery, so historical ACK survives outage.
3. Resolve W06 trusted binding/context and persisted authorization. Execution also
   requires the validated planning bundle; OPPLAN is not a prerequisite.
4. Reconcile an accepted terminal predecessor and check upstream active/interrupted
   runs. Unknown states fail closed. Only success/error/timeout release active slots.
5. Reserve the durable intent; database uniqueness gives one winning dispatcher.
6. Persist dispatch assistant/kind/full context proof and candidate thread ID before
   any remote mutation. All remote operations happen outside DB transactions.
7. Create once, validate returned identity/metadata, bind/accept and return server ACK.

Same ID/different message or operation conflicts409. A same-intent caller whose
preflight races the winning ACK gets the existing creating/accepted projection,
not a spurious active conflict. A deterministic barrier test reproduces that window.

One pending/accepted-active/uncertain submission per thread is enforced in PostgreSQL.
Opposite planning/execution flows cannot hold active submissions simultaneously in
one engagement; this check is inside the reservation transaction. This preserves
planning handoff after terminal completion rather than switching a hydrated assistant.
Interrupted runs retain their slot pending the later explicit resume policy.

## Native transport and recovery

The background REST create shape was checked against the installed SDK and live
RunCreateStateful schema. It uses assistant_id, input.messages, config.configurable,
trusted metadata/ui_request_id, canonical stream options and explicit reject policy.
The background-create API has no on_disconnect field; acknowledged background runs
continue independently of the HTTP request. GETs/listing never call runs.stream or
create another run. Mutation bodies have a15s deadline; read bodies retain5s/2MiB
limits and redirect refusal. The server declares its first-party streaming dependency.

Additive migration `20261002020000_runtime_dispatch_recovery` persists optional
candidateThreadId, dispatchAssistantId, dispatchKind and dispatchConfigHash. Existing
IDs/authority and historical migrations are preserved; no message payloads are stored.

Explicit400/404/409/422 runtime rejection marks the reservation rejected and can
release its slot. Timeout/lost or malformed ACK/local persistence failure preserves
uncertainty; no blind mutation retry occurs. Reconciliation uses only a known owned
candidate thread or owned run listing, exact ui_request_id and full metadata/context
proof. Zero matches retain uncertainty; multiple/mismatched matches conflict. A stale
worker performs bounded read-only recovery after the W05 creating→uncertain sweep.
Startup recovery is asynchronous so dependency failures do not block API liveness.

## Fresh state bootstrap

The first actual model run succeeded but its checkpoint held authorizationfalse while
configurable/metadata contained true. This is the runtime's fresh boolean reducer
default interacting with hydrate-only-if-None behavior. The failing capture is kept
in w07-hydration-failure.json. Existing false must not be upgraded automatically.

New thread creation therefore seeds trusted state through native `supersteps` at
__start__, with if_exists=raise. Only persisted owner context is seeded, only on a
new server-generated candidate; sandbox_url remains config-only. Every run still
sends CLI-parity configurable and messages-only input. No Python runtime, middleware,
RoE, SafeCommand, egress or HITL guard was modified. Reusing a mismatched existing
thread still conflicts. Decision/threat model: ADR0004 in docs/decisions.

## Executed verification

```powershell
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-contracts
node clients/web-raptix/tools/verify-w05.mjs fresh --w07
node clients/web-raptix/tools/verify-w05.mjs oldcopy --w07
node clients/web-raptix/tools/verify-w07-live.mjs
node clients/web-raptix/tools/verify-w06-live.mjs
node clients/web-raptix/tools/verify-w01-independence.mjs --w07
```

Controlled fault runner from server directory:

```powershell
# W07_TEST_DATABASE_URL: dedicated w02 test role/database on127.0.0.1:5433.
# W07_TEST_WORKSPACE: temporary opencode/raptix-w07-* folder.
# W07_EVIDENCE_PATH: selected w07-faults.json or w07-oldcopy-faults.json.
node --import tsx tests/w07-faults.ts
```

Both DB lanes passed9 groups:8 concurrent thread intents/one create,8 concurrent run
intents/one dispatch, deterministic late duplicate, lost thread/run ACK reconciliation,
interrupted slot retention, known rejection, snapshot redaction, foreign resources,
pagination/strict body, document and cross-flow handoff policy, outage replay and fresh
authorization bootstrap. Native fault provider is controlled HTTP; PostgreSQL/service
are real. A failing default-false regression preceded the bootstrap fix.

The actual-runtime gate uses compiled API5284 + dedicated PostgreSQL + LangGraph2400.
Six concurrent thread POSTs and six concurrent run POSTs produced one native thread
and one native planning run. Final raw status was success. Native run metadata and
multitask_strategy=reject were verified, owned snapshot/list returned correct IDs,
and API process restart plus duplicate POST preserved the same run ID/count. The
run requested only an acknowledgement in an isolated context fixture, not target
assessment. Its owned remote thread/workspace and API process were cleaned afterwards.

Results: server140 tests, shared contracts34 tests, frontend54 tests; typecheck/build/
server lint pass. Frontend lint0 errors/38 inherited warnings. Mock production-browser
8/8, W04 real planning-browser1/1 and W06 live context gate5 groups pass. Clean npm ci,
own Prisma generation/server140 tests/server+frontend builds pass with clients/web
omitted. Only test DB lanes were migrated; original engagement fingerprints and prior
migration checksums remain equal. W05 regression now tests independent planning slots
alongside W07's explicit cross-flow handoff guard; historical evidence files retained.

Evidence files: w07-live.json, w07-faults.json, w07-oldcopy-faults.json,
w07-migration-{fresh,oldcopy}.json, w07-independence.json, w07-hydration-failure.json,
w07-hydrated-context.json and w07-pristine-state.json. No git staging/commit occurred.
