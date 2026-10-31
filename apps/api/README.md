# @raptix/api

Backend-for-frontend for `apps/ui-app` (ADR-0106). Translates Raptix's domain
model (OPPLAN/`EngagementContext`, capability runtime, AKG, asset-map,
governance, closure, scope, vault...) into the contract `apps/ui-app` already
speaks (`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`).

This is currently a skeleton: one `/api/health` route. Route-by-route
implementation is sequenced in
`docs/design/2026-10-31-ui-app-integration-implementation-plan.md` — read
that before adding a route group.

## Layout

- `src/http/routes/` — one file per `apps/ui-app` contract module (see the
  plan's module table). Each route translates to/from the runtime, never the
  other way around.
- `src/adapters/runtime/` — calls the Python runtime's LangGraph HTTP API
  (`/threads`, `/assistants`, `/runs`, plus the custom mounts in
  `packages/raptix/raptix/interfaces/api/`). This is the only part of the
  system allowed to hold `RAPTIX_RUNTIME_API_TOKEN_FILE`
  (`interfaces/api/auth.py`).
- `src/db/` — Prisma client + schema for business records with no runtime
  equivalent (auth/session, RBAC, roles). Not yet populated.
- `src/integrations/` — infrastructure plumbing (C2, sandboxes, webshell,
  environments, campaigns) salvaged from the retired `apps/web/server`
  (recoverable from git history prior to the ADR-0106 deletion commit).
  Not yet populated.

## Dev

```bash
npm run dev --workspace=@raptix/api   # listens on 127.0.0.1:8080 by default
```

`apps/ui-app`'s dev proxy (`API_PROXY_TARGET` in its `.env.example`) already
points at `http://127.0.0.1:8080`, matching this default.
