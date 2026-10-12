# Evidence-informed decision evaluation (P3)

This suite evaluates one **replayed decision checkpoint** at a time. It runs a
fresh LangChain agent through the existing KG middleware with the same read-only
replay tool in both conditions:

- `baseline`: `RAPTIX_KG_EVIDENCE_CONTEXT=0`.
- `evidence`: `RAPTIX_KG_EVIDENCE_CONTEXT=1`, using the actual bounded P2 summary.

The suite pins claim context off and plugin discovery off, restoring the caller's
environment after each episode. Run sequentially: the ablation flag is process
environment, not a concurrency-safe per-request setting.

## Run

No target, Docker sandbox or Neo4j is required. Model runs require the configured
LiteLLM proxy and valid provider credentials. Existing `RAPTIX_LLM__PROXY_URL` /
`RAPTIX_LLM__PROXY_API_KEY` settings are supported, with `LITELLM_PROXY_URL` /
`LITELLM_MASTER_KEY` fallbacks and the runtime's local proxy defaults.

```powershell
# Paired ablation on the development corpus
uv run python -m benchmarks.suites.decision_eval --model custom/Qwen/Qwen3.5-122B-A10B-FP8 --repetitions 3 --seed 7 --timeout 60

# Evaluation only: freeze code, metrics and prompts before this run.
uv run python -m benchmarks.suites.decision_eval --fixtures held-out --model custom/Qwen/Qwen3.5-122B-A10B-FP8 --repetitions 3 --seed 7

# Deterministic scoring, agent and HTTP-provider wiring tests; no model claims.
uv run pytest packages/raptix/tests/unit/benchmark/test_decision_eval.py -q
```

Repeat `--model` for the weak/strong comparison. Every model gets both conditions
on all scenarios. Conditions are shuffled with a recorded scheduling seed; that
seed does **not** make provider generations deterministic. Each repetition starts
a new agent and message history. There is no client retry or model fallback.
The proxy may implement its own routing; reports retain its reported model name
when supplied, and do not infer the underlying provider when absent.

## Scenarios and scoring

`benchmarks/scenarios/decision-eval/dev.json` covers supported proof/control,
contradiction after an older positive claim, incomplete execution, drift, alias
lineage and missing evidence with exhausted budget. The separate held-out corpus
is explicitly selected, evaluation-only, and not used to tune policies. These are
authored synthetic fixtures, not independent real-world generalization evidence.

The model receives objective, checkpoint, historical notes, available replay IDs,
and optionally historical KG snapshots. Ground truth stays exclusively in the
evaluator. `read_replayed_verification` returns a frozen observation; it is **not**
the live workspace recheck or a target executor. Repeated reads cannot add data.
The common system instruction maps production recheck/inspection advice to this
replay tool in both conditions. Snapshot rows are preselected fixture query
results; the suite exercises the actual summary renderer and middleware, while
P2's live harness owns query-selection correctness.

The answer schema requires:

- `outcome`: supported / contradicted / inconclusive.
- `next_action`: report_scoped / revise_hypothesis / gather_evidence / stop_insufficient.
- `evidence_refs`: unique references from current replay reads used for this claim,
  including contrary/inconclusive observations where they carry a reference.
- `lineage_count`: distinct recorded producer invocation IDs behind those
  references. This does not assert independent corroboration.

Joint decision correctness requires the expected verdict, an accepted next action,
correct references and lineage count, required replay reads, and no scope violation.
Malformed responses and provider/timeout failures remain failures in denominators.
False positives include reporting an unsupported claim even when its verdict says
inconclusive. Redundant reads are counted separately from decision correctness.

## Reports and interpretation

Outputs go to `benchmarks/results/runs/decision-eval/run-<UTC>/report.json`.
`--output DIRECTORY` selects a new destination; an existing report is not overwritten.
Reports retain corpus/prompt hashes, git revision and dirty status, scenario/model
identity, scheduling parameters, per-episode answers, reads, scores, latency,
provider-reported token usage and cost. Missing usage/cost stays `null`; no pricing
estimate is invented. Group summaries include joint/verdict/action accuracy,
invalid responses, false positives, outcome handling, failures, scope violations
and redundant reads. Paired gain is evidence joint accuracy minus baseline joint
accuracy for the same model/scenario/repetition.
Prompt fingerprints cover the effective initial model messages, including the
injected KG instructions. Tool schemas have a separate fingerprint. Completed
model responses and tool attempts survive a later timeout/provider failure, but
an incomplete episode's total usage/cost remains unknown.

One successful smoke run establishes wiring, not statistical improvement. Use
multiple repetitions and inspect failures. Zero gain on easy cases does not
justify default activation. These results cannot establish exploitation success,
hypothesis discovery, long-horizon OPPLAN behavior, weak/strong model parity or
the need for P4. Target-backed experiments and additional ablations come next.

## Initial local smoke (2026-10-12)

With protocol/code fixed before held-out, Qwen's declared and provider-reported
alias was `custom/Qwen/Qwen3.5-122B-A10B-FP8`. One repetition, scheduling seed 7,
60-second episode timeout:

| Corpus | Baseline joint correctness | Evidence joint correctness |
|---|---:|---:|
| Development, six scenarios | 1/6 | 4/6 |
| Held-out, four scenarios | 2/4 | 2/4 |

Development had one failed episode in each condition. Some baseline answers
were semantically plausible but used Markdown fences and failed the strict JSON
protocol. Held-out showed no measured gain in this small run. No policy, prompt,
fixture or scoring change was made from the held-out outputs. This is smoke
evidence, not justification for default rollout or model parity; cost was unknown.

Ignored local artifacts:

- `benchmarks/results/runs/decision-eval/run-20261012_020317_756819/report.json` (dev).
- `benchmarks/results/runs/decision-eval/run-20261012_020459_107347/report.json` (held-out).

The earlier Claude-alias attempt recorded authentication/rate-limit failures
throughout and is not a model-quality comparison. Use healthy, explicitly chosen
aliases for a multi-model matrix; the harness does not silently substitute them.
