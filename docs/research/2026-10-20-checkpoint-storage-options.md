# Checkpoint storage options for the Raptix LangGraph runtime

Date: 2026-10-20
Status: research only. No code, settings, containers or database rows were changed.

## 1. Question and requirements

Question: find a way to store LangGraph checkpoints more efficiently than the current one, without losing:

1. Restore: resume a conversation after reload, and after a run is interrupted for tool approval (HITL) or an ask_user question.
2. Replay: re-run or inspect earlier steps of a run.
3. Branching: fork a new line of execution from an earlier checkpoint.

Headline result: the slow `/state` read is not caused by size alone. It is caused by one `DeltaChannel` (`files`, from deepagents) whose snapshot never fires, so every read walks the whole ancestor chain and decodes every full checkpoint on it. A one-line runtime setting change (`LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT`) is the smallest safe first step and keeps all three requirements.

## 2. Current facts (with evidence)

### 2.1 Deployment

- Runtime: `langgraph dev` in container `raptix-web-raptix-web-runtime-1`, started with `--allow-blocking` and `--n-jobs-per-worker 10` (`D:\.VTNet\redteam\raptix\docker-compose.web-runtime.yml`, the `web-runtime` service `command`).
- Custom checkpointer wired by `langgraph.json`: `"checkpointer": {"path": "./packages/raptix/raptix/interfaces/api/checkpointer.py:sqlite_checkpointer"}`.
- `packages/raptix/raptix/interfaces/api/checkpointer.py` opens `AsyncSqliteSaver.from_conn_string(...)` at `RAPTIX_CHECKPOINT_PATH` or `.langgraph_api/checkpoints.sqlite`, then calls `setup()`.
- Installed versions in the runtime venv (`/app/.venv`): langgraph 1.2.4, langgraph-api 0.10.0, langgraph-checkpoint 4.1.1, langgraph-checkpoint-sqlite 3.1.1, langgraph-runtime-inmem 0.30.0, deepagents (version not recorded in this report).
- The runtime image is built from `D:\.VTNet\redteam\raptix\infra\containers\langgraph.Dockerfile`.

### 2.2 Storage shape (read-only SQLite inspection)

Command (run with `mode=ro`, no writes):

```
sqlite3 file:/app/.langgraph_api/checkpoints.sqlite?mode=ro  (via /app/.venv/bin/python -I, stdin script)
```

Schema:
- `checkpoints(thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint BLOB, metadata BLOB)`, PK (thread_id, checkpoint_ns, checkpoint_id). No blob table.
- `writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value BLOB)`.
- Source of this schema: `langgraph/checkpoint/sqlite/aio.py` `setup()` (installed file, around lines 305-345).

Totals:
- `checkpoints`: 3057 rows in total. `writes`: 5562 rows in total (`msgpack` 3146, `null` 2416).
- Thread `64d9f776-db6c-4129-820e-c95d0961d0e6` (execution thread): 2927 checkpoint rows, 927,314,962 bytes total, average 316,814 bytes, max 2,069,940 bytes, min 806 bytes. Writes for this thread: 5192 rows, 6,985,037 bytes.
- Thread `baab51f9-4e37-4ce5-8fb4-9b45251e6519` (planning thread, graph `soundwave`): 115 checkpoint rows, 30,858,291 bytes (average 268,333 bytes). Writes: 332 rows, 595,277 bytes.
- DB file: `/app/.langgraph_api/checkpoints.sqlite` 975,355,904 bytes, plus a 1,998,232-byte WAL.
- Writes are small. The growth is entirely full-state copies in `checkpoints`.

### 2.3 What one checkpoint contains (latest checkpoint of the execution thread, decoded read-only)

- Latest checkpoint id `1f1cc570-b2bd-66b7-8291-14c1d9ca1474`, step 657, 1,302,658 bytes (msgpack).
- Decoded channel sizes (encoded bytes):
  - `messages`: list of 233 messages, 607,454 bytes (stored as a plain list, not a delta).
  - `subagent_transcripts`: list of 500 entries, 657,328 bytes (capped by `reduce_concat_transcript`, `packages/raptix/raptix/middleware/state_reducers.py`, `TRANSCRIPT_CHANNEL_LIMIT = 500`).
  - `objectives` 27,979; `dispatch_ledger` 4,349; `kg_summary` 888; all others under 100 bytes each.
