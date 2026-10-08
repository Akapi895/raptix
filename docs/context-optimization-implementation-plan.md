# Context Optimization Implementation Plan

> Status: **Proposed — not yet signed off.** Wave A is implementation-ready;
> Waves B–E are sequenced after A with per-wave gates. Nothing here weakens a
> guardrail; blocking semantics need explicit sign-off (§12).
> Last updated: 2026-10-08
> Source of diagnosis: [`docs/context-optimization.md`](context-optimization.md)
> (analysis transcript) and
> [`benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md`](../benchmarks/Silentium/run-20261008-0642/analysis/CONTEXT_AUDIT.md)
> (revalidated audit). Both are analysis artifacts — **never tune thresholds
> against Silentium data**; it is a case study, not a training set.
> Tracks: Incalmo-lessons safe subset (`incalmo-lessons-implementation-guide.md`),
> tool-optimization T2/T3 contracts (`tool-optimization-implementation-plan.md`).

This plan turns the audit's three problem chains — **Context Integrity,
Context Efficiency, Autonomous Progress Control** — into sequential work
waves (A–E). Each work package (WP) is one PR, one concern, ≤400 runtime
lines, ≤10 files, with an ADR first, per
[`docs/QUALITY_BAR.md`](QUALITY_BAR.md) and
[`CONTRIBUTING_AGENT.md`](../CONTRIBUTING_AGENT.md). Every WP ships a
pasteable sub-agent brief.

---

## 1. Evidence-driven goals

The audit (revalidated 2026-10-08, branch `structure`, HEAD `be5c9db`) leaves
no ambiguity about what is broken:

| # | Defect | Evidence strength | Wave |
|---|---|---|---|
| C1 | Child summarization state (`_summarization_event`) crosses the parent–child boundary through the streaming adapter's last-state return; parent projection collapses to a foreign summary | CONFIRMED-CODE + REPRODUCED offline + observed in run | A |
| C2 | Summary offload path `/conversation_history/...` is outside the sandbox-pinned workspace; no recovery pointer is readable by the worker's own tools | CONFIRMED-CODE (fence) + missing pointer observed | A |
| C3 | Failure handling corrupts semantics: summary-generation errors become summary text; context-overflow exceptions lose their type through `_reraise_with_actionable_message`; the safe proxy re-invokes the downstream handler on any exception | CONFIRMED-CODE + REPRODUCED (overflow typing) | A |
| C4 | Unknown model context capacity + approximate counter with one-way clamp; no downward correction; factory never re-derives thresholds when the request model changes | CONFIRMED-CODE; exact bias UNKNOWN | A |
| C5 | Skill-load dedupe (`loaded_keys`) lives on the shared middleware instance, not the conversation; stale "already in context" replies after dispatch/compaction | CONFIRMED-CODE | A |
| C6 | Historical tool content accumulates and is re-shipped (bash text 40.45% of recorded characters; 73.9–85.8% in the largest requests) with fixed system-prompt overhead (28.28%) | measured (case) | C/E |
| C7 | No persistent, structured task state: a new worker cannot reconstruct objective + completed work + evidence + next actions without conversation history | CONFIRMED-CODE (only OPPLAN status exists) | B |
| C8 | No semantic-progress control: recursion/dispatch/USD limits bound steps, not progress; changing-command exploration is unconstrained | CONFIRMED-CODE; waste not quantified | D |
| C9 | Observability gaps: summary calls bypass the recorder; retry layers are invisible; cache/billing unknown; raw recorder output holds secrets | CONFIRMED-CODE | E |

`docs/architecture/context-engineering.md` remains the design intent
(progressive disclosure, observation masking, stable prefix ordering,
filesystem scratch pad). Its named mechanisms (`DockerSandbox` truncation,
StreamingEngine `/compact`) are **superseded** — the current equivalents are
the bash tool's 15K inline/offload tier and background-notification budgets
(`execution/tools/bash/bash.py:73,444-499,589-604`). Implement against the
current runtime, not the legacy doc.

---

## 2. Ground rules (repo non-negotiables)

1. **Never touch** the exploit-execution path (`execution/tools/bash/*`,
   sandbox dispatch), `SafeCommand`, RoE guardrail, `EngagementContext`,
   egress, HITL, `.semgrep/raptix-no-*` rules. Context work never relaxes
   ADR-0042's workspace fence.
2. **KG remains canonical** for engagement knowledge. New task-state files
   are *task/execution* state, not a second source of truth for findings.
3. **Post-tool hooks are fail-safe**: try/except, bounded time/bytes, return
   the original tool result unchanged. Hook failure never blocks a tool.
4. **Flag-gate everything that alters agent input or writes new state**;
   default = current behavior, documented, reversible by env.
5. **One PR = one WP**; ADR (`docs/adr/`, `Status: Proposed`) before code.
6. **Public-API discipline**: `packages/raptix-core/tests/test_public_api_stability.py`
   count bumps are deliberate, with CHANGELOG, in the same commit; core
   imports only pydantic/stdlib (`tests/test_no_runtime_deps.py`).
7. **Test lanes** (from AGENTS.md): focused =
   `uv run pytest packages/raptix/tests/path/test_x.py::test_name` or
   `make test-local ARGS="path::test"`; Python PR lane = `make ci-lint`
   then `make ci-test`; cross-stack = `make quality` / `make quality-strict` /
   `make smoke`. Replay tests use `ReplayMiddleware`
   (`runtime/recording.py:578-687`, env `RAPTIX_RUNTIME__REPLAY_PATH`).
8. **Evidence discipline**: CONFIRMED-CODE / CONFIRMED-RUN / REPRODUCED /
   INFERENCE / UNKNOWN labels, exactly as the audit uses them. No percentage
   savings is claimed without an A/B benchmark; "agent seems better" closes
   nothing.

---

## 3. Target architecture (corrected from the analysis transcript)

The transcript proposes three schemas (`WorkerInput`, `WorkerPrivateState`,
`WorkerResult`), a Task State Store, a Context Builder, transactional
compaction, and progress control. Mapped onto the repo's actual owners:

```
 Orchestrator thread (checkpointed AgentState + SubagentTranscriptState + DispatchState)
     │  task(description, subagent_type, objective_id, dispatch_id)
     ▼
 DispatchMiddleware._prepare: identity + ledger + budget counters from task state
     │  WorkerInput block = objective + acceptance criteria + task_state revision
     │                     + evidence refs + remaining budgets   (Wave B3, flag-gated)
     ▼
 Child graph (reused compiled instance; fresh message list)
     ├─ streaming adapter  ── emits live UI events (observability only)
     ├─ summarization slot ── effective-context projection, never raw-state mutation
     └─ post-tool hooks    ── execution ledger + receipts (fail-safe)      (Wave B2)
     │  output projection: ONLY declared channels + final message
     │  (Wave A1 — kills C1 at the seam)
     ▼
 Parent Command.update: dispatch ledger + WorkerResult outcome + declared channels
     ▼
 Persisted task state (per objective, /workspace/plan/task-state/<objective>.json)
     + OPPLAN status (plan truth) + KG (knowledge truth)
     + execution ledger (what ran, what it proved) + evidence refs
     ▼
 Context Builder (Wave C3): manifest-driven per-request assembly
     system overlays + working set + masked history + budget check → model
```

Two transcript claims are deliberately **not adopted as-is**:

- **No standalone "Task State Store" platform.** Task state extends the
  existing mission ownership (`orchestration/mission/`, ADR-0040/0041) and
  persists through the same scoped backend OPPLAN already uses
  (`execution/tools/opplan.py:221-258`). OPPLAN stays the plan; KG stays the
  knowledge; task-state files hold per-objective work/execution state.
