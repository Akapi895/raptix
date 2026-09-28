# 0015. Defer provider-side structured decoding pending measured failures

- **Status:** Proposed
- **Date:** 2026-09-28
- **Related:** `docs/incalmo-lessons-implementation-guide.md` WP-L6

## Investigation

The standard factories (for example `agents/standard/recon.py`) call
`LLMFactory.get_model(role)` and pass the resulting ChatOpenAI-compatible model
to `langchain.agents.create_agent`. `LLMFactory._create_chat_model` routes the
model to LiteLLM. LangChain owns tool-calling and tool schema handling; the
middleware assembler in `agents/build.py` passes ordered middleware slots to
each factory. A `wrap_model_call` hook could change the model request, but there
is no separate, provider-neutral grammar/decision decode step to configure.

## Evidence and decision

No representative model/tool transcript or parse-error log is checked into this
repository. The checked-in `benchmark/results/cve-bench/dry-run-2026-06-11.jsonl`
has three *mocked* dry-run score rows and zero real model calls. RecordingMiddleware
captures successful model/tool responses, while EventLogMiddleware records calls
and responses without a parse/format-error category. Thus the available sample
has a denominator of **zero model calls**; a parse-error rate cannot be calculated
from it. Do not infer that the rate is 0%.

**Defer implementation.** Function-calling already constrains tool arguments;
adding provider-specific response formats without evidence risks breaking
LiteLLM fallback and changing decisions rather than merely fixing syntax. First
obtain a representative, consented and redacted recording with counts of model
calls and *explicitly classified* parse/format failures. Reconsider a middleware
only if failures are non-negligible and both the primary and fallback providers
support a provider-neutral shape. If implemented later, compare T0 malformed/valid
decisions and T1 replay across providers without changing tool decisions.

No runtime path or model-input surface changes in this work package.