- `files` is NOT present in this checkpoint's `channel_values` (its version is recorded in `channel_versions`).
- Parent-chain walk of 70 rows from the latest (read-only): `messages` is a plain `list` in every row (lengths 233 down to 208). It is never a `_DeltaSnapshot`.

Consequence: every checkpoint carries the full message list and the full transcript list. Total storage is roughly O(steps x state size).

### 2.4 Branch structure

SQL on IDs and parent pointers only (no blob decode):
- 2927 rows, 16 roots (no parent in the thread), 16 leaf heads, 0 branch points (no node with more than one child). So the execution thread contains no forks, only 16 linear chains.
- Chain from the latest head: 658 rows, 566.6 MB.
- The other 15 chains: 2269 rows, about 361 MB, not reachable from the latest head. They are still reachable by checkpoint id through the history API.

### 2.5 Latency measurements

- From inside the runtime container (`docker exec raptix-web-raptix-web-runtime-1 curl -s -o /dev/null -w ... http://localhost:2024/threads/<id>/state`), three runs on the execution thread: 3.57 s, 2.07 s, 2.47 s. Body size 1,343,444 bytes (HTTP 200).
- Planning thread `/state`: 0.64 s, body 519,160 bytes.
- `/ok` health: 0.001 s.
- The port is not published to the host, so the timings are from inside the container. Host-side timings from the earlier session (about 2 s and 14.5 s for six concurrent reads) are consistent with these.

### 2.6 Where the ~2 s goes (root cause)

Measured with an in-process, read-only script (`AsyncSqliteSaver` opened via aiosqlite with `mode=ro`, `setup()` skipped because it writes, real compiled raptix graph imported from `raptix.intelligence.agents.standard.raptix`):

- `aget_state` on the execution thread: 2.83 s (first run), 1.30 s and 1.44 s (warm).
- `aget_tuple` alone: 0.004 s.
- cProfile of one `aget_state` (1.89 s total): `Pregel._aprepare_state_snapshot` 1.743 s, of which `achannels_from_checkpoint` 1.742 s, which calls `SqliteSaver.aget_delta_channel_history` 1.742 s. Inside it, `step_walk_with_row` 1.739 s, `loads_typed` (671 calls) 1.657 s, `ormsgpack.unpackb` 1.656 s with 91,002 ext-hook calls.
- Per-channel delta history for `files` on the latest checkpoint (read-only, `AsyncSqliteSaver.aget_delta_channel_history`): 1.33 s to 1.76 s, 670 blobs deserialized, 565.3 MB of blob bytes, loads 1.22 s, `seed` absent, 13 write rows returned.
- Compiled raptix graph `DeltaChannel` channels (introspected from `rmod.graph.channels`): exactly one, `files`, `snapshot_frequency=50`, reducer `_file_data_delta_reducer`.
- Source of the channel: `deepagents/middleware/filesystem.py` line 310: `files: Annotated[NotRequired[dict[str, FileData]], DeltaChannel(_file_data_delta_reducer, snapshot_frequency=50)]`. Docstring line 311 says "snapshots every ~50 pregel steps to bound read depth".
- `messages` in raptix is not a DeltaChannel (only `files` is). The deepagents `AgentState` in `deepagents/graph.py` line 66 declares `messages` as a DeltaChannel, but raptix's compiled graph does not use it. The stored thread was written with plain `messages` (see 2.3).

Mechanism (verified in source):
- `langgraph/pregel/_checkpoint.py` `achannels_from_checkpoint` (around line 187) asks the saver for delta history for every DeltaChannel whose value is not stored at the target checkpoint.
- The SQLite saver walks ancestors until it finds a stored value for that channel (`langgraph/checkpoint/sqlite/_delta.py`, `step_walk_with_row`, which deserializes each on-path blob).
- `_DeltaSnapshot` is written only when `delta_channels_to_snapshot` decides so (`langgraph/pregel/_checkpoint.py` lines 37-56): when the channel's update count reaches `snapshot_frequency` (50 here) OR the superstep count since last snapshot reaches `DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT`.
- `langgraph/_internal/_config.py` lines 32-34: that bound defaults to 5000 and is overridable with env `LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT`.
- The latest checkpoint metadata has `counters_since_delta_snapshot: {'files': [10, 656]}`: 10 updates and 656 supersteps since the last snapshot. Neither threshold is reached (50 updates, 5000 supersteps), so no `files` snapshot exists anywhere in the chain. The walk therefore runs to the root on every read.
- Each new superstep adds one row to the path, so `/state` cost grows linearly with thread age (path 658 rows today).
- Offline check of the snapshot decision (read-only, pure function call): with default bound 5000, `delta_channels_to_snapshot({'files': ch}, {'files': (10, 656)})` returns an empty set. With `LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT=100` it returns `{'files'}`.