- **No generic "Context Builder" replacing guardrail middleware.** The
  builder is the final *composition and budget* layer; all safety-critical
  slots (`engagement-context`, `roe-guardrail`, `untrusted-output`,
  `prompt-injection-shield`) remain slot-owned and untouched.

---

## 4. Runtime invariants (the acceptance contract)

Every wave must keep these true; waves exist to *make* them true:

| Invariant | Meaning | Owned by |
|---|---|---|
| I-1 State has an owner | Child never mutates parent's private context state; stale/foreign compaction events are rejected | A1, C1 |
| I-2 Progress is stored outside the conversation | Removing model-visible history removes no work state | B |
| I-3 Completion needs evidence | Tool ran ≠ objective achieved | B3, D2 |
| I-4 Compaction is recoverable | Evicted content has a readable reference the worker's own tools can open | A2, C1 |
| I-5 Context reflects one state revision | No hybrid of old summary + new KG + unversioned task state | C1, C3 |
| I-6 Retry/handoff preserves counters | New worker inherits attempts/budgets, never resets them | B, D1 |
| I-7 Unknown execution ≠ "did not run" | `planned → started → succeeded/failed/outcome_unknown`; resume reconciles before re-running | B2, D3 |

**Final acceptance test (defines "solved"):** at a valid checkpoint, wipe all
model-visible history, start a fresh worker from persisted state only, and
verify it continues correctly — no re-running completed work, no false
completion, evidence intact. This test is built incrementally (B2/B3) and
must pass before Waves D/E optimization is judged.

---

## 5. Verification toolbox

Every WP ships its own tests; the shared toolbox is:

- **T0 unit** — deterministic, fixtures, no LLM, no network. Named by
  behavior, asserting observable outcomes (QUALITY_BAR test rules).
- **Fault injection** — the hook/parser raises; assert the original tool
  result returns unchanged and no exception escapes (fail-safe contract).
- **T1 replay** — `ReplayMiddleware` against a recorded run. Default-flag
  replay must stay green (flag-gated changes are off by default, so old
  records remain replayable). New behavior gets its own recorded fixtures.
- **Synthetic stateful env** — a minimal mock-tool environment whose outputs
  react to agent actions (for progress/loop/handoff tests). Scaffold under
  `benchmarks/context_eval/` (new, harness reuses the `benchmarks/` runner
  patterns). No LLM required for determinism: drive with scripted models or
  ReplayMiddleware records built offline.
- **Offline record analysis** — the audit scripts
  (`benchmarks/Silentium/run-20261008-0642/analysis/`) are read-only evidence
  tooling; extend, never tune against them.

---

## 6. Wave A — Correctness (fixes C1–C5)

Sequential: A1 → A2 → A3 → A4 → A5. A1 and A2 are independent after A1's
first PR; A3 depends on A1's event shape; A4/A5 are independent.

### WP-A1 — Parent–child state isolation + event identity · P0

**Goal.** Child compaction must never affect the parent's effective context;
the same public projection is used on every return path; summarization events
carry identity.

**In scope.**
- `packages/raptix/raptix/core/subagent_streaming.py`
- `packages/raptix/raptix/middleware/dispatch.py`
- `packages/raptix/tests/unit/core/test_subagent_streaming*.py`,
  `test_dispatch_boundary.py`

**Never touch.** `execution/tools/bash/*`, guardrails, deepagents sources
(patch behavior at the raptix seam only).

**Steps.**

