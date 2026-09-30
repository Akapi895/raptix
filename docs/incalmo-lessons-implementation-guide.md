# Incalmo-lessons — Implementation Guide (safe subset)

> Briefing pack for sub-agents implementing the safe subset of the Incalmo-lessons
> initiative. **Standing rules: [`../AGENTS.md`](../AGENTS.md)** (read first).
> This guide gives per-lesson **work packages (WP)** with exact edit scope, so each
> can be handed to one sub-agent as a single ≤400-line / one-concern PR + ADR.
>
> Scope reminder: only **L2a, L2b, L6, L7-obs, L9** are in scope. L1/L3/L4/L5/L7-blocking
> are OUT (need a T2 benchmark first — see AGENTS.md).

---

## Global rules (recap — full text in AGENTS.md)

- **Never touch** the exploit-execution path (`tools/bash/*`, sandbox dispatch, Sliver/msf/impacket) or the guardrail stack (`SafeCommand`, `middleware/roe.py`, `EngagementContext`, `middleware/egress.py`, `middleware/hitl.py`, `.semgrep/raptix-no-*`).
- **Fail-safe hooks**: any post-tool hook wraps work in try/except and returns the original tool result unchanged on error — a hook failure can never break/alter/delay tool execution.
- **KG is canonical**; auto-ingest is an added trusted write path, not a second source of truth.
- **Per WP**: one ADR (`docs/adr/`, follow 0001/0002) + one PR ≤400 runtime lines / ≤10 files / one concern.
- **Tests before merge**: T0 unit (deterministic, fixtures, no LLM) + T1 replay (`runtime/recording.py` `ReplayMiddleware`). No agent A/B required for this subset.
- **Flag-gate** any change that alters agent input, default reversible.
- Obey CLAUDE.md AI-slop ban; no AI co-author trailers.

### Definition of Done (every WP)
1. ADR merged (or drafted in the PR) describing the change + blast radius.
2. T0 unit tests green, incl. an explicit **fail-safe test** where the mechanism raises and the tool result / agent flow is provably unaffected.
3. T1 replay of a recorded run green with no behavioral regression.
4. Change behind a flag, default documented.
5. `make quality` green; diff ≤400 runtime lines / ≤10 files / one concern.

### Dispatch order (within safe subset)
1. **WP-L2a** (auto-ingest hook) — highest value, foundational for trustworthy state.
2. **WP-L7-obs** (tried-edge ledger, observational) — builds on the same hook seam.
3. **WP-L6** (constrained decoding) — investigate-first; may end in a "defer" memo.
4. **WP-L2b** (extend parsers) — narrow; only real gaps.
5. **WP-L9** (structure knob) — lowest; likely defer until an in-scope toggle exists.

Repo anchors: middleware use `wrap_tool_call`/`awrap_tool_call`/`after_model`/`wrap_model_call` hooks (see `middleware/kg.py`, `middleware/event_logging.py`); `KGMiddleware` (`middleware/kg.py`) provides `kg_ingest`, KG-context injection (`_inject_kg_context`), and `KGStore` (`middleware/kg_internal/store.py`). Its scoped scanner adapters live in `middleware/kg_internal/ingest.py` (nmap/httpx/nuclei/SARIF); the broader legacy `kg_ingest_*` tools in `tools/research/tools.py` use a compatibility shim. `MiddlewareSlot` and `SLOTS_PER_ROLE` live in `decepticon_core.contracts.slots`, default factories in `agents/middleware_slots.py`, assembled by `agents/build.py::build_middleware`. Scanner files live in the HTTP sandbox, not the LangGraph container.

---

## WP-L2a — Auto-ingest KG state (fail-safe post-tool hook)  ·  Value: High · Risk: Low · Effort: Low-Med

**Objective.** After a network scanner tool completes, automatically run the matching
`kg_ingest_*` parser so the KG reflects reality — the LLM no longer has to remember to
call `kg_ingest`. This makes downstream state trustworthy (kills a class of
"claimed progress but KG empty" loops).

