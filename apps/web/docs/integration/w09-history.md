# W09 owned checkpoint history/transcript recovery - 2026-10-02

## Delivered boundary

`GET /api/engagements/:id/threads/:thread` now returns the owned checkpoint
history projection in addition to the W07 root-message snapshot. The thread
snapshot stays scope-checked the same way: binding + trusted context resolution
happen on every read, and history adds no runtime mutation path.

`services/runtime/history-projection.ts` reads `values.subagent_transcripts`
(bounded to the most recent 500 entries) and projects each entry with the same
redaction/preview pipeline as live SSE frames (`projectCustomPayload`), so
credential-shaped argument keys are `[redacted]`, text is bounded and private
state never leaks. Producer-capped tool results ending with the runtime's
`…[truncated]` marker surface `truncated: true`; un-capped entries stay false.
Entries the producer did not persist in full mark the whole view lossy via
`transcriptsTruncated`, and a non-array channel is treated as lossy rather than
fabricating history.

## Stable thread-level attribution

Every transcript entry is `runId: null` / `source: 'checkpoint'`: the channel
accumulates opaque events across all runs of the thread and the producer
records no run identity, so nothing is ever attributed to an active run.
Provenance keys come from the shared normalizer (`session::type#id`, else
`session::type@createdAt`); entries without either keep `key: null` and remain
occurrence-ordered. Parallel-branch duplicate emissions collapse by provenance
key, and key sequences are stable across repeated snapshot fetches.

Root messages now carry `messageId` when provable (string) or explicit `null`;
unprovable identity is never invented.

## Client merge

`features/agent-runs/history-merge.ts` (`mergeThreadHistory`) is a pure merge
of one snapshot into the W08 stream state, by provenance IDs only: messages by
`[namespace, messageId]` (insert-only, never overwriting keyed live content),
tools by `[session, toolId]` with the same no-downgrade rule as the reducer
(full live content is never replaced by capped checkpoint replay; status/error/
cancelled still merge), invocations by `sessionId` (existing run attribution is
preserved; history can never set one), questions by `questionId` with the same
downgrade protection. `engagement_ready` handoff stays live-only, transport and
recovery flags are untouched, and merging the same snapshot twice is
idempotent. The W08 `bounded()` limits apply to all stores.

## Contracts

Additive: `ScopedThreadMessage.messageId?`, `ThreadHistoryEvent`
(`key/runId/source/truncated/payload`), `ScopedThreadView.transcripts?`,
`transcriptsTruncated?`. Validators accept the previous shape unchanged and
reject forged attribution (`runId` non-null, `source: 'runtime'`, unknown
payload types, transcripts without a boolean `transcriptsTruncated`).
`isPublicStreamPayload` was extracted from `isPublicStreamEvent` for reuse; its
event-level behavior is unchanged.

## Executed gate

```powershell
npm run build --workspace=@raptix/streaming      # + typecheck + 19 tests
npm run build --workspace=@raptix/web-contracts  # 36 tests
npm run typecheck --workspace=@raptix/web-raptix-server  # + lint + 154 tests + build
npm run typecheck --workspace=@raptix/cli
npm run test --workspace=@raptix/web-raptix      # 67 tests, typecheck, build, lint 0 errors
node --import tsx clients/web-raptix/tools/verify-w07-live.mjs --w09
node --import tsx clients/web-raptix/tools/verify-w07-live.mjs --w08  # regression
node tools/verify-w01-independence.mjs --w08
# Controlled lanes (server/tests/w07-faults.ts):
#   W07_TEST_DATABASE_URL=...fresh...  W08_STREAM_GATE=1 W09_HISTORY_GATE=1 -> w09-faults.json
#   W07_TEST_DATABASE_URL=...oldcopy.. W08_STREAM_GATE=1 W09_HISTORY_GATE=1 -> w09-oldcopy-faults.json
# Browser: mock production 8/8, W04 real planning live 1/1
```

Live runtime gate (API5284/PostgreSQL/LangGraph2400) passed 7 groups: real
planning run under native reject policy, snapshot history fields present and
validator-clean, provable message ids, thread-level/checkpoint-only history,
idempotent history merge over genuine replayed live events, foreign-scope
denial, and process-restart identity retention. The W08 lane was re-run
afterwards (6 groups) to prove the shared streaming regression still passes.

Controlled PostgreSQL/HTTP gates passed 11 groups per lane (fresh and oldcopy):
the history group injects representative producer transcripts (full result,
`…[truncated]`-capped result, parallel duplicate pair, secret-shaped args,
unidentifiable message) into the owned thread and proves dedup by provenance
key, correct full-vs-capped flags, redaction, thread-level attribution, stable
keys across fetches, plus foreign-scope denial. The deployed LangGraph image at
2400 does not yet expose the `subagent_transcripts` channel on GET state
(W06/W07 pristine state confirms the same), so content-level history semantics
are proven through the controlled lane exactly like W08's producer/SDK cases;
the live gate proves real-run integration, shape compatibility and merge
idempotency. No runtime/producer change was made.

Results: streaming 19, contracts 36, server 154, frontend 67 tests pass; CLI
typecheck, server/frontend lint/build pass (frontend 0 errors, retained source
warnings only). Mock production browser 8/8 and W04 real planning browser 1/1
pass. Clean install/build/test gate passes without `clients/web`. No new
migration, no production data change, no git staging/commit.

Console rendering of the recovered history is W10; question/file HITL remain
W11.

Evidence: w09-live.json, w09-faults.json, w09-oldcopy-faults.json,
w08-independence.json (rerun for W09). Previous W07/W08 evidence remains
separate.