1. **Project the child's public output.** `StreamingRunnable` currently
   returns `{**last_state, "subagent_transcripts": transcript}` in
   `invoke`/`ainvoke` (`subagent_streaming.py:620,745`) and returns
   `last_state` in the caught-failure branches (`:586-587,713-714`).
   Because `stream(mode="values")` yields the *internal* state, private
   channels (e.g. `_summarization_event`, declared `PrivateStateAttr` by
   deepagents' `SummarizationState`) ride along; deepagents then forwards
   every key not in its `_EXCLUDED_STATE_KEYS`
   (`deepagents/middleware/subagents.py:240-247,494-532`). Fix:
   - resolve the compiled graph's output channels via
     `self._runnable.get_output_schema()`;
   - build `projected = {"messages": last_state.get("messages", []),
     **{k: v for k, v in last_state.items() if k in output_schema},
     "subagent_transcripts": transcript}`;
   - return `projected` from **all four paths** (sync/async success and
     sync/async caught-failure). `messages` must be present (deepagents
     validates it at `subagents.py:494-503`) and stays excluded from the
     parent update by the dependency's own key filter.
2. **Defense in depth at the dispatch seam.** In `DispatchMiddleware._finish`
   (`dispatch.py:168-196`), explicitly drop `_summarization_event` (and any
   other private key you document in the ADR) from the `Command.update`
   before merging. This second layer survives future wrapper changes.
3. **Event identity.** Wrap the summarization event the raptix slot
   ultimately persists with identity fields: `thread_id` (from
   `langgraph.config.get_config()`), `worker_instance_id` (graph id or role
   + build tag), `context_epoch` (new counter channel — add to a raptix
   summarization state schema declared on `_SafeSummarizationProxy`, see A3),
   `source_revision` (task-state revision once B lands; placeholder
   constant until then), `covered_message_ids` (ids of the messages the
   summary replaced, when available). Identity is additive — the deepagents
   consumer only reads `cutoff_index`/`summary_message`/`file_path`, so extra
   keys are inert upstream while enabling A3/C1 validation.

**Tests.**
- `test_streamed_child_compaction_does_not_leak_to_parent`: child state with
  private channel → real `StreamingRunnable` + deepagents task tool (pattern
  from the audit's offline repro) → assert `_summarization_event` absent from
  `Command.update` and parent effective messages unchanged.
- `test_caught_failure_branch_returns_same_public_projection`: failing
  runnable → assert returned dict has no private keys and transcript present.
- `test_declared_channels_still_forward`: `subagent_transcripts` (and later
  mission channels) survive projection.
- `test_dispatch_finish_strips_private_event`: `_finish` with an update dict
  containing the event → absent from result.
- Existing `test_dispatch_boundary.py` and `test_subagent_streaming*.py`
  suites stay green.

**Acceptance.** Offline repro (audit §1.1) fails before, passes after;
invoke/ainvoke/stream paths agree; child compaction cannot alter parent
context.

**ADR.** `docs/adr/0044-*` — child/parent state ownership at the streaming
seam.

**Effort.** S. **Brief** at §13.

---

### WP-A2 — Recoverable offload: align summary backend with scoped filesystem · P0

**Goal.** Compaction offload writes into the engagement-scoped workspace and
produces a reference the worker's own filesystem tools can open (I-4).

**In scope.**
- `packages/raptix/raptix/execution/backends/__init__.py`
- `packages/raptix/raptix/intelligence/agents/middleware_slots.py`
  (`_make_summarization`)
- tests (see below)

**Never touch.** `execution/sandbox/server/app.py` fence logic (ADR-0042);
deepagents sources.

**Steps.**

1. Deepagents `_get_backend` calls the backend when it is callable,
   passing a constructed `ToolRuntime` (`deepagents/middleware/summarization.py:375-405`);
   the instance path uses the construction-time backend verbatim. Today
   `_make_summarization` passes the built `CompositeBackend`
   (`middleware_slots.py:405-406`), whose default transport is the
   process-wide sandbox — no per-run rebind, no engagement scoping. Fix by
   passing a **backend factory** that mirrors the filesystem middleware's
   resolution (`middleware/filesystem.py:288-351`):
   - resolve the per-run sandbox via `build_sandbox_backend(runtime.config)`;
   - wrap the default route in `EngagementFilesystemBackend` with the
     workspace resolved from runtime (reuse `_workspace_from_runtime`,
     `filesystem.py:278-285`);
   - preserve `/skills/` routes and set `artifacts_root="/workspace"` on the
     rebuilt `CompositeBackend` so `_history_path_prefix` becomes
     `/workspace/conversation_history` (launcher) or is scoped to the
     engagement dir via the wrapper (shared/web mode).
2. Verify **read-back**: after an offload the returned `file_path` must be
   resolvable by the worker's `read_file` (same `EngagementFilesystemBackend`
   mapping). Add an integration test that compacts a scripted conversation
   against the sandbox (or a fake backend honoring the wrapper) and asserts
   a `read_file`-equivalent round trip succeeds.
3. Keep deepagents' fail-open contract: offload failure still yields
   `file_path=None` and proceeds; the ADR records why the fence now permits
   the path instead of relaxing it.

**Tests.**
- `test_summary_offload_path_inside_engagement_workspace`: factory-built
  backend (fake transport) → `_history_path_prefix` is engagement-scoped.
- `test_offload_pointer_readable_by_filesystem_tools`: write→read round trip.
- Fail-safe: offload raises → summary proceeds with `file_path=None`, tool
  flow unaffected.

**Acceptance.** Compaction in an isolated workspace yields a readable
pointer; no fence relaxation; per-run sandbox/tenant routing preserved.

**ADR.** `docs/adr/0045-*` — summarization backend binding and workspace
scoping.

**Effort.** S. **Brief** at §13.

---

### WP-A3 — Compaction failure semantics: overflow typing, no error-text
summaries, no blind handler re-invoke · P0

**Goal.** Errors keep their meaning (C3): overflow reaches the compaction
path, a failed summary never becomes agent context, and downstream failures
are not masked as "summarization failed".

**In scope.**
- `packages/raptix/raptix/intelligence/llm/factory.py`
- `packages/raptix/raptix/intelligence/agents/middleware_slots.py`
- tests: `tests/unit/middleware/test_summarization_fallback.py`,
  new `tests/unit/intelligence/llm/test_error_translation_overflow.py`

**Never touch.** Provider retry policies, LiteLLM fallback config.

**Steps.**

1. **Preserve overflow type.** `_reraise_with_actionable_message`
   (`factory.py:1383-1501`) converts every 400 into `RuntimeError` before
   deepagents can catch `ContextOverflowError`
   (`langchain_openai/chat_models/base.py:512-528` defines the subtype;
   deepagents catches it at `summarization.py:1082-1095`). Add a first
   branch: if the exception is (or wraps) a `ContextOverflowError` —
   `isinstance(exc, ContextOverflowError)` using the same base the installed
   deepagents imports (verify with the installed version in the container) —
   redact secrets in the message and re-raise the original type. Do not
   rely on string matching alone.
2. **Failed summary must not become context.** The dependency returns
   `"Error generating summary: ..."` as summary text
   (`langchain/agents/middleware/summarization.py:804-811,830-837`). In
   `_SafeSummarizationProxy`, after the inner wrap returns, inspect any
   `ExtendedModelResponse`'s command update: if its `_summarization_event`
   summary message content starts with the error marker, **strip the event**
   from the update (keep any `messages` tail) so the failed compaction never
   replaces effective history. Log at warning with the reason.
3. **Stop blind re-invocation of the downstream handler.** Restructure the
   proxy's catch (`middleware_slots.py:382-402`): pass a marker-wrapping
   handler to the inner hook that records "downstream started"; on exception:
   - if downstream started → re-raise (downstream failure is not the
     summarizer's to mask);
   - else → `handler(request)` once (summary generation itself failed; skip
     summarization for this turn).
   Existing pinned tests (`test_summarization_fallback.py`) still pass:
   the fake inner raises *before* calling the handler.
4. Add the `context_epoch` channel + identity stamping from A1 step 3 here
   if it did not land in A1's PR.

**Tests.**
- `test_overflow_type_survives_error_translation`: synthetic
  `OpenAIContextOverflowError` through `_reraise_with_actionable_message` →
  still `ContextOverflowError` (REPRODUCED shape from the audit).
- `test_failed_summary_event_is_stripped`: inner returns event with
  `Error generating summary:` → proxy returns response without the event;
  original request still executes.
- `test_downstream_handler_error_propagates`: inner calls handler, handler
  raises → proxy re-raises, handler invoked exactly once.
- `test_summary_generation_failure_skips_compaction`: inner raises before
  handler → handler called once with the original request (existing
  fallback contract preserved).

**Acceptance.** Audit's synthetic probes §1.4 fail before, pass after;
no double handler invocation; no error text in committed summaries.

**ADR.** `docs/adr/0046-*` — error classification across the model-call
seam.

**Effort.** S. **Brief** at §13.

---

### WP-A4 — Summarization thresholds: real capacity + explicit overrides · P1

**Goal.** Stop guessing the context budget (C4): optional capacity profile,
explicit operator overrides, threshold re-derivation on model change.

**In scope.**
- `packages/raptix/raptix/intelligence/agents/middleware_slots.py`
  (`_make_summarization`, `_SafeSummarizationProxy._scoped_inner`)

**Never touch.** `count_tokens_approximately` upstream; provider routing.

**Steps.**

1. Read optional env `RAPTIX_LLM__MAX_INPUT_TOKENS` (integer); when set,
   pass `profile={"max_input_tokens": N}` on the summarization slot's model
   (or via factory) so `compute_summarization_defaults`
   (`deepagents/middleware/summarization.py:172-209`) selects the
   85%/10% fraction defaults. When unset: today's fallback (170K/6) —
   **default behavior unchanged**.
2. Operator overrides for the fallback path: optional
   `RAPTIX_SUMMARIZATION_TRIGGER_TOKENS` / `RAPTIX_SUMMARIZATION_KEEP_MESSAGES`,
   applied in the raptix factory after `create_summarization_middleware`
   (rebuild with explicit `trigger=`/`keep=`). Invalid values fail build
   with the env name, like `_make_record`.
3. Re-derivation on rebind: `_scoped_inner` currently copies the helper and
   swaps only `model` (`middleware_slots.py:358-380`). If the request model
   differs **and** has a profile, rebuild the defaults for that model
   instead of inheriting the original trigger. Keep the rebind local to the
   copied instance; never mutate the shared one.
4. Document in the ADR: capacity/profile is a **threshold** fix, not a
   tokenizer — chars/token bias (if any) is calibrated separately (E1/X39).

**Tests.**
- unset env → `trigger=('tokens', 170000)`, `keep=('messages', 6)`.
- `RAPTIX_LLM__MAX_INPUT_TOKENS=200000` → fraction defaults.
- override envs applied; invalid value raises with env name.
- rebind with a profiled request model → trigger re-derived; original
  instance untouched.

**Acceptance.** Defaults unchanged; profile path verified by construction
probe (audit §1.2 pattern); no claims about estimator accuracy.

**ADR.** `docs/adr/0047-*` — capacity-aware summarization configuration.

**Effort.** S. **Brief** at §13.

---

### WP-A5 — Skill dedupe scoped to conversation · P1

**Goal.** `loaded_keys` stops pretending process cache == model-visible
context (C5).

**In scope.**
- `packages/raptix/raptix/middleware/skillogy.py`
- `packages/raptix/tests/unit/middleware/test_skillogy.py`

**Never touch.** The skillogy backend ACL (ADR-0008), the phase-block
rendering, `force` semantics removal (keep `force=true` as explicit reload).

**Steps.**

1. Replace the closure `loaded_keys` set (`skillogy.py:196-206`) with a
   **conversation-scoped** store keyed by thread identity. At call time,
   resolve `thread_id` from `langgraph.config.get_config()`
   (`configurable.thread_id`) inside the tool; fall back to a per-call
   session id when no run context exists (library use). Cache shape:
   bounded dict `{thread_id: set[canonical_keys]}` with FIFO eviction
   (e.g. 64 threads) so long-lived servers cannot grow without bound.
2. Keep both keys per load (requested name + resolved canonical path) as
   today; `force=true` bypasses and refreshes the entry.
3. Flag-gate because the tool's reply changes:
   `RAPTIX_SKILL_DEDUPE_SCOPE=thread` (default) vs `=instance` (legacy
   behavior). Default is **thread** only after the ADR records the change;
   if you want zero behavior change in the same PR, ship with
   default `instance` and flip the default in the following release PR —
   decide in the ADR and state it in the PR body.
4. Note in the ADR that this is the *minimal* fix; the complete answer is
   the Wave C3 context manifest, which reports skill visibility from actual
   context, not from a cache.

**Tests.**
- same thread: load → body; repeat → pointer; `force=true` → body.
- different thread id (fresh runtime config): load → body (no stale
  pointer).
- `=instance` mode keeps legacy cross-thread suppression.
- eviction bound respected (unit test with a tiny cap injected).

**Acceptance.** No "already in context" on a fresh dispatch; replay of a
default-flag run unchanged when the default is `instance` (or a recorded
fixture updated deliberately).

**ADR.** `docs/adr/0048-*` — skill-visibility lifecycle.

**Effort.** S. **Brief** at §13.

---

## 7. Wave B — Durable task state (I-2, I-3, I-6 foundations)

Gate to enter: Wave A merged, all A acceptances green.

### WP-B1 — Per-objective task-state documents · P1

**Goal.** Persist work state outside the conversation so a fresh worker can
reconstruct it.

**In scope.**
- `packages/raptix/raptix/orchestration/mission/task_state.py` (new)
- `packages/raptix/raptix/execution/tools/opplan.py` (read/write helpers only)
- tests under `packages/raptix/tests/unit/orchestration/`

**Never touch.** OPPLAN status semantics, KG write paths, middleware
guardrails.

**Steps.**

1. Schema (core-free, pydantic lives in `raptix`): per objective
   `<workspace>/plan/task-state/<objective_id>.json` with
   `schema_version`, `objective_id`, `state_revision` (monotonic int),
   `saved_at`, `updated_by`, and sections: `work_state`
   (`pending|running|blocked|completed|exhausted` + reason), `evidence_refs`
   (bounded list of {ref, sha256, note}), `decision_record` (bounded list of
   {action, outcome, reason, retry_condition}), `continuation`
   ({next_steps, blockers, awaiting}), `budget` ({model_calls, input_tokens,
   wall_clock_s, attempts} counters). Reuse core `ObjectiveStatus` where it
   maps; do not fork OPPLAN types.
2. Writers: OPPLAN objective mutations already persist
   `plan/opplan.json` (`execution/tools/opplan.py:221-258`); extend the same
   backend plumbing (not the same file) so a `update_objective` write
   refreshes `task_state.saved_at`/`state_revision` atomically after a
   validated transition (`opplan.py:655-725`). Best-effort with the same
   failure policy as OPPLAN persistence (never raise into the LLM loop).
3. Flag-gate writes: `RAPTIX_TASK_STATE=1` (default off). Reader degrades
   gracefully (missing file → empty bundle, no crash).
4. Provenance: each write records `event_id` + the OPPLAN/KG revision it
   observed (`kg_store.revision` when available); the projection advertises
   the revision it consumed (B3/C3 consume this).

**Tests.**
- round trip write→read; `state_revision` monotonic; bounded sections
  (decision_record cap respected).
- `update_objective` transition persists task-state only with the flag on.
- missing file → empty bundle; malformed file → explicit error, no crash.

**Acceptance.** I-2 for objective-level work state; no behavior change with
flag off (replay green).

**ADR.** `docs/adr/0049-*` — durable per-objective task state.

**Effort.** M. **Brief** at §13.

---

### WP-B2 — Execution ledger with receipts (fail-safe post-tool hook) · P1

**Goal.** I-7: every side-effecting action has `planned → started →
succeeded/failed/outcome_unknown` with an idempotency key.

**In scope.**
- `packages/raptix/raptix/middleware/execution_ledger.py` (new)
- `packages/raptix-core/raptix_core/contracts/slots.py` + slot factory
  (base slots, env-gated like TRIED_EDGES)
- tests

**Never touch.** Tool execution itself; guardrails; KG canonical facts.

**Steps.**

1. Model after `tried_edges.py`/`kg_autoingest.py` fail-safe patterns:
   `wrap_tool_call` records `planned` (args hash, tool, target scope from
   RoE-safe fields only); `wrap_tool_call` post-handler records
   `succeeded|failed`; a crash gap leaves `started` entries whose resume
   reconciliation (D3) marks `outcome_unknown`. Bounded time (≤4 s) and
   semaphore (2) exactly like the siblings; **always return the original
   result**.
2. Storage: task-state `execution_ledger` section (B1) or a sibling file
   `<objective>.ledger.jsonl` — choose in the ADR; prefer the sibling
   append-only file (bounded by rolling cap) so the task-state document
   stays small.
3. Idempotency key = `hash(role, tool, canonical args, objective_id)`.
   Never log raw parameter values: hash only (telemetry rule).
4. Flag `RAPTIX_EXECUTION_LEDGER=1` (default off).

**Tests.**
- planned/succeeded pair recorded; args hash only (assert raw command
  absent from the ledger).
- ledger write raises → original ToolMessage returned unchanged (fail-safe).
- crash-gap simulation: `started` without terminal → resume marks
  `outcome_unknown`, never auto-`succeeded`.

**Acceptance.** Receipts exist at safe boundaries; execution untouched;
flag works.

**ADR.** `docs/adr/0050-*` — execution receipts.

**Effort.** M. **Brief** at §13.

---

### WP-B3 — Dispatch handoff bundle (WorkerInput/WorkerResult) · P1

**Goal.** I-3, I-6: a dispatch carries objective + acceptance + revision +
evidence + remaining budgets; returns typed outcome + evidence refs; budget
counters survive handoff.

**In scope.**
- `packages/raptix/raptix/middleware/dispatch.py` (build the input block and
  merge counters)
- `packages/raptix/raptix/orchestration/mission/task_state.py` (read/merge)
- tests (`test_dispatch_boundary.py` extensions)

**Never touch.** deepagents state copy, OPPLAN tool surface.

**Steps.**

1. In `_prepare`/`_child_runtime` (`dispatch.py:80-146,198-202`), when
   `RAPTIX_DISPATCH_HANDOFF=1` and `objective_id` resolves, append a
   deterministic `WorkerInput` block to the child's task description:
   objective title + acceptance criteria (from OPPLAN state), task-state
   revision, bounded evidence refs, remaining budget counters. Bounded text
   (cap each section; never unbounded).
2. `_finish` returns today's typed outcome; add the task-state merge: after
   a successful dispatch, atomically fold the child's budget deltas and
   evidence refs into task state; after failure, record the decision entry.
   Folding is best-effort; dispatch outcome reporting is unchanged.
3. Counter continuity: budgets come from task state (B1/B2), never from a
   fresh per-dispatch zero. Handoff never resets them (I-6).

**Tests.**
- WorkerInput block includes acceptance criteria + revision + bounded
  refs; empty sections omitted; cap enforced.
- failed dispatch appends a decision entry; counters not reset.
- flag off → description byte-identical to today (replay green).

**Acceptance.** A fresh worker reconstructs objective + completed work +
next actions from persisted state (the final-acceptance test, §4, first
pass).

**ADR.** `docs/adr/0051-*` — dispatch handoff contract.

**Effort.** M. **Brief** at §13.

---

## 8. Wave C — Context lifecycle (I-4, I-5)

Gate to enter: Wave B merged; final-acceptance test passes at the B scope.

### WP-C1 — Transactional compaction with revision check · P1

**Goal.** I-4/I-5: commit a compaction only if (a) offload succeeded and is
readable, (b) the summary passes validation, (c) the source revision is
still current; otherwise keep the current effective context.

**In scope.**
- `packages/raptix/raptix/intelligence/agents/middleware_slots.py`
  (`_SafeSummarizationProxy` — post-processing of the inner result)

**Never touch.** deepagents internals; raw-state mutation (none exists —
effective projection only).

**Steps.**

1. At wrap start, capture the source revision: task-state revision (B1) +
  a hash of the pre-wrap effective message ids.
2. After the inner wrap returns an `ExtendedModelResponse`:
   - offload pointer present and readable? (A2 gives the verifiable path;
     re-check with the same backend mapping the worker uses);
   - summary text is not the A3 error marker;
   - structure check (C2's deterministic validator, once it lands; before
     that, presence of required section headers is the stop-gap);
   - source revision unchanged (no concurrent task-state/OPPLAN write).
   Any failure → strip the event from the command update, keep the
   uncompacted request (deepagents already falls back to the original
   request when it cannot summarize; here we also refuse a *committed*
   projection), log warning.
3. `context_epoch` increments only on a committed compaction; events carry
   the epoch (A1/A3 channel). A stale-epoch event is rejected on apply.

**Tests.**
- offload fails → no event committed, original request used.
- summary error text → no event (overlaps A3; keep both layers asserted).
- revision changes between snapshot and commit → event stripped.
- happy path: event committed with epoch+identity; effective messages
  replaced exactly once.

**Acceptance.** No committed compaction lacking a valid recovery reference;
no hybrid-revision context; failure modes verified by fault injection.

**ADR.** `docs/adr/0052-*` — transactional compaction.

**Effort.** M. **Brief** at §13.

---

### WP-C2 — Structured summary with reference validation · P1

**Goal.** Summaries cite machine-checkable references instead of trusting
free text for the safety-critical parts (hypothesis vs fact, artifacts,
blockers).

**In scope.**
- raptix summary prompt extension + deterministic validator
  (`orchestration/mission/` or a small `intelligence/context/` module —
  decide in the ADR; middleware stays cross-cutting per ADR-0041)

**Never touch.** The base `DEFAULT_SUMMARY_PROMPT` contract upstream
(SESSION INTENT/SUMMARY/ARTIFACTS/NEXT STEPS stays), tool-call formatting.

**Steps.**

1. Extend the summary prompt passed by the raptix factory with a
   **structured section**: explicit fields for `completed_work` (refs to
   task-state/ledger entries), `evidence` (refs with ids), `failed_attempts`
   (action hash + reason + retry condition), `unresolved` (blockers),
   `hypotheses` (marked as such). Base prompt text appended after the
   upstream template; flag `RAPTIX_SUMMARY_STRUCTURED=1` (default off).
2. Deterministic validator: parse the structured section; every reference
   must resolve (task-state revision, ledger entry, evidence file existing
   via the scoped backend); unknown ref → validation failure → C1 strips
   the commit. Schema vs semantic distinction is explicit in the ADR:
   - schema (machine, hard-gate), reference (machine, hard-gate),
   - semantic fidelity (optional LLM-assisted, advisory, off by default,
     never the sole gate).
3. Do **not** ask the LLM to rewrite constraints/completed work from memory:
   structured fields must reference persisted sources (B1/B2), which the
   context includes.

**Tests.**
- valid structured summary passes; missing section → failure (stop-gap
  before C2 flag on: headers present only).
- reference to a non-existent ledger entry → validation failure.
- hypothesis phrasing cannot smuggle `verified` for a ledger entry that
  says otherwise (unit-test the parser).

**Acceptance.** Structured summaries carry resolvable references; failed
validation blocks compaction commit (via C1); base prompt contract intact.

**ADR.** `docs/adr/0053-*` — structured compaction summaries.

**Effort.** M. **Brief** at §13.

---

### WP-C3 — Context manifest + masking (Context Builder, phased) · P2

**Goal.** Make context assembly observable, budgeted, and mask-aware
(efficiency half of the audit, C6), without moving guardrail ownership.

**In scope (three PRs, sequential).**
- C3a (manifest, observational): new `intelligence/context/manifest.py` +
  an innermost slot (before RECORD) that computes and logs a per-request
  manifest — block inventory (which overlay contributed what, hashes,
  char/token estimate), sources of dynamic blocks, current `context_epoch`,
  task-state revision. `RAPTIX_CONTEXT_MANIFEST=1` (default off). No
  mutation.
- C3b (masking): deterministic masker replacing **old** tool-result
  contents (older than N turns or above M chars — both configurable) with
  a compact observation + artifact reference, EXCEPT status-bearing
  markers, system-reminders, and untrusted-output envelopes (never mask
  inside guardrail wrappers). Reuses the bash-tool preview pattern
  (`bash.py:444-499`); offloads full text to `.scratch`/task-state refs.
  `RAPTIX_CONTEXT_MASK=1` (default off). Fail-safe: masking never blocks a
  call; on error return the request untouched.
- C3c (assembly unification): declare block ownership via the manifest API
  and migrate overlay injections (OPPLAN/KG/skillogy/engagement) to
  budgeted block emission — the largest PR; only after C3a/C3b data shows
  which blocks cost what. Explicitly out: re-owning safety-critical
   injections.

**Operator decision (2026-10-08).** C3c is opt-in via
`RAPTIX_CONTEXT_ASSEMBLY=1`; `RAPTIX_CONTEXT_BUDGET_TOKENS=0` means no added
per-request size limit. A positive value budgets estimated request tokens,
with priority-preserving adapter compaction and verified offload, never a hard
stop or removal of safety-critical blocks. Synthetic renderer/replay evidence
satisfies the C3a/C3b measurement gate; a live lab is not required. Assembly
does not cap cumulative engagement token consumption.

**Never touch.** Safety-critical slot behavior; order of guardrail blocks.

**Tests.**
- C3a: manifest lists each overlay + hash + estimate; no duplication of the
  same block in one request (regression test).
- C3b: old large ToolMessage → masked with reference; recent/small/status
  messages untouched; masking failure returns original request.
- C3c: block budgets enforced; full-block tests per migrated adapter.

**Acceptance.** Per-request observability; masking reduces measured
recurring characters on replay fixtures without fidelity regressions
(T1 + synthetic env); guardrails byte-identical.

**ADR.** `docs/adr/0054-*` (manifest/builder), masking covered within.

**Effort.** L (three PRs). **Brief** at §13.

---

## 9. Wave D — Execution control (C8, I-3, I-6)

Gate to enter: Wave C merged. **Observational first; blocking requires
sign-off + before/after benchmark** (AGENTS.md Incalmo rule — L7 blocking/
pruning is not free to implement).

### WP-D1 — Cross-dispatch budgets · P1

**Goal.** Token/call/wall-clock/attempt budgets persist across handoff.

**In scope.** task-state budget section (B1) + a fail-safe counter
middleware (usage_metadata input tokens + call count, `wrap_model_call`
post-hook) + B3 fold.

**Steps.**
1. Counter middleware: after each downstream model call, fold input/output
  token deltas into the active objective's budget counters (flag
  `RAPTIX_TASK_BUDGET=1`). Never block on failure; never log raw params.
2. B3 dispatch: remaining budget injected in WorkerInput; fold on finish.
3. Exhaustion behavior: soft — emit a system-reminder + ledger entry
  (`budget_exhausted`); hard-stop is **not** in this WP (that is D2/D3
  sign-off territory).

**Tests.** counters accumulate across two sequential dispatches (no reset);
soft-reminder fires at threshold; flag off → zero overhead (replay green).

**ADR.** `docs/adr/0055-*`. **Effort.** S–M.

---

### WP-D2 — Progress signals + loop detection (observational) · P2

**Goal.** Answer "did the last N actions change anything?" with
deterministic signals; surface, never block.

**In scope.** Extend `tried_edges.py` (the L7-obs hook already exists,
env `RAPTIX_KG_TRIED_EDGES`) with state-delta fingerprints: action hash,
input-version hash, result hash, KG/task-state delta. Emit a bounded
"no verifiable progress in last N actions" reminder into context (flag
`RAPTIX_PROGRESS_OBSERVE=1`).

**Never touch.** Blocking, pruning, dedupe-removal, OPPLAN transitions
(observational only — the existing L7-obs contract).

**Tests.** identical action+input+result+no-delta → reminder emitted;
legitimate polling (different result) → none; valid retry after environment
change (input-version hash differs) → allowed; nothing blocked (assertion).

**Acceptance.** Observational loop signals with zero blocking; ADR records
that the blocking half (L7-blocking) needs the D-gate benchmark.

**ADR.** `docs/adr/0056-*`. **Effort.** M.

---

### WP-D3 — Safe handoff policy (sign-off-gated) · P2

**Goal.** Handoff at safe boundaries with ownership lease and
`outcome_unknown` reconciliation (I-7).

**In scope.** Dispatch-level handoff triggers (budget exhausted / stall
signal from D2 / phase transition / operator request), lease handover via
task-state `owner_lease {token, expires_at}`, resume reconciliation that
marks `started` ledger entries `outcome_unknown` and lists them in the
WorkerInput bundle instead of re-running.

**Gate.** Requires explicit sign-off (threat model: a mid-flight handoff
with side-effecting tool gaps). Never auto-handoff by default.

**Operator decision (2026-10-08).** D3 ships default-off
(`RAPTIX_TASK_HANDOFF`): the objective owner lease and `outcome_unknown`
resume reconciliation are implemented behind the flag, triggers are evaluated
but never executed automatically, and the threat model is recorded in
ADR-0057. Sign-off covers the default-off implementation only; enabling the
flag in a live engagement is a separate operator decision.

**Tests.** lease taken before continue; old owner cannot write after
handover; unknown outcomes surfaced, never silently re-executed.

**ADR.** `docs/adr/0057-*` with threat model. **Effort.** M.

---

## 10. Wave E — Observability, caching, cost (C9)

Gate to enter: Waves C merged (E1 can start in parallel with A3).

### WP-E1 — Complete attempt telemetry · P1

**Goal.** `run → task → dispatch → worker instance → logical call →
upstream attempt` identity chain; summary calls counted; served model
captured.

**In scope.**
- `runtime/recording.py` envelope: `attempt_id` + `parent_attempt_id`
  (thread through active_dispatch context), `served_model` from
  `response_metadata` (`factory.py:945-966` already logs it — record it).
- Summarizer calls: wrap the summary model invocation at the raptix
  boundary (a thin recorder around the inner helper's model, or a
  dedicated summary recorder slot) so summary usage is attributed
  separately (`kind="summary_call"`).
- Proxy-side raw usage capture: an optional debug passthrough (log only,
  `RAPTIX_LLM__LOG_RAW_USAGE=1`, no parameter values) to expose
  `prompt_tokens_details` when the gateway returns it.

**Never touch.** Budget enforcement semantics; telemetry must never log raw
parameters/credentials (standing rule).

**Tests.** attempt chain reconstructed from a scripted run; summary call
recorded separately; raw-usage logging contains no secret-shaped values.

**ADR.** `docs/adr/0058-*`. **Effort.** M.

---

### WP-E2 — Provider cache measurement (before any cache tuning) · P1

**Goal.** Replace "cached = 0 / unknown" with route-specific evidence.

**In scope.** `benchmarks/context_eval/cache_probe.py` + capture script:
identical request ×2, append-only prefix, changed suffix, cold/warm where
possible; raw usage at both proxy and provider boundary; latency recorded
but never used alone as evidence. Run against the **real route and
deployment** (custom/GLM through LiteLLM, and any Anthropic route if
exercised).

**Deliverable.** A measurements report; if the backend does not expose
cache buckets, the report says so — the plan then proceeds to E3 only on
positive evidence, otherwise E3 becomes "stable-prefix hygiene, no billing
claim".

**Tests.** probe script itself unit-tested against a fake transport.

**No ADR needed for a benchmark script (Tier-auto); an ADR is needed
before any cache-flag change.**

---

### WP-E3 — Cache-aware prefix ordering (evidence-gated) · P2

**Goal.** Maximize usable prefix stability on routes where E2 proved
prefix caching: byte-stable ordering of system blocks (static → dynamic),
tool-schema stability, dynamic state always last.

**Gate.** Only after E2 positive evidence; no savings claim without the
probe. Never keep stale dynamic state to raise cache hits (correctness
first).

**Scope.** Ordering policy in the manifest/assembly layer (C3c), not in
guardrail middleware. **Tests.** ordering invariant + no stale-state
assertion. **ADR.** `docs/adr/0059-*`. **Effort.** M.

---

### WP-E4 — Recorder sanitization and retention policy · P1

**Goal.** Raw engagement payloads stop shipping with secrets in shareable
artifacts; replay fidelity documented.

**In scope.**
- `runtime/recording.py`: envelope-only default is **not** changed (replay
  fidelity is load-bearing); add an **export sanitizer** (new function +
  CLI/script) that redacts sensitive-shaped values across messages/args
  before sharing, and a `RAPTIX_RUNTIME__RECORD_LEVEL=redacted|raw`
  (default `raw` to preserve replay; `redacted` marks the record
  non-replayable in its header).
- Document retention/access policy in the ADR (who may hold raw records).

**Never touch.** `event_logging` telemetry redaction semantics (it is
already content-free); replay hashing.

**Tests.** sanitized export: no credential-shaped value survives,
deterministic; `redacted` record is flagged non-replayable and
`open_replay` refuses it. **ADR.** `docs/adr/0060-*`. **Effort.** S–M.

---

## 11. Sequencing, PR map, flags, effort

| Wave/WP | Fixes | Depends on | ADR | Effort | Gate |
|---|---|---|---|---|---|
| A1 boundary + event identity | C1 | — | 0044 | S | — |
| A2 offload/scoping | C2 | A1 | 0045 | S | — |
| A3 failure semantics | C3 | A1 | 0046 | S | — |
| A4 thresholds/profile | C4 | — | 0047 | S | — |
| A5 skill dedupe scope | C5 | — | 0048 | S | — |
| B1 task-state documents | C7 | A | 0049 | M | A merged |
| B2 execution ledger | I-7 | B1 | 0050 | M | B1 |
| B3 handoff bundle | I-3, I-6 | B1, B2 | 0051 | M | B1+B2 |
| C1 transactional compaction | I-4, I-5 | A2, A3, B1 | 0052 | M | B |
| C2 structured summary | fidelity | B1, B2 | 0053 | M | B |
| C3 manifest/masking/builder | C6 | C1 | 0054 | L (×3 PRs) | B |
| D1 cross-dispatch budgets | I-6 | B | 0055 | S–M | C |
| D2 progress signals (obs.) | C8 | B2 | 0056 | M | C |
| D3 safe handoff | I-7 | D1, D2 | 0057 | M | **sign-off** |
| E1 attempt telemetry | C9 | — | 0058 | M | parallel after A3 |
| E2 cache probe | C9 | E1 | benchmark (no ADR) | M | — |
| E3 prefix ordering | cost | E2 positive | 0059 | M | E2 |
| E4 sanitizer | C9 | — | 0060 | S–M | — |

**Flag inventory (all default off / legacy unless stated):**
`RAPTIX_TASK_STATE`, `RAPTIX_EXECUTION_LEDGER`, `RAPTIX_DISPATCH_HANDOFF`,
`RAPTIX_SUMMARY_STRUCTURED`, `RAPTIX_CONTEXT_MANIFEST`,
`RAPTIX_CONTEXT_MASK`, `RAPTIX_TASK_BUDGET`, `RAPTIX_PROGRESS_OBSERVE`,
`RAPTIX_TASK_HANDOFF`, `RAPTIX_SKILL_DEDUPE_SCOPE=thread|instance`,
`RAPTIX_LLM__MAX_INPUT_TOKENS`, `RAPTIX_SUMMARIZATION_TRIGGER_TOKENS`,
`RAPTIX_SUMMARIZATION_KEEP_MESSAGES`, `RAPTIX_RUNTIME__RECORD_LEVEL`,
`RAPTIX_LLM__LOG_RAW_USAGE`.

C-wave configuration additions: `RAPTIX_TRANSACTIONAL_COMPACTION`,
`RAPTIX_CONTEXT_ASSEMBLY` (default off),
`RAPTIX_CONTEXT_BUDGET_TOKENS` (default `0`, unlimited),
`RAPTIX_CONTEXT_MASK_AFTER_TURNS`, `RAPTIX_CONTEXT_MASK_MIN_CHARS`.

**ADR numbering starts at 0044** (latest accepted is 0043).

---

## 12. Sign-off gates & open questions

1. **D2-blocking / L7 blocking-pruning**: not implementable without explicit
   sign-off + a before/after benchmark (AGENTS.md). The plan ships only the
   observational half.
2. **Response caching**: never adopted for a stateful agent observing a
   changing environment; E2 measures prompt/KV caching only.
3. **HITL interaction for handoff**: automatic mid-life handoff (D3) needs
   the same threat-model review as any execution-path change.
4. **Skill dedupe default flip**: A5's ADR must state whether the default
   flips in the same PR or a later one; replay compatibility follows from
   that decision.
5. **Silentium data**: analysis-only. No threshold (mask N/M, stall window,
   budget caps) may be tuned against the Silentium export; derive
   thresholds from synthetic fixtures + new benchmark runs.
6. **Model profile values**: the actual GLM-5.3-Flash capacity is a
   deployment fact to be confirmed by the operator/provider (E1 raw usage),
   not a constant to invent.

---

## 13. Sub-agent briefs (paste per WP)

<details><summary>WP-A1 brief</summary>

Fix child→parent state leakage in `packages/raptix/raptix/core/subagent_streaming.py`
and `middleware/dispatch.py`. `StreamingRunnable` returns the last internal
state from `stream(mode="values")`; project it to the compiled graph's output
schema (`get_output_schema()`) plus `messages` (required by deepagents) plus
`subagent_transcripts`, on ALL four paths (sync/async success + caught
failure). Drop `_summarization_event` explicitly in `DispatchMiddleware._finish`.
Add summarization-event identity fields (thread_id, worker_instance_id,
context_epoch, source_revision, covered_message_ids). Tests: the offline repro
(child compaction → parent unaffected) passes; declared channels still
forward; existing `test_dispatch_boundary.py` green. One ADR
(`docs/adr/0044-*`), one PR ≤400 lines. Follow AGENTS.md.
</details>

<details><summary>WP-A2 brief</summary>

Make summarization offload land inside the engagement workspace: change
`_make_summarization` (`intelligence/agents/middleware_slots.py:405-406`) to
pass a per-run backend factory that mirrors
`middleware/filesystem.py:288-351` (per-run sandbox rebind +
`EngagementFilesystemBackend` scoping, `/skills/` routes preserved,
`artifacts_root="/workspace"`). Do not touch the sandbox fence. Verify the
offloaded pointer is readable by the worker's filesystem tools (round-trip
test). Fail-safe: offload failure still yields `file_path=None`. ADR
`docs/adr/0045-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-A3 brief</summary>

Fix compaction failure semantics. (1) `intelligence/llm/factory.py`
`_reraise_with_actionable_message`: preserve `ContextOverflowError` type
instead of converting to `RuntimeError` (verify the exact base the installed
deepagents catches). (2) `_SafeSummarizationProxy`: strip any
`_summarization_event` whose summary starts with "Error generating summary:".
(3) Restructure the proxy catch: track whether the downstream handler started
(marker wrapper); re-raise downstream failures, fall back to `handler(request)`
only when summary generation itself failed. Existing
`test_summarization_fallback.py` must stay green; add overflow-typing test.
ADR `docs/adr/0046-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-A4 brief</summary>

