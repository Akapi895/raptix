# Scope Web recovery to the deployment and trusted actor

**Status: Proposed** · 2026-10-16

## Context

O03 verification reproduced authenticated actor switches retaining an earlier
actor's query results and plaintext drafts. Actor IDs can also overlap when a
different deployment replaces a server at the same browser origin. Heartbeat
authorization alone can starve when upstream SSE traffic is continuous.

## Decision

The optional `deploymentId` in `/api/capabilities` is a non-secret installation
identity configured server-side with `RAPTIX_WEB_DEPLOYMENT_ID`. Operators retain
it across image upgrades and change it when replacing a deployment/data authority.
Older servers without an identity get a page-load-only recovery namespace: the
browser must not restore unattributed persistent recovery state across reloads.

Feature QueryClients are owned by a deployment/actor boundary, separate from the
outer bootstrap/session client. Changing that boundary disposes the old client,
streams and recovery mirror; a late result cannot populate the new actor's cache.
The outer trusted session is provided to inner consumers rather than independently
refetched by each feature. Recovery keys bind deployment, actor and resource IDs.

SSE re-attests run access at elapsed-time deadlines, including during continuous
events. Refusal closes observation with recovery required; reconnect authorizes
again. Disconnect/revocation does not cancel the runtime run.

## Consequences

The capabilities extension is additive. Existing servers remain readable, but
durable browser recovery requires an explicit deployment identity. No role or
runtime execution permission is derived from this identifier. Session changes
discard browser drafts; durable accepted/uncertain intents remain on the server ledger.

## Alternatives

- Clearing a shared cache only on explicit logout misses authenticated actor changes.
- Using origin or a fixed `local` identity does not distinguish replaced deployments.
- Resetting a heartbeat after each frame fails to bound authorization re-attestation.
