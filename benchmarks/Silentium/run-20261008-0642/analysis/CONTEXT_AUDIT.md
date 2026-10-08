# Context Engineering & Runtime Audit — Raptix codebase

**Revalidated:** 2026-10-08. **Checkout:** branch `structure`, HEAD `be5c9db`,
including the existing working-tree changes. **Case study:** Silentium export
`run-20261008-0642`, recorded on 2026-10-07.

This revision audits runtime mechanisms first and uses Silentium to demonstrate
specific outcomes. It supersedes the previous revision's unsupported claims
about 4,000-token summaries, two independent compactions, zero provider caching,
zero tool failures, inherited worker budgets, and projected savings.

Only this report was changed in the repository during revalidation. The original
Q01–Q40 wording and A–I grouping are not available in the retained audit brief.
Q labels below are navigation references carried forward from the previous
report, not a claim that reconstructed question titles reproduce that brief.
The five deliverables are D1–D5; the coverage index is in §12.

## 0. Evidence, scope, and verdict

### 0.1 Evidence conventions

- **CONFIRMED-CODE:** source establishes the mechanism under stated conditions.
- **CONFIRMED-RUN:** the exported record/log establishes the observed outcome.
- **REPRODUCED:** a synthetic offline probe exercised the mechanism.
- **INFERENCE:** plausible explanation that is not directly established.
- **UNKNOWN:** required data is unavailable.

Source abbreviations used throughout:

| Prefix | Exact location |
|---|---|
| `R/` | `packages/raptix/raptix/` |
| `C/` | `packages/raptix-core/raptix_core/` |
| `Run/` | `benchmarks/Silentium/run-20261008-0642/` |
| `DA-S` | installed `deepagents/middleware/summarization.py`, deepagents 0.6.8 |
| `DA-A` | installed `deepagents/middleware/subagents.py`, deepagents 0.6.8 |
| `LC-S` | installed `langchain/agents/middleware/summarization.py`, langchain 1.3.9 |
| `LC-U` | installed `langchain_core/messages/utils.py`, langchain-core 1.4.9 |
| `LC-O` | installed `langchain_openai/chat_models/base.py`, langchain-openai 1.2.2 |
| `LC-C` | installed `langchain_anthropic/middleware/prompt_caching.py`, langchain-anthropic 1.4.8 |

Dependency sources were inspected in `raptix-langgraph` under
`/app/.venv/lib/python3.13/site-packages/`; copies are in the approved temporary
directory. These versions are evidence about the inspected image, not a promise
about every deployment. Current checkout code is not assumed to be byte-identical
to the historical run image. Where historical behavior is claimed, the exported
record/log is cited separately.

### 0.2 Important corrections to the previous answers

| Previous answer | Revalidated answer |
|---|---|
| Summary reads only 4,000 tokens, about 2.7% of history | **Incorrect for the Raptix factory path.** `create_summarization_middleware` passes `trim_tokens_to_summarize=None`; the helper returns the complete selected batch. Direct class construction has a different default. |
| Two true compactions | **One distinct summary is observed**, first in postexploit; the same summary is subsequently applied to the orchestrator through state leakage. The second collapse is not evidence of another summary-generation call. |
| Compaction permanently destroys ~148K tokens | **Incorrect.** Deepagents preserves raw `state["messages"]` and changes the effective model request. The missing offload pointer impairs agent retrieval; it does not prove deletion from checkpoints or the record. The provider-token delta is not an evicted-history token count. |
| Zero cache at every layer; cached tokens = 0 | **Unsupported.** The named middleware is inactive for factory-created ChatOpenAI models; all recorded cache-detail maps are empty. Actual provider KV caching, response caching, and billed discounts remain unknown. |
| Full prompt shipment proves no prefix reuse | **Incorrect.** Provider prefix caching normally still receives the full prompt. Stable prefixes are an opportunity, not evidence of a miss. |
| 0 tool errors / no retries | **Incorrect scope.** No escaped exception records are present, but **19 ToolMessage responses have `status="error"`**. SDK/proxy retries can be hidden inside one recorded model call. |
| Exactly five system blocks for every agent | **Incorrect.** In this export: exploit/postexploit 5; recon 7; orchestrator 7–11. OPPLAN and KG inject into the **system message**, not conversation messages. |
| Worker recursion limit inherits the parent's 400 | **Incorrect as a general rule.** Deepagents lets the child's bound config win collisions. Current standard limits differ by role. |
| All recovery names are available tools | **Incorrect.** The exposure module explicitly says `inspect_context` and `diagnose_execution` have no runtime tools yet. Preservation of an existing tool does not create it. |
| Cache header/profile fixes guarantee 30% savings or remove estimator bias | **Unsupported.** Provider support must be measured; setting a context-limit profile changes thresholds, not the tokenizer or chars/token estimator. |
| Prompt reduction saves the whole 2.65M-token prompt budget | **Incorrect.** That is an estimated recurring footprint, not the removable fraction. Safety instructions and workflows cannot simply be deleted. |

### 0.3 Codebase-level conclusions

1. **Private-state isolation breaks at the streaming adapter boundary.**
   `StreamingRunnable` returns the last full state from `stream_mode="values"`;
   deepagents then forwards keys not explicitly excluded. This bypasses the
   child graph's normal output projection. `_summarization_event` can affect the
   parent's unrelated conversation (§1.1).
2. **Summarization backend handling is not aligned with filesystem handling.**
   The normal filesystem tools rebind the sandbox per run and scope the workspace;
   the summarization slot receives the construction-time backend directly. Root
   paths and tenant routing both need checking (§1.3).
3. **Prompt-cache behavior depends on the actual transport, not the model name.**
   All models built by `LLMFactory` use ChatOpenAI subclasses. The Anthropic-only
   middleware therefore does not activate merely because a route serves Claude.
   Other middleware and proxy handlers still have cache-aware behavior (§2).
4. **Retries, failures, and spending have multiple boundaries.** A record entry
   is a middleware round trip, not necessarily one provider attempt or one graph
   superstep. Step budgets, dispatch failures, USD budgets, and context limits
   are separate mechanisms (§4 and §6).
5. **Shared middleware lifetime differs from conversation lifetime.** Skill
   deduplication is held in a closure on a reused middleware instance, creating
   cross-dispatch/thread contamination risk (§5.2).

## 1. Compaction mechanics — Q10–Q17

### 1.1 State isolation and the actual poisoning chain

**CONFIRMED-CODE + REPRODUCED.** The mechanism is more specific than “deepagents
forgot one excluded key”:

1. `R/intelligence/agents/standard/raptix.py:149-157` builds each discovered child
   graph once and wraps it in `StreamingRunnable`. It does not construct a new
   graph on each `task()` call.
2. `DA-A:534-540` copies non-excluded parent state into the child and replaces
   `messages` with `[HumanMessage(description)]`. Other declared state channels
   can survive this handoff; a fresh message list is not complete state isolation.
3. `DA-S:154-160` declares `_summarization_event` as a private state attribute.
   Normal graph output projection can omit that private channel.
