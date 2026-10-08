# W08 scoped SSE and stream state — 2026-10-02

## Delivered boundary

`GET /api/engagements/:id/threads/:thread/runs/:run/events` resolves owner, accepted
ledger run, immutable binding and native run metadata on every attach/reconnect.
It observes the acknowledged run with native GET /stream, cancel_on_disconnect=0
and a validated Last-Event-ID. It has no create/cancel/resume code path.

Headers: text/event-stream; no-cache,no-transform; X-Accel-Buffering:no. A connected
comment and15s heartbeat keep the channel observable without changing replay IDs.
Node Readable backpressure bounds downstream buffering. Peer close aborts/cancels
only the local reader/subscription. Header handshake deadline5s and bounded2MiB SSE
framing apply. Unsafe cursor/unknown query options fail before joining the runtime.

Absent cursor defaults to native -1 (replay all resumable buffered events). Cursor
syntax is bounded opaque token, not a URL. A stream error or EOF emits an ID-less
control frame requiring recovery; it never declares execution completed/failed.

## Projection and cursor identity

- Shared incremental decoder supports network-split lines/JSON/UTF8, CRLF/bare CR,
  multiline data, heartbeat comments and explicit wire IDs. Incomplete EOF blocks
  are not invented as completed events. It never conflates inherited cursor state
  with a new event's identity.
- Fixed public event payloads cover messages, root tools, canonical custom events,
  structured questions and generic interrupts. Unknown/debug/system/provider state,
  private reasoning blocks and raw metadata/kwargs are not forwarded.
- Sensitive argument keys and recognizable credential text are redacted. Text has
  bounded previews with explicit truncation; no full output is stored in localStorage.
- Namespaces, session/tool/question identity, nullable IDs,85.125-style elapsed
  seconds, cancellation/error flags are preserved. Root task calls are delegation
  markers, not an additional child execution count.
- Values/messages/transcripts with unproven history attribution are checkpoint
  events with runId=null. streamRunId separately identifies the observed stream's
  cursor owner. Scoped live chunks/custom events carry the acknowledged run ID.
- eventId hashes native cursor+projection position/scope, or explicit domain identity;
  missing identity uses a connection occurrence key and labels limited confidence.
- If one upstream frame projects into many events, only the final event commits the
  native cursor in its SSE id/envelope. An interrupted partial frame is replayable;
  reducer event IDs discard its already received part. Heartbeat/EOF/error control
  frames have no fake cursor; ignored native frames can advance a genuine cursor-only
  control event without forwarding private data.

## Client and reducer

`features/agent-runs/observe-stream.ts` uses GET-only same-origin streaming, verifies
typed event scope/cursor identity, then refetches owned run status and root snapshot
after transport EOF/error. It reattaches active attempts using the last native cursor
with a bounded retry count. Abort never submits or cancels; unknown status still
requires recovery. The orchestration is outside React business effects.

Pure reducer stores by engagement/thread and indexes attempt status/cursors by
run ID. Message IDs upsert, deltas append and snapshots replace without appending
whole snapshots again. Parallel same-agent sessions and same-name tools keep separate
identity. Question IDs deduplicate repeat emissions; historical question attribution
is explicit. Handoff signal is live-only. EOF changes transport/recovery state only;
actual status observations decide execution outcome.

Bounds: recent events/seen IDs2000, messages500, invocations500, tools1000,
questions100, attempts100; message text32000 chars, projected preview16000 chars and
bounded argument JSON. Full live tool content is not downgraded by truncated
checkpoint replay. No agent-name-as-invocation assumption is made for missing IDs.

This is resumable observation plus normalization, not a durable full-event collector.
The runtime buffer may expire, and transcripts have their producer's checkpoint
timing/8000-char retention semantics. Full snapshot/transcript service and Console
render binding remain W09/W10, respectively.

## Executed gate

```powershell
npm run build --workspace=@raptix/streaming
npm run typecheck --workspace=@raptix/streaming
npm run test --workspace=@raptix/streaming
npm run build --workspace=@raptix/web-contracts
npm run test --workspace=@raptix/web-contracts
npm run typecheck --workspace=@raptix/cli
npm run typecheck --workspace=@raptix/web-raptix-server
npm run lint --workspace=@raptix/web-raptix-server
npm run test --workspace=@raptix/web-raptix-server
npm run build --workspace=@raptix/web-raptix-server
node --import tsx clients/web-raptix/tools/verify-w07-live.mjs --w08
node clients/web-raptix/tools/verify-w01-independence.mjs --w08
```

The PostgreSQL/controlled HTTP fault runner uses `tests/w07-faults.ts` with
W08_STREAM_GATE=1, dedicated W07_TEST_DATABASE_URL, temporary opencode workspace
containing w07, and selected evidence output. Fresh and oldcopy lanes passed10 groups.
It proves owner/cursor denial before joins, real peer disconnect/reconnect, unchanged
run-create count, cancel_on_disconnect=0, retained active reservation, bounded public
projection and all earlier W07 concurrency/ACK-loss/handoff gates.

Actual runtime gate on API5284/PostgreSQL/LangGraph2400 passed6 groups: one native
acknowledged run despite duplicate submission, attach/abort without run cancellation,
native cursor reconnect/late replay, repeat-replay message dedup, scope/cursor denial,
normal planning model success, and process restart retaining request/run identity.
Only fixture resource/workspace were created; ownership-checked cleanup completed.
Wire shape evidence records keys/types, not raw provider secrets.

Live acknowledgement run emitted metadata/values/updates. Incremental tuple messages,
parallel custom invocations, tool pairing/nullable IDs, terminal flags, structured
interrupts and transcript truncation are tested with controlled representative
producer/SDK cases; this gate does not claim a live assessment/subagent execution.

Results: streaming19 tests, contracts35, server147 and frontend60 pass; required
typecheck/build/server lint plus CLI typecheck pass. Frontend lint0 errors/38 retained
source warnings. Mock production-browser8/8 and W04 real planning-browser1/1 pass.
Clean npm ci/own Prisma generation/server147 tests/server+frontend builds pass without
clients/web. Frontend now declares its direct first-party streaming dependency.
No new migration, production data change, git staging or commit was performed.

Evidence: w08-live.json, w08-faults.json, w08-oldcopy-faults.json,
w08-independence.json. The previous W07 evidence remains separate.
