# 0062. Differential verification over retained captures

- **Status:** Proposed
- **Date:** 2026-10-11
- **Related:** ADR-0049, ADR-0060, ADR-0061;
  `docs/structure-review.md` P1;
  `packages/raptix/raptix/specialist_contracts/evidence.py`

## Context

Before capture wiring, `validate_workspace_finding` ran proof/control commands
but discarded their full runner outputs. It returns a compatibility boolean
plus excerpts; the workspace-first verifier persists that JSON. ADR-0061's
captures let a downstream consumer re-derive a differential outcome without
requiring a new graph writer or a second verdict on the producer.

## Decision

With `RAPTIX_KG_EVIDENCE_CAPTURE=1` and explicit sandbox/workspace run context, retain
the proof and control outputs as captures and write one record that stores both
references plus the success/negative patterns. The record's reference is
returned additively as `verification_ref`; the agent persists the complete JSON
at `findings/evidence/<finding_id>_verification.json` and references that file
from the finding's `evidence_pointer`. The verifier has no `kg_record` tool.

The primary consumer is A1's read-only `recheck_workspace_verification(finding_id)`.
It resolves `verification_ref` and re-runs strict
`specialist_contracts.evidence.validate_evidence` over the two captures:

- **supported** — proof matches a success pattern, control matches a baseline
  pattern, and the control does not match any success pattern.
- **contradicted** — a valid baseline control also matched a success pattern.
- **inconclusive** — a capture is missing or drifted, a pattern is invalid, the
  baseline did not match, execution failed/timed out/truncated, or the signal is insufficient.

Both commands must report complete output and exit code zero for either
non-inconclusive verdict. The workspace producer uses the same strict signal
criterion for its compatibility `validated` boolean; the global graph PoC
validator is unchanged. Command invocations are captured in execution order,
not keyed by command text. The record binds `finding_id`, an invocation ID,
and proof/control completion and exit status. A1 checks the requested ID against
both the persisted JSON's `vuln_id` and the retained record. Legacy unbound
records remain readable but cannot support a finding-specific A1 verdict.

A second deterministic consumer, `record_workspace_finding(finding_id)`, bridges
the workspace artifact to the graph when a caller asks for it: it reads the
persisted JSON, confirms the finding binding, then upserts a `Finding` node whose
props carry `verification_ref` and the current outcome snapshot. It writes
nothing for a missing, foreign, malformed or unbound verification, or an
unavailable store, and it never sets `Finding.validated`. This activates the KG
consumer (`inspect_evidence`) deterministically instead of relying on the agent
to hand-copy the reference. `plumbing/verification.py` stays graph-free; the
graph write lives on the evidence surface.

The verdict is scoped to this one differential observation. It never sets
`Finding.validated`, changes the recorded-claims summary, or claims
exploitability, CVSS, target liveness, or independent corroboration. Integrity
is reported per side and is separate from the verdict. A1 and the promoter reuse
capture storage and the strict validator rather than introducing another store
or graph node model.

## Threat model

References and records are untrusted: descriptor/content digests, engagement
scope, path containment and size bounds are checked before any bytes are
pattern-matched. Hashes detect drift, not authenticated provenance; a
model-authored reference is not proof of execution or authorization. Retention
is best-effort and flag-gated; failure leaves the verification result unchanged
and simply omits the reference. The finding reference must not be transplanted
to another finding; digest integrity alone does not prove that binding. Producer
and consumer use the run's explicit endpoint for capture operations, with no
cross-engagement process-default fallback. Execution failures cannot become
positive evidence solely because their output contains a matching marker.

## Consequences

A finding can carry a re-derivable differential check without an operator
re-running the PoC, and the outcome is honest about missing/tampered evidence.
The captured outputs are the runner's returned text (possibly truncated at the
sandbox seam), not guaranteed raw bytes; the tool mandates `negative_command`
and `negative_patterns`. Output completeness is recorded conservatively; an
unknown completion status cannot produce a positive finding. Persistence remains
an agent-authored step; the recheck validates artifacts, not LLM compliance.
Provider coverage remains limited to `validate_workspace_finding`; the
`validate_finding` graph path is unchanged.

## Alternatives considered

- Reuse only the existing boolean: loses the supported/contradicted/inconclusive
  distinction and the re-derivation over retained bytes.
- Make `validate_workspace_finding` itself write the graph: conflicts with its
  live no-graph boundary; the deterministic promoter is a separate consumer.
- Let the agent copy `verification_ref` onto a KG node by hand: model-dependent
  and silently skipped; the promoter is deterministic.
- Bind the pair directly on a new node type: expands the graph model for one
  relationship a props reference already carries.
