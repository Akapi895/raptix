# Observability capture fix plan

**Date:** 2026-10-07
**Status:** Implemented with post-commit review corrections; verification
surfaces and remaining limitations are recorded in §7.
**Scope:** Observability only — recorder + event log + pre-flight.
Isolation/reproducibility is a separate plan.

## 0. What the verification actually found (corrections to the incident report)

The incident report listed symptoms; re-reading the current code corrects
three of them. The plan fixes the corrected version, not the literal one.

1. **The serializer has `tool_calls`, but the real framework boundary lost
   them.** Post-commit review reproduced LangChain handlers returning
   `ModelResponse(result=[AIMessage(...)])`, while the recorder read attributes
   from that wrapper as if it were an AIMessage. The correction unwraps the
   model messages, preserving content, calls, usage and structured output.
   The original direct-AIMessage unit tests did not exercise this boundary.
   Other gaps addressed by PR-A:
   - **agent label** — `_make_record(**_: Any)` discards `role`
     (`intelligence/agents/middleware_slots.py:417`), so entries cannot be
     attributed to an agent. Contrast `_make_event_log(*, role, ...)`
     (ln 434), which threads it.
   - **usage** — recorded only when the provider populated
     `usage_metadata`; there is no fallback to `response_metadata`, and an
     absent value is indistinguishable from "recorder bug". Fix is
     normalization + explicit `null`, **not** adding a second field.
   - **task-tool output** — a `Command` response (the `task` tool path) is
     serialized as the stub `{"type": "command"}`
     (`recording.py:299-301, 318-320`), dropping the entire sub-agent
     report. This is the real "missing tool_calls" symptom.
2. **events.jsonl writing no content is by design and stays.** It is a
   summary channel, and every event is mirrored to the consent-gated
   telemetry sink (`event_logging.py:_safe_append` → `_telemetry.record`).
   Adding result content would double-capture against `record.jsonl` and
   expand the telemetry redaction surface. The "every tool result is 0
   bytes" symptom is an *absence of a trustworthy full-fidelity channel*,
   fixed by PR-A — not a reason to bloat events.
3. **O6 fix goes to the reader, not the writer.** `EventLog.for_workspace`
   deliberately writes the flat `<workspace>/events.jsonl` (docstring:
   the engagement workspace root *is* the directory `shutdown.py` and the
   web dashboard read). `runtime/shutdown.py:471` agrees. Only
   `cli/export_transcript.py:61` reads the nested
   `engagements/<id>/events.jsonl` — that file is never written. Fix the
   reader.

Verified NOT broken (do not "fix" these):

- `runtime/shutdown.py` and `cli/zip.py` use the flat path — consistent
  with the writer.
- `ReplayMiddleware._Replay` reads only `kind`/`req_hash`
  (`recording.py:208-215`) — envelope additions are replay-safe. All new
  envelope fields are ignored by replay.
- T0 baseline capture explicitly runs with recording off
  (`benchmarks/suites/tool_eval/baseline/capture_assembled_baseline.py:64`) —
  frozen baseline unaffected.
- `.env` never-override semantics (`cli/auth.py:93`) is intentional
  (exported env must win). Keep semantics; add visibility only.

## 1. Root causes being fixed

| ID | Root cause | Files |
|----|-----------|-------|
| O2 | Record slot is env-gated with 3 silent failure modes; no pre-flight, no startup log, doctor blind to it | `middleware_slots.py`, `recording.py`, `cli/auth.py` |
| O3 | Recorder role-blind; Command responses stubbed; usage ad-hoc; per-instance seq collides across agents | `recording.py`, `middleware_slots.py` |
| O4 | Sink write happens after handler with no try/except → capture failure can replace a live tool result with an error ToolMessage; no lock/fsync; sink never closed | `recording.py` |
| O5 | Orphan `tool.call` on handler exception (no finally); no run-start anchor; `_safe_append` swallows everything silently | `event_logging.py` |
| O6 | `export-transcript` reads `engagements/<id>/events.jsonl`; writer writes flat `<workspace>/events.jsonl` | `cli/export_transcript.py` |
| O7 | Nothing ever sets `active_objective_id`; RoE ledger (roe.py:454,553,600) and recorder read `""` forever | `middleware/dispatch.py` |

Non-goals (deliberate):

- No tool-result content in `events.jsonl` (see §0.2).
- No heartbeat subsystem — `llm.call`/`llm.response` pairs already bracket
  long gaps; revisit only with evidence.