Optional capacity-aware summarization thresholds: env
`RAPTIX_LLM__MAX_INPUT_TOKENS` → `profile={"max_input_tokens": N}`;
optional `RAPTIX_SUMMARIZATION_TRIGGER_TOKENS`/`..._KEEP_MESSAGES` overrides;
re-derive defaults in `_SafeSummarizationProxy._scoped_inner` when the request
model changes and has a profile. Defaults unchanged when envs unset. Invalid
values fail build naming the env. ADR `docs/adr/0047-*`, one PR. Follow
AGENTS.md.
</details>

<details><summary>WP-A5 brief</summary>

Scope skill-load dedupe to the conversation: replace the `loaded_keys`
closure set in `middleware/skillogy.py:187-206` with a bounded
thread_id-keyed store (thread id from `langgraph.config.get_config()` at
call time; per-call fallback id for library use). Keep `force=true` bypass.
Flag `RAPTIX_SKILL_DEDUPE_SCOPE=thread|instance`; the ADR
(`docs/adr/0048-*`) must state which default ships and when it flips; replay
compatibility must hold for the shipped default. Tests in
`tests/unit/middleware/test_skillogy.py`. One PR. Follow AGENTS.md.
</details>

<details><summary>WP-B1 brief</summary>

Per-objective durable task state:
`orchestration/mission/task_state.py` (new) + helpers reusing the OPPLAN
backend plumbing in `execution/tools/opplan.py:221-258`. Schema:
`schema_version`, `objective_id`, `state_revision` (monotonic), `saved_at`,
`updated_by`, `work_state`, `evidence_refs`, `decision_record`,
`continuation`, `budget`. Writes piggyback on validated `update_objective`
transitions, best-effort (never raise into the LLM loop), flag
`RAPTIX_TASK_STATE=1` default off. Reader degrades to empty bundle. Unit
round-trip + flag-off replay tests. ADR `docs/adr/0049-*`, one PR ≤400
lines. Follow AGENTS.md.
</details>