**In scope**
- New middleware `packages/raptix/raptix/middleware/kg_autoingest.py`.
- Register a new `MiddlewareSlot` member + add it to `SLOTS_PER_ROLE` for network roles only (`recon`, `exploit`, `postexploit`, `ad_operator`, `cloud_hunter`) in `decepticon_core.contracts.slots`.
- Register its default factory in `agents/middleware_slots.py`; `agents/build.py::build_middleware` assembles it without special-case logic.
- A **curated allowlist** mapping `{tool/command signature → existing scoped adapter}` in `middleware/kg_internal/ingest.py`, without modifying legacy parsers.

**Out of scope (do NOT touch)**
- `tools/bash/*`, sandbox dispatch, any guardrail middleware.
- `KGMiddleware` behavior in `middleware/kg.py` (add a sibling middleware; don't modify it).
- The `kg_ingest_*` functions themselves (reuse only).

**Change spec**
- Implement `async def awrap_tool_call(self, request, handler)`:
  1. `result = await handler(request)` (tool runs exactly as today).
  2. `try:` detect a successful foreground tool call from `request`; locate its output — prefer an explicit absolute workspace file (`nmap -oX <f>`, `nuclei -jsonl -o <f>`, `httpx -json -o <f>`); read bounded bytes via the HTTP sandbox and call the matching scoped adapter. For nmap XML stdout, capture bounded text to a temp file, ingest, delete.
  3. `except Exception:` log at debug; **always `return result`** (original, unchanged).
- Start with `nmap`, `httpx`, `nuclei`: their scoped KGStore adapters already exist. Do not assume legacy `masscan`, `subfinder`, `crackmapexec` parsers are interchangeable; leave them manual until a safe scoped write path and output location are verified.
- Gate behind `RAPTIX_KG_AUTOINGEST` (default **off** for initial release; enable with `=1` after validation in a test engagement).

**Honest caveats**
- The hard part is *reliably locating tool output*; the existing ingesters are file-path based. Only auto-ingest where the output path is unambiguous. Bound any temp-file work; never block on it.
- Because it changes KG contents (LLM input), it is flag-gated and T1-replay-checked, though it does not touch execution.

**Tests**
- T0: fixture nmap XML → assert KG nodes created via the hook. **Fail-safe test**: make the ingester raise → assert the original tool result is returned unchanged and no exception propagates.
- T1: replay a recorded recon run → assert KG is populated *without* the LLM's manual `kg_ingest` calls; assert no change to tool outputs.

**Acceptance**: allowlisted tools auto-populate KG; fail-safe proven by test; execution untouched; flag works.

<details><summary>Sub-agent brief (paste)</summary>

Implement WP-L2a from `docs/incalmo-lessons-implementation-guide.md`: a fail-safe
post-tool middleware that calls the scoped KGStore adapters after allowlisted
network scanners (nmap/httpx/nuclei).
New file `middleware/kg_autoingest.py` implementing `awrap_tool_call` that runs the
tool via `handler`, then ingests in a try/except that ALWAYS returns the original
result unchanged. Register a new `MiddlewareSlot` in `decepticon_core.contracts.slots`
(network roles only) and its factory in `agents/middleware_slots.py`. Reuse existing
`middleware/kg_internal/ingest.py` adapters; do not modify `tools/bash/*` or guardrails.
Gate on `RAPTIX_KG_AUTOINGEST` (default off). Write an ADR (`docs/adr/`) and T0
unit tests including a fail-safe test (ingester raises → tool result unchanged, no
exception) + a T1 replay test. One PR ≤400 runtime lines, one concern. Follow
`../AGENTS.md` non-negotiables.
</details>

---

## WP-L7-obs — Tried-edge + fail-reason ledger (observational only)  ·  Value: Med · Risk: Med · Effort: Low

**Objective.** Record each attempt as an edge (attacker→target, technique/tool,
outcome, fail-reason) and surface a bounded "recently tried + outcomes" section in
the model context, so the LLM stops blindly repeating dead moves — **without blocking anything**.

**In scope**
- A small recorder writing `TriedEdge(attacker, target, technique, outcome, reason, ts)` — reuse the edge model in `tools/research/chain.py` / `_state.py` and `KGStore`.
- Extend KG-context injection `middleware/kg.py::_inject_kg_context` (or emit from the L2a hook / `after_model`) with a **bounded** "Already tried (retry only with a changed parameter)" section.
- Coarse outcome/fail-reason classifier from the tool result: `success | blocked | error | no_change`.

**Out of scope (do NOT)**
- Any gating/blocking of actions, OPPLAN transitions, or dedup that removes options. Observational only.

**Change spec**
- Cap at N most-recent edges (e.g. 20) so the prompt cannot grow unboundedly.
- Rendering states outcomes; it never forbids a retry — it says "do not blindly repeat; retry only with a changed parameter."

**Honest caveats**
- Keep the classifier coarse; do not overfit. This only *informs* the LLM — its value depends on the model heeding it. If you later want it to *block*, that is the OUT-of-scope L7-blocking half (needs a benchmark).

**Tests**
- T0: recorder produces the correct edge from a sample tool result; injection renders bounded text.
- T1: replay run shows tried-edges accumulate; **assert no action is ever blocked**.

**Acceptance**: context shows tried edges + reasons, bounded; nothing blocked; flag-gated.

<details><summary>Sub-agent brief (paste)</summary>

Implement WP-L7-obs from the guide: an OBSERVATIONAL tried-edge ledger. Record each
attempt (attacker→target, technique/tool, outcome, fail-reason) reusing the edge
model in `tools/research/chain.py`/`_state.py` + `KGStore`, and surface a bounded
(≤20) "already tried, retry only with a changed parameter" section via
`middleware/kg.py::_inject_kg_context`. Coarse classifier: success|blocked|error|no_change.
ABSOLUTELY no blocking/pruning/dedup-removal — recording + surfacing only. Flag-gated.
ADR + T0 tests (recorder correctness, bounded render) + T1 replay test asserting no
action is blocked. One PR ≤400 lines, one concern. Follow `../AGENTS.md`.
</details>

---

## WP-L6 — Constrained/structured decoding  ·  Value: Med (format only) · Risk: Low · Effort: Med · **Investigate-first**

**Objective.** Reduce parse/format failures at decision points by enforcing
structured output at the model-call seam.

**Reality check (why investigate-first).** Raptix has **no explicit decode seam** —
tool-calling is delegated to `langchain.agents.create_agent`. LangChain function-calling
already validates the tool schema, so the marginal value is smaller than for a raw
text-tag agent, and **it only fixes format, not decision quality**. Provider support
for grammar/JSON-schema varies across the LiteLLM fleet.

**In scope**
- **Step 1 (memo):** map the model-call path — `agents/build.py` (`create_agent`), `llm/` (factory/router), and the `wrap_model_call` middleware hook. Measure current parse/format-error rate from logs.
- **Step 2 (only if Step 1 finds a clean, provider-agnostic seam with measurable error reduction):** implement a `wrap_model_call` middleware that requests provider-side structured output where supported, degrading gracefully where not.

**Out of scope (do NOT)**
- Changing decision *content*; hardcoding a provider in a way that breaks multi-provider LiteLLM routing; touching function-calling for tools that already work.

**Honest caveats & recommendation**
- If Step 1 shows parse errors are already rare (FC covers them), **deliver the memo and DEFER** — do not add machinery for negligible gain. This WP is allowed to end in a documented "defer".

**Tests (if it lands)**
- T0: a malformed decision is constrained/rejected cleanly (no loop); a valid decision passes unchanged.
- T1: replay shows no decision-distribution regression; multi-provider still works.

**Acceptance**: parse-error rate down with unchanged decisions on replay and working multi-provider — OR a "defer" memo with the measured error rate.

<details><summary>Sub-agent brief (paste)</summary>

Do WP-L6 from the guide, INVESTIGATE-FIRST. Step 1: write a short memo mapping
Raptix's model-call/tool-calling path (`agents/build.py` create_agent, `llm/`,
`wrap_model_call` middleware) and measure the current parse/format-error rate from
logs. Only if a clean provider-agnostic seam exists AND errors are non-negligible,
Step 2: add a `wrap_model_call` middleware enforcing provider-side structured output,
degrading gracefully; do not change decision content or break LiteLLM multi-provider
routing. If errors are already rare, DELIVER THE MEMO AND DEFER. ADR + T0/T1 tests
only if it lands. One PR ≤400 lines. Follow `../AGENTS.md`.
</details>

