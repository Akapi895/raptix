# W16 — New-stack deployment cutover (accepted 2026-10-02)

> Historical cutover evidence. IW updates (2026-10-03) enable real-mode Docker
> builds, synchronized migrations, durable local checkpoints and Vault. Current
> image/version/mount/readiness details are in the interactive readiness backlog
> and P1 release runbook; health 200 alone is not inference/tool evidence.

## Scope

Guide §14.3/§14.5: deploy the new web-raptix stack from containers, same-origin
routing, dedicated database, legacy service stopped, data preserved, rollback
basics documented.

## New deployment assets

- `containers/web-raptix-server.Dockerfile` — Fastify API image (node:22-slim,
  multi-stage). Own Prisma artifacts; `prisma migrate deploy` runs at boot (the
  new server is the migration owner, guide §13.4). Copies the workspace-nested
  `clients/web-raptix/node_modules` because npm resolves the server's ajv@8
  there while the hoisted root copy is ajv@6 — without it ESM named exports
  break. No `clients/web` reference anywhere in the build.
- `containers/web-raptix.Dockerfile` — static UI image: Vite build of
  `@raptix/web-raptix` served by nginx; no Prisma/DB/server packages ship.
- `containers/web-raptix-proxy.conf` — same-origin topology per §14.3:
  `/projects/*` SPA fallback to index.html (no-store shell), `/assets/*`
  immutable, `/api/*` → `web-raptix-api:8081` with `proxy_buffering off`,
  long read timeouts and a hard 404 for unknown asset/API paths (an API route
  never falls back to SPA HTML).
- `docker-compose.web-raptix.yml` — two services only (`web-raptix-api`,
  `web-raptix-ui`) on the existing base network (`raptix_raptix-net`,
  overridable via `RAPTIX_NETWORK`); PostgreSQL / Neo4j / LangGraph / sandbox
  and the workspace volume keep running from the base compose untouched.
  Dedicated new-stack database `raptix_web_raptix` (own migration history; the
  legacy `raptix_web` database is never touched). The UI binds the SAME host
  port the legacy web served (127.0.0.1:3000 → 8080), so the CLI `/web`
  command and launcher health checks keep working without code changes.

## Makefile / CI

- New lane targets: `webraptix-quality` (streaming + contracts build, server
  typecheck/tests, UI typecheck/lint/build/tests), `webraptix-build`
  (both images), `webraptix-db-ensure` (idempotent database creation),
  `webraptix-up` (up --wait; migrations run in-container), `webraptix-down`,
  `webraptix-health` (API JSON through the proxy, capabilities-no-SPA-fallback,
  SPA fallback, assets route, and legacy-web stopped/running state).
- CI: new `web-raptix` quality job and `web-raptix` / `web-raptix-server`
  docker-build matrix entries (path-filtered). The legacy `web` job stays
  during the rollback window and retires with W20 (guide §14.5).

## Cutover performed (2026-10-02)

1. Both images built from the local checkout (`raptix-web-raptix-api:stable`
   923 MB, `raptix-web-raptix-ui:stable` 74.6 MB).
2. `raptix_web_raptix` database ensured; migrations deployed by the API
   container at boot (6 migrations, then "No pending migrations").
3. **Legacy `raptix-web` container stopped** (Exited 0), freeing port 3000.
4. New stack up and healthy; same-origin acceptance through the proxy:
   - `GET /api/health` → `{"status":"ok","service":"web-raptix-server",…}`
   - `GET /api/capabilities` → JSON (no SPA fallback)
   - `GET /projects/cutover-check/charter` → SPA fallback serves the shell
   - `GET /assets/…` unknown → 404 (assets never SPA-fallback)
   - index shell `Cache-Control: no-store`
   - SSE route reached through the proxy answers API JSON, never HTML
5. Live round trip through the deployed proxy: create engagement → read →
   danger delete → 404.

## Data preservation & rollback basics

- Preserved: legacy `raptix_web` database rows, the workspace volume mount
  (`$RAPTIX_HOME/workspace` reused by the new API), Neo4j store, LiteLLM,
  LangGraph runtime and sandbox all keep running from the base stack.
- Rollback window: stop the new stack (`make webraptix-down` or
  `docker compose -f docker-compose.web-raptix.yml down` — frees port 3000)
  and `docker start raptix-web` to restore the legacy service. The legacy
  image and code stay in place until the W20 retirement gate.
- The legacy `web-hotswap.sh` lifecycle and `clients/web` runtime are no
  longer part of the serving path; their removal is W20's scope, not a W16
  runtime dependency.

## Non-goals honored

No data volume recreated, no LangGraph/sandbox restart, no legacy image
deletion during the rollback window, no runtime upstream dependency from the
new stack to `clients/web`.
