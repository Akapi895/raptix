# 01: App-local tooling and verification commands

**What to build:** Isolated dependency/configuration preparation: install the agreed router, state, Query and form packages plus Vitest/RTL/user-event/jsdom and lint tooling; expose app-local npm verification scripts. Domain and UI changes follow in other tickets.
**Blocked by:** None (after execution prerequisites).
**Status:** resolved
**Owner:** Toolchain, manifests and lockfile.
**Contract:** [execution.md](../execution.md).

- [x] Node/Vite compatibility verified; app-local npm lockfile is authoritative and the conflicting pnpm lockfile is retired deliberately.
- [x] Typecheck, lint, build and non-watch test commands exist; test configuration can run without loading Figma preview plugins.
- [x] Existing diagnostics are recorded with owning migration tickets; the tooling introduces no new diagnostics and does not suppress rules to obtain green.
- [x] A runner smoke check passes; dependency justification and supply-chain review requirements are recorded separately from feature work.

## Evidence

All commands run in `apps/web-improve` with Node v24.18.0 / npm 11.16.0, Vitest 5.0.4 (supports Vite ^8 as peer).

- `npm run typecheck` — pass, **0 diagnostics** (baseline was also 0; tooling added none).
- `npm run lint` — pass (`exit 0`), **0 errors / 226 warnings**: the recorded pre-existing export baseline, not new findings. See [diagnostics.md](../diagnostics.md) for the full per-file inventory, rule totals, the severity ratchet policy and per-file owning tickets. No rule is disabled or ignored; five rules ship as `warn` solely because the untouched export still violates them, and owning tickets must re-promote them to `'error'` as their files migrate. Ticket 01 fixed the only 2 findings inside its own tooling surface (`vite.config.ts` `no-explicit-any`, type-only change).
- `npm test -- --run` — pass: 1 test file, 1 test (`src/App.test.tsx` renders `<App />` and asserts the sign-in heading and enabled Continue button; `npm test` is `vitest run`, non-watch).
- `npm run build` — pass; `dev`/`build`/Figma deploy semantics unchanged (`vite.config.ts` untouched except the type-only `any` fix).

Figma plugin isolation proven empirically: with a temporary `throw` guard installed at the top of `vite.config.ts` (all Figma plugin factories), `npm test -- --run` still passed (guard never fired → `vitest.config.ts` replaces `vite.config.ts` for tests, which prefer the dedicated config) while `npm run build` failed with the guard (proving the real build still loads the Figma pipeline). Guard reverted afterwards; both runs re-verified green.

Tooling files added: `vitest.config.ts` (react + tailwind + `@` alias, jsdom, `src/test/setup.ts`; no Figma plugins), `eslint.config.js` (typescript-eslint recommended + react-hooks + react-refresh, flat config), `src/test/setup.ts` (jest-dom matchers), `src/App.test.tsx` (smoke test). Scripts added: `typecheck`, `lint`, `test`. `tsconfig.json` gained `vitest.config.ts` in `include`.

Dependency justification, lockfile policy (pnpm retired, npm sole authority, Router pinned `^7` not v8) and `npm audit` result: [diagnostics.md § Dependency justification](../diagnostics.md).

No runtime `src/` behavior was changed: the only `src/` additions are the test harness files; no existing component, store or screen was modified.