Other contributing costs (verified in source):
- `aget_state` runs `checkpointer.aget` once more as a prefetch (`langgraph_runtime_inmem/ops.py` around lines 1554-1562), so the latest blob is decoded twice (about 0.16 s each in isolation, measured 0.159 s).
- The adapter does not override `aget_delta_channel_history` (`langgraph_api/_checkpointer/_adapter.py`, class `_CustomCheckpointerAdapter`, lines ~95-245). Calls use the base implementation in `langgraph/checkpoint/base/__init__.py` lines 651-690, which walks `aget_tuple` once per ancestor. Same asymptotics, unverified constant factor.
- Serialization and response are not the bottleneck: `json_dumpb` (`langgraph_api/serde.py`, around line 166) uses orjson, and `default` calls `model_dump` only for the 233 message objects.
- Concurrency: `AsyncSqliteSaver.aget_tuple` calls `self.serde.loads_typed(...)` synchronously inside the async function (`langgraph/checkpoint/sqlite/aio.py` around line 346+). Decoding blocks the event loop, which explains why concurrent reads serialize. Inferred from source and the earlier six-read measurement; not profiled under concurrency.

Conclusion: the 2 s `/state` latency is determined by the `files` DeltaChannel reconstruction walk (about 1.2 to 1.7 s of blob decoding per call). Size reduction alone would reduce the constant factor but not the O(path) growth. The fix that removes the growth is making `files` snapshot regularly.

### 2.7 Other facts checked

- The raptix state `messages` plain channel and `subagent_transcripts` are both full copies in every checkpoint: O(steps x size) total.
- Compression: no built-in checkpoint compression in `langgraph/checkpoint` (no matches for `compress|zstd|gzip|lz4`). There is an `EncryptedSerializer` (`langgraph/checkpoint/serde/encrypted.py`), which is encryption, not compression.
- Measured compressibility of the last 40 checkpoint blobs of the execution thread (per blob, read-only): raw 81.4 MB, zlib level 6 17.0 MB (4.78x), lzma preset 3 10.4 MB (7.79x).

## 3. How LangGraph checkpoints work (source citations)

All paths are relative to the runtime venv `/app/.venv/lib/python3.13/site-packages/` (langgraph 1.2.4, langgraph-checkpoint 4.1.1, langgraph-checkpoint-sqlite 3.1.1, langgraph-api 0.10.0, deepagents). Local repo mirrors are not used.

- `langgraph/checkpoint/base/__init__.py`
  - `class Checkpoint(TypedDict)` (line 92): `channel_values` holds the values of channels at that point, `channel_versions` the version per channel, `versions_seen`, `updated_channels`.
  - `class CheckpointTuple` (line 139): `config`, `checkpoint`, `metadata`, `parent_config`, `pending_writes`.
  - `class BaseCheckpointSaver` (line 176). Methods: `put`/`put_writes` (277, 300), `delete_thread` (320), `delete_for_runs` (331), `copy_thread` (350), `prune` (374, `strategy` "keep_latest" or "delete"), async versions (417-580), `get_delta_channel_history`/`aget_delta_channel_history` (582, 651).
  - Docstring warnings in `delete_for_runs`, `copy_thread` and `prune` (lines ~331-416) spell out DeltaChannel-aware rules: a naive keep-latest prune can silently reconstruct delta channels as empty. Safe options are to keep ancestors up to the nearest `_DeltaSnapshot`, force a snapshot on kept heads before pruning, or skip pruning for delta threads.
  - `get_delta_channel_history` default implementation walks `get_tuple` plus `parent_config`, one ancestor at a time (lines 582-649).
