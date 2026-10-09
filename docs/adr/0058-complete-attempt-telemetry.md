# ADR-0058: Complete attempt telemetry

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0050 (execution receipts); ADR-0051 (dispatch handoff);
  ADR-0055 (budget); `docs/context-optimization-implementation-plan.md`
  (WP-E1, defect C9)

## Context

The record/replay layer captures the *content* of every model and tool call but
cannot reconstruct the *identity chain* the plan needs to attribute cost:
`run → task → dispatch → worker instance → logical call → upstream attempt`.
The dispatch context holds `dispatch_id`/`attempt`, but the recorder envelope
drops it. The served model (after a fallback) is only logged, never recorded, so
a record cannot show which provider actually answered. Summarization calls are
invisible because the summarization helper invokes its own model directly,
bypassing the innermost RECORD slot.

## Decision

### Completion review (2026-10-09)

Use one context-local identity chain for model/tool/summary calls, dispatch worker
instances and observable upstream attempts. Record failures as well as successes.
Provider SDK retries retain their policy; callbacks expose observable retries,
while proxy-internal retries are explicitly unobservable unless proxy metadata
provides them. Summary attribution is request-local and includes objective/worker
identity. Raw usage is a numeric allowlist, and the debug flag also works without
a record path. Recording failures never replace live responses.

- **Attempt identity.** Every recorded entry's envelope gains `attempt_id`
  (unique per entry) and `parent_attempt_id` (the active dispatch's
  `dispatch_id:attempt`, or `None` outside a dispatch). Both are additive
  observability fields; the replayer keys only on `kind`/`req_hash`.
- **Served model.** A model entry gains `served_model` read from
  `response_metadata.model_name`/`model` (mirroring the existing attribution
  log), so a fallback is visible in the record rather than only in logs.
- **Summary calls recorded separately.** The summary model is wrapped in a
  duck-typed `SummaryCallRecorder` that delegates every attribute to the real
  model and records `invoke`/`ainvoke` as `kind="summary_call"` into the same
  sink. The wrap is applied wherever the summarization helper's model is
  (re)built — construction, capacity/trigger override, and per-request rebind —
  and is idempotent. When no record path is set the model is returned unchanged.
- **Raw usage passthrough (opt-in).** `RAPTIX_LLM__LOG_RAW_USAGE=1` adds a
  `raw_usage` block (usage metadata / `input_token_details` / served model) to
  model and summary entries. It includes only usage-bearing fields — never
  prompts, tool arguments, or credentials.
- **Failure is invisible to the run.** Recording remains best-effort: summary
  capture swallows its own errors, and the sink's poison-on-failure contract is
  unchanged. Flag off (no record path) leaves behavior byte-identical.

## Threat model

The new fields are observability-only and replay ignores them, so they cannot
change replayed behavior. `raw_usage` is derived from usage metadata, not
request content, so it cannot carry credentials or parameter values; a redacted
record (`ADR-0060`) additionally runs it through the sanitizer. The wrapper does
not alter the model's request or response, only observes it.

## Consequences

- **Easier:** cost/perf can be attributed to a specific dispatch and served
  model; summary spend is separable from agent spend; fallbacks are visible in
  the artifact rather than only in logs.
- **Harder:** the summary model is now wrapped in three construction paths and
  must stay idempotent (guarded) and transparent (attribute delegation).
- **Given up:** nothing observable — default records stay replayable and the
  envelope additions are ignored by replay.
- **Migration:** none. No record path means no wrapper; existing records replay.

## Alternatives considered

- **A dedicated summary recorder middleware slot** — rejected: the summary call
  does not traverse the middleware chain, so a slot would never see it.
- **Record served model in the request** — impossible: the served model is only
  known after the response.
- **Always record raw usage** — rejected: it is debug detail; opt-in keeps the
  default artifact minimal.
