# W20 — Legacy retirement gate (reference-only decommission)

> Updated evidence 2026-10-03: IW-07 performs clean install/build/tests, both
> Docker builds and a real DB/runtime browser flow in a snapshot actually lacking
> `clients/web`. The original reference folder is retained. IW-06 adds the new
> image lifecycle/catalog and host `raptix web` commands; remote publication and
> channel/recovery acceptance remain unverified until a release run exists.

Date: 2026-10-02. Guide: W20 row — "decommission legacy folder/workspace/image/active
references … clean install/build/run/E2E without clients/web; final retirement gate".

## Decision (operator-approved)

Keep the `clients/web` Next.js folder in the checkout as **reference-only** (no
`git rm`), but remove it from **every active lane**: Makefile, CI, release, compose
runtime and the desktop/CLI entrypoints. The archived `raptix-web` GHCR image stays
pull-only for emergency rollback. Active scripts/build/runtime/CI references to the
old folder/service must be zero.

## Changes

- `docker-compose.yml` — removed the legacy `web` service (image
  `ghcr.io/akapi895/raptix-web`, port 3000/3003, profile `web`); replaced with a
  pointer to the active web-raptix stack; updated the stale `cli:` comment about the
  `/web` spawn.
- `docker-compose.watch.yml` — removed the `web` service sync/rebuild watch block
  (web-raptix has its own dev server outside compose watch).
- `Makefile` — retired `WEB_DIR`, `web-dev`, `web-build`, `web-hotswap`,
  `web-lint`, `web-migrate`, `web-db-ensure`; `quality`/`quality-strict` now run
  `webraptix-quality`; new `webraptix-dev` replaces the legacy Next dev server;
  `health` web check now polls the web-raptix stack on port 3000 (SKIP hint when
  down, never fails because an optional profile is absent).
- `.github/workflows/ci.yml` — removed the `web` paths-filter (app + docker), the
  `web` job (lint + Next build), and the `outputs.web` line; `web-raptix` comment
  updated (legacy job retired with W20, guide §14.5).
- `.github/workflows/release.yml` — removed `docker-web` (multi-arch build of
  `containers/web.Dockerfile`) and `docker-web-merge` (manifest/sign/SBOM);
  `publish-release` no longer needs `docker-web-merge` and both image lists drop
  `raptix-web`; dangling comments fixed.
- `clients/cli/src/commands/web.ts` — truthful retirement: `/web` and `/web url`
  only print the dashboard URL; lifecycle args (`up`/`down`/`stop`) answer with the
  W20 notice pointing at `docker compose -f docker-compose.web-raptix.yml up -d`
  / `make webraptix-up` instead of spawning a service that no longer exists. No
  compose call, no fabricated success.
- `clients/cli/src/commands/web.test.ts` — replaced the retired
  `formatComposeFailure` tests with command-level tests (URL reporting + lifecycle
  notice).
- `clients/desktop` (`config.mjs`, `main.mjs`, `config.test.mjs`) — local mode no
  longer auto-spawns the `web` compose profile: removed `webContainer`,
  `composeProcessEnv`, `composeUpArgs`, `runningWebImageCurrent`, `startWebProfile`
  and the spawn plumbing; the offline status now names the host commands. Desktop
  keeps polling `dashboardUrl` and loads it when the stack is up.
- `AGENTS.md` (root) — build note now targets web-raptix; `clients/web` marked
  reference-only.
- `docs/makefile-reference.md`, `docs/web-dashboard.md` — active docs rewritten for
  the web-raptix stack (webraptix-* targets, `/web` URL-only behaviour, Fastify API
  routes, web-raptix Prisma schema path).

Kept (per decision): `clients/web/` folder, `containers/web.Dockerfile`,
`containers/web-entrypoint.sh`, `scripts/web-hotswap.sh`, `scripts/init-web-db.sql`
— dormant files, not referenced by any active lane.

## Acceptance evidence

- Legacy service stopped: `raptix-web` = `Exited (0)`; active stack =
  `raptix-web-raptix-ui` Up + `raptix-web-raptix-api` Up (healthy).
- Compose validation mirrors the CI compose lane: base and base+dev
  `docker compose config` both valid after the service removal.
- CI YAML parse: `ci.yml` and `release.yml` valid.
- Clean install/build/run/E2E without clients/web in the lane:
  - `npm ci` from the root lockfile (zero `clients/web` workspace entries).
  - contracts 45/45; server typecheck + tests 211/211 (21 files); frontend
    typecheck + lint (0 errors, 39 pre-existing warnings) + build + unit 80/80.
  - Playwright mock lane 8/8; real lane 29/29.
  - CLI tests 33/33 (incl. new `/web` behaviour), desktop tests 27/27, all desktop
    entrypoints `node --check` clean.
- Active-reference scan: `clients/web` / `web.Dockerfile` / `web-entrypoint` /
  `web-hotswap` / `--profile web` hits in Makefile, compose files, CI and release
  workflows are comments or `clients/web-raptix` paths only.