- `langgraph/channels/delta.py`
  - `class DeltaChannel` (line 25). Stores only a sentinel for non-snapshot steps (`checkpoint()` returns `MISSING`, around line 186-200), reconstructs by replaying ancestor writes through the reducer (`replay_writes`), and takes snapshots per `snapshot_frequency`.
  - `from_checkpoint` (around lines 134-150): a plain stored value is used directly, which is the migration path from BinaryOperatorAggregate blobs.
  - Beta warning in the class docstring (lines ~26-35).
- `langgraph/pregel/_checkpoint.py`
  - `delta_channels_to_snapshot` (37-56) and snapshot write (73-108).
  - `achannels_from_checkpoint` (around 187-225): the delta-history walk on read.
- `langgraph/pregel/_loop.py`
  - Exit-mode persistence (around 1296-1312): with `durability="exit"` the checkpoint and writes are persisted on exit, including when an exception (such as an interrupt) propagates.
  - `do_checkpoint` (around 1117): with durability other than exit, a checkpoint is written each step.
- `langgraph/types.py` line 87: `Durability = Literal["sync", "async", "exit"]` and docstring (lines 87-93): `sync` persists before the next step, `async` persists while the next step runs, `exit` persists only on graph exit. Default is `"async"` (`langgraph/pregel/main.py` lines 2573-2574).
- `langgraph/pregel/main.py`
  - `aget_state` (1434): loads `aget_tuple` then `_aprepare_state_snapshot` (1266).
  - `aget_state_history` (1531).
- `langgraph/checkpoint/sqlite/aio.py`
  - `setup` (305-345): writes (CREATE TABLE, PRAGMA journal_mode=WAL). Not safe on a read-only analysis path.
  - `aget_tuple` (346): reads the latest checkpoint or a given id, then pending writes.
  - `adelete_thread` (602): deletes all rows of a thread. No `aprune`, no `adelete_for_runs`, no `acopy_thread`.
  - `aget_delta_channel_history` (622): SQLite override of the walk.
- `langgraph/checkpoint/sqlite/_delta.py`: the two-stage walk. `step_walk_with_row` deserializes each on-path blob and stops when every requested channel has a seed.
- `langgraph_api/_checkpointer/_adapter.py`
  - `CheckpointerCapabilities.from_type` (around 79-93): detects overrides of `aget_iter`, `adelete_thread`, `adelete_for_runs`, `acopy_thread`, `aprune`.
  - `get_checkpointer` (around 257-332) logs the warnings: no `adelete_for_runs` (rollback does not clean up), no `acopy_thread` (fallback), no `aprune` (keep_latest not supported, storage grows without bound).
  - `aprune` (222-240): if capability missing, `keep_latest` raises `RuntimeError`.
- `langgraph_runtime_inmem/ops.py`
  - `Threads.State.get` (1502-1560): prefetches `checkpointer.latest_iter = await checkpointer.aget(config)`, then `graph.aget_state`.
  - `Threads.prune` (1323): `keep_latest` is rejected in the in-memory runtime; `delete` is supported.
- `langgraph_api/api/threads.py`
  - `prune_threads` (461-487): `POST /threads/prune` with strategy `delete` or `keep_latest`, delegating to `Threads.prune`.
- `langgraph_api/schema.py` lines 235-236 and `langgraph_api/stream.py` lines 167-173: run payload accepts `durability` (`"sync"|"async"|"exit"`) and legacy `checkpoint_during`.
- `langgraph_api/config/__init__.py` line ~363: `LANGGRAPH_THREAD_TTL` (thread-level TTL sweep, `langgraph_runtime_inmem/ops.py` `sweep_ttl`, around line 1493). Not evaluated further; it deletes whole threads.
- Restore after interrupt: the interrupt is persisted as pending writes in the `writes` table plus the checkpoint, and `Command(resume=...)` resumes from the checkpoint. Raptix's `langgraph.types.interrupt` use (`packages/raptix/raptix/execution/tools/interaction/ask_user.py`) and HITL (`packages/raptix/raptix/middleware/hitl.py`) depend on this. Verified only at the source level, not by running a resume.
- Fork: `update_state` with a `checkpoint_id` creates a child of that checkpoint. In the SQLite saver it is an `aput` with `parent_checkpoint_id` (`langgraph/checkpoint/sqlite/aio.py` `aput`, around line 509). The chain is the parent pointers, so pruning or snapshotting must keep those ancestors.

## 4. Options

