# 0087. Classify retained Web captures before serving original bytes

- **Status:** Accepted (2026-10-17, requester). Owner/manager/admin classify; viewers never read original bytes; attach of an unclassified capture is allowed without exposing bytes; reclassification is CAS-versioned and audited and never changes the digest; file/DB partial failure uses staging + `pending` rows + an orphan sweeper.
- **Date:** 2026-10-17
- **Deciders:** project owner (requester)
- **Related:** ADR-0069 (Web workflow lifecycle storage), ADR-0084 (real feature-service adapters), docs/design/2026-10-17-web-ui-contract-completion-implementation-plan.md §4 D01 and P03–P04

## Context

`ArtifactsService` can retain uploaded bytes, while workspace artifact reads are engagement-scoped. The current Web capture record has no stored sensitivity classification or original-byte read policy. A browser checkbox cannot enforce access, and presenting a file as non-sensitive when the server has no such fact would misstate the source.

The requester chose to keep real-mode upload and original-byte access gated until classification and its access policy are persisted and enforced. Once enabled, upload must survive a lost acknowledgement without duplicating capture records; the digest must identify the exact retained bytes. Capture integrity describes those bytes only, not the truth of a finding.

## Decision

1. A newly retained Web capture starts `unclassified`. Owner or reviewer membership must classify it as `standard` or `sensitive` before any original bytes or preview are served.
2. Standard captures may be read by owner, operator and reviewer members. Sensitive captures may be read only by owner or reviewer. Viewer members never read original bytes, whatever the classification; they see the capture record and its classification only. A viewer request for original bytes is refused with 403, and for a sensitive capture with 404 so its existence is not disclosed. Upload, list, classify, attach, preview and download each re-check engagement authorization server-side.
2a. A retained capture whose bytes no longer match the recorded SHA-256 or size is refused with 409 and the integrity message. It is a stored-data conflict, not a service outage, so retrying the same request does not help until the workspace is reconciled.
3. Classification changes are versioned, reasoned and audited. The initial unclassified-to-classified decision records actor/time; later reclassification is an explicit CAS mutation, never a browser-only edit.
4. Upload carries a stable request ID and payload fingerprint. Retrying the same ID and same bytes returns the existing capture; reusing the ID with different content conflicts. The retained descriptor has an opaque capture ID, immutable SHA-256, size, media type and source attribution.
5. Original-byte download is separate from the existing bounded UTF-8 workspace preview. The server verifies the retained bytes against the recorded digest before serving them; preview truncation/redaction never claims original-byte integrity.
6. Legacy workspace artifacts and digest-only evidence are not silently upgraded to standard/sensitive or verified captures. Existing legacy text/JSON API behavior remains unchanged until a separately scoped migration defines its classification.

## Consequences

- **Easier:** the UI can distinguish classification state, source identity and capture integrity; upload recovery can replay one durable capture intent.
- **Harder:** capture metadata, classification history, read authorization, request idempotency and bytes must stay consistent across PostgreSQL and the workspace filesystem. File/database partial failure needs reconciliation and an orphan policy.
- **Given up:** immediate upload or original-byte display for a capture whose sensitivity has not been decided. A successful upload response does not imply permission to inspect its content.
- **Migration:** additive capture metadata/table and migration; existing evidence links remain readable as legacy references. Original bytes for legacy records remain unavailable through the new download route until explicitly classified.

## Alternatives considered

- **Uploader chooses standard/sensitive at upload time.** Rejected for this release: the requester chose an owner/reviewer classification gate rather than trusting the uploader's client-side assertion.
- **Treat every upload as standard.** Rejected: there is no current persisted sensitivity fact, and this would make new original bytes visible to all engagement members by default.
- **Keep uploads and downloads disabled indefinitely.** Rejected as the target design: the gate remains until this contract is implemented, after which classification enables a truthful workflow.
