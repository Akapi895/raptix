# ADR-0034: Durable checkpoints for the local interactive web runtime

## Status

Accepted and verified locally, 2026-10-03 (IW-13).

## Context

The Docker deployment used `langgraph dev` with runtime-inmem. Recreating its
container lost checkpoints while web ownership rows remained in PostgreSQL.
That left previously used threads with empty state and no recoverable question.
During migration the dev runtime flushed its legacy checkpoint pickle files on
graceful shutdown; those files and thread metadata were retained.

Windows and Linux views of the previous `/mnt/d/...` bind also diverged. The
workspace contains legitimate Linux filenames with `::`, so copying the entire
tree into a native NTFS directory failed. Renaming these files would change
artifact paths and evidence references.

## Decision

- Use the supported LangGraph `checkpointer.path` extension with
  `AsyncSqliteSaver`, supplied by the framework's `runtime-persistence` extra.
  No framework internals are patched.
- Persist `/app/.langgraph_api` in `langgraph_state`: it holds committed SQLite
  checkpoints and the dev server's thread/run metadata files.
- Add `RAPTIX_WORKSPACE_PATH` as a common Docker mount-source override for the
  API, runtime and sandbox. This Windows deployment selects `workspace_data`,
  backed by the same `raptix_workspace_data` volume in both Compose projects.
  Existing bind defaults remain supported when the override is absent.
  The launcher's explicit `RAPTIX_ENGAGEMENT_WORKSPACE` remains higher priority
  for the runtime/sandbox so the shared-source override does not broaden a
  deliberately pinned engagement mount.
- Access the canonical workspace from the host using Docker copy/exec commands.
  Linux filenames remain unchanged. Host and container marker round-trips are
  part of the live gate.
- If a previously completed/interrupted thread has no checkpoint, return a
  scoped 503 recovery message. A new thread or an initial pending run with no
  checkpoint yet is not treated as data loss.

## Scope and recovery

SQLite is the local single-user runtime backend. The tested lifecycle is
graceful restart/recreate; this is not a hosted multi-replica database design.
The dev-server operations metadata still uses its own periodic file flush.

Before cutover, three idle thread state snapshots were saved privately under
`C:\Users\tuanp\AppData\Local\Temp\opencode\iw13-backup\`. Legacy checkpoint
pickle files were copied into the state volume, and the full Linux workspace was
copied into its new volume using a binary-safe tar stream. The old bind contents
were not deleted. Legacy pickle checkpoints are archived, not automatically
imported into SQLite; affected old chats receive the explicit recovery error.
New SQLite-backed threads are the subjects of the recreate/resume gate.

Back up both runtime and workspace volumes with the runtime stopped cleanly;
restore them together with the same application/schema revision. `down -v`
removes these volumes and is not an update command. Do not load checkpoints from
an untrusted backup. No guardrail, authorization, egress or HITL policy changes.

## Verification

- Deterministic graph test: an interrupt, two isolated threads and a resumed
  terminal state survive closing/reopening the SQLite connection.
- Server regression: completed-thread checkpoint loss returns 503; the initial
  pending-run race does not incorrectly report lost history.
- `tools/verify-runtime-durability.mjs --recreate`: 19 live checks, including
  identical question ID, execution messages/run status after runtime/API/sandbox
  recreate, UI answer/resume success and host/container artifact round-trips.
- The gate runs against the Docker entrypoint and actual model/runtime, without
  API interception. Artifacts are in
  `clients/web-raptix/test-results-deployed/iw13/`.