---

## WP-L2b — Extend `kg_ingest_*` parsers (narrow)  ·  Value: Med · Risk: Med (brittle) · Effort: Ongoing

**Objective.** Add `kg_ingest_*` for network tools that agents actually run but that
have **no** existing ingester.

**Step 0 (mandatory audit).** Coverage is already broad (14+ ingesters incl.
crackmapexec, asrep, nmap, httpx, nuclei, masscan, subfinder, katana, ffuf, testssl,
dnsx, slither, sarif). Grep the network agents' tool usage vs existing `kg_ingest_*`
and add parsers **only for real gaps**. Do not duplicate.

**In scope**
- New `kg_ingest_<tool>` in `tools/research/tools.py`.
- If (and only if) a new node type is needed: `graph_db/schema_keys.py` — and **invoke the `graph-db-writes` skill first** (AGENTS.md auto-invoke rule).

**Out of scope**: re-implementing existing ingesters; new node types where an existing schema fits.

**Tests**: T0 fixture → expected nodes. Write the lesson ADR even when reusing an existing node type; document any schema addition explicitly. PR per-parser.

**Acceptance**: each new parser covered by a fixture test; reuses schema where possible.

<details><summary>Sub-agent brief (paste)</summary>

Do WP-L2b from the guide. Step 0: audit which tools the network agents run that lack a
`kg_ingest_*` in `tools/research/tools.py` (coverage is already broad — list the real
gaps). For each real gap, add one `kg_ingest_<tool>` with a fixture T0 test. If a new
node type is needed, invoke the `graph-db-writes` skill and edit `graph_db/schema_keys.py`
(+ ADR). Do not duplicate existing ingesters. One PR per parser, ≤400 lines. Follow `../AGENTS.md`.
</details>

