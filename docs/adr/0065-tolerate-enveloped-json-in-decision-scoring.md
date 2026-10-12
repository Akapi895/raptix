# 0065. Tolerate enveloped JSON in decision scoring

- **Status:** Proposed
- **Date:** 2026-10-12
- **Related:** ADR-0064; `docs/structure-review.md` P3

## Context

ADR-0064 fixed the decision experiment to "not retry, repair model answers,
infer successes from prose, or silently switch models", and the suite validated
answers with `Decision.model_validate_json(content)` on the whole message. A
multi-model matrix showed this strict protocol dominating the metric: most
invalid responses were a schema-valid, semantically correct `Decision` wrapped
in a Markdown fence or followed by prose. For example, a held-out answer whose
JSON exactly matched ground truth scored zero only because of a ` ```json `
fence, and a development model's measured gain moved from +0.33 to +0.06 once
enveloped answers were parsed. Invalid-response rate tracked formatting style
more than decision quality, and it biased the baseline/evidence comparison
unevenly across models.

## Decision

Accept a decision when the message contains a JSON object that validates against
the strict `Decision` schema. Try the bare message first, so a strict answer is
unchanged, then extract the first balanced `{...}` slice and validate it. Only a
schema-valid object counts: prose alone, missing or extra fields, wrong enums and
wrong value types remain invalid. Extraction is format tolerance, not answer
repair — no field is inferred, defaulted, rewritten or read out of prose.

This narrows ADR-0064's "do not repair model answers" constraint to semantic
repair only; recovering an embedded, already-complete object is allowed.

## Threat model

Extraction runs locally over the model message and adds no network, target,
filesystem or graph access. It does not relax schema validation, read ground
truth, or reintroduce a second KG/Cypher path.

## Consequences

`valid_response` now measures decision protocol compliance including fence
tolerance, so accuracy reflects decision quality rather than Markdown habits.
Joint correctness still requires every check. Scores are not comparable across
the parser change: any earlier run must be re-run before comparison, and held-out
must be re-frozen before the next evaluation. Tolerating unknown fences could in
principle accept an object the model did not intend as its answer, but it must
still satisfy the full strict schema.

## Alternatives considered

- Keep whole-message strict JSON: rejected — it measured formatting and masked
  the ablation the experiment exists to test.
- Strip fences with a regex: rejected — brittle against surrounding prose and
  nested braces.
- Ask a model to extract the JSON: rejected — nondeterministic and would obscure
  the protocol-compliance signal the suite reports.