4. With a renderer or stream writer available, the Raptix wrapper reads
   `stream_mode="values"` / `astream(..., stream_mode="values")` and returns
   `{**last_state, "subagent_transcripts": transcript}`. It also returns the
   last state on caught child failure. See
   `R/core/subagent_streaming.py:536-620,656-745`.
5. `DA-A:240-247` excludes `messages`, `todos`, `structured_response`,
   `skills_metadata`, `skills_load_errors`, and `memory_contents`, but not
   `_summarization_event`. `DA-A:494-532` therefore includes the leaked event
   in the parent `Command.update`.
6. `R/middleware/dispatch.py:168-196` copies those command updates and adds its
   dispatch ledger; it does not remove the summarization event.
7. The parent owns its own summarization channel. `DA-S:520-560` applies the
   event to the parent's message list as `[summary_message] + messages[cutoff:]`.
   If `cutoff > len(messages)`, it logs and returns only `[summary_message]`.

**Offline reproduction:** a StateGraph with a private summarization channel and
public `AgentState` output was passed through the actual `StreamingRunnable` and
deepagents task tool, with an in-memory stream writer and no LLM or sandbox
command execution:

```text
normal_output_has_private_event= False
wrapped_task_update_has_event= True
excluded_state_keys_contains_event= False
effective_parent_messages= 1
same_summary_identity= True
```

**Scope:** any orchestrator using this wrapper, a child emitting that private
state, and a compatible parent channel can be affected. The stream-enabled and
plain-invoke paths differ: `R/core/subagent_streaming.py:517-519,638-640` bypass
the streaming adapter if no channels are available. This is not a universal bug
in every unwrapped deepagents invocation.

**Run corroboration:** `Run/workspace/record.jsonl:1407` lists
`_summarization_event` in the postexploit `task` response's `update_keys`.
The summary at lines 1307 and 1408 is identical (§8). The exported log records
`cutoff_index 162` being applied to parent message counts 148, 151, 154, 157,
and 160: `Run/logs/langgraph.log:362,369,374,378,382`.

### 1.2 Trigger, retention, and summarizer input — Q10/Q11/Q12/Q14

`R/intelligence/agents/middleware_slots.py:405-406` calls
`create_summarization_middleware(llm, backend)`, wrapped by
`_SafeSummarizationProxy`.

| Configuration | Actual behavior | Evidence |
|---|---|---|
| Valid `model.profile["max_input_tokens"]` integer | trigger at 85% of input capacity; retain 10%; corresponding argument-truncation fractions | `DA-S:172-198` |
| Missing/invalid model profile | trigger 170,000 estimated tokens; retain 6 messages; argument-truncation trigger/keep 20 messages | `DA-S:200-209` |
| Raptix factory summary trim | **None: no helper trim ceiling** | `DA-S:1158-1164,1222-1231`; `LC-S:839-843` |
| Direct `SummarizationMiddleware(...)` constructor default | 4,000-token helper trim | `DA-S:233-243`; `LC-S:839-854` |

An offline factory construction with `ChatOpenAI` and `CompositeBackend` returned:

```text
profile= None
trim= None
history= /conversation_history
trigger= ('tokens', 170000)
keep= ('messages', 6)
```

The “4K / 2.7%” claim in the previous report confused a class default with the
factory's explicit override. For this path the summary model receives the full
**selected batch**, after effective-history reconstruction and old write/edit
argument truncation. It does not necessarily receive every original raw byte.
Summary prompt tokens also add to that call's input.

Retention is not always exactly six individual messages: the helper chooses a
safe cutoff that preserves tool-call/result relationships (`LC-S:614-785`).
The observed seven effective messages are consistent with summary + a retained
tail; they are not a universal post-compaction size limit.

The counter includes the **system message, effective messages, and tool schemas**
(`DA-S:1067-1080`). For ChatOpenAI the helper enables usage-metadata scaling
(`LC-S:197-205,333-341`). `LC-U:2239-2248,2303-2367,2369-2395` uses roughly
chars/4, message overhead, serialized tool calls and schemas; its correction
factor is clamped to `[1.0, 1.25]` when suitable provider metadata exists.

**CONFIRMED-CODE:** downward scaling is unavailable in that branch.
**UNKNOWN:** actual safe GLM input capacity and tokenizer calibration.
The old `173,101 vs 150,601` estimate is not retained as an exact replay result:
recorded requests omit full tool schemas and per-message response metadata needed
to reconstruct the actual counter input/scaling. Without those inputs, the
15% claim is a diagnostic estimate, not a universal error rate or proof that
compaction was “earlier than needed.”

The factory chooses trigger/keep defaults at graph construction. The request
model rebinding in `_SafeSummarizationProxy` does not rerun
`compute_summarization_defaults` (`R/intelligence/agents/middleware_slots.py:358-380`).
Model overrides/fallbacks with different capacities therefore need explicit
threshold validation; rebinding the summary model alone is insufficient.

Argument truncation specifically targets older `write_file`/`edit_file` tool-call
arguments, with a default length limit of 2,000 characters
(`DA-S:324-334,714-756`). It does not summarize old bash stdout.

### 1.3 Offload paths, tenant routing, and persistence — Q15

**CONFIRMED-CODE:** `R/execution/backends/__init__.py:60-115` creates a
`CompositeBackend` routing `/skills/` locally and everything else to the HTTP
sandbox, without an explicit `artifacts_root`. Deepagents derives
`/conversation_history/{thread_id}.md` from that backend root
(`DA-S:316-319,407-440`).

The sandbox daemon's outside-workspace rejection is **conditional on a fenced
engagement**, not an unconditional rule for all dev/standalone backends:
`R/execution/sandbox/server/app.py:264-273`. Under that fence an absolute
`/conversation_history/...` path fails the `/workspace` containment check.
History offload catches failure and continues with `file_path=None`
(`DA-S:832-906,1112-1124`).

**CONFIRMED-RUN:** the observed summary has no history path, matching the
`file_path=None` rendering (`DA-S:474-505`).
**INFERENCE:** the root/fence mismatch explains that failure; the retained log
does not contain the historical offload HTTP response, so an observed “403” is
not claimed solely from current source or an absent directory.

There is a second, codebase-wide routing concern:

- Normal filesystem tools rebind `HTTPSandbox` using `runtime.config`, preserve
  routes/artifacts root, and wrap it in `EngagementFilesystemBackend`:
  `R/middleware/filesystem.py:288-351`.
- Summarization receives the construction-time backend object. Deepagents
  `_get_backend` returns that object unchanged unless a callable was supplied:
  `DA-S:375-405`.

Setting only `artifacts_root="/workspace"` may solve the isolated-root path but
does not by itself solve shared-server tenant selection or subdirectory scoping.
Test isolated bind-mount, shared `/workspace/<slug>`, per-run `sandbox_url`, and
custom backend shapes before describing this as a one-line production fix.

