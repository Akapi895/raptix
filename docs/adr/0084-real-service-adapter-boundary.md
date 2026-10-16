# Real-mode feature service adapter and control-gap boundary

**Status: Proposed** — 2026-10-16. Blocks adapter code under
`apps/web/src/real/service-adapter/` until accepted.

## Context

`apps/web` renders two UI trees for the same screens: `src/screens/*` (mock,
the target UX) and `src/real/screens/*` (real, hand-built against
`src/real/api.ts`). They share no presentation code, the domain models have
diverged (operations threads/runs vs steps/plan; findings split into
read + curated resources vs one lifecycle; C2 dispatch/reconcile vs
console/transcript), and every real screen must be maintained twice.

The service contract in `src/domain/service.ts` (ADR-0067) is already async and
backend-agnostic, but `createConsoleServices()` is the only implementation and
`useServices()` deliberately throws in real mode (ADR-0068 D4: real mode never
falls back to demo data). Mock-only plumbing (`authority`, `clock`, `schedule`,
`dispose`) has no meaning against a real backend.

## Decision

1. **Narrow feature seam.** Export a `FeatureServices` type from
   `src/domain/service-factory.ts` as `Pick<ConsoleServices, …>` covering only
   per-feature services (findings, operations, c2, reports, …). Expose it through
   a new `useFeatureServices()` hook. `useServices()`, `useDb()` and the other
   mock-only accessors keep throwing in real mode.
2. **Adapter location.** Real implementations live in
   `src/real/service-adapter/`, one file per feature, each importing only
   `src/real/api.ts` and `domain/service.ts` types. Adapters never import from
   `src/real/screens/*` or `src/screens/*`.
3. **Honest absence, two tiers.**
   - *Not yet integrated*: a domain without an adapter resolves every method to
     `{ok:false, failure:{kind:'unavailable'}}` through a Proxy stub. Existing
     query error paths render it.
   - *Not modelled by the backend*: a static `REAL_CONTROL_GAPS` table maps
     control ids (e.g. `operation.pause`, `finding.aiSuggestion`,
     `c2.transcript`) to a reason string. `useRealControlGap(id)` returns that
     reason in real mode and `null` in mock mode; screens wrap the control with
     the existing `Gated`/`Locked` primitives. These gaps are frontend-owned and
     are not driven by `CapabilitiesDocument`, because the server has no concept
     of these verbs at all.
4. **Concurrency mapping.** Adapters translate backend `expectedVersion`
   conflicts into `ServiceFailure{kind:'conflict'}`. No change to
   `domain/service.ts` is required.
5. **Routing.** A `MIGRATED_ROUTES` set, checked before `REAL_PAGES` in
   `router/host.tsx`, selects the mock screen for both modes once a domain
   reaches parity. Real screens for that domain are then deleted.

## Consequences

- Real and mock screens for a migrated domain become one implementation; only
  the data seam differs.
- Operations pause/resume/stop/complete and C2 transcript stay gated in real
  mode indefinitely unless a backend initiative adds those concepts. This is an
  intentional scope decision for this ADR, not deferred debt.
- Each migrated domain requires its adapter, a query-hook swap, gating for
  model gaps, and removal of the matching `src/real/screens/*` files plus test
  rewrites (`precommit-regressions.test.tsx`).
- Mock screens that call `services.authority` or `services.clock` directly
  (`c-console.tsx`, `h-session.tsx`, and four legacy writes in `e-findings.tsx`)
  must be moved onto the typed facade before their domain can migrate.

## Open questions

See `docs/design/2026-10-16-web-screens-unification-implementation-plan.md` §6.
This ADR is accepted once those questions are answered for the pilot domain
(findings).