---

## WP-L9 — Per-role structure knob (lowest priority; likely defer)  ·  Value: Low · Risk: Low

**Objective.** A per-role config to dial *interface structure* (distinct from
`RAPTIX_MODEL_PROFILE`, which is model tier). Default = current behavior (no-op).

**Recommendation: DEFER.** A structure knob is only meaningful once there is an
in-scope, structured alternative to toggle (e.g. once L1/L3 exist — both OUT of scope).
Adding an inert knob now is config surface with no payoff. Deliver a one-paragraph note
recording the decision unless a specific in-scope safe change needs the toggle.

**If built anyway**: a config field + read site, default no-op; **must not** be
conflated with `RAPTIX_MODEL_PROFILE`. Flag-gated, T0 test that default = current
behavior.

<details><summary>Sub-agent brief (paste)</summary>

WP-L9 is DEFER by default: write a one-paragraph note that a per-role structure knob
(distinct from `RAPTIX_MODEL_PROFILE`) has no payoff until an in-scope structured
alternative exists (L1/L3 are out of scope). Only implement if a specific in-scope
change needs the toggle; if so, add a default-no-op config field + T0 test. Follow `../AGENTS.md`.
</details>

---

## Summary table

| WP | In scope (files) | Never touch | Value | Risk | Effort | Dispatch |
|----|------------------|-------------|-------|------|--------|----------|
| **L2a** | new `middleware/kg_autoingest.py`, `decepticon_core/contracts/slots.py`, `agents/middleware_slots.py` | `tools/bash/*`, guardrails, `middleware/kg.py` logic | High | Low | Low-Med | 1st |
| **L7-obs** | `middleware/kg.py::_inject_kg_context`, `tools/research/chain.py`/`_state.py`, `KGStore` | any blocking/gating | Med | Med | Low | 2nd |
| **L6** | memo → maybe `wrap_model_call` middleware, `agents/build.py`, `llm/` | decision content, LiteLLM routing | Med (format) | Low | Med | 3rd (may defer) |
| **L2b** | `tools/research/tools.py`, (maybe) `graph_db/schema_keys.py` | existing ingesters | Med | Med | Ongoing | 4th |
| **L9** | config field (default no-op) | `RAPTIX_MODEL_PROFILE` semantics | Low | Low | Low | defer |

**Orchestration note (for the human dispatcher):** hand each WP to a separate
sub-agent as its own ADR + PR. Do not let one sub-agent bundle two WPs (violates
one-concern + diff budget). Verify each PR against the WP's Acceptance + the AGENTS.md
non-negotiables before merge; pay special attention to the **fail-safe test** (L2a) and
the **no-blocking assertion** (L7-obs) — those are the two places a "safe" change could
silently become an unsafe one.