**Persistence correction:** `DA-S:1048-1050,1126-1147` leaves raw message state
intact and persists an event describing the effective projection. Missing
offload means the model lacks a successful filesystem pointer to old history;
operator checkpoint/record recovery may still be possible. Neither permanent
deletion nor “148K evicted tool-output tokens” follows from the provider-token
delta.

### 1.4 Summary structure and failure paths — Q13/Q17

`LC-S:33-78` requests SESSION INTENT, SUMMARY, ARTIFACTS, NEXT STEPS. It explicitly
asks for rejected options and their reasons, and warns against repeating actions.
Thus anti-repeat information is already requested, although there is no dedicated
FAILED ATTEMPTS field and no structured schema validation.

The summary is generated by a direct model invocation outside the agent's
model-handler middleware (`LC-S:787-837`). `_SafeSummarizationProxy._scoped_inner`
copies the helper and binds the request-selected model, which can include the
per-run virtual key (`R/intelligence/agents/middleware_slots.py:358-380`).
Summary calls therefore need separate usage/cost instrumentation; the 1,115
recorded calls are not a proven count of every LLM request made by the runtime.

Two failure paths must be distinguished:

1. **Summary generation exception:** the LangChain helper catches it and returns
   `"Error generating summary: ..."` as the summary string (`LC-S:804-811,830-837`).
   If the following model call succeeds, an event containing that error text can
   be committed. The outer “safe” proxy does not detect summary quality.
2. **Exception escaping the inner wrap:** the Raptix proxy catches broadly and
   calls `handler(request)` again with the outer request
   (`R/intelligence/agents/middleware_slots.py:382-402`). This can repeat a failed
   downstream attempt even when no summary was generated. It does not establish
   double billing; that depends on provider acceptance/accounting.

**Overflow integration correction:** `LC-O:512-528` preserves an OpenAI 400
context overflow as `ContextOverflowError`, and deepagents catches that type
(`DA-S:1082-1095`). However, Raptix's `_ProxiedChatOpenAI.invoke/ainvoke` runs
`_reraise_with_actionable_message`; its generic 400 branch turns the error into
`RuntimeError` (`R/intelligence/llm/factory.py:918-942,1402-1447`). A synthetic
400 overflow passed through that translator produced:

```text
translated_overflow_type= RuntimeError
still_ContextOverflowError= False
```

The dependency having an overflow branch does **not** prove the Raptix transport
can reach it unchanged. Preserve exception types and test the actual bound model
path end-to-end before relying on overflow-triggered compaction.

## 2. Cache and usage accounting — Q05–Q09

### 2.1 Actual model class versus provider route

`R/intelligence/llm/factory.py:1710-1770` creates `_ProxiedChatOpenAI`,
`_DeepSeekThinkingChatOpenAI`, or `_NvidiaNIMChatOpenAI`. All are ChatOpenAI
subclasses, including when the model name refers to Anthropic through LiteLLM.
It sets proxy URL, key, max retries, streaming, stream usage, and output limits.
Library callers may inject a different `llm`, so this statement is about the
factory path.

`LC-C:92-113,153-189` checks `isinstance(request.model, ChatAnthropic)`.
`R/intelligence/agents/middleware_slots.py:409-410` selects silent ignore for
unsupported classes. **CONFIRMED-CODE:** this particular middleware is inactive
for factory-created models; changing the route's name to Claude does not enable it.

That is not a claim of zero cache handling in the whole codebase:

- `R/orchestration/mission/opplan.py:334-377` adds an ephemeral static cache
  breakpoint and an unmarked dynamic status block.
- `R/middleware/kg.py:195-233` adds an ephemeral static block plus dynamic KG
  summary/planning blocks.
- `infra/config/claude_code_handler.py:355-390,557-561,765-798` contains
  route-specific breakpoint handling and cache-usage mapping for the auth path.

Those code paths differ from the Silentium custom GLM route. Whether their
markers survive each transport conversion needs route-specific verification.
There is no universal OpenAI-compatible header that guarantees prompt caching.

### 2.2 What the record proves — Q05/Q07/Q08/Q09

`R/runtime/recording.py:159-205` reads usage from `usage_metadata`, then known
metadata fallbacks; it does not synthesize token counts. **CONFIRMED-RUN:**
all 1,115 model entries have `usage_source="usage_metadata"`; all have empty
`input_token_details`. These are runtime/provider-chain reported counts, not an
internal chars/4 estimate. They are not independently audited billing statements.

`LC-O:4008-4014` maps `prompt_tokens_details.cached_tokens` to `cache_read`.
The exported record lacks raw proxy/upstream chunks, so it cannot distinguish:

1. provider does not expose cache usage;
2. LiteLLM or another gateway drops it;
3. provider reports no cache bucket despite an internal KV cache;
4. no cache occurred.

**Correct answer:** cached-token quantity and discounts are **UNKNOWN**, not 0.
Fast identical responses do not identify whether the cause is KV reuse,
whole-response caching, replay, or another optimization. Moreover, identical
canonical request hashes in this run sometimes have different reported input
counts (§8.2); that discrepancy requires transport evidence.

Full prompt transmission is compatible with prefix caching. Byte-stable tool
schemas, system prefixes, and conversations can be cache-eligible even though
the client sends them again. Request-side block reconstruction by itself is not
a cache miss.

The checked-in `infra/config/litellm.yaml:771-888` has no response-cache
configuration block. This is configuration evidence, not proof that a running
proxy or an upstream gateway has no externally enabled cache.

## 3. Prompt assembly and context growth — Q01–Q04/Q26/Q27/Q29–Q31

### 3.1 Build-time content, request overlays, and state messages

`PromptBuilder.build` composes role text, cross-cutting instructions, tool
documentation, always-loaded workflow, cache-boundary text, current date,
shared fragments, and optional dynamic sections:
`R/intelligence/prompts/builder.py:260-323`. `load_prompt` applies composition
and overrides (`:326-416`).

Standard factories invoke `load_prompt` while building the graph; e.g.
`R/intelligence/agents/standard/postexploit.py:150-169`. The date is frozen for
**that built graph**, not intrinsically for every process lifetime. A rebuilt
graph or explicit custom prompt can differ. `BASH_PROMPT` is added via
`shared=["bash"]` (`R/intelligence/prompts/builder.py:189-199,358-373`).

| Component | Injection/storage lifecycle | Evidence |
|---|---|---|
| Role prompt + workflows/tool documentation | constructed at graph build; supplied as base system prompt each call | builder above; standard factories |
| Engagement, language, target/benchmark context | request-local system overlay from hydrated state | `R/orchestration/mission/engagement.py:397-411,441-510` |
| Skillogy policy + phase context | phase block rendered at middleware construction; reused in each system overlay | `R/middleware/skillogy.py:382-410,424-495` |
| Filesystem tool instructions | dependency filesystem middleware overlays conventions; exact form depends on installed version | `R/middleware/filesystem.py:336-351` |
| Subagent policy | orchestrator-only request overlay from subagent middleware | `R/intelligence/agents/middleware_slots.py:200-214`; `DA-A:390-420` |
| OPPLAN | static system block + dynamic objective table recomputed per request | `R/orchestration/mission/opplan.py:334-377` |
| KG | static system block + revision-cached state projection | `R/middleware/kg.py:133-183,195-233` |
| Background completion notices | `before_model` state update with HumanMessage reminder; then part of history | `R/middleware/notifications.py:204-323` |
| Opscontrol | system policy each call; HumanMessage on a state transition | `R/middleware/opscontrol_notifications.py:139-213` |
| Model/tool round trips | accumulated raw message state; effective request can be summarized/truncated | `DA-S:1048-1147` |