Each row: what it changes, which requirements it keeps or breaks, expected effect on DB size and `/state` latency, migration risk. Effects marked "measured" come from this report; the rest are estimates and are marked unverified.

| # | Option | What changes | Restore | Replay | Branch | Size effect | `/state` effect | Migration / risk |
|---|---|---|---|---|---|---|---|---|
| A | Lower the DeltaChannel snapshot bound: set `LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT` (for example 100 or 200) in the `web-runtime` environment, then restart the runtime | New checkpoints write a `_DeltaSnapshot` for `files` every N supersteps. Reads for that channel stop at the nearest snapshot. No change to stored data. | Kept | Kept | Kept | Adds one small `files` snapshot per N supersteps (files is small, so negligible). Does not shrink existing rows. | Large and direct. Read walk for `files` becomes at most N ancestors (measured today: 670). Growth stops. Expected from the measured per-blob decode cost (about 1.8 ms per blob, measured): roughly 0.1 s instead of about 1.3 s for N=50 to 100 (estimate, unverified end to end). | Low. One env var, forward only, no DB write. Verify on the execution thread with one `/state` timing before and after. Note the bound applies to all DeltaChannels in the runtime (only `files` in the raptix graph today). |
| B | Compress checkpoint blobs in the repo's `checkpointer.py` with a custom serde that wraps `JsonPlusSerializer` (new type tag such as `zlib+msgpack`, dispatching on type in `loads_typed`) | Blob bytes only; schema unchanged | Kept | Kept | Kept | Measured 4.8x (zlib 6) and 7.8x (lzma 3) per blob on recent checkpoints. Cross-row redundancy not exploited, so real gains could be higher with delta encoding. | Small or negative (decompression on every read; not measured). Mainly saves disk and I/O. | Medium. Old rows keep type `msgpack` and stay readable if dispatch is by type tag. Must confirm the dev server's serde path (adapter, unpack hooks) uses the saver's serde unchanged (unverified). Needs a test that reads an old and a new row. |
| C | Prune or compact history (implement `aprune` on a custom saver, or delete old chains) | Removes ancestors of retained heads, or removes whole dead chains | Kept only if every kept head keeps its path to the nearest snapshot (base docstring lines ~374-416) | Broken for pruned steps | Broken for pruned fork points unless the fork points are kept | Could drop the 361 MB in the 15 non-latest chains, or most of the latest chain if only the last N steps are kept. | Shorter walk only if snapshots exist (use with A). | High. Destructive. Needs an owner decision on which history must stay. The base docstring warns that a naive keep-latest silently empties delta channels. `POST /threads/prune` with `keep_latest` already fails for this saver (adapter `aprune`). |
| D | Per-run durability `exit` (set `durability: "exit"` in run creation from `apps/web/server/src/services/runtime/run-service.ts`, which currently does not send durability) | Only one checkpoint is written per run, at exit | Kept, including after interrupt (source: `_loop.py` ~1296-1312 persists on exception). Needs a test. | Broken for intermediate steps; only run boundaries remain | Broken for forks from mid-run steps; forks from run boundaries still work | Rows drop from one per superstep to about one per run (run count unverified). | Shorter chains, so `/state` improves, but only proportionally to the row reduction. | Medium. A process crash mid-run loses the in-flight run. The UI may show per-step history (unverified). Set per run, so easy to roll back. |
| E | Move large data out of the graph state: keep message bodies and transcripts in a durable sidecar store keyed by message/transcript id; state keeps ids and small summaries | `messages` and `subagent_transcripts` stop being copied into every checkpoint | Kept if the sidecar is durable and append-only | Kept (references are immutable) | Kept (forks share sidecar entries) | Per-checkpoint state drops from about 1.3 MB to small (estimate from channel sizes in 2.3). | Large. Blobs stop being the cost. | High. Raptix orchestration (`packages/raptix/raptix/middleware/`, `intelligence/agents/`) reads `messages` every model call, so rehydration is needed on each turn. Existing threads keep their old values. |
| F | Make `messages` a DeltaChannel (deepagents style, `_messages_delta_reducer`, `snapshot_frequency` around 50) | `messages` stored as deltas plus snapshots | Kept (plain stored values are a supported migration seed, `delta.py` `from_checkpoint`) | Kept | Kept | Removes the O(steps x 233 messages) copies. | Reads walk at most one snapshot interval of writes, plus the snapshot decode. Needs A-style snapshotting too. | Medium-high. `langgraph.graph.message._messages_delta_reducer` is marked experimental (`langgraph/graph/message.py` lines ~247-270). Reducer semantics for `RemoveMessage` and ids must be checked. Changes orchestration state. Not tested. |
| G | Move from the dev server to the production runtime with a Postgres saver (`langgraph-api` Postgres deployment) | Different runtime and saver | Kept (per base docs, Postgres overrides the delta walk, unverified here) | Kept | Kept | Depends on the saver; no per-blob dedup in the SQLite path | Likely better concurrency (no event-loop decode in SQLite path, but decode cost stays) | High. Not the deployed setup. Out of scope for a first step. Not verified in this environment. |
| H | Checkpoint frequency tuning beyond D (for example per-node durability) | Not supported as a per-node setting in this version (only run-level `durability`); unverified | - | - | - | - | - | Not recommended. |