<details><summary>WP-B2 brief</summary>

Fail-safe execution ledger middleware (model after `middleware/tried_edges.py`
and `kg_autoingest.py`): record `planned → started →
succeeded/failed` receipts per side-effecting tool call with an idempotency
key `hash(role, tool, canonical args, objective_id)`; args stored hashed
only. Crash gap → `outcome_unknown` on resume reconciliation (test-only for
now; D3 consumes it). Bounded time (≤4 s)/semaphore(2); always return the
original tool result unchanged. Append-only sibling file
`<objective>.ledger.jsonl`, bounded cap. Flag `RAPTIX_EXECUTION_LEDGER=1`
default off. ADR `docs/adr/0050-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-B3 brief</summary>

Dispatch handoff bundle in `middleware/dispatch.py`: when
`RAPTIX_DISPATCH_HANDOFF=1` and the objective resolves, append a bounded
WorkerInput block (objective + acceptance criteria + task-state revision +
evidence refs + remaining budgets) to the child task description; fold
budget deltas/evidence refs back into task state in `_finish`; counters
never reset across handoff. Flag-off must leave the description
byte-identical (replay test). ADR `docs/adr/0051-*`, one PR. Follow
AGENTS.md.
</details>

<details><summary>WP-C1 brief</summary>

Transactional compaction in `_SafeSummarizationProxy`: capture source
revision (task-state revision + effective-message hash) at wrap start; after
the inner wrap, require readable offload pointer, non-error summary text,
passing structure check, unchanged source revision — else strip the event
from the command update and keep the uncompacted request. Increment
`context_epoch` only on committed compaction; stale-epoch events rejected.
Fault-injection tests for every refusal branch. ADR `docs/adr/0052-*`, one
PR. Follow AGENTS.md.
</details>

<details><summary>WP-C2 brief</summary>

Structured summary + reference validation: extend the summary prompt behind
`RAPTIX_SUMMARY_STRUCTURED=1` with structured fields (completed_work,
evidence refs, failed_attempts, unresolved, hypotheses) that must reference
persisted task-state/ledger/evidence; add a deterministic validator
(resolvable refs required; hypothesis ≠ verified). Validation failure →
compaction commit refused (consumed by C1). Do not modify the upstream base
prompt sections. ADR `docs/adr/0053-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-C3a brief</summary>