OPPLAN/KG overlays do not append another persistent conversation message each
turn. Background reminders do. This distinction matters when diagnosing
append-only history growth versus a fixed request overhead.

### 3.2 Tool schemas and final assembled surface

`R/intelligence/agents/build.py:466-530` assembles baseline/plugin tools and
optionally applies active exposure. Middleware instances also contribute tools:
filesystem, skills, task, OPPLAN, KG. Counting only `_STANDARD_TOOLS` misses part
of the final surface.

The record serializes tool **names only**, not schemas or model settings:
`R/runtime/recording.py:138-146`. Thus previously measured BASH/RESEARCH/web
schema budgets are snapshots of groups, not an exact invoice attribution or a
complete per-role schema count. A residual between chars/4 and reported tokens
also includes tokenizer mismatch, serialization, role markers and unrecorded
provider formatting; it is not “all tool schemas.”

### 3.3 Output size controls — Q29/Q30

`R/execution/tools/bash/bash.py:73,444-499,589-604` sanitizes output, returns
up to 15,000 characters inline, and normally moves larger output to a scratch
file with head/tail previews. Status markers have exceptions. Importantly,
`:466-477` returns only a truncation preview when workspace is `/workspace`,
explicitly declining to write root scratch output. “Offload always works” is
therefore incorrect even independently of the summarization bug.

Background notifications have their own 15K limit/head-tail handling and a
session-log pointer (`R/middleware/notifications.py:57-97`). Persisted child
transcripts default to an 8,000-character result cap while live events retain
the full result (`R/core/subagent_streaming.py:53-60,102-128,499-504`). These are
three different storage/model/UI budgets, not one global output limit.

**Run-only:** 856 bash call entries; median response 723 characters, p90 using
sorted index `floor(0.9 * N)` gives 9,432, maximum 12,968. All are character counts,
not KB or exact token counts. Outputs below the inline cap do not prove that an
offload path was exercised. Small individual outputs can still dominate input
once many old outputs are sent on later turns.

Only six surplus bash entries share identical complete args and agent name.
This metric includes description/session/options; it is not normalized shell
semantics and does not prove the absence of equivalent commands, repeated screen
reads, or broader unproductive loops.

### 3.4 Prefix measurements — Q03/Q04

The previous script sorts by timestamp at
`Run/analysis/audit_context.py:162-164`, then accidentally re-sorts each agent
by `seq` at `:167`. Since exported process parts overlap in sequence numbers,
its reported prefix and event measurements are not reliable as chronological
statistics. The script remains an earlier artifact; corrected figures below were
independently recomputed by completion timestamp and record line.

| Agent | Median equal message prefix | Mean effective message count | Adjacent equal full system payloads |
|---|---:|---:|---:|
| raptix | 36 | 42.49 | 80.31% |
| recon | 84 | 84.51 | 96.59% |
| exploit | 132 | 139.58 | 100.00% |
| postexploit | 91 | 106.98 | 99.86% |

Comparison uses the complete serialized message dict with sorted JSON keys.
It is per role, includes dispatch boundaries, and does not reconstruct provider
wire prefixes or measure cache hit rate. Concurrent instances of one role would
require thread/dispatch-aware pairing. Record `ts` is assigned **after** the
handler completes (`R/runtime/recording.py:417-437`), not at request start.

No identical serialized message dict repeats in the top-30 largest requests
in the earlier duplicate check (`Run/analysis/audit_context.py:135-153`). This
does not exclude repeated content under different tool-call IDs or duplication
between a skill, workflow, and system prompt.

## 4. Construction, routing, retries, and recovery — Q01/Q18/Q19

### 4.1 Common assembly path and role differences

`R/intelligence/agents/build.py:347-463` walks the slot enum, applies plugin
replacement/disable rules, skips conditional factories returning None, appends
additive plugin middleware, then substitutes Skillogy. The enum order and role
sets live in `C/contracts/slots.py:22-66,146-257`.

The RECORD slot is last among standard slots, but additive plugin middleware
can be appended after it. “Recorder is always innermost” is only true of the
unextended standard stack. Hook execution order and wrap nesting should also
not be conflated: `before_model`, `wrap_model_call`, and tool hooks differ.

| Family | Important additions to common base |
|---|---|
| raptix orchestrator | engagement, task/dispatch, OPPLAN, KG/planning, model override, opscontrol, opt-in HITL |
| recon | engagement, sandbox notifications, KG, flag-gated auto-ingest |
| exploit/postexploit | engagement, sandbox notifications, flag-gated auto-ingest; **no KG slot in the default mapping** |
| soundwave | engagement; no child dispatch |
| vulnresearch | task/dispatch and OPPLAN; separate role settings |
| domain specialists | declared role slot sets; composer reuses shared builders |

See `C/contracts/slots.py:194-257` and
`R/intelligence/agents/domain_composer.py:80-115`. KG can be absent when store
initialization fails (`R/intelligence/agents/middleware_slots.py:221-264`);
auto-ingest is conditional (`:267-287`). A claim that every fresh worker gets
live KG context or an OPPLAN table is therefore wrong.

Explicit factory `middleware=`/`tools=`/`system_prompt=` can replace defaults;
the library/plugin composition path is a documented configuration surface
(`R/intelligence/agents/standard/raptix.py:81-118,159-197`). Safety-critical slot
replacement/disable is gated by `build.py:293-339,414-420`.

### 4.2 Provider routing — Q01

Factory-created models send an OpenAI-compatible request through LiteLLM.
The `custom/<name>` route generator maps it to `openai/<name>` with
`CUSTOM_OPENAI_API_BASE` and `CUSTOM_OPENAI_API_KEY`:
`infra/config/litellm_dynamic_config.py:561-580`.

The Silentium alias is `custom/zai-org/GLM-5.3-Flash`; the earlier environment
inspection identified a Viettel gateway. This endpoint/model alias is a case
configuration, not a hardcoded Raptix backend or proof of the physical model
served behind a gateway. Different credentials, role overrides, model override,
fallback chains, and dynamic proxy routes can produce different behavior.

### 4.3 Retry layers — Q18

