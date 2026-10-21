# Real-mode feature service adapter and control-gap boundary

**Status: Accepted** — 2026-10-21 (repository owner). Proposed 2026-10-16. The prose was updated at acceptance to match the source: the adapters exist, the presentation location is decided, and Operations controls are wired.

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
2. **Adapter location and presentation.** Real implementations live in
   `src/real/service-adapter/`, one file per feature, each importing only
   `src/real/api.ts` and `domain/service.ts` types. Adapters never import from
   `src/real/screens/*` or `src/screens/*`. The unified presentation for a
   migrated domain lives in `src/features/<domain>/` (owner decision, 2026-10-21).
   A presentation file moves there when its feature is changed; there is no bulk move.
3. **Honest absence, two tiers.**
   - *Not yet integrated*: a domain without an adapter resolves every method to
     `{ok:false, failure:{kind:'unavailable'}}` through a Proxy stub. Existing
     query error paths render it.
   - *Not modelled by the backend*: a static `REAL_CONTROL_GAPS` table maps
     control ids to a reason string. It holds `evidence.original` and
     `evidence.integrity` today. `useRealControlGap(id)` returns that reason in
     real mode and `null` in mock mode; screens wrap the control with the existing
     `Gated`/`Locked` primitives. These gaps are frontend-owned and are not driven
     by `CapabilitiesDocument`. Operations pause, resume, complete and run cancel
     are backed by the runtime and are not gaps. The interactive C2 transcript is a
     gap until the PTY console exists (ADR-0095); no real-mode transcript UI renders
     today, so there is nothing to gate yet.
4. **Concurrency mapping.** Adapters translate backend `expectedVersion`
   conflicts into `ServiceFailure{kind:'conflict'}`. No change to
   `domain/service.ts` is required.
5. **Routing.** A `MIGRATED_ROUTES` set, checked before `REAL_PAGES` in
   `router/host.tsx`, selects the mock screen for both modes once a domain
   reaches parity. Real screens for that domain are then deleted.
6. **Time.** Time comes from the factory clock. Presentation and the real
   interface never receive `MockClock` (owner decision, 2026-10-21). In real mode,
   deadlines and authorization are decided by the backend.

## Status of implementation (2026-10-21)

- Adapters: 21 non-test files in `src/real/service-adapter/`, plus `index.ts` and `stub.ts`.
- Pilot committed: Findings and Evidence. `MIGRATED_ROUTES` holds 19 route keys.
- Operations run controls (pause run, resume operation, complete operation, cancel run)
  are wired through `src/features/operations/runtime-query.ts` and `runtime-runs.tsx`.
- The project Findings tab renders the Finding module. Producer findings appear in
  its AI Suggestions tab and import as drafts only (`importSuggestion`). No separate
  producer panel remains.
- Not yet migrated: Reports, Assets/Library, C2 (`h-session.tsx` must call writes
  through the facade), Operations screen (`c-console.tsx`, same), Global inventories,
  Instance/subagent, Vault, Settings/Team/Audit, Closeout.

## Consequences

- Real and mock screens for a migrated domain become one implementation; only the
  data seam differs.
- The C2 interactive transcript stays gated until ADR-0095 is Accepted and the PTY
  console exists.
- Mock screens that call `services.authority` or `services.clock` directly
  (`c-console.tsx`, `h-session.tsx`, and four legacy writes in `e-findings.tsx`) must
  move onto the typed facade before their domain can migrate. The e-findings writes
  run only in the mock branch. `addFindingCommentTransaction` still reads the demo
  clock because it takes no clock argument.
- Each migrated domain requires its adapter, a query-hook swap, gating for model
  gaps, and removal of the matching `src/real/screens/*` files plus test rewrites
  (`precommit-regressions.test.tsx`).

## Open questions (resolved 2026-10-21)

See `docs/design/2026-10-16-web-screens-unification-implementation-plan.md` §6.

1. Findings PR-4 scope: comment posting, AI-suggestion dismissal and add-to-report
   ship in the pilot. The real branches in `e-findings.tsx` call the writes.
2. Findings transitions: `ai_suggested` has one route, to `draft`, through
   `importSuggestion`.
3. C2 transcript: gated until ADR-0095 is Accepted (owner decision D5).
4. Campaigns: not decided. It is not a findings question, so it does not block this
   ADR and stays open.
5. Operations detail shape: the existing runtime backend is wired; no gate (owner
   decision D5).
