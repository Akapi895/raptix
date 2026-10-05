# W05 ownership and durable intent ledger — 2026-10-02

## Delivered boundaries

Migration `20261002000000_runtime_ownership` adds:

- `EngagementThread`: globally unique runtime threadId, engagement foreign key,
  fixed assistantId/kind, contextHash and timestamps.
- `WebRequestLedger`: unique engagement/requestId intent, operation, payloadHash,
  private reservation token, thread/run IDs, creating/accepted/uncertain/rejected
  state and timestamps. A composite FK prevents linking a ledger entry to another
  engagement's thread. A nullable unique activeThreadId enforces one outstanding
  run/resume intent per thread, including accepted and uncertain requests.
- Nullable `Engagement.runtimeContextLockedAt`, set atomically with the first
  binding. Target PATCH requires draft/no legacy pointer/no context lock in the
  actual UPDATE predicate, so a concurrent planning binding cannot use stale
  target metadata. Display-name changes remain supported.

Original tables/IDs/metadata and historical migration files are preserved. Existing
Engagement.threadId pointers are not evidence of ownership and are not auto-adopted.
The scalar is not repurposed to track planning threads.

The service uses short PostgreSQL transactions and an owner-scoped engagement row
lock to serialize local binding/reservation operations. It never holds a DB
transaction across a remote operation. Database uniqueness/FKs enforce durable
invariants in addition to service checks. Binding inputs use explicit field mapping.

W05 contextHash covers engagement ID, slug, persisted target/auth, assistant and
planning/execution kind. `prepareBinding` produces the expected snapshot; binding
checks it again after the runtime adapter returns. Runtime root/mount/configuration
resolution and actual hydrated-thread comparison belong to W06. A hash is not
proof that a remote thread exists; only the trusted adapter may supply runtime IDs.

## Reservation and failure semantics

- Canonical SHA256 intent includes operation, thread, exact payload and context.
  Object key order is irrelevant; message whitespace/array order remain meaningful.
  Non-JSON values, sparse arrays, excessive nesting and payloads over64KiB fail.
  Only hashes are persisted, not user-message or resume payloads.
- First reservation returns a private token and `reserved:true`. Replays return the
  persisted recovery projection and `reserved:false`, without the token. Different
  payload/operation/thread under the same requestId conflicts409.
- Acceptance requires the winning token, owned binding and appropriate thread/run
  IDs. Repeated identical acceptance is idempotent; a different runtime identity
  conflicts. Accepted run intents retain their active slot until the caller has
  verified completion of that exact run and explicitly releases it.
- Known pre-dispatch rejection can release a creating reservation. Unknown delivery
  becomes uncertain and retains the active slot. Uncertain requests cannot be
  relabeled rejected through the pre-dispatch API.
- Startup and every30s mark creating entries older than2minutes uncertain. Sweeping
  never sends, retries, cancels or releases a runtime operation. A sweep failure is
  logged and does not prevent API liveness from starting. Future runtime service
  reconciliation must inspect owned remote metadata before resolving uncertainty.

This is durable dedup/ownership infrastructure, not an exactly-once guarantee
across PostgreSQL and LangGraph.

## Public HTTP reads

When the owned database service is configured:

- `GET /api/engagements/:id/requests/:requestId`: typed request recovery state/IDs.
- `GET /api/engagements/:id/thread-bindings/:threadId`: typed binding metadata,
  not a runtime snapshot/messages endpoint.

Both are owner scoped and `Cache-Control:no-store`; they omit tokens, payload and
context fingerprints, owner IDs and workspace paths. Invalid request identifiers
return400, non-owned bindings/engagements return404, context mismatch returns409.
Runtime creation/submission routes and capabilities are still gated for W06/W07.

## Executed gate

```powershell
npm run build --workspace=@raptix/web-contracts
npm run prisma:generate --workspace=@raptix/web-raptix-server
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-contracts
npm run typecheck --workspace=@raptix/web-contracts
node clients/web-raptix/tools/verify-w05.mjs fresh
node clients/web-raptix/tools/verify-w05.mjs oldcopy
node clients/web-raptix/tools/verify-w01-independence.mjs --w05
```

The live verifier accepts only the two explicit isolated test DB lanes on5433. It
captures existing engagement fingerprints and migration checksums, deploys owned
migrations, executes `server/tests/w05-live.ts` against PostgreSQL and Fastify, then
starts/stops/restarts the compiled API5282 and checks persisted recovery over HTTP.
Its owned API processes are shut down after each lane. No production migration,
DB reset, imported-row rewrite or remote runtime call is performed.

Both lanes passed8 assertion groups:

1. Owner-scoped immutable bindings,8 concurrent creates/one row, wrong graph/kind,
   cross-project binding and unproven legacy-pointer rejection, planning target lock.
2. Six concurrent first-binding/target-change races, with exactly one safe winner.
3. Twelve concurrent duplicate intents, one reservation winner; canonical replay,
   changed payload/operation conflict and no cross-project dispatch reservation.
4. Private-token state changes, uncertain/accepted slot retention, exact-run release,
   rejected replay and idempotent accepted identity.
5. Multiple planning/execution threads with independent slots; stale creating
   requests become uncertain while their slots remain held.
6. Two distinct simultaneous intents on one thread have one durable active winner.
7. New client instance recovers accepted identity; real HTTP read contracts deny
   foreign owners/projects, omit private values and reject fabricated submit API.
8. Out-of-band persisted target mismatch refuses existing bindings/reservations.

Separate API-process restart proof confirms creating→uncertain aging and accepted
identity retention. Runtime IDs are synthetic DB fixtures; terminal-run proof is
supplied by the test, not observed from LangGraph. Actual runtime context/execution
and reconciliation remain future gated work.

`w05-fresh.json` and `w05-oldcopy.json` record preservation hashes, checks and restart
results. The initial live test failed on the missing new column before migration.
Sparse-array fingerprint rejection was separately observed failing before its fix.

Additional regressions executed:

- Server122 tests; shared contracts31 tests; typecheck/lint/build pass.
- Clean install (legacy folder omitted), own Prisma client generation, server122
  tests and server/frontend builds pass; see w05-independence.json.
- Frontend typecheck/lint/build/test:54 passing tests,0 lint errors/38 inherited
  visual-source warnings.
- `npm run test:e2e --workspace=@raptix/web-raptix`: mock production-browser8/8 pass,
  preserving13 source tabs and zero mock-mode backend requests.
- W04 live planning lane (`npx playwright test --config playwright.planning.config.ts`
  with its dedicated DB/workspace environment):1/1 pass after the W05 migration.

The phase was implemented directly by HEAD; no agents were spawned and no commit
or staging operation was performed.