| Layer | Code/config evidence | Visibility in `record.jsonl` |
|---|---|---|
| Client SDK retry policy | `R/intelligence/llm/factory.py:1729-1750`; default `max_retries=2` in `C/utils/config.py:49` | attempts can be hidden inside one middleware round trip |
| LiteLLM completion retry | `infra/config/litellm.yaml:786-787` (`num_retries=3`) | requires proxy trace to count actual attempts |
| LiteLLM router retry/fallback | `infra/config/litellm.yaml:805-880` (`num_retries=5`, configured fallback groups) | requested model alias may differ from served model |
| Agent model fallback | `R/intelligence/agents/middleware_slots.py:319-328`; factory `:1683-1708` | handler re-invocations may be recorded if recorder is inside fallback |
| Summarization recovery/proxy fallback | §1.4 | downstream attempts may be repeated; summary model calls bypass recorder |
| New `task()` dispatch attempt | `R/middleware/dispatch.py:80-146,208-259` | a separate dispatch intent/ledger mechanism, not an SDK retry |

These configuration values do not imply a simple product of retries: exception
classification and the selected route determine which layers act. No escaped
exception entries in a run cannot establish that no retries occurred.

### 4.4 Recovery tool names — Q19

`R/intelligence/tooling/exposure.py:84-98,249` protects listed recovery names
from exposure filtering **when those tools are supplied**. The comments
explicitly state `inspect_context` and `diagnose_execution` have no runtime tools
yet; `ask_user` ships under `ask_user_question`. Tool availability must be checked
against the assembled role surface, not inferred from this allowlist.

## 5. Knowledge, skills, and handoff — Q20/Q21/Q24/Q25/Q27/Q28/Q35

### 5.1 KG state is durable but its prompt view is a bounded projection

`R/knowledge/graph/tools.py:84-143` accepts a JSON observation list with
`kind`, deterministic `key`, `label`, `props`, and `edges_out`, and injects
engagement/provenance. This **generic tool schema** has no required confidence
or verified-status field. It does not mean the entire codebase has no validation:
`R/execution/tools/research/tools.py:1556-1626` calls a PoC validation path,
including optional negative controls.

`R/middleware/kg.py:142-183` compares per-engagement revisions before model
decisions, rebuilds projections only on a change, and keeps summary strings in
state. `R/knowledge/graph/store.py:229-254` derives revisions from an atomic
counter plus legacy node/edge timestamps. Prompt injection uses system blocks,
not a new conversation message each turn (`kg.py:195-233`).

**Ranking/size behavior previously left untraced — Q35:**

- Vulnerabilities: query at most 20 rows, then local severity sort and top five
  (`R/knowledge/graph/summary.py:34-49,83-99`). The query has no severity ordering
  before `LIMIT`; this is not a guaranteed global top-five ranking.
- Open entrypoints: at most three without a scoped HAS_VULN edge (`:102-115`).
- Crown jewels: at most ten, with path counts over up to six hops (`:118-134`).
- Planning context: at most three jewels; one path per jewel ordered by
  **hop count**, bounded to six hops (`:212-249`). Despite “cheapest” in naming,
  this implementation does not minimize edge weights, exploit risk, or USD cost.
- Result row limits bound returned rows but do not necessarily bound the work
  of variable-length Cypher path enumeration.
- No wall-clock TTL is applied by this summary-rebuild path. A stale-node
  deletion primitive exists (`R/knowledge/graph/store.py:546-568`), but repository
  caller search found tests rather than a production scheduler. It must not be
  described as automatic expiry.

A summary is therefore a useful selective view, not a complete verified memory
of all attempts. Skillogy retrieval is a separate service and should not be
conflated with this engagement KG projection.

### 5.2 Skillogy lifetime and dedupe — Q28

Skillogy is on by default unless explicitly disabled (with a legacy enabling
flag): `R/middleware/skillogy.py:151-166`. Its load tool uses a closure-local
`loaded_keys` set (`:187-206,240-272`), keyed by requested name and resolved
canonical path. `force=true` bypasses suppression.

**CONFIRMED-CODE:** dedupe lifetime is the tool/middleware **instance**, not a
thread ID, dispatch ID, or engagement ID. Standard orchestrator construction
builds child factories once (`raptix.py:149-157`), so graph reuse shares that
set across fresh dispatch message lists. Module-level graph reuse can also
share it across threads/engagements in a server process. A newly built graph
has a new set; “always process-wide” is too broad.

The “already in your context” response can therefore be false on a fresh
dispatch, after compaction, or after reconnect to a new conversation. Correct
scoping should be derived from conversation/dispatch state, not a shared closure.
This conclusion is code-level and does not depend on a CAPTCHA lab.

### 5.3 Handoff guarantees and limitations — Q24/Q25/Q27

Fresh dispatch means a new input conversation for a **reused compiled graph**,
not a new middleware instance. `DA-A:534-540` creates one HumanMessage carrying
the orchestrator's task description. It does not automatically read findings,
enforce checkpoint completeness, or prove worker progress was saved to KG.

Handoff information may come from the description, workspace files, declared
shared state, optional KG overlays, OPPLAN state, and final child report.
The default task return is the final nonempty AI text plus non-excluded state
(`DA-A:494-532`). Raptix adds durable UI transcripts, normally capped per result;
those transcripts are not automatically injected wholesale into the parent's
model conversation.

The dispatch boundary preserves typed failures/partial file references and
tracks terminal intents; see `R/core/subagent_streaming.py:237-272` and
`R/middleware/dispatch.py:148-196`. A “success” ledger outcome means no captured
dispatch exception, not independent verification that the objective is complete.

OPPLAN is a separate graph-state mechanism. Its per-request system table
reflects objective status (`R/orchestration/mission/opplan.py:353-366`), and
objective mutations validate transitions/dependencies
(`R/execution/tools/opplan.py:655-725`). It is not present in every child's
default slot set. Finishing a lab does not establish lossless handoff quality.

Mid-life context replacement with a validated handoff bundle is not implemented
by the standard `task` boundary. Redispatch can support that design, but it
requires an explicit checkpoint contract and outcome checks; it is not already
guaranteed by “fresh context per objective” documentation.

### 5.4 Artifact terminology — Q21

The run has no truthy LangChain `ToolMessage.artifact` fields in 1,173 serialized
tool entries (`R/runtime/recording.py:208-216`). This does **not** prove that
no files/evidence were created or no core `ArtifactStore` access occurred.
LangChain artifact fields, core `Artifact` references, sandbox scratch paths,
and workspace finding files are distinct interfaces. Command serialization
also does not retain every nested artifact value (`recording.py:219-234`).

## 6. Termination, dispatch budgets, and durability — Q22/Q23/Q32–Q34

### 6.1 Actual standard-agent limits

| Agent | Current bound recursion limit | Evidence under `R/intelligence/agents/` |
|---|---:|---|
| raptix | env default 400; factory argument can override | `standard/raptix.py:74-78,197-202` |
| recon | 1,000 | `standard/recon.py:79,157-161` |
| exploit | 1,000 | `standard/exploit.py:92,170-174` |
| postexploit | 400 | `standard/postexploit.py:81,159-164` |
| soundwave | 200 | `standard/soundwave.py:66,135-139` |
| domain specialist | definition-specific | `domain_composer.py:109-115` |

