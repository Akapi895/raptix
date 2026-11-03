# 0066. Bind decision output to consumed provenance

- **Status:** Proposed
- **Date:** 2026-10-12
- **Related:** ADR-0064, ADR-0065

## Context

The P3 scorer detects incorrect citations against evaluator-only answers, but
schema-valid model text has no separate provenance-checked output. Recorded
episodes demonstrate lookup IDs substituted for artifact references, corrupted
hashes, historical citations and lineage counts unsupported by consumed reads.
The runtime verification bridge already rechecks finding bindings before writing;
the observed failures occur in the replay agent's generated decision JSON.

## Decision

Add a fail-closed output boundary to the replay checkpoint. It uses a ledger of
the JSON actually returned by completed replay calls, not the initial fixture,
KG snapshots, model tool-call claims or golden answers. Freeze declared lookup
IDs and claim membership when the checkpoint starts. Each scenario declares
`claim_replays`, identifying its constituent verification lookups independently
of `expected`. This ownership metadata is excluded from model messages.

Only claim-bound, consumed references with the canonical reference syntax and
a recorded producer invocation are citable. Reject absent reads, unauthorized
lookups, attempted forbidden tools, missing producer attribution, conflicting
reference ownership, duplicate citations and references from unrelated results.
Unavailable or finding-unbound records supply no citable reference. Derive
lineage from distinct producer IDs behind the citations; compare it with the
model's count. Unresolved citations leave lineage unknown, not fabricated.

Preserve raw content and all existing golden-answer scores. Emit `bound_decision`
only on successful provenance validation; otherwise emit null plus diagnostic
`provenance.issues`. Record consumed observations and `output_boundary` version.
Never repair a hash, translate a lookup ID into a citation, silently correct
lineage, retry a model or increase its score. Model instructions and replay
payloads for declared calls are unchanged.

## Consequences

Consumers can distinguish raw generated text from provenance-checked decisions.
Acceptance establishes citation binding, not correct reasoning, independent
corroboration or a verified vulnerability. The scorer still judges verdict,
action and which evidence the decision should use. Scope declarations are
trusted checkpoint inputs: their correctness must be checked during authoring.
This is a benchmark boundary, not a production rollout or a new canonical KG.
Original reports remain immutable; replayed audits are diagnostics and cannot
be presented as improved live model performance or P4 evidence.

## Alternatives considered

- Tighten only the prompt: a generative instruction cannot enforce exact
  references or authoritative lineage.
- Repair citations or derive replacement model answers: can silently bind a
  claim to the wrong observation and obscure the measured failure.
- Validate against golden answers: would turn an output boundary into an oracle.