Observational context manifest: new `intelligence/context/manifest.py` +
innermost slot (before RECORD) computing per-request manifest (overlay
inventory, hashes, char/token estimate, context_epoch, task-state revision)
behind `RAPTIX_CONTEXT_MANIFEST=1` default off. No mutation; no duplicate
block in one request (regression test). No ADR-0041 violation (pure
observability). ADR `docs/adr/0054-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-C3b brief</summary>

Deterministic old-tool-result masking: mask ToolMessages older than N turns
or larger than M chars (both env-configurable) into compact observation +
artifact reference (offload full text to `.scratch`/task-state refs),
never masking status markers, system-reminders, or untrusted-output
envelopes. Fail-safe: masking errors return the request untouched. Flag
`RAPTIX_CONTEXT_MASK=1` default off. T1 replay + synthetic-env fidelity
tests. One PR (ADR-0054 umbrella). Follow AGENTS.md.
</details>

<details><summary>WP-C3c brief</summary>

Unify overlay assembly through the manifest API: migrate OPPLAN/KG/
skillogy/engagement block emission to budgeted blocks with declared
ownership/order; safety-critical slots stay slot-owned and untouched. Only
after C3a/C3b data justifies it. Block-budget tests per adapter; guardrail
blocks byte-identical. One PR (ADR-0054 umbrella). Follow AGENTS.md.
</details>

<details><summary>WP-D1 brief</summary>

Cross-dispatch budget counters: fail-safe `wrap_model_call` post-hook folds
input/output token deltas into the active objective's task-state budget
(flag `RAPTIX_TASK_BUDGET=1` default off); B3 folds deltas on dispatch
finish; counters never reset on handoff. Soft threshold reminder only — no
hard stop in this WP. ADR `docs/adr/0055-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-D2 brief</summary>

