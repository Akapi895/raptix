# @raptix/web-raptix

Canonical Raptix web console — React 19 + Vite 8 + Tailwind CSS 4, npm
workspaces. Replaced the previous 13-page browser app in the ticket-02 cutover
(`.scratch/frontend-backend-integration/` is the active integration tracker).

## Development

```bash
npm install                      # from repo root (root lockfile is authoritative)
npm run dev --workspace=@raptix/web-raptix
```

- Dev server `127.0.0.1:5273` (override with `VITE_DEV_PORT`; add
  `-- --port <port>` if the default is taken). Standalone mock mode needs no
  backend/database/Docker.
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
- Production build does not read `.figma/` (Figma tooling removed at cutover).
- 53-route inventory: `src/router/registry.tsx` (MANIFEST) — hash-based routes.
- Mock data lives behind the explicit mock authority (`src/domain/`); real-mode
  integration lands ticket by ticket and must never fall back to demo data.
- `tests/contracts/w00-captures.test.ts` + `tests/fixtures/` are retained
  real-API capture regressions from the previous app; `tools/` holds the
  deployment verification harnesses (`verify-docker-real-mode.mjs` is a CI
  consumer).

## Project structure

- `src/main.tsx` — entrypoint, imports `src/index.css`, mounts `App`.
- `src/App.tsx` — lazy feature composition and shell.
- `src/router/` — route registry/navigation (53 keys).
- `src/domain/` — contracts, service factory (mode seam), projections.
- `src/state/` — zustand console state and Query providers.
- `src/features/` — feature modules (a/b/c/d/e/f/g/h/s groups).
- `server/` — Fastify API + Prisma (separate package, own build/tests).
- `tests/contracts/` — retained API capture regression.
- `tools/` — deployment/contract verification harnesses.

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
