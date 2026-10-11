# 0062. Differential verification over retained captures

- **Status:** Proposed
- **Date:** 2026-10-11
- **Related:** ADR-0049, ADR-0060, ADR-0061;
  `docs/structure-review.md` P1;
  `packages/raptix/raptix/specialist_contracts/evidence.py`

## Context

`validate_workspace_finding` already runs a proof command and a mandatory
baseline control, but it neither retains the two outputs nor reports a
supported/contradicted/inconclusive verdict — it returns a validated boolean
plus excerpts and asks the agent to persist the JSON itself. ADR-0061 added
retained captures; this ADR binds a proof/control pair to that mechanism so a
downstream consumer can re-derive the differential outcome.

## Decision

With `RAPTIX_KG_EVIDENCE_CAPTURE=1` and an engagement workspace on state, retain
the proof and control outputs as captures and write one record that stores both
references plus the success/negative patterns. The record's reference is
returned additively as `verification_ref`; the agent puts it on the finding
node's props (existing `kg_record` surface).

`inspect_evidence` resolves `verification_ref` and re-runs strict
`specialist_contracts.evidence.validate_evidence` over the two captures:

- **supported** — proof matches a success pattern, control matches a baseline
  pattern, and the control does not match any success pattern.
- **contradicted** — the control also matched a success pattern.
- **inconclusive** — a capture is missing or drifted, a pattern is invalid, the
  baseline did not match, or the signal is insufficient.

The verdict is scoped to this one differential observation. It never sets
`Finding.validated`, changes the recorded-claims summary, or claims
exploitability, CVSS, target liveness, or independent corroboration. Integrity
is reported per side and is separate from the verdict. No new tool or graph node
model is introduced; the only new type is the delegating capture store wrapper
(ADR-0061's legacy path), which forwards to the existing `KGStore`.

## Threat model

References and records are untrusted: descriptor/content digests, engagement
scope, path containment and size bounds are checked before any bytes are
pattern-matched. Hashes detect drift, not authenticated provenance; a
model-authored reference is not proof of execution or authorization. Retention
is best-effort and flag-gated; failure leaves the verification result unchanged
and simply omits the reference.

## Consequences

A finding can carry a re-derivable differential check without an operator
re-running the PoC, and the outcome is honest about missing/tampered evidence.
The captured outputs are the runner's returned text (possibly truncated at the
sandbox seam), not guaranteed raw bytes; the tool mandates `negative_command`
and `negative_patterns`, and both are required for any non-inconclusive verdict.
Provider coverage remains limited to `validate_workspace_finding`; the
`validate_finding` graph path is unchanged.

## Alternatives considered

- Reuse only the existing boolean: loses the supported/contradicted/inconclusive
  distinction and the re-derivation over retained bytes.
- Add a dedicated verification tool/store: unnecessary; the pair record rides
  the ADR-0061 capture machinery and `inspect_evidence` is the existing consumer.
- Bind the pair directly on a new node type: expands the graph model for one
  relationship a props reference already carries.