Observational progress/loop signals: extend `middleware/tried_edges.py`
(L7-obs hook) with state-delta fingerprints (action hash, input-version
hash, result hash, KG/task-state delta) and emit a bounded "no verifiable
progress in last N actions" reminder behind `RAPTIX_PROGRESS_OBSERVE=1`.
Zero blocking — assert nothing is vetoed; valid retries with changed
input-version hash are exempt. ADR `docs/adr/0056-*` records that the
blocking half needs sign-off + benchmark. One PR. Follow AGENTS.md.
</details>

<details><summary>WP-D3 brief</summary>

Safe handoff policy (sign-off-gated): dispatch-level handoff triggers
(budget exhausted / D2 stall / phase transition / operator), ownership
lease in task state (token + expires_at), resume reconciliation marking
`started` ledger entries `outcome_unknown` and listing them in the Worker
Input bundle instead of re-running. Default off; threat model in the ADR
(`docs/adr/0057-*`). One PR. Follow AGENTS.md.
</details>

<details><summary>WP-E1 brief</summary>

Attempt-chain telemetry: `runtime/recording.py` envelope gains
`attempt_id`/`parent_attempt_id` (threaded through `active_dispatch`) and
`served_model`; summarizer calls recorded separately (`kind="summary_call"`);
optional raw-usage debug log (`RAPTIX_LLM__LOG_RAW_USAGE=1`) exposing
`prompt_tokens_details` with no parameter values/credentials. ADR
`docs/adr/0058-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-E2 brief</summary>

Cache measurement probe under `benchmarks/context_eval/cache_probe.py`:
identical×2, append-only prefix, changed suffix, cold/warm; raw usage both
sides of the proxy; latency recorded but never used as sole evidence.
Run against the real custom/GLM route. Ship a measurements report; positive
evidence gates E3, absence of evidence keeps caching claims at UNKNOWN.
Unit-test the probe against a fake transport. No ADR needed for the script.
</details>

<details><summary>WP-E3 brief</summary>

Only after E2 proves prefix caching on the route: byte-stable static-first
block ordering (static → dynamic; dynamic state always last), tool-schema
stability, via the C3c assembly layer — never inside guardrail middleware,
never keeping stale state for cache hits. Ordering-invariant tests. ADR
`docs/adr/0059-*`, one PR. Follow AGENTS.md.
</details>

<details><summary>WP-E4 brief</summary>

Recorder sanitization: export sanitizer redacting sensitive-shaped values
across messages/args (deterministic); `RAPTIX_RUNTIME__RECORD_LEVEL=raw|redacted`
(default `raw`, replay-compatible; `redacted` marks the record
non-replayable and `open_replay` refuses it). Retention/access policy in the
ADR (`docs/adr/0060-*`). Do not change event-logging telemetry redaction.
One PR. Follow AGENTS.md.
</details>

---

## 14. How to implement a WP (checklist for the executing agent)

1. Read this plan + `docs/QUALITY_BAR.md` + `CONTRIBUTING_AGENT.md` +
   root `AGENTS.md`; check the working tree first — four files already
   carry uncommitted modifications (`engagement.py`, `opplan.py`,
   `raptix.py`, `langgraph.Dockerfile`); resolve conflicts before editing.
2. Draft the ADR (`docs/adr/NNNN-*.md`, `Status: Proposed`); name scope,
   blast radius, threat model when behavior changes.
3. Implement under the WP's in-scope file list. No comments unless asked;
   named constants; typed public functions; named exceptions.
4. Watch tests fail first (bug-fix WPs: failing-then-passing commit
   sequence, do not squash locally).
5. `make ci-lint` then `make ci-test`; focused runs via
   `make test-local ARGS="packages/raptix/tests/...::test_name"`.
6. Replay/fail-safe assertions from the WP's Tests section are mandatory.
7. PR body: one concern, End-to-end verification statement with the exact
   commands and observed behavior, flag names + defaults, ADR link.
8. Never merge two WPs in one PR; never exceed the diff budget without the
   `large-diff-approved` label.

## 15. Rollout and de-risking notes

- Wave A ships behind defaults that preserve today's behavior where a flag
  exists; A1/A2/A3 correctness fixes are the only near-default changes —
  each has an offline reproduction and a pinned regression test.
- Between waves, run the benchmark harness (`python -m benchmarks.runner`)
  on a smoke config to catch engagement-level regressions; keep the
  Silentium export as an analysis reference only.
- The final-acceptance test (§4) is assembled across B2/B3 and must be
  green before any Wave C/D/E work is judged a success.