- No rotation, no fsync by default, no change to `.env` override semantics.
- No migration of existing artifacts; readers tolerate both old and new
  envelope shapes.

---

## 2. PR-A — Recorder fidelity and fail-safety

**Files:** `runtime/recording.py`, `intelligence/agents/middleware_slots.py`,
`middleware/dispatch.py` (2-line stamp), tests.
**Budget:** ~300 LOC behavior.

### A1. Envelope fields on every record entry (replay-safe)

Every entry gains metadata fields; `_Replay` ignores them (it keys on
`kind`/`req_hash` only):

```json
{"kind": "model_call", "seq": 42, "req_hash": "sha256:…",
 "agent": "recon", "engagement": "lab-x", "workspace": "/workspace/lab-x",
 "objective_id": "OBJ-3", "ts": "…Z", "dur_ms": 4120, …}
```

- `agent`: thread `role` through `_make_record(*, role, **_)` →
  `RecordingMiddleware(role=role)`; fall back to
  `request.runtime.agent_name` (same ladder as
  `event_logging.py:_resolve_scope`) so plugin agents without a role kwarg
  still get a label.
- `engagement`/`workspace`: read from `request.state`
  (`engagement_name`/`workspace_path`) with the same env fallbacks as
  `event_logging.py:347-357`. Read lazily per call; never crash on missing
  state (empty string).
- `objective_id`: from `state["active_objective_id"]` — see A5.
- `ts`: ISO-8601 UTC wall clock. Replay docstring objects to wall-clock in
  *canonical hashes*; as an envelope field it does not touch `req_hash`
  (hash is computed over the request payload only) and is what an operator
  debugging a 2-of-5-capture run actually needs.
- `dur_ms`: `time.monotonic()` around `handler(request)`; report even on
  failure (see A4).

### A2. Usage normalization (do not duplicate `usage_metadata`)

Single `usage` field with provenance, `null` when genuinely absent:

```python
usage, usage_source = _normalize_usage(message)
# usage_source ∈ {"usage_metadata", "response_metadata", "absent"}
# absent  -> usage=None (never fabricate zeros)
```

- Fallback chain: `usage_metadata` → `response_metadata["token_usage"]`
  (OpenAI-style) → `additional_kwargs["usage"]` (Anthropic-style) → None.
- Keep the raw `usage_metadata` key for replay compatibility; add
  `usage`/`usage_source` alongside.

### A3. Serialize `Command` responses (kill the stub)

`_serialize_command_response(cmd)` →
`{"type": "command", "update_keys": [...], "messages": _serialize_messages(update.get("messages", [])), "dispatch_ledger": update.get("dispatch_ledger")}`.

The sub-agent report lives in `update["messages"]` — that is the payload
the stub currently destroys. Full fidelity (no size cap): recording is
opt-in, local, and the analysis channel. Note in the docstring that
`Command` entries are replayed as their recorded `ToolMessage`s only when
`_Replay` learns command support — out of scope here; replay of
`dispatch_ledger`-bearing runs is CI's problem, not capture's.

### A4. The sink must never corrupt a live run (O4)

- Wrap `handler` + `sink.write` in `try/except` such that **a capture
  failure can never propagate into the conversation**: on write failure,
  `log.warning(..., exc_info=True)` once per sink (rate-limited), set
  `self._poisoned = True`, and stop attempting writes for this sink
  (subsequent calls short-circuit to `handler(request)` only). A poisoned
  sink must never replace a tool result with an error ToolMessage — that
  is the O4 blast radius through
  `langgraph/prebuilt/tool_node.py`'s error-ToolMessage conversion.
- Keep flush-per-write; no fsync (advisory channel; document).
- Do NOT add locking: with the shared-sink registry (A6) there is one
  writer per path per process, and cross-process interleaving is bounded
  to whole-line `write()` calls (same tolerance the docstring already
  declares).
- `close()` stays for tests; runtime relies on process exit after
  flush-per-write (documented; at most the in-flight line is lost).

### A5. Stamp `active_objective_id` at dispatch (fixes RoE ledger + recorder)

Objective attribution needs a declared `ObjectiveContextState` channel and a
separate runtime state copy BEFORE invoking the child. Dispatch inserts the
validated objective into that copy; unbound tasks receive an empty value rather
than the previous objective. RoE and recording register the channel on child
graphs, including read-only specialists.

