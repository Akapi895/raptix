# 0076. Web System Overview cross-project reads

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** pending review
- **Related:** ADR-0068 (web frontend real-mode data boundary), ADR-0069 (web workflow lifecycle)

## Context

The real-mode web console had no landing surface: the empty-hash location
resolved to the sign-in route, so an authenticated operator saw a
"Signed in as …" card instead of an operating picture. The existing
command center (integration ticket 15) already aggregates readiness and the
task inbox across the actor's authorized engagements, but findings and C2
activity were only reachable per project.

Cross-project reads touch every engagement the actor owns or holds a
membership on, so they are an authorization-sensitive new public API surface
(the system is multi-user in production). Durable C2 state lives in the
command audit (`C2Command`) while live Sliver sessions are a per-engagement
provider read; a cross-project endpoint must not silently fan out to
providers or misrepresent audit rows as live sessions.

## Decision

The real-mode console lands on a System Overview route (`overview`, the new
empty-hash default) composed of independently-loading sections. Each domain
has its own read endpoint on the existing command-center aggregate owner
(`InboxService`); there is no single aggregate document:

- `GET /api/overview/findings` — observed finding counts by severity and
  workflow status over authorized engagements, with an explicit `truncated`
  flag when the row scan cap is hit.
- `GET /api/overview/c2` — durable command-audit counts per status plus a
  bounded newest slice, and the count of pending session grants. Live Sliver
  sessions remain a per-project provider read.
- Projects and tasks reuse the existing `GET /api/engagements` and
  `GET /api/tasks` reads.

Authorized-engagement scoping reuses the inbox service's owner-or-member
resolution; every section renders an explicit unavailable/degraded state
instead of zeros when its source fails.

## Consequences

- **Easier:** the dashboard grows domain by domain without a monolith
  contract; a failing source degrades one card, not the page; each section is
  authorized and testable on its own.
- **Harder:** the client makes several reads per view; aggregating a new
  domain means a new endpoint plus contract, not a field addition.
- **Given up:** cross-project live C2 session counts (provider fanout is
  rejected as too slow and dishonest to summarize).
- **Migration:** none — all reads are additive; the previous default route
  (`login`) still resolves for explicit `#/login`.

## Alternatives considered

- **One `/api/overview` aggregate document:** rejected — couples unrelated
  domains' availability and authorization, and one failing source would
  blank the page.
- **Per-engagement fanout for live C2 sessions:** rejected — provider calls
  per engagement on a dashboard read are slow and mix unaudited state with
  the durable audit.
- **Client-side fanout over existing per-engagement endpoints:** rejected —
  N requests per engagement, no membership filtering server-side in one
  place, and it re-implements the inbox aggregate's authorization.