Notes:
- Options A and B are independent and compose. A removes the growth in read cost; B shrinks the bytes that remain.
- Option A does not remove the `messages` and `subagent_transcripts` full copies. Those keep DB growth at O(steps x state size) until E or F is done.
- Option C is the only way to reclaim the existing 927 MB. It is destructive and needs a decision.

## 5. Recommendation

Smallest safe first step (no DB write, reversible, keeps all three requirements):

1. Set `LANGGRAPH_DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT` to a small value (100 is verified to fire for the current counters; 50 matches the channel's own frequency) in the `web-runtime` service environment in `docker-compose.web-runtime.yml`, and restart the runtime. The change is an env var only; the code is not edited.
2. Measure `GET /threads/64d9f776-db6c-4129-820e-c95d0961d0e6/state` before and after, from inside the container, three runs each. Expect the `files` walk to stop at the first new snapshot (within about 100 supersteps).
3. Keep the old history. Do not prune until the owner decides on C.

Then, in order of value and risk:
- B (compression in `checkpointer.py`), with a read test on old and new rows. Lowers disk use and I/O.
- E or F (stop copying `messages` and transcripts into every checkpoint). This is the real fix for DB growth. It is a design change to raptix orchestration and needs its own plan.
- C only with an explicit owner decision about which history must be retained. The 15 non-latest chains (about 361 MB) are the easiest candidates to examine first, but only the owner can say whether they are needed.

Do not rely on D alone: it reduces rows but leaves the `files` walk growth in place, and it loses mid-run replay and fork.

## 6. Open questions for the owner

1. Is the `files` channel used by raptix at all? The sandbox provides `/workspace`. If `files` is vestigial, dropping it from the state (or overriding it to a plain channel with a one-time migration) is an alternative to A. Unverified: reconstructed `files` content was not checked.
2. Do any UI or API consumers read `GET /threads/{id}/history` or fork from older checkpoints? That decides whether C can drop anything. The 15 non-latest chains: what produced them (16 roots suggest 16 restarts or separate thread-level runs)?
3. Is the runtime expected to move to a Postgres deployment? That changes the choice between B and G.
4. Which run payloads currently set `durability`, and does the web UI depend on per-step history? (Needed before D.)
5. Accept a restart of the runtime container for the env change in step 1?
6. What is the acceptable worst-case thread length? With A the read cost stays bounded per superstep, but total storage still grows with steps x state size until E or F.

## 7. Sources

Primary, installed in the runtime container (read-only):
- `/app/.venv/lib/python3.13/site-packages/langgraph/checkpoint/base/__init__.py` (Checkpoint 92; CheckpointTuple 139; DeltaChannelHistory 149; BaseCheckpointSaver 176; delete_thread 320; delete_for_runs 331; copy_thread 350; prune 374; get_delta_channel_history 582; aget_delta_channel_history 651)
- `/app/.venv/lib/python3.13/site-packages/langgraph/checkpoint/sqlite/aio.py` (setup 305; aget_tuple 346; aput 509; adelete_thread 602; aget_delta_channel_history 622)
- `/app/.venv/lib/python3.13/site-packages/langgraph/checkpoint/sqlite/_delta.py` (DELTA_STAGE1_SQL, step_walk_with_row)
- `/app/.venv/lib/python3.13/site-packages/langgraph/channels/delta.py` (DeltaChannel 25; from_checkpoint; replay_writes; checkpoint returns MISSING)
- `/app/.venv/lib/python3.13/site-packages/langgraph/pregel/_checkpoint.py` (delta_channels_to_snapshot 37-56; snapshot write 73-108; achannels_from_checkpoint ~187)
- `/app/.venv/lib/python3.13/site-packages/langgraph/pregel/_loop.py` (exit persistence ~1296-1312; do_checkpoint ~1117)
- `/app/.venv/lib/python3.13/site-packages/langgraph/pregel/main.py` (durability default 2573-2574; aget_state 1434; _aprepare_state_snapshot 1266)
- `/app/.venv/lib/python3.13/site-packages/langgraph/types.py` (Durability 87-93)
- `/app/.venv/lib/python3.13/site-packages/langgraph/_internal/_config.py` (DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT 32-34)
- `/app/.venv/lib/python3.13/site-packages/langgraph/graph/message.py` (_messages_delta_reducer ~247-270, experimental)
- `/app/.venv/lib/python3.13/site-packages/langgraph/checkpoint/serde/jsonplus.py` (loads_typed 273; ext_hook ~633)
- `/app/.venv/lib/python3.13/site-packages/langgraph/checkpoint/serde/encrypted.py` (encryption only)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/_checkpointer/_adapter.py` (CheckpointerCapabilities ~79-93; _CustomCheckpointerAdapter; get_checkpointer ~257-332; aprune 222-240; aget_tuple 242)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/api/threads.py` (prune_threads 461-487; state endpoints 222-291)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/graph.py` (get_graph 351-411)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/serde.py` (json_dumpb ~166; default ~70)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/schema.py` (durability 235-236); `langgraph_api/stream.py` (167-173)
- `/app/.venv/lib/python3.13/site-packages/langgraph_api/config/__init__.py` (LANGGRAPH_THREAD_TTL ~363)
- `/app/.venv/lib/python3.13/site-packages/langgraph_runtime_inmem/ops.py` (Threads.State.get 1502-1560; Threads.prune 1323; sweep_ttl ~1493)
- `/app/.venv/lib/python3.13/site-packages/deepagents/middleware/filesystem.py` (FilesystemState.files DeltaChannel, line 310-311)
- `/app/.venv/lib/python3.13/site-packages/deepagents/graph.py` (AgentState.messages DeltaChannel, line 66; not used by raptix's compiled graph)

Repo files (read-only):
- `D:\.VTNet\redteam\raptix\langgraph.json` (checkpointer path)
- `D:\.VTNet\redteam\raptix\packages\raptix\raptix\interfaces\api\checkpointer.py` (AsyncSqliteSaver wiring)
- `D:\.VTNet\redteam\raptix\packages\raptix\raptix\middleware\state_reducers.py` (reduce_concat_transcript, TRANSCRIPT_CHANNEL_LIMIT = 500)
- `D:\.VTNet\redteam\raptix\packages\raptix\raptix\intelligence\agents\standard\raptix.py` (module-level `graph = create_raptix_agent()`, line 213)
- `D:\.VTNet\redteam\raptix\docker-compose.web-runtime.yml` (runtime command and environment)
- `D:\.VTNet\redteam\raptix\infra\containers\langgraph.Dockerfile`

Official docs:
- https://docs.langchain.com/oss/python/langgraph/durable-execution was fetched on 2026-10-20. It did not return the durability-mode definitions or interrupt semantics (the page links to Checkpointers and Stores guides). Definitions above are taken from the installed source `langgraph/types.py`. The docs were not verified for these points.

Unverified items (how to verify):
- Official definitions of `durability` and DeltaChannel semantics on the docs site: read the Checkpointers and Persistence guides from docs.langchain.com and compare with `langgraph/types.py` and `langgraph/channels/delta.py`.
- End-to-end effect of option A on `/state` latency: set the env var in a staging runtime (or restart the runtime), then time `/threads/<id>/state` before and after with a fresh run that crosses a snapshot.
- Resume after interrupt with durability `exit` (option D): run a graph with `interrupt`, exit, and resume with `Command(resume=...)` in a test thread.
- Compression read path (option B): read one old `msgpack` row and one new wrapped row through the adapter and the state endpoint.
- Whether any runtime consumer reads older checkpoints: grep the web server for `/history` and `checkpoint_id` use (not done in this report).
