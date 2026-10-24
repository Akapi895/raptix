# ADR-0101: The console has one data source: the real API; the demo data path is removed

- **Status:** Proposed — 2026-10-24. The direction was chosen by the operator on 2026-10-24 (two phases, both approved); the record stays Proposed until the repository owner accepts it in writing.
- **Date:** 2026-10-24
- **Deciders:** repository owner (pending)
- **Related:** ADR-0068 (real mode never falls back to demo data), ADR-0084 (feature services), ADR-0096 (feature ownership: `mock.ts` and `remote.ts`), ADR-0100 (single-operator mode)

## Context

The web console was built with two data sources: a demo authority (an in-memory database with seed data, simulated runtime and personas) and the real API. Each feature has a port (`service.ts`), a demo implementation (`mock.ts` or demo logic inside `service.ts`) and a real adapter (`remote.ts`). The demo side is about 12,800 lines: 33 feature `service.ts` files (about 7,100 lines, most of it demo logic), 13 `mock.ts` files (about 2,500 lines), and `src/demo/` (about 3,150 lines). About 76 production files import from `src/demo/`, and 59 test files depend on it.

The demo data is a second product that users can reach: the account menu offered "Switch to demo mode" to every user. Real-mode screens do not fall back to demo data (ADR-0068), so the demo path is dead in production, but it costs maintenance, makes the bundle larger, and blurs what the console really shows.

## Decision

The console has one data source: the real API.

Phase 1 (done in `8c000c9f`): a production build always resolves to the real API, whatever the query string or local storage says; the "Switch to demo mode" item is removed from the account menu.

Phase 2: remove the demo path from the code base. The steps, in order, each ending with the gates green:

1. **Demo-only presentation** with no real-mode importer: `src/demo/guide.tsx`, `guides.ts`, `launch.ts`, `pages.tsx`, and the demo project-detail pages. Remove them with their tests.
2. **Shared types and helpers** that the real adapters use, moved out of the demo: the actor helper (`actorRef` in `demo/persona.ts`) and the seed row types (`Db`, `FindingRow`, `SuggestionDispositionState`) go to `domain/`.
3. **Projections and the composition root.** The `ConsoleServices` type and `state/services.tsx` (the demo authority provider) are removed. Each projection that reads the demo authority snapshot is either re-platformed to the real adapter's view model or removed with its feature view. This is the largest step: 35 production modules import `ConsoleServices` or the authority snapshot.
4. **Feature services.** For each of the 33 `features/*/service.ts`, the port types and the pure helpers used by `remote.ts` stay; the demo logic that takes the authority is deleted. The 13 `features/*/mock.ts` files are deleted.
5. **`src/demo/`** is deleted (`authority`, `seed`, `persona`, `services`, `runtime`), and the 59 test files that depend on it are rewritten against the real adapters with fixtures, or deleted.
6. **Tools and docs.** The mock modes of the verification flows and route smoke, the `mock` value of `VITE_DATA_MODE`, and the mock lines in `CLAUDE.md` and `AGENTS.md` are removed.

Scope measured on 2026-10-24: `features/*/service.ts` 7,106 lines in 33 files; `features/*/mock*.ts` 2,522 lines in 13 files; `src/demo/` 3,157 lines in 19 files; 35 production modules import `ConsoleServices`; 46 modules call `useServices`; 59 test files depend on the demo.

## Consequences

- **Easier:** one data path to test and to reason about; a smaller bundle; no demo state that can disagree with the server.
- **Harder:** a developer without a backend cannot browse the console any more. The stack takes minutes to start and needs Docker.
- **Given up:** the offline demo, the seeded personas, and the demo runtime for presentations. A presentation of the console needs the verification stack with its fixtures.
- **Migration:** existing mock-mode tests are rewritten against the real adapters with fixtures, or deleted when they only test demo behaviour. The `mock` value of `RAPTIX_VERIFY_FLAGS`-style switches and of `VITE_DATA_MODE` is removed.

## Alternatives considered

- **Keep the demo for development only:** Rejected for now. The owner's development server on port 5273 runs the demo; removing the demo means that workflow moves to the verification stack. The operator chose the full removal.
- **Hide the demo, keep the code:** This was phase 1. It leaves the maintenance cost and the bundle size in place, so it is not the end state.

## Implementation status

Work is on branch `frontend` and is not pushed. The status line above stays Proposed until the owner accepts the record.

- Phase 1: `8c000c9f`.
- Step 1: `0cbcd54b`, the QA galleries, the prototype gate and the demo presentation.
- Step 2: `84dfae6a`, `actorRef` moved to `domain/actor.ts`. The finding row and seed types were not moved: nothing live needed them, so they left with the mock findings service in step 4.
- Steps 3 to 5: `e2203e50`, the composition root, the feature services, the mock modules and their tests. Reachability from the app entry finds no dead production module and no production import of `demo/` or mock code. These steps land as one commit because each one only typechecks with the others.
- Step 6: the verification flows and the route smoke are real-only, the route inventory keeps only real expectations, and the flows that ran only against the mock (agents, operations, integration path) are removed. `VITE_DATA_MODE`, the `dataMode` query and the prototype gate are gone from the tools and the web guides.

Open items:

- Eleven feature routes (preflight, operation-schedule, operation, agent, ai-plan, ai-plan-review, ai-plan-compare, ai-branch, c2-channel, c2-session, c2-console) take their real expectation from the declared title. A stack run in discover mode has not confirmed them yet.
- The responsive, dark-theme and a11y screen audits and the global infrastructure route suite were deleted: their assertions used demo fixtures. Rebuilding them on real fixtures is not done.
- Verified: tsc, eslint, the boundary ratchet, the web suite (110 files) and the production build. The bundle has no demo strings.
