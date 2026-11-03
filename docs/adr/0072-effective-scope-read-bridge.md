# ADR-0072: Effective scope snapshot read bridge

Status: Proposed

## Context

The web governance model holds the authoritative scope: one approved scope
revision at a time, an always-in-scope engagement root target, and a cumulative
asset classification fold (W07). The runtime sandbox enforces egress/ROE with
its own guardrails. Until now the two sides had no shared contract: a green web
preflight said nothing about whether the runtime was actually executing against
the current scope version, and there was no way for a runtime component to read
the effective scope without scraping internal tables.

## Decision

Expose a single read-only endpoint, `GET /api/engagements/:id/scope/effective`,
returning the cumulative effective scope snapshot: the authoritative approved
revision version (or null), the engagement root target, the in-scope asset
identifiers, and the approved ROE (windows, restrictions, emergency contacts).
Access follows the standard engagement membership policy (viewer and above);
the response is never cached.

The endpoint is a read bridge only. Consumers (runtime, CLI, operators) fetch
the snapshot and apply it through their own guardrail machinery. The web never
writes runtime configuration, never weakens runtime guardrails, and never
edits producer documents as a side effect.

## Consequences

- **Easier:** runtime components and operators can reconcile what the runtime
  executes against the exact authorized scope version; preflight checks and
  the UI can display the same cumulative truth.
- **Harder:** the snapshot is eventually consistent with in-flight decisions —
  a scope change approved after a fetch is not retroactively visible, so
  long-running work must re-read the snapshot at start/resume boundaries.
- **Given up:** no push channel — the web does not proactively notify the
  runtime of scope changes; polling/re-fetch at boundaries is the contract.
- **Migration:** none — additive endpoint over existing persisted state.

## Alternatives considered

- **Push scope updates to the runtime on approval:** rejected — it would give
  the web a write path into runtime guardrail state, the exact side effect the
  plan forbids; pull keeps the runtime in control of when it adopts a scope.
- **Expose raw scopeRevision rows instead of a cumulative snapshot:**
  rejected — consumers would each re-implement the add/remove fold, and the
  root-target semantics (always in scope) would leak into every consumer.
