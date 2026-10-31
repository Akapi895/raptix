# @raptix/api

Backend-for-frontend for `apps/ui-app` (ADR-0106). Translates Raptix's domain
model (OPPLAN/`EngagementContext`, capability runtime, AKG, asset-map,
governance, closure, scope, vault...) into the contract `apps/ui-app` already
speaks (`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`).

**Tier 1 (foundation)** and **Tier 2 (core loop)** are done. Tier 3+ (Assets,
Vulnerabilities, C2, Skills, Knowledge, RBAC, everything else) is not
started — see
`docs/design/2026-10-31-ui-app-integration-implementation-plan.md` before
adding the next route group.

## Layout

- `src/http/routes/auth.routes.ts` — the full "Authentication and account"
  module (`/api/auth/login|logout|validate|change-password`; the two
  `robot-binding*`/`robot-bindings` routes are stubbed `501` -- no Raptix
  equivalent, cut candidate pending the owner's call, ADR-0106 §2/§7).
- `src/http/routes/projects.routes.ts` — "Projects and fact graphs": CRUD +
  stats + conversations-by-project are real (Prisma-backed, no runtime
  equivalent). The 11 fact-graph/fact/promote-attack-chain sub-resources are
  stubbed `501` -- they need the Neo4j AKG client (Tier 5), not built yet.
- `src/http/routes/conversations.routes.ts` — "Conversations and messages"
  CRUD (list/create/get/rename/delete/pinned/project) is real; creating a
  conversation creates a real LangGraph thread (`RuntimeClient.createThread`)
  and fails with `503`, never a fabricated row, if the runtime is down.
  `delete-turn`/`plan-tasks`/`results`/`token-usage` are stubbed `501`
  (replay/usage-metering, not built).
- `src/http/routes/agent-loop.routes.ts` — `POST /api/eino-agent` creates a
  real run on the conversation's thread and polls it to a terminal status
  (bounded wait, default 20s -- see `agentSyncWaitMs`), extracting the
  assistant's reply from `/threads/:id/state`
  (`src/adapters/runtime/message-extract.ts`, best-effort LangChain message
  parsing). `GET /api/agent-loop/tasks[/completed]` and
  `POST /api/agent-loop/cancel` are real, scanning every known
  conversation's thread. SSE streaming (`eino-agent/stream`,
  `multi-agent/stream`) and `multi-agent` (no clean Raptix equivalent -- see
  the route file's comment) are stubbed `501`.
- `src/http/routes/hitl.routes.ts` — `pending`/`decision`/`dismiss` are
  stubbed `501` with a precise note on the real mechanism
  (`middleware/hitl.py`'s `ProjectApprovalTransport`: JSONL files in the
  *project's own sandbox*, not a LangGraph interrupt) -- needs a sandbox-file
  HTTP client (Tier 4) that doesn't exist yet.
- `src/http/plugins/auth-guard.ts` — the `preHandler` every `bearerAuth`
  route in `apps/ui-app/docs/openapi.yaml` needs; looks up the session by
  token (`src/db/auth-store.ts`), never a JWT.
- `src/security/` — password hashing (`node:crypto` scrypt, no dependency),
  session token/payload shape, the first-boot operator seed.
- `src/db/client.ts` — Prisma client factory (driver adapter over `pg`, no
  env reads, no side effect on import). `auth-store.ts`/`project-store.ts`/
  `conversation-store.ts` are ports + their Prisma implementations; routes
  depend on the port, so tests use the fakes under `tests/support/` instead
  of a database.
- `src/adapters/runtime/` — calls the Python runtime's LangGraph HTTP API
  (`/info`, `/assistants/search`, `/threads`, `/threads/:id/runs`,
  `/threads/:id/state`, plus the custom mounts in
  `packages/raptix/raptix/interfaces/api/`). This is the only part of the
  system allowed to hold `RAPTIX_RUNTIME_API_TOKEN_FILE`
  (`interfaces/api/auth.py`). `RuntimeTransport` is the port routes depend
  on; `RuntimeClient` implements it, `tests/support/fake-runtime.ts` fakes
  it.
- `src/integrations/` — infrastructure plumbing (C2, sandboxes, webshell,
  environments, campaigns) salvaged from the retired `apps/web/server`
  (recoverable from git history prior to the ADR-0106 deletion commit).
  Not yet populated (Tier 4).
- `prisma/schema.prisma` — `Operator`/`Session` (Tier 1) and
  `Project`/`Conversation`/`Message` (Tier 2). RBAC/AI-roles proper is a
  Tier 6 design spike, not this.

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