`DA-A:553-563` explicitly says the subagent's **bound** config wins collisions,
including `recursion_limit`. Parent metadata/configurable fields can still
propagate. Worker limits must be inspected per compiled graph.

A recursion limit is a graph-superstep bound, not a count of model calls or tool
calls. Hooks, parallel tools, dispatch boundaries, and separate child graphs
make those counts non-equivalent. The earlier “21 wasted supersteps” cannot be
derived exactly from record counts and is withdrawn.

**Run-only:** 14 recorded `task` calls name recon five times, exploit twice, and
postexploit seven times. A task entry is a boundary invocation; it does not prove
a new graph instance was built, nor that a child completed successfully.

### 6.2 Other bounds are real but not interchangeable

- `BoundedWorkerRunner` enforces `min(CompletionSpec.max_steps,
  WorkerSpec.step_budget)` in its primitive loop:
  `R/execution/workers/runner.py:151-223`. Repository usage search found its
  exports/tests, not standard-agent `task()` construction wiring. Its mechanism
  is implemented, but it is not the termination budget for the standard agents.
- `DispatchMiddleware` limits the ledger to 256 distinct dispatches, blocks
  in-flight duplicates, and records terminal repeated failures for the same
  intent (`R/middleware/dispatch.py:35,94-146,148-196`). It does not bound a
  successful-but-unproductive stream of changing commands inside one dispatch.
- `BudgetEnforcementMiddleware` is disabled for nonpositive caps; when enabled
  it consults LiteLLM spend, caches reads (default 5 seconds), and stops before
  a later model call (`R/middleware/budget.py:160-204,223-263,288-299`). Query
  failures fail open (`:232-240,315-344`). Its role-scope fallback and omitted
  direct-summary model-handler path also need accounting validation.
- Model output-token limits and request timeouts bound one request, not total
  engagement effort (`R/intelligence/llm/factory.py:1729-1750`).

The exported log records child recursion failures at 17:37:02 and 17:48:43
(`Run/logs/langgraph.log:1050,1672`). This directly contradicts a broad
“no runtime errors” reading of the old report even though no exception-type
record entries were written.

### 6.3 Checkpoints and resume — Q34

`langgraph.json:29-31` selects
`R/interfaces/api/checkpointer.py:11-17`: `AsyncSqliteSaver`, path overridden by
`RAPTIX_CHECKPOINT_PATH` or default `.langgraph_api/checkpoints.sqlite`.
`docker-compose.yml:447-448` persists the default location in `langgraph_state`.

**CONFIRMED-CODE:** default Compose checkpoint storage can survive container
recreation. This is separate from workspace evidence mounts, external KG, and
in-memory closure sets. A different path, custom graph caller, or different
deployment can have a different durability contract.

**UNKNOWN:** exactly-once semantics for arbitrary external tool side effects.
Checkpoint durability does not transactionally bind an HTTP/shell side effect
to a saved graph update. `StreamingRunnable` explicitly avoids rerunning when
a stream yields no state (`:599-618,726-743`), but that is not universal crash
idempotency. Use execution IDs/reconciliation for any replay-sensitive tool.

## 7. Recording fidelity and redaction — Q05/Q36

`R/runtime/recording.py:122-156` captures message content, tool calls, system
content, model alias and tool names. It does not capture the complete wire
payload: tool schemas, temperature/model settings, served-model metadata, and
per-message response metadata/usage are omitted. It cannot fully reconstruct
cache keys, provider retry counts, or the summarizer's scaling state.

Canonical request hashes deliberately remove IDs and timestamp-like dict fields
(`recording.py:102-119`). Equal `req_hash` means equality under that projection,
not proof of byte-identical HTTP bodies or identical hidden sampling parameters.
The sink records on completion and uses a per-path writer. Current code counts
existing file lines to initialize seq (`:260-277`); sequence collisions in the
historical merged export are not automatically a bug in today's sink.

**CONFIRMED-CODE:** recording is opt-in via `RAPTIX_RUNTIME__RECORD_PATH`
(`R/intelligence/agents/middleware_slots.py:417-440`). It persists raw request
and response contents. The run contains sensitive values; this report does not
copy those credentials again.

`R/middleware/event_logging.py:79-116` is a **content-free argument summarizer**:
strings become `<str:N>`, collections become shape descriptions, sensitive
keys are masked. It is not a full-text secret scrubber for arbitrary model/tool
responses. Applying it directly to replay records would destroy replay fidelity
and still requires a response-text policy.

Separate operational telemetry from restricted replay capture: scrub exported
copies for sharing, control raw capture retention/access, and explicitly decide
whether a sanitized artifact is replayable. Do not promise that simply reusing
`_redact_args` preserves deterministic replay.

## 8. D3 — Corrected Silentium compaction/event report

This section is case evidence, not a universal Raptix workload profile.
Record line numbers are one-based in the exported `workspace/record.jsonl`.

### 8.1 One observed summary, then a contaminated parent projection

| Observation | Record evidence | Interpretation |
|---|---|---|
| Last large postexploit request | line 1305, 17:15:58; 150,601 input tokens, 166 effective messages | last observed request before summary; not the exact raw cutoff batch |
| First summarized postexploit request | line 1307, 17:17:05; 24,312 input tokens, 7 effective messages | one observed distinct summary, 5,359-character serialized summary message; no offload pointer |
| Child result forwarded | line 1407, 17:18:46; `task` update includes `_summarization_event` | summary event crosses child→parent boundary |
| First collapsed parent request | line 1408, 17:18:55; 21,367 input tokens, 1 effective message | summary message exactly matches line 1307; not a distinct parent summary |
| Resume warnings | exported log lines 362–382; cutoff 162 > growing parent message count | retained cross-conversation cutoff explains hidden tool results |

The complete serialized summary-message SHA-256 at both first appearances is:

```text
eb2f6d1afb9c489f5cedc65a1fd88b37ff4038c09c485cb92eb5d9712572f5b8
```

This provides stronger evidence than a token-drop heuristic. Summary calls
themselves bypass the recorder, so “one observed distinct summary” is deliberately
not a certified total of every attempted summary model call.

### 8.2 Repeated canonical requests

| Group | Lines | Calls / surplus after first | Recorded input pattern |
|---|---|---|---|
| Early orchestrator/recon dispatch pattern | 32,35,48 | 3 / 2 | 20,718 then 13,726 twice |
| Parent collapse before abort | 1408,1412,1416,1420,1424,1428,1432 | 7 / 6 | 21,367 then 14,042 six times |
| Parent collapse after resume | 1436,1439,1442,1445,1448 | 5 / 4 | 21,367 then 14,042 four times |

Total surplus equal-hash requests: 12. The two collapsed-parent groups contribute
**10 surplus calls and 140,420 recorded input tokens** after excluding their
first calls. That accounting is not the same as billing, nor does it certify
that every surplus call had no purpose. The earlier 11-call/154K/21-superstep
estimate is withdrawn.

