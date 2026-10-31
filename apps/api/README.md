# @raptix/api

Backend-for-frontend for `apps/ui-app` (ADR-0106). Translates Raptix's domain
model (OPPLAN/`EngagementContext`, capability runtime, AKG, asset-map,
governance, closure, scope, vault...) into the contract `apps/ui-app` already
speaks (`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`).

**Tier 1 (foundation)**, **Tier 2 (core loop)** and **Tier 3 (findings)** are
done. Tier 4+ (C2, WebShell, Skills, Knowledge, RBAC, everything else) is not
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
  *project's own sandbox*, not a LangGraph interrupt). Tier 3 built the
  sandbox-file client this needs (`src/adapters/sandbox/`), but HITL stays
  stubbed: the client's `workspaceSlug` must be the sandbox the runtime
  actually dispatched this conversation's tool calls to, and
  `agent-loop.routes.ts`'s `createRun` doesn't pass any per-project sandbox
  routing yet -- see the route file's comment.
- `src/http/routes/assets.routes.ts` — "Assets": list/replace(full
  replace)/delete/batch-delete/bulk-patch/import(upsert)/merge/
  project-binding/selection/stats (10 ops) are real, Prisma-backed.
  `scan-links` is stubbed `501` -- needs the Neo4j AKG client (Tier 5).
- `src/http/routes/vulnerabilities.routes.ts` — "Vulnerabilities" CRUD +
  `retest` (branches a real conversation with a real LangGraph thread) +
  `batch` (deletes everything matching the current filter, not an explicit
  id list -- matches `apps/ui-app`'s actual caller) + `export` (groups into
  real generated Markdown files by conversation) + `filter-options`/`stats`
  (real aggregates) are all real. The vulnerability-alerts subscription is a
  real singleton row (`db/alert-subscription-store.ts`).
- `src/http/routes/files.routes.ts` — "Files and chat uploads" + `/api/files`
  aliases: real, routed through a project's sandbox via
  `src/adapters/sandbox/`. `apps/ui-app`'s own contract assumes one global
  file tree (a bare `path`, no project); Raptix has no such tree (ADR-0102),
  so every `path` here is `<projectId>/<relativePathInThatSandbox>` -- a
  deliberate, documented deviation (see the route file's top comment), not
  an oversight.
- `src/http/routes/attack-chains.routes.ts` -- stubbed `501`: deriving a
  chain from a transcript needs an LLM summarization call
  (`intelligence/llm`), which is Tier 5 territory, not a CRUD concern.
- `src/http/routes/storage.routes.ts` -- stubbed `501`: CyberStrikeAI's
  "storage" is a server-wide local-disk retention policy with no Raptix
  equivalent (project files live only in sandboxes, ADR-0102; there is no
  runtime endpoint for a global disk-cleanup policy).
- `src/adapters/sandbox/` -- `SandboxFilesClient` (port:
  `SandboxFilesTransport`) talks to a project's sandbox daemon
  (`/execute`, `/upload_files`, `/download_files`, `/workspace/ensure`,
  Bearer `sandboxTokenFor(key, slug)`), ported from the retired
  `apps/web/server`'s `SandboxProjectFiles`. Holds
  `RAPTIX_SANDBOX_KEY_FILE`. Nothing provisions a `sbx-<workspaceSlug>`
  sandbox per `apps/api` Project yet -- Files routes are real code that
  will work once that provisioning exists, same as Tier 1/2's runtime
  routes before a LangGraph container is up.
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
- `src/integrations/` — infrastructure plumbing (C2, webshell, environments,
  campaigns) salvaged from the retired `apps/web/server` (recoverable from
  git history prior to the ADR-0106 deletion commit). Not yet populated
  (Tier 4) -- `adapters/sandbox/` (Tier 3) is a different, already-built
  piece (project files, not C2/webshell).
- `prisma/schema.prisma` — `Operator`/`Session` (Tier 1),
  `Project`/`Conversation`/`Message` (Tier 2), `Asset`/`Vulnerability`/
  `AlertSubscription` (Tier 3). RBAC/AI-roles proper is a Tier 6 design
  spike, not this.

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
