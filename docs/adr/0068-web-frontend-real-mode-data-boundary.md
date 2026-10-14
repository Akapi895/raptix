# 0068. Give the Web frontend an explicit real-mode data boundary

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** requester (D1-D6 integration decisions, ticket 01)
- **Related:** apps/web/.scratch/frontend-backend-integration/spec.md (R02, R04, R05), coverage.md, ticket 03

## Context

The new Web UI (today `apps/web-improve`, canonical at `apps/web` after cutover)
serves all 53 routes from an in-process mock authority (`DbAuthority`,
`MockClock`, scoped commit handlers) whose sync projections read in-memory
snapshots. The real backend is the Fastify server in `apps/web/server` plus the
Python runtime, exposed as same-origin `/api` HTTP and scoped SSE.

Wiring real mode by injecting HTTP calls into the mock authority would leave
snapshot-based sync reads reading demo data, let real consumers reach demo
reset/clock operations, and make mock/real isolation untestable. The integration
spec (R02/R04) requires mode selection before provider creation, no mock
fallback in real mode, and scoped, cache-correct read models.

## Decision

Introduce a browser-side data boundary inside the frontend package:

- A single real transport (same-origin `/api` fetch client + SSE consumer) that
  validates wire responses against `@raptix/web-contracts` DTOs.
- Real feature read models built on browser Query (React Query) with
  mode/identity/engagement-scoped keys; no second browser database and no
  `snapshot()` emulation.
- Composition selects exactly one authority per mode before providers mount;
  real composition never imports the mock authority, seed, `MockClock`, demo
  schedules or reset operations.

## Consequences

- **Easier:** mock mode stays deterministic and serverless; real mode failures
  are explicit; per-scope cache invalidation and stale-scope cancellation are
  testable without a backend.
- **Harder:** every feature that goes real needs an adapter/read model and
  cannot silently borrow the demo `Db`; two parallel implementations must be
  kept type-disjoint.
- **Given up:** transparently "falling back" to demo data when the backend is
  absent, and sync global reads in real mode.
- **Migration:** feature modules migrate screen by screen (tickets 03-17);
  unchanged mock-only screens keep working during the transition.

## Alternatives considered

- **Extend `DbAuthority` with HTTP-backed handlers:** rejected because sync
  snapshot projections would still read demo data and reset/clock operations
  would remain reachable from real consumers.
- **Point Query at server code imports:** rejected because server/Prisma source
  must not run in the browser (R04).
