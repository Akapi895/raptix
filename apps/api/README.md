# @raptix/api

Backend-for-frontend for `apps/ui-app` (ADR-0106). Translates Raptix's domain
model (OPPLAN/`EngagementContext`, capability runtime, AKG, asset-map,
governance, closure, scope, vault...) into the contract `apps/ui-app` already
speaks (`apps/ui-app/docs/openapi.yaml`, `apps/ui-app/docs/api-contracts.md`).

**Tier 1-6** (foundation, core loop, findings, operations, knowledge &
tooling, platform) are done. Tier 7 (Workflows/packages, Markdown agents,
Robots and bindings, System updates — each needs the repo owner's explicit
accept/cut call before any route work starts) is not started — see
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
  stubbed `501` -- they need a Neo4j AKG client, which Tier 5 did not build
  (its Knowledge module turned out to be an unrelated RAG document store,
  not the asset/vuln knowledge graph; see Tier 5's note below). Still not
  built; still needed before these can go real.
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
  `scan-links` is stubbed `501` -- needs a Neo4j AKG client, still not built
  (see the Projects note above).
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
  (`intelligence/llm`) apps/api still has no client for -- Tier 5 added a
  recon-provider HTTP client and config-test passthroughs
  (`src/http/routes/config.routes.ts`), but nothing that calls an LLM
  directly for a one-off text task like this.
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
- `src/http/routes/batch-tasks.routes.ts` -- "Batch task queues": real, all
  12 ops. Maps to Tier 2's chat loop, not the retired `apps/web`'s campaign/
  gophish/evilginx integration (that mapping in the plan's first draft was
  wrong): a `BatchTask` *is* a chat message, dispatched through the same
  `services/agent-turn.ts` helper `POST /api/eino-agent` uses. `start` runs
  pending tasks with up to `concurrency` workers (`services/
  batch-processor.ts`, optimistic per-task claim against Postgres) in the
  background and returns immediately; cron scheduling fields are stored
  and returned but not auto-triggered (no background scheduler loop built
  this pass -- manual `start` always works).
- `src/http/routes/webshell.routes.ts` -- "Webshell": connections CRUD +
  `state` (an opaque UI-side JSON blob, round-tripped not interpreted) +
  `ai-conversations`/`ai-history` (real, via a new `Conversation.
  webshellConnectionId` link) are real, Prisma-backed. `exec`/`file` --
  actually issuing the HTTP request to the connection's `url` to run a
  command or move a file on the target -- are stubbed `501`: that is a raw
  outbound HTTP relay to an operator-supplied URL with no RoE/scope gate,
  bypassing Raptix's sandbox-mediated network egress entirely. Building
  that without a safety gate is exactly what CONTRIBUTING_AGENT.md's
  guard-rail rule requires an ADR + threat model for.
- `src/http/routes/c2.routes.ts` + `src/adapters/c2/` -- a bridge client
  (`C2BridgeClient`, port `C2Transport`) ported from the retired
  `apps/web/server`'s `SliverClient`: one endpoint (`${url}/v1/c2`), one
  generic `{op, ...}` JSON call, Bearer auth (`SLIVER_BRIDGE_URL`/
  `SLIVER_BRIDGE_TOKEN`). Only `GET sessions[/:id]`, `GET listeners`,
  `GET profiles` are wired to real bridge ops (`sessions.list`,
  `sessions.get`, `listeners.list`, `profiles.list` -- the only op names
  evidenced in the retired code; nothing else was guessed). Every mutating
  op (dispatch a task to a live session, start/stop a listener, build a
  payload, ...) is stubbed `501` for the same reason as webshell `exec`:
  the retired `C2Service` gated every one of these behind an approved
  `ScopeRevision` + a per-command grant, which apps/api still has no
  equivalent of (Tier 6's Platform work did not add a Scope/Governance
  subsystem; see that tier's note below). Dispatching to a live implant
  with no RoE/scope gate at all would weaken a guard rail, not just skip a
  nice-to-have.
- `src/http/routes/terminal.routes.ts` -- both ops stubbed `501`: ADR-0095
  ("Interactive C2 console (PTY)"), the decision that puts an interactive
  Shell/PTY surface in scope at all, is still Proposed, not Accepted.
- `src/http/routes/tool-guard.routes.ts` -- "Tool guard": all 3 ops real
  (GET/PUT the rule set, POST test matches a sample tool call against it).
  Patterns run on Node's `RegExp`, not RE2 (apps/ui-app's own model.ts says
  RE2 is the authority; no RE2 binding exists in this stack -- a documented
  deviation, not an oversight). Storage + testing only: nothing here is
  wired into the live agent tool-call path yet, so "enabled" does not
  actually block anything in a real run.
- `src/http/routes/knowledge.routes.ts` -- "Knowledge": a RAG-style document
  knowledge base (`internal/knowledge/types.go`) with **no Raptix runtime
  equivalent** -- this is CyberStrikeAI's own feature, not the Neo4j asset/
  vuln knowledge graph (don't confuse the two; the AKG client the
  fact-graph/scan-links stubs above need is a separate, still-unbuilt
  thing). Items CRUD + categories + stats + retrieval-logs (9 ops) are
  real, Prisma-backed. `scan`/`index`/`index-status` (3 ops) are stubbed
  `501`: embedding-backed indexing would need a real LiteLLM `/embeddings`
  call (the pattern Skillogy's hybrid retrieval already uses,
  `packages/raptix/raptix/skills/engine/server`) *and* a retrieval endpoint
  to consume those embeddings during chat -- neither exists anywhere
  apps/api touches, so storing vectors nobody reads would be inert
  scaffolding. `apps/ui-app` degrades this gracefully (index-status treats
  any non-2xx as "no status").
- `src/http/routes/skills.routes.ts` -- "Skills": all 12 ops stubbed `501`,
  deliberately in full, not piecemeal -- see the route file's top comment.
  Short version: Skillogy (`packages/raptix/raptix/skills/engine/server`, a
  separate Neo4j-backed REST service) is a real, reachable backend for
  *reads*, but its `find`/`load` ops require a filter and it deliberately
  removed its old unconditional list endpoint, so `apps/ui-app`'s default
  (no-search) list view can't be served for real; writes need the repo's
  documented `audit-skills` -> `build-skill-graph` -> `check-skill-graph`
  corpus pipeline, not a live HTTP mutation. Wiring only the search-filtered
  read case would make the page work when you search and break on load --
  stub the whole module instead of shipping that half-measure.
- `src/http/routes/fofa.routes.ts` -- "Recon / information collection": a
  real passthrough to the four public attack-surface search engines
  `apps/ui-app` targets (FOFA/ZoomEye/Quake/Shodan, `src/adapters/recon/`) --
  read-only queries against already-public internet-wide scan databases
  using the operator's own configured key, the same thing a browser-based
  Shodan/FOFA search does. Each provider is independently optional; an
  unconfigured one fails `503`, a rejected one `502`, never a fabricated
  empty result. `parse` (natural-language-to-query-DSL) is stubbed `501` --
  it needs an LLM call apps/api has no direct client for (see the
  attack-chains note above); the search itself is this feature's real
  value.
- `src/http/routes/config.routes.ts` -- "Configuration and AI models": `GET/
  POST/PUT /api/config` persist the saved settings object faithfully
  (`AppConfig` KV store, `src/db/app-config-store.ts`); `list-models`/
  `test-openai`/`test-vision` are real OpenAI-compatible-API passthrough
  probes using the operator-supplied credentials from the request body
  (never a stored secret). `apply` is stubbed `501`:
  `infra/config/litellm.yaml` pins `store_model_in_db: false`, a deliberate
  upstream choice that there is no live admin API to defeat -- what's saved
  is real, but pushing it live into the running LiteLLM/runtime stack would
  need an env var/YAML edit and a restart, not an HTTP call. `test-typesafe`
  is stubbed `501` -- TypeSafe/Jev is a third-party HITL-audit protocol with
  no documented wire format anywhere in this repo; guessing it would risk a
  false "connection successful". `tools` GET/PUT/`:name/schema` (3 ops) are
  stubbed `501` -- no HTTP introspection of Raptix's ~159-function tool
  catalog exists to enumerate or toggle against.
- `src/http/routes/external-mcp.routes.ts` -- "External MCP servers": list/
  get-one/stats/PUT(upsert)/DELETE (5 ops, `src/db/external-mcp-store.ts`)
  are real Prisma CRUD of the operator's *desired* config.
  `start`/`stop` are stubbed `501`: the real control surface
  (`RAPTIX_MCP__SERVERS`, `execution/tools/mcp/client.py`) is an env var
  parsed once at the langgraph container's startup -- no live reload, no
  per-server RPC to action. `status`/`tool_count`/`error` are reported as
  `"unknown"` rather than guessed, since nothing here can observe the live
  connection. (`POST /api/external-mcp` to create is in `apps/ui-app`'s
  OpenAPI extraction but classified mock-only there -- the real UI always
  upserts by name via PUT, so it isn't built.)
- `src/http/routes/monitor.routes.ts` + `src/http/routes/mcp.routes.ts` --
  "MCP monitor and execution details": `GET /api/monitor[/stats]`,
  `/calls-timeline`, and the two delete/hide ops, plus `GET
  /api/mcp/external` and `GET /api/mcp/executions/:id`, are real --
  "executions" are **derived live** from every known conversation's actual
  LangGraph thread state (`services/execution-derivation.ts` pairs each
  `AIMessage.tool_calls[]` entry with its matching `ToolMessage` by
  `tool_call_id`, same message-shape handling as
  `adapters/runtime/message-extract.ts`), never stored separately. A thread
  has no delete primitive on its own history, so `DELETE /api/monitor/
  execution[s]` hides an id from this derived view (`HiddenExecution`
  table) without touching the underlying thread. `GET /api/mcp/tools` and
  `POST /api/mcp/executions/:id/cancel` are stubbed `501`: no HTTP
  introspection of the real tool catalog exists for the former, and no
  per-tool-call cancel primitive exists in the LangGraph runtime API for
  the latter -- only whole-run cancellation (`POST /api/agent-loop/cancel`,
  Tier 2) is possible.
- `src/http/routes/roles.routes.ts` — "AI roles": apps/ui-app's agent-persona
  catalog (`internal/config/config.go` `RoleConfig`) -- **not** user RBAC
  and **not** Raptix's own agent specialist roles (`intelligence/agents`);
  all 5 ops real, Prisma CRUD (`db/ai-role-store.ts`). `tools`/`mcps` are
  stored as opaque name lists, never validated against a real catalog
  (same reasoning as Tier 5's `config/tools` stub).
- **Platform access / RBAC**: not built, not even stubbed. Confirmed from
  `apps/ui-app/docs/openapi.yaml` that every `/api/rbac/*` operation is
  classified mock-only -- the real frontend has no code path that calls any
  of them (`features/rbac/` is an empty directory in `apps/ui-app`'s own
  source tree). Stubbing a `501` for an endpoint nothing ever calls would
  serve no purpose; there is no route file for this module.
- `src/http/routes/audit.routes.ts` -- "Audit": `GET /api/audit/
  logs[/export]`, `GET /api/audit/summary`, `GET /api/audit/logs/:id` (4
  ops, not the originally-estimated 6 -- `conversationExists` in
  `apps/ui-app`'s client reuses the existing real
  `GET /api/conversations/:id`, not a new audit op) are real,
  Prisma-backed (`db/audit-log-store.ts`). Write points are wired into
  `auth.routes.ts` only this pass (login success/failure, logout,
  change-password success/failure) -- a real but deliberately partial
  instrumentation; retrofitting every mutating route across Tiers 1-5 to
  write audit entries is future work, not done here to keep this tier's
  diff bounded.
- `src/http/routes/notifications.routes.ts` -- "Notifications" (part of
  "Dashboard, notifications and usage"): both ops real.
  `GET /api/notifications/summary` **derives** one notification per real
  Vulnerability record (new findings), the same "derive, don't store a
  parallel feed" approach Tier 5 used for MCP monitor executions;
  `POST /api/notifications/read` marks ids read via a small
  `ReadNotification` marker table (`db/read-notification-store.ts`). A
  deliberately narrow slice of `apps/ui-app`'s `NotificationItem` contract
  -- there is no event bus anywhere in apps/api, so HITL/execution-failure/
  session notifications (the other id fields the wire type carries)
  have no source to derive from yet.
- `src/http/routes/usage.routes.ts` -- "Usage" (part of the same module):
  `GET /api/usage/tokens` stubbed `501`. Real per-model token accounting
  would need LiteLLM's own spend-tracking API
  (`general_settings.database_url` is set in `infra/config/litellm.yaml`,
  so LiteLLM does track this) -- but its exact `/spend/logs` response
  schema isn't reliably documented, and there is no running LiteLLM
  instance in this dev environment to verify it against empirically,
  unlike this repo's own internal patterns which can be read from source.
  Guessing a third-party wire format risks silently reporting wrong
  numbers; stubbed honestly instead.
- `src/http/routes/openapi.routes.ts` -- "OpenAPI and misc": the one real
  op found (`GET /api/openapi/spec`; the originally-estimated 3 ops turned
  out to be a single real one, per this tier's plan note) parses
  `apps/ui-app/docs/openapi.yaml` (a sibling package's checked-in file, via
  the new `yaml` dependency) to JSON and serves it, matching what
  `apps/ui-app`'s own api-docs page expects -- apps/api has no OpenAPI
  generator of its own. A deployment where that sibling directory isn't on
  disk (a container built from apps/api alone) gets a clear `503`, never a
  fabricated empty spec.
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
- `src/integrations/` — infrastructure plumbing (environments) salvaged from
  the retired `apps/web/server` (recoverable from git history prior to the
  ADR-0106 deletion commit). Not yet populated -- C2 and sandbox-files are
  now `adapters/c2/` and `adapters/sandbox/` instead (Tier 3/4), campaigns
  turned out not to be what "Batch task queues" needed (see
  `batch-tasks.routes.ts`'s note).
- `prisma/schema.prisma` — `Operator`/`Session` (Tier 1),
  `Project`/`Conversation`/`Message` (Tier 2), `Asset`/`Vulnerability`/
  `AlertSubscription` (Tier 3), `BatchQueue`/`BatchTask`/
  `WebShellConnection` (Tier 4), `ToolGuardConfig`/`AppConfig`/
  `KnowledgeItem`/`RetrievalLog`/`ExternalMcpServer`/`HiddenExecution`
  (Tier 5), `AiRole`/`AuditLog`/`ReadNotification` (Tier 6).

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
