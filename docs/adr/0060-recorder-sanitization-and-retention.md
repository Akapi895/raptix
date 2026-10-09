# ADR-0060: Recorder sanitization and retention

- **Status:** Proposed
- **Date:** 2026-10-08
- **Related:** ADR-0058 (attempt telemetry); ADR-0042 (engagement workspace);
  `docs/context-optimization-implementation-plan.md` (WP-E4, defect C9)

## Context

The record file is a full-fidelity artifact: it contains raw prompts, tool
arguments, and results. That fidelity is load-bearing for replay and must not
change by default, but it also means a record cannot be shared casually — it can
carry credentials, tokens, and private keys captured from a live engagement.
There is currently no supported way to produce a shareable copy, and no marker
distinguishing a shareable (lossy) copy from a replayable (raw) one.

## Decision

### Completion review (2026-10-09)

Redaction considers credential keys as well as string shapes, JSON embedded in
text, quoted assignments, authorization, URL credentials and private keys.
Redaction is idempotent. A sink owns its immutable record mode and refuses mixed
mode appends; replay checks non-replayable markers anywhere in the file. Export
refuses source=destination and publishes atomically. A CLI invokes the same export
implementation. Raw records remain engagement-local; share only reviewed exports.

- **Default unchanged.** The envelope-only default and raw capture are
  untouched; replay fidelity is preserved. `RAPTIX_RUNTIME__RECORD_LEVEL`
  defaults to `raw`; an invalid value fails agent build, naming the variable.
- **Export sanitizer.** `export_sanitized(src, dst)` writes a deterministic,
  shareable copy: every string leaf is redacted against credential-shaped
  patterns (private keys, JWTs, bearer tokens, common API-key prefixes, and
  `key = value` credential assignments), normal text is left intact, and
  malformed lines are dropped rather than failing the artifact.
- **Redacted records are marked non-replayable.** A record written with
  `RAPTIX_RUNTIME__RECORD_LEVEL=redacted` (and any sanitized export) starts with
  a `record_header` carrying `replayable: false`; `open_replay` raises
  `NonReplayableRecord` rather than silently mismatching. Redacted capture runs
  every entry through the same sanitizer.
- **Retention/access policy.** Raw records are engagement-local operational data
  with the same access controls as the engagement workspace; they may contain
  secrets and must not be committed, published, or attached to tickets. Only
  sanitized exports are shareable. Raw records are retained only as long as
  needed for replay/debugging and removed with the engagement workspace.

## Threat model

The hazard is secret exfiltration through a shared artifact. The sanitizer is a
deterministic deny-list reduction, not a proof: it cannot catch every possible
secret shape, so it reduces but does not eliminate risk. The `replayable: false`
header prevents a sanitized/redacted artifact from being mistaken for a
replayable source of truth. The sanitizer never runs on the live recording path
unless `RECORD_LEVEL=redacted` is explicitly chosen, so it cannot corrupt a
replay fixture by accident. Event-logging telemetry redaction is separate and
unchanged.

## Consequences

- **Easier:** records can be shared after sanitization; the raw/redacted
  distinction is explicit and machine-enforced.
- **Harder:** operators must choose `RECORD_LEVEL=redacted` deliberately to
  capture shareable records; sanitized records cannot be replayed.
- **Given up:** no "sanitize in place" — a raw record is only shared via an
  explicit export.
- **Migration:** none. Default `raw` keeps existing records and replay intact.

## Alternatives considered

- **Redact by default** — rejected: it would silently break replay fidelity for
  every existing consumer.
- **Sanitize on read by the replayer** — rejected: replay needs the raw values;
  sanitization is an export concern.
- **Drop message content from records** — rejected: destroys the replay and
  analysis value the recorder exists for.
