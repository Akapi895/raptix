# ADR-0096: Give each Web feature its own presentation and real adapter

- **Status:** Accepted — 2026-10-22 (repository owner approved the restructuring plan; see `apps/web/.scratch/web-standardization/ket-luan-tai-cau-truc.md`). Supersedes decision 2 of ADR-0084 (adapter location only).
- **Date:** 2026-10-22
- **Deciders:** repository owner
- **Related:** ADR-0084 (decisions 1, 3, 4 and 6 stay in force; decision 5 stays until `REAL_PAGES` is removed), ADR-0067 (service/domain boundary), ADR-0068 (real-mode data boundary), product foundations proposal 2026-10-21 §6.

## Context

ADR-0084 placed the real implementations in `apps/web/src/real/service-adapter/`, one file per feature. The owner decided on 2026-10-21 that presentation moves to `features/<domain>/` and changes only when its feature changes. The proposal (§6.5) moves each adapter into its owning feature as well.

Today `src/real/` holds transport, session, streaming, adapters, real screens and shell parts together. Presentation branches on the mode: 25 `isRealMode()` calls in 7 files. Presentation and feature code call the mock accessor `useServices()` in 59 files, and reach the mock authority in 29 files. Demo data and the demo clock are imported by feature code. A domain's real behaviour is therefore spread across `features/`, `screens/`, `real/` and `router/`.

## Decision

1. **Feature ownership.** Each feature owns its real adapter in `features/<domain>/remote.ts`. Its port (`service.ts`) is the only interface presentation uses. Presentation lives in `features/<domain>/views/` and is shared by both modes.
2. **One mode decision.** Mode selection happens once, in the composition root (`state/`). A feature's mock implementation lives in `features/<domain>/mock.ts` and may import `demo/`. Real implementations do not import `demo/` or mock modules.
3. **Shared browser machinery** lives in `platform/` (transport, session, streaming). `platform/` contains no domain logic.
4. **Demo-only code** (seed, demo clock, mock authority, mock service factory, demo runtime, personas) lives in `demo/`. Real mode never falls back to it (ADR-0068).
5. **Public surface.** A caller outside a feature imports only `features/<domain>` through its `index.ts`.
6. **One presentation per route.** A route key renders one shared presentation in both modes. Route keys are declared once, in `router/`.

`apps/web/tools/check-boundaries.mjs` checks decisions 1, 2, 4 and 5 mechanically. It is an acceptance check, not a lint rule; lint configuration is unchanged.

## Consequences

- **Easier:** a domain's knowledge sits in one place; tests live next to the behaviour they cover; import boundaries can be checked by script.
- **Harder:** each migrated domain must provide a `remote.ts` that covers the port, or report an explicit `unavailable` gap. A real panel can be removed only after the shared presentation reaches parity.
- **Given up:** separate real-only panels and parallel mock/real screen trees for migrated routes.
- **Migration:** slice by slice (see the conclusions document). `src/real/service-adapter/` and `src/real/screens/` are removed when their last entry moves.

## Alternatives considered

- **Keep adapters in `real/service-adapter/` (status quo of ADR-0084).** Rejected: `real/` remains the place where every domain meets, and the real and mock trees keep diverging.
- **One global API client over all features.** Rejected: it hides domain knowledge behind one large interface, which proposal §6.6 forbids.