```python
child_runtime.state = {**runtime.state, "active_objective_id": context.objective_id or ""}
updates["active_objective_id"] = context.objective_id or ""
```

The parent channel is a last-joined completion cursor, with a reducer for
parallel joins. It is not the scope of parallel children: each child uses its
own validated copy. Recording a task Command takes its objective from that
Command, not the parent's previous cursor (ADR-0042).
The parent's pre-dispatch RoE row resolves the requested ID against the trusted
objective catalog. ToolCallRequest dict arguments are decoded explicitly; they
must not fall through to an empty command or stale objective.

### A6. Shared sink per resolved path + non-colliding seq

- Module-level registry `{resolved_path: _Sink}`; `RecordingMiddleware`
  instances on the same path share one sink → seq is global per run per
  process (fixes the per-instance collision the docstring currently
  apologizes for).
- `seq_base = number of lines in the file at open` so a second process
  appending does not restart seq from 0.
- Path resolution: `Path(record_path).expanduser().resolve()`.

### A7. Pre-flight: no more silent capture loss (O2)

In `_make_record`:

1. Env unset/blank → return `None` (unchanged: byte-identical stack, zero
   cost — this mode is intentional and stays silent).
2. Env set → resolve path, then **open the sink eagerly and let failures
   be loud**: wrap in a try/except that re-raises
   `RuntimeError(f"RAPTIX_RUNTIME__RECORD_PATH='{value}' is not usable: "
                 f"{original}. Fix the path or unset the variable.")`
   instead of the raw `PermissionError`/`OSError` escaping agent build.
3. On success, `log.info("recording enabled → %s", path)` once per
   process (registry hit = no duplicate log).

This converts all three silent modes into: (a) intentional off, (b)
fail-fast with the env var named, (c) a startup line proving capture is
live. The stale-path auto-`mkdir` (`recording.py:166`) stays — it is
correct for `<workspace>/record.jsonl` created before the directory
exists — but the path actually used is now visible in the startup log.

### A8. Doctor visibility

`cli/auth.py` gains a **runtime capture** row in its existing inventory:
`record path: off` / `→ <path> (writable ✓)` / `→ <path> (UNWRITABLE: …)`.
Read-only introspection reusing A7's resolver; no behavior change to auth.

### Tests (extend `tests/unit/runtime/test_recording_internals.py`,
`tests/unit/middleware/test_event_logging.py` is untouched here)

- envelope fields present on model+tool entries; `_Replay` round-trip
  unchanged (existing tests must pass unmodified — they are the
  compatibility guarantee).
- usage fallback chain (3 providers + absent → null).
- Command serialization contains `update["messages"]`.
- sink write failure → handler result returned unchanged, warn
  rate-limited, subsequent calls short-circuit (poisoned).
- two middlewares on one path share seq (no collision).
- `_make_record` bad path → RuntimeError naming the env var; unset → None.
- dispatch stamp: `task(...)` Command update carries
  `active_objective_id`; RoE sink row shows it (reuse
  `tests/unit/middleware/test_roe.py:1194` fixture pattern).

---

## 3. PR-B — Event-log integrity

**Files:** `middleware/event_logging.py`, `runtime/event_log.py` (marker
event type only), `cli/export_transcript.py`, `telemetry/sanitizer.py`,
tests. **Budget:** ~150 LOC behavior.

### B1. No orphan `tool.call` (O5)

`wrap_tool_call`/`awrap_tool_call`: handler failures emit
`tool.result {"tool": name, "status": "exception"}` before re-raising.
Async cancellation also emits the terminal half with `status=cancelled` before
propagating `CancelledError`. Trajectory hooks run only for actual responses.
Existing pair-ordering tests
(`test_tool_call_writes_call_then_result_pair`) must keep passing.

### B2. Run-start anchor

Emit one `agent.session.start {"agent": role}` per
`(workspace, engagement)` scope when the middleware first opens its
`EventLog` (reuse the `_context` cache miss at ln 375-389). Add the
`AGENT_SESSION_START = "agent.session.start"` EventType next to the
existing engagement lifecycle types (`runtime/event_log.py:90-92`) and to
the sanitizer's known-events list (`telemetry/sanitizer.py:28` pattern).
This gives every `events.jsonl` a first line instead of starting
mid-stream, without a heartbeat subsystem.

