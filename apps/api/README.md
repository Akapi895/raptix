# @raptix/api

Backend-for-frontend for `apps/ui-app` (ADR-0106). Translates Raptix's domain
model (OPPLAN/`EngagementContext`, capability runtime, AKG, asset-map,
governance, closure, scope, vault...) into the contract `apps/ui-app` already
speaks (`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`).

**Tier 1 (foundation) is done**: the full "Authentication and account"
module (login/logout/validate/change-password, real Postgres-backed
sessions, single-operator seed) and the LangGraph runtime adapter. Tier 2+
(Projects, chat, HITL, everything else) is not started — see
`docs/design/2026-10-31-ui-app-integration-implementation-plan.md` before
adding the next route group.

## Layout

- `src/http/routes/auth.routes.ts` — the full "Authentication and account"
  module (`/api/auth/login|logout|validate|change-password`; the two
  `robot-binding*`/`robot-bindings` routes are stubbed `501` -- no Raptix
  equivalent, cut candidate pending the owner's call, ADR-0106 §2/§7).
- `src/http/plugins/auth-guard.ts` — the `preHandler` every `bearerAuth`
  route in `apps/ui-app/docs/openapi.yaml` needs; looks up the session by
  token (`src/db/auth-store.ts`), never a JWT.
- `src/security/` — password hashing (`node:crypto` scrypt, no dependency),
  session token/payload shape, the first-boot operator seed.
- `src/db/client.ts` — Prisma client factory (driver adapter over `pg`, no
  env reads, no side effect on import). `src/db/auth-store.ts` is the
  `AuthStore` port + its Prisma implementation; routes depend on the port,
  so tests use `tests/support/fake-auth-store.ts` instead of a database.
- `src/adapters/runtime/` — calls the Python runtime's LangGraph HTTP API
  (`/info`, `/assistants/search`, `/threads`, `/threads/:id/runs`, plus the
  custom mounts in `packages/raptix/raptix/interfaces/api/`). This is the
  only part of the system allowed to hold `RAPTIX_RUNTIME_API_TOKEN_FILE`
  (`interfaces/api/auth.py`). Not yet wired into any route -- Tier 2 does
  that; Tier 1 only needed the client to exist and work (unit-tested against
  a local mock HTTP server, `tests/adapters/runtime-client.test.ts`).
- `src/integrations/` — infrastructure plumbing (C2, sandboxes, webshell,
  environments, campaigns) salvaged from the retired `apps/web/server`
  (recoverable from git history prior to the ADR-0106 deletion commit).
  Not yet populated (Tier 4).
- `prisma/schema.prisma` — `Operator` + `Session` only. RBAC/AI-roles proper
  is a Tier 6 design spike, not this.

## Dev

```bash
npm run dev --workspace=@raptix/api   # listens on 127.0.0.1:8080 by default
npm run prisma:migrate --workspace=@raptix/api   # apply prisma/migrations/ to DATABASE_URL
```

`apps/ui-app`'s dev proxy (`API_PROXY_TARGET` in its `.env.example`) already
points at `http://127.0.0.1:8080`, matching this default. Copy `.env.example`
to `.env.local` and point `DATABASE_URL` at a real Postgres database (`make
infra` brings one up) before starting the server -- there is no in-memory
fallback.