Short follow-up durations (roughly 0.1–0.3 s) coexist with lower reported input
counts for equal canonical hashes. Do not infer greedy decoding, prefix KV
caching, or a prompt-cache discount from that alone.

### 8.3 Exploration window — Q31

For postexploit calls completing in `[17:12:00, 17:18:46)` on 2026-10-07:
114 model entries report **9,331,550 input tokens**, about 16.0% of this record's
input total. Their emitted tool calls are 109 bash + 6 write_file; emitted calls
and completed tool-record entries are different counts. Whole-run argument
keyword matching finds 167 captcha/OCR-related tool entries, not necessarily
167 attempts at the same strategy.

This is an illustrative high-cost exploration segment. The record does not
prove that all its tokens were avoidable or generalize its cost to another lab.
Evaluate progress, alternative availability, and handoff decisions before
labeling the entire window “waste.” Different command strings also do not imply
different hypotheses.

## 9. D4 — Token and context attribution

### 9.1 Recorded totals, independently recomputed

| Agent | Model entries | Reported input tokens | Reported output tokens | Mean input |
|---|---:|---:|---:|---:|
| postexploit | 720 | 39,305,746 | 719,974 | 54,591 |
| exploit | 178 | 11,282,659 | 83,871 | 63,385 |
| raptix | 128 | 4,248,634 | 109,841 | 33,192 |
| recon | 89 | 3,515,061 | 23,930 | 39,495 |
| **Total** | **1,115** | **58,352,100** | **937,616** | **52,334** |

Input/output ratio is about 62.24:1. These totals exclude unrecorded direct
summary invocations and do not independently count hidden transport retries.
The file is 220,439,296 bytes, 2,288 entries including 1,173 tool entries.
No response has exception `type="error"`; 19 ordinary tool responses have
`status="error"`. Additional errors inside Command messages/plain error JSON
and graph logs require separate classification.

### 9.2 Cumulative character footprint, not billed-token buckets — Q02

Method: across every recorded model request, flatten text system blocks and
message contents, count tool-call JSON separately, and sum recurring characters.
This measures what repeatedly appears in recorded context; it excludes tool
schemas, wire formatting, role markers and non-text media tokenization.

| Recorded-context component | Share of counted characters |
|---|---:|
| bash ToolMessage text | 40.45% |
| complete system text, including its overlays | 28.28% |
| AI tool-call JSON | 15.93% |
| loaded skill text | 4.17% |
| read_file results | 3.84% |
| non-summary HumanMessage text/reminders | 2.45% |
| AI prose | 1.89% |
| other tool text + summaries | 2.99% |

Among only the top-20 largest requests (all postexploit), bash text is
73.89–85.79%, system 6.69–8.40%, read_file text 6.90–8.49%, and tool-call JSON
5.71–7.74%. These separate ranges do not form a single additive pie chart.

The old estimated 58.35M-token allocation is removed: character shares cannot
be relabeled as exact provider token shares, and the proposed bucket ranges did
not form a complete, non-overlapping allocation. System overlays must not also
be counted a second time as “injectors.” Cached-token attribution is UNKNOWN.

| Agent | Observed system blocks | Mean system characters | Full-system variants |
|---|---:|---:|---:|
| raptix | 7–11 | 54,651 | 26 |
| recon | 7 | 55,809 | 4 |
| exploit | 5 | 65,583 | 1 |
| postexploit | 5 | 43,506 | 2 |

Dividing the cumulative system character count by four gives about 13.74M
**proxy tokens**, not audited usage. Raw role-prompt size, complete system size,
and removable prompt content are different budgets. Postexploit mean input
54.6K is below exploit 63.4K; the previous statement that it was above is
arithmetically wrong. Neither average measures incremental post-compaction
reorientation cost without a counterfactual baseline.

## 10. D1 — Codebase root-cause and risk matrix

IDs below are stable within this revision: C1 is state leakage; C4 is estimator
calibration. The old executive summary incorrectly mixed those identifiers.

| ID | Mechanism | General scope / condition | Evidence status | Priority |
|---|---|---|---|---|
| C1 | Streaming last-state return bypasses private output projection; task forwards `_summarization_event` | stream-enabled orchestrator/child handoff with summarization channel | CONFIRMED-CODE, REPRODUCED, CONFIRMED-RUN | P0 |
| C2 | Summary artifact root and backend binding differ from scoped filesystem path | fenced sandbox rejects outside root; shared servers also need runtime endpoint/scoping | CONFIRMED-CODE; failed pointer observed; exact historical HTTP error is inference | P0 |
| C3 | Anthropic-only caching middleware sees ChatOpenAI subclasses | all default factory routes; other cache mechanisms may still act | CONFIRMED-CODE; actual upstream savings UNKNOWN | P1 measurement |
| C4 | Unknown model capacity and approximate counting with no downward scaling | missing profiles; format/language/schema dependent | CONFIRMED-CODE; universal 15% bias not established | P1 measurement |
| C5 | Skill-load dedupe belongs to shared instance instead of conversation | reused graph across dispatches/threads | CONFIRMED-CODE | P1 |
| C6 | Static role/workflow/tool instructions recur; history retains many prior tool outputs/arguments | long standard-agent dispatches, independent of lab | CONFIRMED-CODE; case character budgets measured | P1 evaluation |
| C7 | Recorder capture boundary omits summary/SDK attempts and stores sensitive raw content | recording-enabled runs | CONFIRMED-CODE; sensitive export observed | P1 |
| C8 | Overflow exception translation / summary error-string acceptance / broad second handler call | failure branches on proxied models and summary helper | CONFIRMED-CODE; translator REPRODUCED | P0/P1 |
| C9 | Recursion/USD/dispatch limits do not measure semantic progress | bounded but changing-command exploration | CONFIRMED-CODE; case window illustrates cost, not guaranteed savings | evaluation |

## 11. D2/D5 — Lifecycle and optimization roadmap

### 11.1 Context lifecycle

```text
Graph construction (standard or domain factory)
  -> resolve role model + fallback chain
  -> build backend / role tools / middleware / prompt
  -> compiled graph + reused middleware instances
       |  instance caches: Skillogy phase text + loaded_keys
       v
Dispatch boundary
  -> copy non-excluded parent state
  -> child messages = [HumanMessage(task description)]
       v
Agent turn
  -> before_model: KG revision hydration / completion notices
  -> request system overlays: engagement / skills / filesystem / task / OPPLAN / KG
  -> model selection + per-run proxy key
  -> summarization: apply prior event; truncate old write/edit args; estimate
       | not over threshold -> downstream model call
       | summarize -> offload + direct summary model call
       |               -> effective [summary] + retained tail
       |               -> commit event after successful downstream call
       v
Record downstream round trip (partial serialization, completion timestamp)
  -> raw graph messages grow; effective model projection can stay short
       v
Child finishes/fails
  -> StreamingRunnable returns last full state + durable UI transcript
  -> deepagents filters its explicit excluded keys
  -> DispatchMiddleware adds outcome/ledger
  -> parent checkpoint update
       !! leaked private child event can affect parent's unrelated messages
```