### B3. Reader/writer path agreement (O6)

`cli/export_transcript.py:61`: resolve the events file as
`<workspace>/events.jsonl` (what the writer and `shutdown.py:471`
produce), falling back to the legacy `engagements/<id>/events.jsonl` if
the flat file is absent (shared-root deployments that pre-date the flat
convention). Update the docstring that currently asserts the nested path.

### B4. `_safe_append` warning budget

Keep swallow-on-failure (correct: logging must never break the run) but
rate-limit the warning per (event_type, path) — today a broken sink
warns on every single event for the whole run, drowning the log.

### Tests

- handler raises → `tool.call` + `tool.result(status=exception)` pair,
  exception still propagates.
- scope open → exactly one `agent.session.start` (cache-hit emits none).
- export-transcript renders a flat-path log; legacy nested fallback.
- warning rate-limit: 100 failed appends → ≤1 warning.

---

## 4. PR-C — Harness capture pre-flight (the 2-of-5 evidence)

**Files:** `tests/local/harnesses/lab_run.py`, `lab_collect.py`.
**Budget:** ~80 LOC.

1. **Port default**: `--langgraph-url` default `http://localhost:2400`
   (ln 218) → `http://localhost:2024` (compose `docker-compose.yml:370,384`).
   Mode-C runs (API dead from turn 0) currently produce a silent empty
   trace.
2. **Pre-flight probe**: before turn 1, `GET {url}/ok` (the compose
   healthcheck endpoint); on failure, abort with an actionable message
   naming the URL and `docker compose up langgraph`.
3. **Failure markers in trace/**: every capture channel (model_calls,
   tool_calls, workspace copy, container logs) writes an explicit
   `trace/capture/<channel>.status` file (`ok` / `failed: <reason>` /
   `absent`), so a post-mortem never has to infer "missing" vs "never
   captured" from absence. The honest `DERIVED from message diffs` note
   stays in the manifest; add `api_reachable` + per-channel status next
   to it.

Post-commit correction: create input directories before archiving protocol
files, initialize every capture marker before pre-flight, and persist the
manifest in a `finally` even when pre-flight refuses the run. Failed
`docker logs` return codes are capture failures, not successful containers.

---

## 5. Acceptance criteria (maps 1:1 to the four evidence items)

| Evidence item | Acceptance |
|---|---|
| events.jsonl redacted (0-byte tool results) | Accepted as by-design; the record path is now proven at startup (A7 log), doctor-visible (A8), and harness-preflighted (C2). No schema change to events.jsonl. |
| record.jsonl missing tool_calls/usage/agent-label | Every entry carries `agent`/`engagement`/`objective_id`; usage normalized with explicit provenance and `null`-when-absent; `task` tool reports serialized instead of stubbed. Replay round-trip tests pass unchanged. |
| 2/5 runs missing capture | Harness probes the API and marks every channel's capture status; recorder fails fast with the env var named instead of no-op'ing. |
| objective_id empty in RoE ledger | `dispatch.py` stamps `active_objective_id` into the Command update; RoE ledger rows and record envelope both carry it. |

## 6. Risks

- **Envelope growth** inflates record.jsonl (~200 bytes/entry). Accepted:
  opt-in, local, full-fidelity channel.
- **Fail-fast changes agent-build behavior** when the env var is set
  wrongly. Deliberate: the alternative is the 2-of-5 incident. The error
  names the fix.
- **`usage` fallback heuristics** can mislabel provider shapes. Mitigated
  by `usage_source` provenance + golden tests per provider family; absent
  stays `null` (never guess).
- **Command serialization** may duplicate large sub-agent reports into
  record.jsonl. Accepted (same rationale as envelope growth); the
  `update_keys` field keeps orientation cheap.

## 7. Post-commit review verification

- `test_recording_framework.py` runs compiled LangChain graphs against a
  deterministic model, exercising real ModelResponse and task Command shapes.
- Objective checks cover child input, parent channels and task record attribution;
  the scalar parent cursor does not claim to identify every parallel branch.
- `test_event_logging.py` covers cancellation propagation with a terminal tool
  event, in addition to ordinary handler failures.
- `test_lab_run_flow.py` exercises the CLI entry point, turn loop, actual output
  files and refusal markers with bounded API/Docker transport stand-ins.
- These are mechanism checks; they do not claim a live external-provider lab
  benchmark or a rebuilt full Compose engagement.
