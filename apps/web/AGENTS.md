# @raptix/web-raptix

Canonical Raptix web console — React 19 + Vite 8 + Tailwind CSS 4, npm
workspaces. Replaced the previous 13-page browser app in the ticket-02 cutover
(`.scratch/frontend-backend-integration/` is the active integration tracker). Refactor work follows `.scratch/web-improve-refactor/spec.md`, `execution.md` and `coverage.md`; the old root `implementation-plan.md` is archived under `.scratch/web-improve-refactor/archive/`.

## Development

```bash
npm install                      # from repo root (root lockfile is authoritative)
npm run dev --workspace=@raptix/web-raptix
```

- Dev server `127.0.0.1:5273` (override with `VITE_DEV_PORT`; add
  `-- --port <port>` if the default is taken). The console runs against the real API
  only (ADR-0101): start the API or the verification stack first; there is no standalone mode.
- Dev `/api` proxy targets `RAPTIX_WEB_BACKEND_URL` or `http://127.0.0.1:5280`
  (the Fastify server in `apps/web/server`, workspace
  `@raptix/web-raptix-server`).

## Gates

```bash
npm run typecheck --workspace=@raptix/web-raptix
npm run lint      --workspace=@raptix/web-raptix
npm run build     --workspace=@raptix/web-raptix   # build chains typecheck
npm run test      --workspace=@raptix/web-raptix
```

Run only the tests affected by a change (targeted selection, see the
integration contract in `.scratch/frontend-backend-integration/execution.md`);
do not default to the full suite.

## Conventions

- Node >= 22.12; **npm only** — the root `package-lock.json` is the only lock.
- Alias `@` → `src/` (ESM-compatible in `vite.config.ts`).
- Never import Prisma/`fs`/server modules into browser code.
- Timestamps come from the server; the console does not keep a local dataset clock.
- No new `eslint-disable`. Fix the cause in the file you touch; no repo-wide suppression cleanup.
- Production build does not read `.figma/` (Figma tooling removed at cutover).
- Route inventory: `src/router/routes.ts` (one declaration per key); the route smoke expectations are in `tools/verify/routes.json`.
- There is no demo data path: the console reads the real API only (ADR-0068, ADR-0101).
- `tests/contracts/w00-captures.test.ts` + `tests/fixtures/` are retained
  real-API capture regressions from the previous app; `tools/` holds the
  deployment verification harnesses (`verify-docker-real-mode.mjs` is a CI
  consumer).

## Project structure

ADR-0096: each feature owns its presentation, its port and its real adapter; the demo side is removed (ADR-0101).

- `src/main.tsx`, `src/App.tsx` — entrypoint and shell composition.
- `src/state/` — composition root: `feature-services.ts` (the real feature adapter set), `console.ts` (identity and project reads), `query.tsx` (the Query provider).
- `src/router/` — the route keys (`routes.ts`), their slices (`registry.tsx`), hash parsing and the route host.
- `src/platform/` — shared browser machinery: transport, session, streaming, request ledger. No domain logic.
- `src/domain/` — shared contracts and pure logic: entities, catalog, ports (`feature-services.ts`), policy and the actor helper.
- `src/features/<domain>/` — one owner per domain: `index.ts` (public surface), `service.ts` (port), `remote.ts` (real adapter that implements the port), `api.ts` (wire calls behind `remote.ts`), `query.ts` (hooks and reads that presentation calls), `views/` (presentation shared by both modes). Callers outside a feature import only `index.ts`; presentation never imports `remote.ts`, `api.ts` or `mock.ts`.
- `src/real/` and `src/screens/` were removed. Real presentation lives in the owning feature or `src/shell/`; the real composition is `src/state/real-services*.ts(x)` and `src/shell/real-bootstrap.tsx`.
- `server/` — Fastify API + Prisma (separate package, own build/tests).
- `tests/contracts/` — retained API capture regression.
- `tools/` — gates and verification: `check-boundaries.mjs` (ratchet against `boundaries-baseline.json`), `verify/route-smoke.mjs` (route expectations; known failures in `verify/baseline.json`), `verify/stack.mjs` (isolated real-mode stack with its own PostgreSQL container).

Import exceptions (ADR-0096; `check:boundaries` enforces them):
- `features/<x>/remote.ts` and `platform/` import no mock or demo code (there is none).
- Presentation imports a feature through `index.ts` or its `service.ts` port; never `remote.ts`.

Gates before a change lands: `npm run typecheck`, `npm run lint` (clean), `npm run test`, `npm run build`, `npm run check:boundaries` (fails above the baseline), and `npm run verify:routes` for the modes the change touches. `npm run check:boundaries:write` records a reviewed reduction.

## Windows Temporary Process Safety

Applies ONLY to temporary process lifecycle operations — Vite preview/dev
servers, npm/npx servers, `Start-Process`, `Stop-Process`, `Stop-Job`,
`taskkill` and similar cleanup. It does NOT add timeouts to builds, tests,
installs, lint, or other ordinary commands.

- Never launch a temporary server with `Start-Process -NoNewWindow` unless you
  control the entire child process tree. `npm.cmd`/`npx.cmd` spawn `cmd.exe`
  and `node.exe` children that survive the parent — never assume
  `Stop-Process -Id $p.Id` stops the whole tree.
- Before stopping anything, identify the exact PID, command line, worktree and
  port. NEVER kill all `node.exe`, `npm`, or `cmd.exe` processes. Prefer
  stopping only the children of the server you started; kill a whole tree only
  when its root PID is verified to belong to the current verification session.
- Every STOP/CLEANUP operation has a hard 5-second cap. If the environment
  supports tool-level command timeouts, use them for every STOP/CLEANUP call.
  If a stop does not finish within the cap, skip cleanup, record a warning with
  the surviving PID/port, and move on — no unbounded retries.
- A `Start-Sleep`, `Wait-Job -Timeout`, or an HTTP probe timeout is NOT a hard
  timeout for the whole PowerShell command, and no timeout mechanism may be
  built by spawning another job/process that can itself wait forever.
- Waiting for a server to start and probing HTTP get their own time limits (the
  5-second STOP cap does not apply to them). Always probe the actual port from
  the launch configuration or arguments — never hardcode a different port in
  HTTP checks. Do not start another server while a port is in use until the
  owning process is identified.
- Never wait on `Stop-Job`/`Wait-Job` or on long-lived server stdout/stderr
  without a timeout. Prefer verifiable termination checks over fixed sleeps.
- If the terminal tool cannot guarantee a timeout, do not keep issuing stop
  commands that may hang: report the surviving PID/port and continue
  independent work.
- Never modify application code, install dependencies, or change Vite
  configuration to work around an agent process-management failure.
- When a verification server is optional, prefer SKIPPING it and recording the
  verification gap over running an unbounded server lifecycle.

## Color roles

Two accent families exist in `src/index.css`. The rule below is the one the token comment states, and it applies to new code.

- Primary (blue, `--c-primary`): primary actions and links. A filled primary button carries its own fill token, so its white label meets 4.5:1 in both themes.
- Accent (red, `--c-accent`): the brand mark, severity states and destructive actions. Destructive buttons carry their own fill token.
- Do not use the accent for an ordinary action or link, and do not use primary for a severity state.
- Text links use `--c-link`, the lighter blue; the token comment in `src/index.css` gives its contrast on the slate panels. `--c-primary` is for fills and buttons.
