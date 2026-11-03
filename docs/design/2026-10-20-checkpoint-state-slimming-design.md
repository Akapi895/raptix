# Checkpoint state slimming: design for options E and F

Status: design only. Option A (snapshot bound) is applied; option E and F are not implemented.
Context and evidence: `docs/research/2026-10-20-checkpoint-storage-options.md`.

## 1. Problem and what each option fixes

Two separate problems, verified in the research report:

1. **Read latency of `/state`.** The `files` DeltaChannel (deepagents `filesystem.py:310`) never gets a snapshot, so every read walks to the root. Fixed by **A** (env `LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT`), applied in `docker-compose.web-runtime.yml`.
2. **Storage growth.** Every checkpoint copies the full `messages` channel (~600 KB, 233 messages) and the full `subagent_transcripts` channel (~650 KB at the 500 cap). Total size is O(steps × state size). Thread `64d9f776` holds 2927 checkpoints, ~927 MB. Fixed by **E** (for transcripts) and **F** (for messages). A does not touch this.

Constraint that decides the split: the model reads `messages` from graph state on every turn to build its prompt. `messages` therefore must stay in state. Only F can reduce its per-checkpoint cost. `subagent_transcripts` is written by `core/subagent_streaming.py` and read by the server (`services/runtime/history-projection.ts`, `fleet-service.ts`), but not by the model (checked with grep over `packages/raptix/raptix`). It can move out of state.

## 2. Requirements that every change must keep

- **Restore**: after reload, and after an interrupt for tool approval (`middleware/hitl.py`) or a user question (`execution/tools/interaction/ask_user.py`), the run resumes.
- **Replay**: the state at an earlier step can be read and re-run.
- **Branch**: `update_state` from an earlier checkpoint creates a new line of execution.

## 3. Option E: move `subagent_transcripts` into a sidecar store

### 3.1 Target design

- The graph state keeps only a pointer: `transcript_count` (int, the number of sidecar entries written up to this checkpoint). The `subagent_transcripts` channel and its reducer are removed.
- Each subagent event is appended to a sidecar table `transcript_events(thread_id, seq, dispatch_id, event_json, created_at)` with a unique key `(thread_id, seq)`. It lives in a SQLite file next to the checkpointer (`.langgraph_api/transcripts.sqlite`), written by the runtime process, so it is durable even when no client is connected (the existing schema docstring requires this).
- The write happens in `StreamingRunnable` (`core/subagent_streaming.py`, where `TRANSCRIPT_STATE_KEY` is set today). It replaces the state write with an append, and returns `transcript_count` as the state update.
- Reads: a new runtime HTTP route `GET /_raptix/threads/{id}/transcripts?before=<seq>&limit=<n>`, returning the newest page. The server reads it through `RuntimeReadPort` (`integrations/runtime/read-client.ts`) and replaces `values.subagent_transcripts` in `history-projection.ts` and `fleet-service.ts`.

### 3.2 Behaviour under the three requirements

- **Restore**: state is small, so `/state` is fast. The transcript view reads the sidecar newest-first, so reload shows the same history.
- **Replay and branch**: transcripts are observability, not model input. A replay or fork from an old checkpoint keeps the full sidecar, including events from the abandoned branch. This is a deliberate change of semantics: the UI must label transcript events as "all events in this thread", not "events of this checkpoint". Document it in the route's response.

### 3.3 Migration

1. Deploy the sidecar writer and the new route, keeping the old channel readable (both paths active).
2. One-off copy of the existing 500 entries from the latest checkpoint into `transcript_events`, through the state API (same method used for the trim).
3. Remove the channel and reducer after one release, once the server reads only the new route.

### 3.4 Risks

- Two sources of truth during the transition: mitigate with a single read path flag in the server.
- Sidecar growth is unbounded: add a retention policy as a separate, explicit decision (see §6), not as a side effect.
- Concurrency: sidecar writes run in the runtime event loop. Use `aiosqlite` with WAL, one connection per thread lock, and measure write latency under the six-concurrent-read test.

## 4. Option F: make `messages` a DeltaChannel

### 4.1 Target design