Raw checkpoints, effective model context, filesystem history artifacts, KG
projections, UI transcripts, and recording capture are separate stores/views.
Correctness requires their boundaries to agree; “fresh context” alone is
insufficient.

### 11.2 Prioritized changes, with acceptance criteria

These are recommendations, not runtime changes applied by this audit.

| Order | Change | Required acceptance evidence |
|---|---|---|
| R1 — P0 | Enforce explicit private-state isolation on child→parent output **and** parent→child input; preserve intended transcript/mission channels | real compiled child + actual streaming adapter + task/dispatch; summary cutoff must remain conversation-local; normal/error/parallel/resume paths |
| R2 — P0 | Align summary artifact root, runtime sandbox resolution, and engagement scoping with filesystem backend | isolated bind-mount and shared-subdirectory tests; per-run endpoint/key; written pointer is readable by child's tools; retain path fences |
| R3 — P0 | Preserve `ContextOverflowError` through transport translation; treat failed summary text as a failed compaction; review broad handler re-invoke | synthetic overflow reaches summarizer; failed summary does not replace useful context; downstream failure does not silently repeat unbounded requests |
| R4 — P1 | Scope skill dedupe to dispatch/thread state and effective context | repeated loads within one visible context are short; fresh dispatch/reconnect/compaction can obtain the body; no cross-engagement suppression |
| R5 — P1 | Measure cache behavior per route before changing caching integration | raw request/usage at both proxy and provider boundary; cache-read/write buckets and invoices where available; supported flags only |
| R6 — P1 | Configure real input capacity separately from tokenizer calibration | profile changes thresholds as intended; counter tested on multilingual/tool-heavy requests and model overrides; retained tail/output headroom stays safe |
| R7 — P1 | Reduce duplicated prompt/workflow/schema content based on final role surface | per-role token budgets and before/after success/failure replay; keep RoE/OPSEC/injection defenses and genuinely needed workflow always available |
| R8 — P1 | Add direct summary/attempt/served-model/compaction observability; separate restricted replay capture from structural telemetry | account for every invocation without logging raw secrets to telemetry; sanitize shareable exports; document replay fidelity |
| R9 — evaluation | Establish per-dispatch checkpoint/handoff and semantic-progress signals; consider a separate standard-agent step budget | multi-objective/cross-domain benchmark, distinct command sequences, resume and partial evidence; L7 blocking/pruning needs explicit sign-off per initiative rules |

No guaranteed percentage savings is asserted. Prompt footprints are upper
bounds on candidate recurring costs, not removable budgets. Setting model
profile capacity does not install a tokenizer. `CompletionSpec.max_steps`
integration requires an explicit adapter/step definition; it is not a one-line
fix to standard LangGraph dispatch.

### 11.3 Experiments — retained Q37–Q40 references

| Ref | Experiment | What it establishes |
|---|---|---|
| Q37 | route-specific synthetic cache test: repeated prefix, changed suffix, fresh conversation, with raw usage at both sides | whether usable cache metadata/discounts exist; latency alone is insufficient |
| Q38 | confirm capacity from operator/provider configuration; bounded synthetic boundary checks with output headroom | deployment-specific input limit and overflow typing, not a guessed universal GLM limit |
| Q39 | restore exact tool schemas/model settings for offline counter calibration; compare language/output mixes | estimator bias distribution; adding a profile and calibrating a counter are separate interventions |
| Q40 | child compaction + real wrapper/dispatch + parent, including parallel calls and resume | isolation and offload regressions independent of any lab |

Revalidation executed the offline mechanism probes in §1.1/§1.2/§1.4. It did not
send synthetic paid LLM requests, run a new engagement, or execute these proposed
provider experiments. Record statistics were computed offline using local
Python 3.13.5; dependency mechanism probes used the container's installed runtime.

## 12. Coverage and verification record

| Retained Q references | Revised location / qualification |
|---|---|
| Q01 | §3–§4: common construction and route-specific configuration |
| Q02–Q04 | §3.4, §9: corrected chronological prefixes and character attribution; exact schema/wire attribution unavailable |
| Q05–Q09 | §2, §7: reported usage, cache middleware applicability, missing raw cache/billing evidence |
| Q10–Q12 | §1.2: trigger/counter/retention; Q12 title reconstructed as retention mechanics |
| Q13–Q17 | §1.3–§1.4, §8: summary content/input, offload, event identity, failure/overflow paths |
| Q18–Q19 | §4.3–§4.4: retry boundaries and actual recovery surface |
| Q20–Q21 | §5.1/§5.4: generic KG schema versus validation; distinct artifact interfaces |
| Q22–Q25 | §5.3/§6: dispatch/handoff and separate termination budgets |
| Q26–Q29 | §3/§5: build-time prompt versus system overlays; skill lifetime and output handling |
| Q30–Q33 | §3.3/§8/§6: repetition metric limits, case window, dispatch counts versus supersteps |
| Q34–Q36 | §6.3/§5.1/§7: checkpoints, projection ranking/expiry, restricted raw recording |
| Q37–Q40 | §11.3: proposed experiments, not claimed executed provider tests |

**Offline probes actually executed during revalidation:**

1. Recomputed all 2,288 record entries, per-agent token totals, full-system block
   counts, timestamp-ordered message prefixes, canonical request groups,
   ToolMessage error statuses, summary identity, and the exploration window.
2. Constructed the installed summarization factory with an inert model/backend;
   confirmed `trim=None`, trigger/keep defaults and `/conversation_history` root.
3. Executed a synthetic StateGraph through the actual streaming wrapper and
   deepagents task tool; confirmed private event omission on normal output and
   leakage through streamed last-state output.
4. Passed a synthetic OpenAI overflow through Raptix's error translator;
   confirmed loss of `ContextOverflowError` type.
5. Checked 77 explicit repository/export citation ranges for existing files and
   valid line bounds; verified Markdown fences/whitespace and independently
   confirmed no duplicate serialized message dicts in the top-30 requests.

Temporary probe scripts are
`C:\Users\tuanp\AppData\Local\Temp\opencode\recheck_context_record.py` and
`recheck_context_mechanism.py`. Source claims above point to repository/installed
dependency locations; case claims point to exported record/log lines rather than
depending solely on temporary outputs.

The first mechanism probe imported runtime packages whose startup discovery
opened the opt-in recording sink; no recorded model/sandbox tool handler ran, and the
live `/workspace/record.jsonl` was verified at **0 bytes** afterward. Subsequent
probe runs unset the recording environment variable. Probe files were copied
only to `/tmp`; no engagement was started and no runtime source was edited.

**Remaining unknowns:** physical served model, real cache/billing semantics,
historical exact offload HTTP error, exact summary-model input/usage, exact
provider-attempt count, and external side-effect crash idempotency. The original
question wording is needed only to certify one-to-one coverage of that brief;
it is not needed to use the verified code-level conclusions in this revision.
