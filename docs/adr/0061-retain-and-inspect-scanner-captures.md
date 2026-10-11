# 0061. Retain scanner captures and inspect their source consistency

- **Status:** Proposed
- **Date:** 2026-10-11
- **Related:** ADR-0049, ADR-0060; `docs/structure-review.md` P1/P2;
  `docs/design/2026-10-11-stage2-evidence-traceability-research.md`

## Context

Registry auto-ingest already reads scanner bytes and stamps observation pointers,
but its temporary Artifact cannot be resolved later. `inspect_evidence` is a live
consumer that currently returns graph properties and workspace-wide custody only.
The proposed proof/control check has no connected retained-proof producer yet.

## Decision

With `RAPTIX_KG_EVIDENCE_CAPTURE=1` (default off, in addition to auto-ingest), retain
registry scanner bytes and a descriptor under the active workspace's evidence
directory before attaching the reference to KG records. Reuse Core `Artifact`
and the existing ParserRegistry; no new observation or graph-node model.

The opaque `workspace-evidence://<descriptor-sha256>` reference identifies a
descriptor containing engagement, Artifact identity/content digest, parser ID
and version, and format context. Its paired binary retains exact downloaded
bytes rather than terminal previews. Different executions keep distinct capture
identities even when their bytes match; this is not independent corroboration.

`inspect_evidence` resolves the selected node's reference using explicit run
config and injected workspace state. Transfers fence resolved paths to that
workspace, retain existing daemon engagement fences, bound downloads, and require
a server acknowledgement of the requested scope. No ambient-sandbox fallback.

Report integrity separately from one narrow assessment: "this captured output
emits this recorded node identity." Reparse through the same parser version;
membership is supported, valid absence contradicted, and missing/drifted/invalid
captures or changed parsers inconclusive. This never sets Finding.validated,
promotes a security claim, or changes the recorded-claims summary.

## Threat model

Graph references and descriptors are untrusted: reject unknown URI forms,
descriptor/content digest mismatch, engagement or Artifact-ID mismatch, path
escape (including symlinks), oversized transfers and missing explicit run context.
Hashes detect drift, not authenticated provenance. Results remain scoped source
assessments; a model-authored reference is not proof of execution or authorization.
Capture failures preserve the original tool result and baseline graph ingestion.
RoE, SafeCommand, HITL and egress are unchanged.

## Consequences

Captures remain usable after the original scanner file is overwritten. They
follow workspace retention/cleanup policy, add bounded storage per capture and
are not backfilled for old nodes. Only registry auto-ingest gains capture wiring;
the legacy graph-ingest path stays unchanged. HTTP scope/size options are additive;
old servers fail closed for scoped transfers instead of silently ignoring them.
Enable the flag only with an updated sandbox daemon.

## Alternatives considered

- Store only the mutable original path: cannot recover earlier content.
- Build a generic ArtifactStore/executor: exceeds the demonstrated consumer need.
- Promote findings from hashes or parser success: confuses integrity, parsing and
  security verification. Proof/control assessment remains a distinct future slice.