- Declare `messages` as a DeltaChannel with the message reducer in the raptix agent state (`middleware/subagent_transcript_state.py` already extends `AgentState`, so the same place can declare it). Reference: `langgraph.graph.message._messages_delta_reducer`, marked experimental in the installed package (verify the exact name and signature in `langgraph` 1.2.4 before use).
- Snapshot interval for `messages`: start at 50 updates (the same convention as `files`), tune by measurement.
- The existing checkpoints store `messages` as a plain list. The research report states this is a supported seed (`delta.py` `from_checkpoint`): no data migration is needed, only a new schema.

### 4.2 Behaviour under the three requirements

- **Restore and replay**: the walk for `messages` stops at the nearest snapshot, so reads stay bounded by the snapshot interval (the same mechanism as A).
- **Branch**: forks from any checkpoint still see the full history, because deltas are reconstructed from the chain.

### 4.3 Verification before any production change

1. Unit test on a toy graph with an interrupt, a resume, a replay from step k, and a fork from step k. Assert message lists are identical to a plain-channel graph.
2. Compare the two reducers on the existing thread's message list (233 messages): same final list, same ids.
3. Enable on a copy of the execution thread (not the live one), measure `/state` and per-checkpoint bytes.

### 4.4 Risks

- Experimental API: pin the langgraph version and add a test that fails on upgrade.
- Reducer semantics: the raptix graph currently appends messages from deepagents middleware (`dispatch.py` builds `ToolMessage` updates). The delta reducer must match `add_messages` semantics for ids and for replacement, or the model sees a different history. Test with the dispatch flow specifically.

## 5. Acceptance criteria

- `GET /threads/{id}/state` on the execution thread: under 200 ms with the thread at 2000+ checkpoints (current: ~2 s).
- Bytes per new checkpoint: under 50 KB average (current: ~317 KB average on this thread).
- Restore, replay and branch tests (§2) pass on a copy of a real thread.
- No change in the model's input messages for a fixed run (diff the prompt).

## 6. Decisions the owner must make

1. Retention for the sidecar `transcript_events` (for example, keep the last N events per thread, or per run).
2. Whether the `files` channel is used at all (research open question 1). If not, dropping it from state is simpler than A.
3. Whether the 15 non-latest checkpoint chains (~361 MB) are needed for replay (research open question 2). Only then is option C (pruning) possible.
4. Approve E and F implementation order: E first (lower risk, transcripts not model-visible), then F (needs the reducer test in §4.3).

## 7. Sources

- Research report: `docs/research/2026-10-20-checkpoint-storage-options.md` (sections 2.6, 4, 5).
- deepagents `files` DeltaChannel: `/app/.venv/lib/python3.13/site-packages/deepagents/middleware/filesystem.py:310` (inside the runtime container).
- LangGraph snapshot bound env: `langgraph/_internal/_config.py:32-34`, `langgraph/checkpoint/base/__init__.py:80`.
- Raptix transcript channel: `packages/raptix/raptix/middleware/subagent_transcript_state.py`, `packages/raptix/raptix/middleware/state_reducers.py` (`TRANSCRIPT_CHANNEL_LIMIT = 500`), `packages/raptix/raptix/core/subagent_streaming.py` (lines 53, 644-811).
- Server readers: `apps/web/server/src/services/runtime/history-projection.ts`, `apps/web/server/src/services/fleet-service.ts`, `apps/web/server/src/integrations/runtime/read-client.ts`.

## 8. Status and decisions (update)

- **E (sidecar for subagent transcripts)**: implemented. Runtime writes each sub-agent event to `transcript_events` in `RAPTIX_TRANSCRIPT_SIDECAR_PATH` as it streams; the state no longer carries `subagent_transcripts`; route `GET /_raptix/threads/{id}/transcripts` pages it; the server snapshot reads the newest 500. 500 legacy events of the execution thread were imported. Not yet confirmed on a live run.
- **F (delta messages)**: decided on option 1, new threads only. The graph `raptix-delta` (`intelligence/agents/standard/raptix_delta.py`) is the first execution assistant for new threads. Existing threads stay on `raptix`. Reason: seeding a plain checkpoint into a `DeltaChannel` lost data in both migration probes (mid-interrupt: tool result lost; clean boundary: newest human turn lost), independent of the reducer used. The contract test `test_raptix_delta_graph` pins that the two graphs differ only in `messages`.
- **A (snapshot bound 100)**: set in `docker-compose.web-runtime.yml`. The `files` snapshot is written at the next checkpoint write, so the latency measurement needs one real run.
