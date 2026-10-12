# 0064. Evaluate evidence-informed decisions at replay checkpoints

- **Status:** Proposed
- **Date:** 2026-10-12
- **Related:** ADR-0049, ADR-0063; `docs/structure-review.md` P3

## Context

P2 now injects bounded historical verification context, but wiring tests do not
demonstrate improved decisions. A decision experiment needs known answers, the
same observations and tool surface across conditions, and an honest distinction
between live model results and deterministic scoring checks.

## Decision

Add an independent `benchmarks.suites.decision_eval` suite. At each checkpoint,
run a fresh LangChain agent with the existing KGMiddleware and a read-only replay
tool. Baseline disables evidence context; evidence enables the actual P2 summary.
Historical notes and available replay IDs are identical. The fixture store
supplies query results, not a second KG or a Cypher implementation. This measures
checkpoint decisions under replay, not target execution or the full orchestrator.

- Keep development and held-out corpora separate. Ground truth and required
  reads belong only to the evaluator, never to the prompt, store or replay tool.
  Held-out is evaluation-only, explicitly selected, and must not tune policies.
- Run both conditions per model/scenario/repetition; randomize condition order
  with a recorded scheduling seed. A new agent and state prevent carry-over.
- Bound each episode by timeout and graph recursion limit. Do not retry, repair
  model answers, infer successes from prose, or silently switch models.
- Score verdict, accepted next action, evidence references, producer lineage
  count and required reads together. Separately report false-positive reporting,
  contradiction/inconclusive handling, scope violations, redundant immutable
  replay reads, invalid responses and provider failures.
- Retain declared and provider-reported model identity, corpus/prompt hashes,
  git revision/dirty status, scheduling parameters and per-episode outputs.
  Provider usage/cost missing from any turn stays unknown, not zero.
- Test scorer and agent wiring with explicit scripted model-provider fixtures.
  No built-in policy reads golden answers and pretends to be a model.

## Threat model

Replay lookup accepts only declared finding IDs and performs no shell, network
target, graph write or OPPLAN update. Historical snapshots remain untrusted;
reference presence is not current verification. The harness never serializes
provider credentials or connection configuration. Synthetic fixtures contain no
live engagement data. Model routing uses the configured LiteLLM proxy.

## Consequences

The suite can compare weak/strong models and the P2 ablation without a target.
It cannot establish exploitation success, hypothesis discovery, long-horizon
replanning, model parity or a production rollout threshold. Held-out cases are
authored fixtures, not an independent real-world distribution. P4 remains gated;
target-backed and broader capability evaluation are subsequent experiments.

## Alternatives considered

- Start with a large target lab: adds execution variance before the decision
  metric and evidence-context ablation have been checked.
- Score an oracle policy: validates a pipeline but cannot measure model behavior;
  explicit provider-fixture tests provide the former without that ambiguity.
