# Raptix UI

Standalone TypeScript, DOM and Vite frontend extracted from CyberStrikeAI. The
local demo runs without a backend. See the [final UI audit](docs/final-ui-audit.md)
and [frontend API inventory](docs/ui-api-endpoints.md) for portability notes and
the existing interface surface.

## Run

Requires Node.js >=22.12 and the Playwright Chromium browser.

```sh
npm ci
npx playwright install chromium
npm run dev -- --mode demo
```

Development in demo mode and `build:demo` use the local demo API. `npm run dev` uses the configured API unless `VITE_MOCK=1` is set. `npm run build` produces `dist/`; demo output is separate in `dist-demo/`. See `.env.example` for the HTTP base and development proxy. Some realtime and legacy requests use same-origin paths; see the audit before moving the package.

## Verification

From this directory:

```sh
npm run check
```

This runs typecheck, ESLint, Vitest, production build, demo build, then Playwright. Both builds must immediately precede e2e. Playwright starts fresh preview servers on ports 4173 (demo) and 4174 (production) with strict ports and server reuse disabled. Stop an existing preview before running the gate.

`tests/e2e/fixtures.ts` fails demo tests on browser exceptions, console errors or unhandled mock API routes. CRUD coverage uses the demo transport and verifies writes survive reloads. Production tests exercise startup with controlled responses; they do not establish compatibility with a future backend.

## Frontend structure

- Feature code lives under `src/features/`; cross-feature imports use public entry points. Platform adapters own browser/transport boundaries.
- `src/main.ts` starts shared UI, typed domain composition, markup actions, and router/auth startup. Cleanup runs in reverse registration order; preserve that lifecycle when moving the package.
- Classic runtime and compatibility bridges have already been removed. Existing DOM hooks, route aliases, storage keys and API-facing interfaces remain intentional compatibility boundaries.

See the [UI export checklist](docs/ui-export-checklist.md) for the final verification
results, root-hosting assumptions and deferred work. This package does not include
the real Raptix backend and does not establish frontend–backend compatibility.
