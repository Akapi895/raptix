# UI API endpoint reference

Source snapshot: 2026-10-30. Scope: `ui-app/`.

Coverage: **299 distinct method/path operations in 30 functional groups**,
including all **284 HTTP registrations in the demo route table** and 15
additional client/realtime operations. There are 117 parseable JSON examples
across fenced blocks and inline request bodies.

This reference inventories the requests defined by the UI feature services,
shared API clients and standalone demo route registry. Request examples follow
the **calling TypeScript code** where a caller exists. Demo-only operations are
identified explicitly. This is a source-code inventory, not a claim that every
operation has been exercised against the Go backend.

## Contents

1. [Transport and conventions](#transport-and-conventions)
2. [Authentication and account](#1-authentication-and-account)
3. [Platform access / RBAC](#2-platform-access--rbac)
4. [Dashboard, notifications and usage](#3-dashboard-notifications-and-usage)
5. [Conversations and messages](#4-conversations-and-messages)
6. [Agent chat and running tasks](#5-agent-chat-and-running-tasks)
7. [Attack chains](#6-attack-chains)
8. [Projects and fact graphs](#7-projects-and-fact-graphs)
9. [Vulnerabilities](#8-vulnerabilities)
10. [Assets](#9-assets)
11. [Recon / information collection](#10-recon--information-collection)
12. [Batch task queues](#11-batch-task-queues)
13. [Human-in-the-loop](#12-human-in-the-loop)
14. [Tool guard](#13-tool-guard)
15. [MCP monitor and execution details](#14-mcp-monitor-and-execution-details)
16. [Audit](#15-audit)
17. [Configuration and AI models](#16-configuration-and-ai-models)
18. [External MCP servers](#17-external-mcp-servers)
19. [Knowledge](#18-knowledge)
20. [Skills](#19-skills)
21. [AI roles](#20-ai-roles)
22. [Markdown agents](#21-markdown-agents)
23. [Workflows and packages](#22-workflows-and-packages)
24. [C2](#23-c2)
25. [WebShell](#24-webshell)
26. [Terminal](#25-terminal)
27. [Files and chat uploads](#26-files-and-chat-uploads)
28. [Storage](#27-storage)
29. [System updates](#28-system-updates)
30. [Robots and bindings](#29-robots-and-bindings)
31. [OpenAPI and miscellaneous](#30-openapi-and-miscellaneous)
32. [Known UI/demo contract differences](#known-uidemo-contract-differences)

## Transport and conventions

- Paths below include `/api`; `:id`, `:name` and similar segments are URL-encoded
  path parameters. Replace them with real IDs; do not send the colon literally.
- The normal UI origin is the base URL. `VITE_API_BASE` can configure the HTTP
  transport; Vite development proxies `/api` to `API_PROXY_TARGET`, defaulting
  to `http://127.0.0.1:8080`.
- Demo mode intercepts same-origin API calls **inside the browser**. Calling
  `http://127.0.0.1:5173/api/...` with curl does not exercise the browser mock;
  it reaches the development server/proxy instead. Use the running demo UI or
  its API Docs page to try mock requests.
- Authenticated HTTP requests use `Authorization: Bearer <token>`. Native
  EventSource and WebSocket connections use a `token` query parameter where
  shown. Examples contain fictional values, not real credentials.
- JSON writes use `Content-Type: application/json`. `None` means no request
  body; `{}` means the caller sends an empty JSON object. GET query parameters
  are not JSON bodies. Uploads use `multipart/form-data` with a browser-generated
  boundary and are documented separately.
- A named body such as **AssetInput** refers to the JSON example in that same
  section. Examples demonstrate field names and types, not exhaustive required
  fields. Omit optional fields that do not apply. Preserve snake_case/camelCase
  exactly; the API is not consistent across resources.
- **Client-only** means a request is defined in a UI/client source file but its
  method/path is absent from the current demo route table. It can fail in demo
  mode. **Mock-only** means the demo registers the operation but no corresponding
  current UI request was identified. Unmarked rows have a demo registration;
  consult the cited caller for their UI use.
- Query lists describe parameters observed in UI callers or shared request
  types. They are not a complete specification of backend validation.

## 1. Authentication and account

Sources: `src/features/auth/service.ts`, `src/features/settings/client.ts`,
`src/api/clients/auth.ts`, `src/mock/routes/auth.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `POST /api/auth/login` | Create a session | None | `{"username":"admin","password":"demo-password"}` |
| `GET /api/auth/validate` | Restore/validate session | None | None |
| `POST /api/auth/logout` | End session | None | None |
| `POST /api/auth/change-password` | Change own password | None | Settings caller: `{"oldPassword":"old-demo-password","newPassword":"new-demo-password"}` |
| `GET /api/auth/robot-bindings` | List own robot bindings | None | None |
| `POST /api/auth/robot-binding-code` | Generate a binding code | None | None |
| `DELETE /api/auth/robot-bindings/:id` | Remove own binding; client-only | None | None |

The shared auth client also sends `oldPassword` / `newPassword`. The demo uses
a different request schema:

```json
{
  "current_password": "old-demo-password",
  "new_password": "new-demo-password"
}
```

The current mock password schema expects this snake_case DTO, whereas both
UI clients send the camelCase DTO above. Login is the unauthenticated entry
point. The seeded demo includes `admin` / `admin`; its login handler accepts
any nonempty password for an enabled seeded account.

## 2. Platform access / RBAC

Compatibility sources: `../internal/handler/rbac.go`, `src/mock/routes/auth.ts`.
The local-operator frontend no longer has Platform Access management or an RBAC
API client. These protected backend endpoints remain available for existing
integrations; the application obtains its own session permissions through Auth.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/rbac/me` | Current permissions/session; retained compatibility API | None | None |
| `GET /api/rbac/metadata` | Permission catalogue | None | None |
| `GET /api/rbac/users` | Members | Mock supports search/pagination | None |
| `POST /api/rbac/users` | Create member | None | **RbacUser** |
| `PUT /api/rbac/users/:id` | Update member or assigned roles | None | **RbacUser**, without `username` if unchanged; omit empty `password` |
| `DELETE /api/rbac/users/:id` | Delete member | None | None |
| `GET /api/rbac/roles` | Platform roles | None | None |
| `POST /api/rbac/roles` | Create platform role | None | **RbacRole** |
| `PUT /api/rbac/roles/:id` | Update platform role | None | **RbacRole** |
| `DELETE /api/rbac/roles/:id` | Delete platform role | None | None |
| `GET /api/rbac/resources` | Search assignable resources | `type`, `q`, `limit`, `offset` | None |
| `GET /api/rbac/resource-assignments` | Current resource grants | None | None |
| `POST /api/rbac/resource-assignments` | Grant resources to a member | None | **ResourceGrant** |
| `DELETE /api/rbac/resource-assignments/:id` | Revoke grant | None | None |

**RbacUser** — legacy client create example; updates can use just `display_name`,
`enabled` and `roles` when changing membership:

```json
{
  "username": "reviewer",
  "display_name": "Demo Reviewer",
  "password": "demo-password-123",
  "enabled": true,
  "roles": ["role-analyst"]
}
```

**RbacRole**:

```json
{
  "name": "Demo Readers",
  "description": "Read project data",
  "scope": "assigned",
  "permissions": ["project:read"]
}
```

Permission and role IDs must come from the metadata and role list responses.

**ResourceGrant**:

```json
{
  "user_id": "user-alice",
  "resource_type": "project",
  "resource_ids": ["proj-lab-web"],
  "auto_detect": true
}
```

## 3. Dashboard, notifications and usage

Sources: `src/features/dashboard/client.ts`,
`src/features/notifications/client.ts`, `src/features/token-usage/client.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/projects/dashboard-summary` | Project/fact summary | `fact_limit` (UI: `10`) | None |
| `GET /api/notifications/summary` | Notification feed and counters | `since`, `limit`, `lang` (UI: `en-US`) | None |
| `GET /api/notifications` | Raw notification list; mock-only | None observed | None |
| `POST /api/notifications/read` | Mark notifications read | None | `{"eventIds":["notif-1","notif-2"]}` |
| `GET /api/usage/tokens` | Token totals and breakdown | `days`, `limit`, `project_id` | None |

The dashboard also reuses endpoints documented in their owning sections:
agent-loop tasks, vulnerability list/stats, batch queues, monitor stats, knowledge
stats, skills stats, AI roles, markdown agents, config tools, HITL pending,
external-MCP stats, WebShell connections, C2 listeners/sessions/tasks. It adds
`project_id` to project-scoped dashboard requests. There is no separate
`/api/dashboard` request in the current source.

## 4. Conversations and messages

Sources: `src/api/clients/conversations.ts`, `src/features/chat/client.ts`,
`src/features/chat/conversations/`, `src/features/chat/process/load.ts`,
`src/app/chat/`, `src/mock/routes/chat.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/conversations` | List/search conversations | `limit`, `offset`, `search`, `sort_by`, `project_id` | None |
| `POST /api/conversations` | Create conversation | None | `{"title":"Demo review","projectId":"proj-lab-web"}`; shared client also allows `{}` |
| `GET /api/conversations/:id` | Read transcript | `include_process_details` (`0`/`1`, or typed boolean) | None |
| `PUT /api/conversations/:id` | Rename conversation | None | `{"title":"Updated review title"}` |
| `DELETE /api/conversations/:id` | Delete conversation | None | None |
| `PUT /api/conversations/:id/pinned` | Pin/unpin | None | `{"pinned":true}` |
| `PUT /api/conversations/:id/project` | Bind/unbind project | None | `{"projectId":"proj-lab-web"}`; empty string unbinds |
| `POST /api/conversations/:id/delete-turn` | Delete a message turn | None | `{"messageId":"msg-1"}` |
| `GET /api/conversations/:id/results` | Run results; mock registration | None observed | None |
| `GET /api/conversations/:id/plan-tasks` | Plan progress | None observed | None |
| `GET /api/conversations/:id/token-usage` | Conversation usage | `since`, `limit` in app caller | None |
| `GET /api/messages/:id/process-details` | Paged/summary execution details | `summary=1`, `full=1`, or `limit`, `offset`, `anchorId` | None |
| `GET /api/process-details/:id` | One process-detail record | None | None |

For conversations without a project, the shared query contract uses
`project_id=__none__`. A typed client accepts `include_process_details` as a
boolean; existing raw callers send `0` or `1`.

## 5. Agent chat and running tasks

Sources: `src/api/clients/chat.ts`, `src/api/types/chat.ts`,
`src/features/chat/composer/send.ts`, `src/features/chat/progress/tasks.ts`,
`src/features/chat/replay/attach.ts`, `src/mock/routes/chat.ts`.

| Request | Purpose | Query | JSON body / response mode |
|---|---|---|---|
| `POST /api/eino-agent` | Single-agent JSON client; client-only | None | **ChatRequest**; JSON response |
| `POST /api/eino-agent/stream` | Single-agent chat | None | **ChatRequest**; SSE response |
| `POST /api/multi-agent` | Multi-agent JSON client; client-only | None | **ChatRequest**; JSON response |
| `POST /api/multi-agent/stream` | Backend-configured chat | None | **ChatRequest**; SSE response |
| `GET /api/agent-loop/tasks` | Active background runs | None | None |
| `GET /api/agent-loop/tasks/completed` | Completed run history | None | None |
| `POST /api/agent-loop/cancel` | Stop a run or stop a tool and continue | None | **CancelRun** |
| `GET /api/agent-loop/task-events` | Reattach to run events | `conversationId` | None; SSE response |

**ChatRequest** — extended example. A minimal request needs a `message`; the UI
also supplies `conversationId` (null for a new conversation) and `role` (empty
string for the default role). `projectId` is sent only for a new conversation.
The HITL block is sent only when its mode is enabled; attachments/reasoning and
channel selection are optional. `webshellConnectionId` is used by WebShell AI.

```json
{
  "message": "Summarize the findings already recorded in this demo project.",
  "conversationId": null,
  "projectId": "proj-lab-web",
  "role": "",
  "aiChannelId": "demo-large",
  "reasoning": { "mode": "auto", "effort": "medium" },
  "finalization": { "requireExecutionEvidence": true },
  "hitl": {
    "enabled": true,
    "mode": "approval",
    "reviewer": "human",
    "sensitiveTools": ["http_probe"],
    "timeoutSeconds": 300
  },
  "attachments": [
    {
      "fileName": "notes.txt",
      "mimeType": "text/plain",
      "serverPath": "uploads/demo/notes.txt"
    }
  ]
}
```

Chat and WebShell AI read `GET /api/config` before sending. If
`multi_agent.enabled` is true, they use `/api/multi-agent/stream`; otherwise
they use `/api/eino-agent/stream`. There is no execution-mode selector or
browser-stored mode override. Both use the same body and let the backend choose
its execution strategy. A configuration HTTP failure stops the send rather
than guessing another endpoint. The shared DTO additionally allows attachment
`content`. The streaming callers use fetch with a JSON POST,
not an EventSource POST. SSE event envelopes have `type`, `message` and optional
`data`; cancelling a reader does not itself cancel the background run.

**CancelRun** — ordinary cancellation:

```json
{ "conversationId": "conv-recon-01" }
```

Stop one tool and continue reasoning:

```json
{
  "conversationId": "conv-recon-01",
  "reason": "Use the existing recorded result.",
  "continueAfter": true,
  "executionId": "mcp-exec-001"
}
```

## 6. Attack chains

Sources: `src/features/chat/attack-chain/flow.ts`,
`src/features/projects/client.ts`, `src/mock/routes/chat.ts`,
`src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/attack-chain/:conversationId` | Read conversation attack graph | None | None |
| `POST /api/attack-chain/:conversationId/regenerate` | Queue graph regeneration | None | None |
| `GET /api/conversations/:id/attack-chain` | Alternate empty graph mock; mock-only | None | None |

Promotion to a project fact graph is documented under projects.

## 7. Projects and fact graphs

Sources: `src/features/projects/client.ts`, `src/features/projects/types.ts`,
`src/api/clients/projects.ts`, `src/api/types/project.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/projects` | List/search projects | `status`, `search`, `limit`, `offset` | None |
| `POST /api/projects` | Create project | None | **ProjectInput** |
| `GET /api/projects/:id` | Read project | None | None |
| `PUT /api/projects/:id` | Update project/pin | None | **ProjectInput**, partial; update also accepts `pinned` |
| `DELETE /api/projects/:id` | Delete project | None | None |
| `GET /api/projects/:id/conversations` | Project conversations | `limit`, `offset` | None |
| `GET /api/projects/:id/stats` | Project counters | None | None |
| `GET /api/projects/:id/facts` | List facts or read one by key | **FactQuery** below | None |
| `POST /api/projects/:id/facts` | Create fact | None | **FactInput** |
| `PUT /api/projects/:id/facts/:factId` | Update fact | None | **FactInput** |
| `DELETE /api/projects/:id/facts/:factId` | Delete fact | None | None |
| `POST /api/projects/:id/facts/deprecate` | Deprecate fact | None | `{"fact_key":"host.198.51.100.10","fact_keys":["host.198.51.100.10"]}` |
| `POST /api/projects/:id/facts/restore` | Restore fact | None | `{"fact_key":"host.198.51.100.10","fact_keys":["host.198.51.100.10"],"confidence":"tentative"}` |
| `GET /api/projects/:id/fact-edges` | List fact links; mock registration | None observed | None |
| `POST /api/projects/:id/fact-edges` | Create link | None | `{"source_fact_key":"host.198.51.100.10","target_fact_key":"finding.auth","edge_type":"related_to"}` |
| `DELETE /api/projects/:id/fact-edges/:edgeId` | Delete link | None | None |
| `GET /api/projects/:id/fact-graph` | Read graph | `view`, `exclude_deprecated` (UI sends `0` to include deprecated) | None |
| `POST /api/projects/:id/promote-attack-chain/:conversationId` | Promote chat graph to project facts | None | None |

**ProjectInput** — `scope_json` is a **JSON-encoded string**, not a nested object:

```json
{
  "name": "Demo Web Review",
  "description": "Review the fictional lab project",
  "scope_json": "{\"targets\":[\"https://app.example.com\"],\"exclude\":[\"*.cdn.example.com\"]}",
  "status": "active"
}
```

**FactQuery**: `limit`, `offset`, `category`, `confidence`, `search`,
`related_vulnerability_id`, `exclude_deprecated`, `sparse_only`; the feature
client also sends `hide_deprecated=true` when excluding deprecated records.
For one fact use `fact_key` and optionally `include_links=true`.

**FactInput**:

```json
{
  "fact_key": "host.198.51.100.10",
  "category": "host",
  "summary": "Demo web service",
  "body": "Recorded HTTP service in the fictional fixture.",
  "confidence": "tentative",
  "pinned": false,
  "related_vulnerability_id": "vuln-003",
  "links_text": ""
}
```

Projects also reuse the asset list/project-binding, vulnerability list/create,
conversation project-binding, active/completed tasks and HITL pending APIs.

## 8. Vulnerabilities

Sources: `src/features/vulnerability/service.ts`,
`src/api/types/vulnerability.ts`, `src/features/projects/client.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/vulnerabilities` | List/filter findings | **VulnerabilityQuery** | None |
| `POST /api/vulnerabilities` | Create finding | None | **VulnerabilityInput** |
| `GET /api/vulnerabilities/stats` | Counters/severity distribution | Same active filters; dashboard can omit `severity` | None |
| `GET /api/vulnerabilities/filter-options` | Suggested filter values | None | None |
| `GET /api/vulnerabilities/export` | Export reports | Active filters, `mode=summary`, `group_by=conversation` | None |
| `DELETE /api/vulnerabilities/batch` | Delete all matching findings | Active filters | None in the current UI; mock schema alternatively accepts `{"ids":["vuln-003"]}` |
| `GET /api/vulnerabilities/:id` | Read finding | None | None |
| `PUT /api/vulnerabilities/:id` | Update finding | None | Partial **VulnerabilityInput**, excluding `conversation_id` |
| `DELETE /api/vulnerabilities/:id` | Delete finding | None | None |
| `POST /api/vulnerabilities/:id/retest` | Create retest conversation | None | `{"prompt":"Review the stored evidence for this finding."}` |
| `GET /api/vulnerability-alerts/subscription` | Read subscription | None | None |
| `PUT /api/vulnerability-alerts/subscription` | Save subscription | None | `{"enabled":true,"min_severity":"high"}` |

**VulnerabilityQuery**: `limit` (not `page_size`), `offset`, `page`, `q`,
`search`, `id`, `project_id`, `conversation_id`, `severity`, `status`, `task_id`,
`conversation_tag`, `task_tag`.

**VulnerabilityInput**:

```json
{
  "title": "Demo response missing a security header",
  "severity": "low",
  "conversation_id": "conv-recon-01",
  "project_id": "proj-lab-web",
  "conversation_tag": "Recon",
  "task_tag": "",
  "description": "Fictional finding for interface testing.",
  "status": "open",
  "type": "Configuration",
  "target": "https://app.example.com",
  "preconditions": "Existing demo fixture",
  "reproduction_steps": "Inspect the recorded response headers.",
  "evidence": "Content-Security-Policy was absent in the fixture.",
  "impact": "Demo impact description",
  "recommendation": "Configure the missing header.",
  "retest_notes": "Not retested"
}
```

The project quick-create caller additionally sends a `proof` field rather than
the main editor's structured evidence fields. That is an observed caller
variant, not a synonym guaranteed by the backend.

## 9. Assets

Sources: `src/features/assets/service.ts`, `src/api/types/asset.ts`,
`src/api/clients/assets.ts`, `src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/assets` | List/filter assets | **AssetQuery** | None |
| `GET /api/assets/stats` | Asset overview | `days` | None |
| `GET /api/assets/selection` | Select all matching assets | Same filter parameters as list | None |
| `POST /api/assets/import` | Import/create assets | None | **AssetImport** |
| `PUT /api/assets/:id` | Update asset | None | **AssetInput** |
| `DELETE /api/assets/:id` | Delete asset | None | None |
| `POST /api/assets/batch-delete` | Delete selected assets | None | `{"asset_ids":["asset-1","asset-2"]}` |
| `PUT /api/assets/bulk` | Update selected assets | None | `{"asset_ids":["asset-1"],"status":"active","tags":["demo"]}` |
| `PUT /api/assets/project-binding` | Bind/unbind selected assets | None | `{"asset_ids":["asset-1"],"project_id":"proj-lab-web"}`; empty project ID unbinds |
| `POST /api/assets/merge` | Merge duplicates | None | `{"asset_ids":["asset-1","asset-2"],"primary_id":"asset-1"}` |
| `POST /api/assets/scan-links` | Persist scan associations | None | **AssetScanLinks** |

There is no asset-create `POST /api/assets` or asset-detail GET in these clients;
creation uses import. An asset needs at least one of `host`, `ip` or `domain`.

**AssetInput**:

```json
{
  "host": "https://app.example.com",
  "project_id": "proj-lab-web",
  "ip": "198.51.100.10",
  "port": 443,
  "domain": "app.example.com",
  "protocol": "https",
  "title": "Demo application",
  "server": "nginx",
  "country": "Example Country",
  "province": "Example Region",
  "city": "Example City",
  "responsible_person": "Demo Owner",
  "department": "Engineering",
  "business_system": "Customer portal",
  "environment": "test",
  "criticality": "medium",
  "source": "manual",
  "source_query": "",
  "status": "active",
  "tags": ["demo", "web"]
}
```

**AssetImport** — each array entry has the AssetInput shape:

```json
{
  "assets": [
    { "host": "https://app.example.com", "ip": "198.51.100.10", "port": 443, "protocol": "https", "tags": ["demo"] }
  ],
  "source": "manual",
  "source_query": ""
}
```

**AssetQuery**: `page`, `page_size`, `q`, `status`, `protocol`, `project_id`,
`source`, `tag`, `host`, `ip`, `domain`, `port`, `risk_level`,
`min_vulnerabilities`, `max_vulnerabilities`, `country`, `province`, `city`,
`responsible_person`, `department`, `business_system`, `environment`,
`criticality`, `scan_state`, `scan_overdue_days`, `last_scan_before`,
`last_scan_after`, `first_seen_before`, `first_seen_after`, `last_seen_before`,
`last_seen_after`, `sort_by`, `sort_order`.

**AssetScanLinks** is a `scans` array of link records; exact record fields are
described by `ScanLink` in `src/features/assets/model.ts`. See the example below.

```json
{
  "scans": [
    { "asset_id": "asset-1", "conversation_id": "conv-recon-01" }
  ]
}
```

Asset scan actions also create conversations or batch queues, then use the
shared agent stream APIs. `PUT /api/assets/:id` is replacement-style on the
backend: omitted editable strings can be cleared/defaulted, unlike a PATCH.

## 10. Recon / information collection

Sources: `src/features/info-collect/service.ts`,
`src/features/info-collect/model.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `POST /api/fofa/search` | Search the selected provider | None | **ReconSearch** |
| `POST /api/fofa/parse` | Convert natural-language input to query | None | `{"provider":"fofa","text":"Find the demo web host app.example.com"}` |
| `GET /api/info-collect` | Empty placeholder list; mock-only | None | None |

**ReconSearch**:

```json
{
  "provider": "fofa",
  "query": "domain=\"example.com\"",
  "size": 10,
  "page": 1,
  "fields": "host,ip,port,protocol,title",
  "full": false
}
```

Provider choices are `fofa`, `zoomeye`, `quake` and `shodan`. The route name
remains `/fofa` for all providers. UI limits and the `full` option are
provider-specific. Import and batch-scan reuse asset import and batch queues.

## 11. Batch task queues

Sources: `src/features/tasks/service.ts`, `src/features/tasks/model.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/batch-tasks` | List queues | `page`, `limit`, `status`, `keyword` | None |
| `POST /api/batch-tasks` | Create queue | None | **BatchQueueInput** |
| `GET /api/batch-tasks/:queueId` | Queue details | None | None |
| `DELETE /api/batch-tasks/:queueId` | Delete queue | None | None |
| `POST /api/batch-tasks/:queueId/start` | Start/resume queue | None | None |
| `POST /api/batch-tasks/:queueId/pause` | Pause queue | None | None |
| `POST /api/batch-tasks/:queueId/rerun` | Rerun queue | None | None |
| `POST /api/batch-tasks/:queueId/tasks` | Add task | None | `{"message":"Summarize the existing demo findings."}` |
| `PUT /api/batch-tasks/:queueId/tasks/:taskId` | Edit task | None | `{"message":"Review the existing demo notes."}` |
| `DELETE /api/batch-tasks/:queueId/tasks/:taskId` | Delete task | None | None |
| `POST /api/batch-tasks/:queueId/tasks/:taskId/run` | Run one task | None | None |
| `PUT /api/batch-tasks/:queueId/metadata` | Change title/role/concurrency | None | `{"title":"Demo queue","role":"","concurrency":1}` |
| `PUT /api/batch-tasks/:queueId/schedule` | Set schedule | None | `{"scheduleMode":"cron","cronExpr":"0 9 * * *"}` |
| `PUT /api/batch-tasks/:queueId/schedule-enabled` | Enable/disable schedule | None | `{"scheduleEnabled":true}`; demo compatibility can also add `"enabled":true` |

**BatchQueueInput**:

```json
{
  "title": "Demo review queue",
  "role": "",
  "hitlPolicy": "",
  "scheduleMode": "manual",
  "cronExpr": "",
  "executeNow": false,
  "projectId": "proj-lab-web",
  "concurrency": 1,
  "tasks": ["Summarize the stored findings.", "Review the stored asset notes."]
}
```

The tasks UI enforces concurrency 1–8. Queue metadata updates preserve the
current title/role before merging the edited fields. Queue creation and updates
do not send an execution-mode override; the backend uses its own defaults.

## 12. Human-in-the-loop

Sources: `src/features/hitl/service.ts`, `src/features/chat/hitl-inline/`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/hitl/pending` | Pending approvals | `page`, `pageSize`, `q`, `conversationId`, `status` | None |
| `GET /api/hitl/logs` | Decision history | `page`, `pageSize`, `q`, `decision`, `decidedBy` | None |
| `GET /api/hitl/logs/:id` | One approval record; client-only | None | None |
| `DELETE /api/hitl/logs` | Delete selected or all matching history | Active filters for all-matching mode | `{"ids":["hitl-log-1"]}` or `{"all":true}` |
| `GET /api/hitl/config/:conversationId` | Conversation approval policy | None | None |
| `PUT /api/hitl/config` | Save conversation policy | None | **HitlConversationConfig** |
| `GET /api/hitl/default-config` | Global defaults | None | None |
| `PUT /api/hitl/default-config` | Save defaults | None | `{"mode":"approval","reviewer":"human","timeoutSeconds":300}` |
| `GET /api/hitl/default-reviewer` | Default reviewer; mock-only | None | None |
| `PUT /api/hitl/default-reviewer` | Set reviewer; mock-only | None | `{"reviewer":"human"}` |
| `GET /api/hitl/audit-strategy` | Audit-agent prompt strategy | None | None |
| `PUT /api/hitl/audit-strategy` | Save audit prompts | None | `{"auditAgentPrompt":"Review the proposed action.","auditAgentPromptReviewEdit":"Review the edited arguments."}` |
| `GET /api/hitl/tool-whitelist` | Global allowed tool list | None | None |
| `PUT /api/hitl/tool-whitelist` | Replace global list | None | `{"toolWhitelist":["search_knowledge","http_probe"]}` |
| `POST /api/hitl/tool-whitelist` | Merge tools into global list | None | `{"sensitiveTools":["search_knowledge"]}` |
| `POST /api/hitl/decision` | Submit approval decision | None | **HitlDecision** |
| `POST /api/hitl/dismiss` | Dismiss resolved/stale item | None | `{"interruptId":"interrupt-demo-1"}` |

**HitlConversationConfig**:

```json
{
  "conversationId": "conv-recon-01",
  "enabled": true,
  "mode": "approval",
  "reviewer": "human",
  "sensitiveTools": ["http_probe"],
  "timeoutSeconds": 300
}
```

**HitlDecision**:

```json
{
  "interruptId": "interrupt-demo-1",
  "decision": "approve",
  "comment": "Reviewed the demo action.",
  "editedArguments": null
}
```

When editing, `editedArguments` must be a JSON object, not an array or JSON text.
HITL modes are `off`, `approval` and `review_edit`; reviewers are `human` or
`audit_agent`; decisions are `approve` or `reject`.
Workflow approvals use `POST /api/workflows/runs/:runId/resume` with
`approved`/`comment`, rather than the HITL decision endpoint.

## 13. Tool guard

Sources: `src/features/tool-guard/service.ts`,
`src/features/tool-guard/model.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/tool-guard` | Current blocking rules | None | None |
| `PUT /api/tool-guard` | Replace rules | None | **GuardConfig** |
| `POST /api/tool-guard/test` | Test proposed arguments against a draft config | None | **GuardTest** |

**GuardConfig**:

```json
{
  "enabled": true,
  "rules": [
    { "id": "rule-demo", "name": "Demo marker", "enabled": true, "pattern": "demo-block-marker", "message": "Matched demo rule" }
  ]
}
```

**GuardTest**:

```json
{
  "config": {
    "enabled": true,
    "rules": [
      { "id": "rule-demo", "name": "Demo marker", "enabled": true, "pattern": "demo-block-marker", "message": "Matched demo rule" }
    ]
  },
  "toolName": "http_probe",
  "arguments": { "target": "https://app.example.com/demo-block-marker" }
}
```

The demo test handler instead reads `command`; it does not implement the UI's
draft-rule evaluation contract.

## 14. MCP monitor and execution details

Sources: `src/features/monitor/service.ts`, `src/features/chat/mcp-detail/modal.ts`,
`src/features/chat/process/mcp-section.ts`, `src/features/chat/client.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/monitor` | Monitor page | `page`, `page_size`, `status`, `tool` | None |
| `GET /api/monitor/stats` | Summary and top tools | `top` (dashboard: `30`) | None |
| `GET /api/monitor/executions` | Execution list; mock registration | Mock filter/pagination | None |
| `POST /api/monitor/executions/names` | Resolve execution IDs to tool names | None | `{"ids":["mcp-exec-001"]}` |
| `GET /api/monitor/execution/:id` | Execution details | None | None |
| `DELETE /api/monitor/execution/:id` | Delete execution | None | None |
| `DELETE /api/monitor/executions` | Delete selected executions | None | `{"ids":["mcp-exec-001"]}` |
| `POST /api/monitor/execution/:id/cancel` | Cancel execution | None | `{"note":"Stop this demo execution."}` |
| `GET /api/monitor/calls-timeline` | Invocation timeline | `range` | None |
| `GET /api/mcp/tools` | Alternate tool catalogue; client-only | None | None |
| `GET /api/mcp/external` | Alternate external tool catalogue; client-only | None | None |
| `GET /api/mcp/executions/:id` | Alternate execution detail client; client-only | None | None |
| `POST /api/mcp/executions/:id/cancel` | Alternate cancellation client; client-only | None | `{"userNote":"Stop this demo execution."}` |

The `/api/mcp/...` methods are defined by the chat-domain client. Existing
chat process UI uses the `/api/monitor/...` family; do not silently rewrite
one family as the other when testing.

## 15. Audit

Sources: `src/features/audit/client.ts`, `src/features/audit/service.ts`,
`src/mock/routes/security.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/audit/logs` | Audit history | `page`, `page_size`, `category`, `action`, `result`, `q`, `since`, `until` | None |
| `GET /api/audit/logs/:id` | Audit event | None | None |
| `GET /api/audit/summary` | Filtered counters | Same filters without pagination | None |
| `GET /api/audit/meta` | Audit metadata; mock-only | None | None |
| `GET /api/audit/logs/export` | Export audit history | Same filters; `format=csv` for CSV, omitted for JSON | None |
| `DELETE /api/audit/logs` | Clear audit log; mock-only | None observed | None |

The UI converts local date inputs to RFC3339/ISO timestamps for `since`/`until`.
The RBAC screen reuses the audit list endpoint.

## 16. Configuration and AI models

Sources: `src/features/settings/client.ts`, `src/features/settings/controller.ts`,
`src/features/chat/session/model-picker.ts`, `src/features/chat/client.ts`,
`src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/config` | Read effective config | None | None |
| `PUT /api/config` | Save edited sections | None | **ConfigUpdate** or relevant section object |
| `POST /api/config` | Alternate chat-domain save method; client-only | None | Config object |
| `POST /api/config/apply` | Apply saved config | None | None |
| `GET /api/config/tools` | Tool catalogue | `page`, `page_size`, `search`, `enabled`, `external_mcp`, `refresh_external`, `include_external` | None |
| `GET /api/config/tools/:name/schema` | Tool argument schema | `external_mcp` optional | None |
| `PUT /api/config/tools` | Acknowledge tool changes; mock-only | None | No body schema/consumer in current mock; no UI body inferred |
| `POST /api/config/list-models` | Provider model catalogue | None | **ModelCredentials** |
| `POST /api/config/test-openai` | Probe AI/audit connection | None | **ModelCredentials**, optionally `credential_scope` |
| `POST /api/config/test-typesafe` | Probe TypeSafe audit model | None | `{"base_url":"https://models.example.com","api_key":"demo-key","model":"jev-latest","credential_scope":"hitlAudit"}` |
| `POST /api/config/test-vision` | Probe vision model | None | **VisionTest** |
| `GET /api/ai/models` | Alternate chat model-list client; client-only | `channel_id`, `refresh=1` | None |

**ConfigUpdate** — representative editable sections, not the full configuration:

```json
{
  "ai": {
    "default_channel": "demo-large",
    "channels": {
      "demo-large": {
        "name": "Demo Large",
        "provider": "openai_compatible",
        "base_url": "https://llm.example.com/v1",
        "api_key": "demo-key",
        "model": "demo-large",
        "max_total_tokens": 120000,
        "max_completion_tokens": 32768,
        "reasoning": { "mode": "auto", "effort": "medium", "allow_client_reasoning": true }
      }
    }
  },
  "storage": { "retention_days": 30, "auto_cleanup": false }
}
```

Other settings sections are open objects, including `server`, `auth`, `log`,
`audit`, `monitor`, `vision`, provider credentials (`fofa`, `zoomeye`, `quake`,
`shodan`), `agent`, `tool_guard`, `hitl`, `multi_agent`, `database`, `security`,
`mcp`, `external_mcp`, `knowledge`, `c2`, `robots`, `project` and directory fields.
The caller generally retains the loaded section's unedited fields.

**ModelCredentials**:

```json
{
  "provider": "openai_compatible",
  "channel_id": "demo-large",
  "base_url": "https://llm.example.com/v1",
  "api_key": "demo-key",
  "model": "demo-large",
  "credential_scope": "openai"
}
```

Observed credential scopes include `openai`, `vision`, `hitlAudit` and
`knowledgeEmbedding`; the model picker can send only saved channel/provider
credentials. Secrets above are placeholders.

**VisionTest**:

```json
{
  "vision": { "enabled": true, "base_url": "https://llm.example.com/v1", "api_key": "demo-key", "model": "demo-vision" },
  "openai": { "provider": "openai_compatible", "base_url": "https://llm.example.com/v1", "api_key": "demo-key", "model": "demo-large" },
  "channel_id": "demo-large"
}
```

## 17. External MCP servers

Sources: `src/features/settings/client.ts`, `src/features/settings/controller.ts`,
`src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/external-mcp` | Servers and status | None | None |
| `GET /api/external-mcp/stats` | Dashboard MCP counters | None | None |
| `GET /api/external-mcp/:name` | Server config | None | None |
| `PUT /api/external-mcp/:name` | Save one server config | None | **McpServerUpdate** |
| `DELETE /api/external-mcp/:name` | Remove server | None | None |
| `POST /api/external-mcp/:name/start` | Start server | None | None |
| `POST /api/external-mcp/:name/stop` | Stop server | None | None |
| `POST /api/external-mcp` | Create server in mock registry; mock-only | None | Mock DTO: `{"name":"demo-mcp","transport":"http","url":"https://mcp.example.com/mcp","enabled":true}` |

**McpServerUpdate**:

```json
{
  "config": {
    "type": "http",
    "url": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "Bearer demo-token" },
    "timeout": 300
  }
}
```

A stdio config instead contains `command`, `args` and optional `env`; an SSE
config uses `type: "sse"` and `url`. The settings editor can save several server
entries by issuing one PUT per name.

## 18. Knowledge

Sources: `src/features/knowledge/service.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/knowledge/categories` | Category list | `_t` cache-buster | None |
| `GET /api/knowledge/items` | Browse/search items | `categoryPage=true`, `limit`, `offset`, `category`, `search`, `_t`; demo paging may add `page`, `page_size` | None |
| `POST /api/knowledge/items` | Create item | None | **KnowledgeInput** |
| `GET /api/knowledge/items/:id` | Item details | None | None |
| `PUT /api/knowledge/items/:id` | Update item | None | **KnowledgeInput** |
| `DELETE /api/knowledge/items/:id` | Delete item | None | None |
| `GET /api/knowledge/stats` | Dashboard counters | None | None |
| `GET /api/knowledge/index-status` | Indexing progress | None | None |
| `POST /api/knowledge/index` | Index missing items or full rebuild | `mode=full` for full rebuild; omitted for missing | None |
| `POST /api/knowledge/scan` | Discover items needing indexing | None | None |
| `GET /api/knowledge/retrieval-logs` | Retrieval history | `limit`, `conversationId`, `messageId` | None |
| `DELETE /api/knowledge/retrieval-logs/:id` | Delete history record | None | None |

**KnowledgeInput**:

```json
{
  "category": "Demo notes",
  "title": "Project review checklist",
  "content": "Read the stored facts and summarize the recorded evidence."
}
```

## 19. Skills

Sources: `src/features/skills/service.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/skills` | Browse/search skills | `limit`, `offset`, `search` | None |
| `POST /api/skills` | Create skill | None | `{"name":"demo-review","description":"Review stored findings","content":"# Demo review\nRead the project notes."}` |
| `GET /api/skills/:name` | Skill detail | `depth=full` or `depth=summary` | None |
| `PUT /api/skills/:name` | Save SKILL.md | None | `{"description":"Review stored findings","content":"# Demo review\nRead the project notes."}` |
| `DELETE /api/skills/:name` | Delete skill | None | None |
| `GET /api/skills/:name/files` | Package files | None | None |
| `GET /api/skills/:name/file` | Read package file | `path` | None |
| `PUT /api/skills/:name/file` | Create/update package file | None | `{"path":"references/notes.md","content":"# Demo notes\nExample content."}` |
| `GET /api/skills/:name/bound-roles` | Roles using skill | None | None |
| `GET /api/skills/stats` | Skill monitor | None | None |
| `DELETE /api/skills/stats` | Reset all skill statistics | None | None |
| `DELETE /api/skills/:name/stats` | Reset one skill's statistics; mock-only | None | None |

## 20. AI roles

Sources: `src/features/roles/service.ts`, `src/mock/routes/platform.ts`.
These are AI execution roles, distinct from platform RBAC roles.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/roles` | AI role catalogue | None in current caller | None |
| `POST /api/roles` | Create AI role | None | **AiRoleInput** |
| `GET /api/roles/:name` | Role detail; mock registration | None | None |
| `PUT /api/roles/:name` | Update AI role | None | **AiRoleInput** |
| `DELETE /api/roles/:name` | Delete AI role | None | None |

**AiRoleInput**:

```json
{
  "name": "demo-reviewer",
  "description": "Review the demo project's stored findings",
  "icon": "",
  "user_prompt": "Summarize recorded facts and cite their evidence.",
  "tools": ["search_knowledge"],
  "enabled": true,
  "workflow_id": "",
  "workflow_version": "",
  "workflow_policy": ""
}
```

The role editor gets tool options from `GET /api/config/tools`.

## 21. Markdown agents

Sources: `src/features/agents/service.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/multi-agent/markdown-agents` | Agent definitions | None | None |
| `POST /api/multi-agent/markdown-agents` | Create markdown agent | None | **AgentInput**, with `filename` |
| `GET /api/multi-agent/markdown-agents/:filename` | Read definition | None | None |
| `PUT /api/multi-agent/markdown-agents/:filename` | Update definition | None | **AgentInput**, without `filename` |
| `DELETE /api/multi-agent/markdown-agents/:filename` | Delete definition | None | None |

**AgentInput**:

```json
{
  "filename": "demo-reviewer.md",
  "id": "demo-reviewer",
  "name": "Demo Reviewer",
  "description": "Summarizes existing evidence",
  "tools": ["search_knowledge"],
  "instruction": "Review only the findings already present in the project.",
  "bind_role": "demo-reviewer",
  "max_iterations": 5,
  "kind": ""
}
```

The orchestrator variant uses `kind: "orchestrator"`; create filenames must
match the UI's safe `.md` filename pattern.

## 22. Workflows and packages

Sources: `src/features/workflows/service.ts`,
`src/features/workflows/package-client.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/workflows` | Workflow list | `includeDisabled` | None |
| `POST /api/workflows` | Create workflow | None | **WorkflowInput** |
| `GET /api/workflows/:id` | Read workflow; mock registration | None | None |
| `PUT /api/workflows/:id` | Update workflow | None | **WorkflowInput** |
| `DELETE /api/workflows/:id` | Delete workflow | None | None |
| `POST /api/workflows/validate` | Validate graph | None | `{"graph":{"nodes":[],"edges":[]}}` (shape example; empty graph need not be valid) |
| `POST /api/workflows/dry-run` | Simulate graph | None | **WorkflowDryRun** |
| `POST /api/workflows/generate-draft` | Generate graph draft | None | **WorkflowDraftRequest** |
| `GET /api/workflows/runs/pending` | Awaiting-approval runs | `conversationId` optional | None |
| `GET /api/workflows/runs/:runId` | Run state | None | None |
| `GET /api/workflows/runs/:runId/replay` | Replay run events | None | None |
| `POST /api/workflows/runs/:runId/resume` | Approve/reject suspended run | None | `{"approved":true,"comment":"Reviewed demo workflow."}` |
| `GET /api/workflows/:id/package` | Download workflow package | None | None; binary download |
| `POST /api/workflow-package-inspections` | Upload package for inspection | None | Multipart **WorkflowPackageUpload** |
| `GET /api/workflow-package-inspections/:inspectionId` | Inspection result | None | None |
| `POST /api/workflow-package-imports` | Apply import resolution | None | **WorkflowImport**; `Idempotency-Key` header required by caller |
| `GET /api/workflow-package-imports/:importId` | Import result | None | None |

**WorkflowInput** — graph shape example; actual validation depends on configured
node types. The UI sends `graph`, while the mock persists `graph_json`:

```json
{
  "id": "demo-workflow",
  "name": "Demo workflow",
  "description": "Workflow editor fixture",
  "enabled": true,
  "graph": {
    "nodes": [
      { "id": "start", "type": "start", "position": { "x": 0, "y": 0 }, "config": {} },
      { "id": "end", "type": "end", "position": { "x": 240, "y": 0 }, "config": {} }
    ],
    "edges": [{ "source": "start", "target": "end" }]
  }
}
```

**WorkflowDryRun**:

```json
{
  "graph": {
    "nodes": [{ "id": "start", "type": "start", "config": {} }, { "id": "end", "type": "end", "config": {} }],
    "edges": [{ "source": "start", "target": "end" }]
  },
  "inputs": { "message": "Summarize the demo notes." }
}
```

**WorkflowDraftRequest**:

```json
{
  "prompt": "Create a workflow to summarize stored project facts.",
  "options": { "include_objective": true, "allow_schedule": false, "allow_high_risk": false },
  "available_tools": [{ "key": "search_knowledge", "name": "search_knowledge", "enabled": true }]
}
```

**WorkflowPackageUpload**: multipart field `file` contains a `.csapkg.zip` file,
maximum 10 MiB according to the UI's validation. Do not JSON-encode the binary.

**WorkflowImport**:

```json
{
  "inspection_id": "inspection-demo-1",
  "resolution": { "action": "create", "new_workflow_id": "" },
  "confirm_overwrite": false
}
```

Import actions are `create`, `keep_existing`, `overwrite` and `rename`.
`rename` supplies `new_workflow_id`; `overwrite` sets `confirm_overwrite: true`.
Use one generated UUID in `Idempotency-Key` for retries of the same payload.

## 23. C2

Sources: `src/features/c2/service.ts`, `src/features/c2/model.ts`,
`src/platform/access-browser.ts`, `src/mock/routes/platform.ts`.

### Listeners

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/c2/listeners` | Listener list | Dashboard can add `project_id` | None |
| `POST /api/c2/listeners` | Create listener | None | **ListenerInput** |
| `GET /api/c2/listeners/:id` | Listener details; mock registration | None | None |
| `PUT /api/c2/listeners/:id` | Update listener/project association | None | **ListenerInput** |
| `DELETE /api/c2/listeners/:id` | Delete listener | None | `{}` |
| `POST /api/c2/listeners/:id/start` | Start listener | None | `{}` |
| `POST /api/c2/listeners/:id/stop` | Stop listener | None | `{}` |

**ListenerInput**:

```json
{
  "name": "Demo listener",
  "type": "http_beacon",
  "bind_host": "127.0.0.1",
  "bind_port": 18080,
  "remark": "UI test fixture",
  "callback_host": "127.0.0.1",
  "project_id": "proj-lab-web",
  "profile_id": "",
  "config": {}
}
```

### Sessions

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/c2/sessions` | Session list | `status`, `listener_id`, `search`, `suspicious=1`; dashboard also `project_id`, `limit` | None |
| `GET /api/c2/sessions/:id` | Session details; mock registration | None | None |
| `DELETE /api/c2/sessions` | Delete selected sessions | None | `{"ids":["sess-1"]}` |
| `DELETE /api/c2/sessions/:id` | Delete one session; mock-only | None | None |
| `PUT /api/c2/sessions/:id/note` | Save note | None | `{"note":"Demo session note"}` |
| `PUT /api/c2/sessions/:id/sleep` | Set interval/jitter | None | `{"sleep_seconds":30,"jitter_percent":10}` |
| `POST /api/c2/sessions/:id/tasks` | Alternate task creation; mock-only | None | Mock DTO: `{"command":"pwd"}` |

The UI's session terminate action creates an `exit` task through `/api/c2/tasks`.

### Tasks, events and files

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/c2/tasks` | Tasks and counts | `status`, `task_type`, `session_id`, `since`, `page`, `page_size`; dashboard also `project_id` | None |
| `POST /api/c2/tasks` | Create typed task | None | **C2TaskInput** |
| `GET /api/c2/tasks/:id` | Poll task/result | None | None |
| `POST /api/c2/tasks/:id/cancel` | Cancel task | None | `{}` |
| `DELETE /api/c2/tasks` | Delete selected tasks | None | `{"ids":["c2-task-1"]}` |
| `GET /api/c2/tasks/:id/result-file` | Download task result; client-only | None | None; binary download |
| `GET /api/c2/events` | Event history | `level`, `category`, `session_id`, `since`, `page`, `page_size` | None |
| `GET /api/c2/events/:id` | Event details; client-only | None | None |
| `DELETE /api/c2/events` | Delete selected events | None | `{"ids":["c2-event-1"]}` |
| `GET /api/c2/events/stream` | Live event subscription; client-only route, intercepted EventSource in demo | `token` | None; SSE |
| `POST /api/c2/files/upload` | Stage file; client-only | None | Multipart: `session_id`, `remote_path`, `file` |

**C2TaskInput** — task payload depends on `task_type`. A harmless read-only
shape example:

```json
{
  "session_id": "sess-1",
  "task_type": "pwd",
  "payload": {}
}
```

Other UI examples: `ls` uses `{"path":"."}`; `shell` uses
`{"command":"pwd","timeout_seconds":60}`; `download` uses
`{"remote_path":"/tmp/demo-notes.txt"}`; after staged upload, `upload` uses
`{"remote_path":"/tmp/demo-notes.txt","file_id":"file-demo-1"}`. These objects
are the nested `payload`, not the entire request.

### Profiles and payload builder

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/c2/profiles` | Traffic profiles | None | None |
| `POST /api/c2/profiles` | Create profile | None | **C2ProfileInput** |
| `PUT /api/c2/profiles/:id` | Update profile; mock-only | None | Mock DTO example: `{"name":"Demo profile","sleepSeconds":30,"jitter":10}` |
| `DELETE /api/c2/profiles/:id` | Delete profile | None | `{}` |
| `POST /api/c2/payloads/build` | Payload-build UI action | None | `{"listener_id":"listener-demo-1","os":"linux","arch":"amd64","host":"127.0.0.1"}` |
| `POST /api/c2/payloads/oneliner` | One-liner UI action | None | `{"listener_id":"listener-demo-1","kind":"curl_beacon","host":"127.0.0.1"}` |
| `GET /api/c2/payloads/:id/download` | Download built artifact | None | None; `:id` is the filename in the UI caller |

The current demo build route only returns a placeholder; it produces no binary.
Listener types shown by the UI are `http_beacon`, `https_beacon`, `tcp_reverse`
and `websocket`. The one-liner kind depends on listener type; the HTTP example
above uses `curl_beacon`.

**C2ProfileInput**:

```json
{
  "name": "Demo profile",
  "userAgent": "DemoClient/1.0",
  "uris": ["/demo/health"],
  "requestHeaders": {},
  "responseHeaders": { "Server": "demo" },
  "bodyTemplate": "",
  "jitterMinMs": 100,
  "jitterMaxMs": 500
}
```

## 24. WebShell

Sources: `src/features/webshell/service.ts`, `src/features/webshell/model.ts`,
`src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/webshell/connections` | Saved connections | Dashboard can add `project_id` | None |
| `POST /api/webshell/connections` | Create connection | None | **WebshellConnectionInput** |
| `PUT /api/webshell/connections/:id` | Update connection | None | **WebshellConnectionInput** |
| `DELETE /api/webshell/connections/:id` | Delete connection | None | None |
| `GET /api/webshell/connections/:id/state` | Restore workspace state | None | None |
| `PUT /api/webshell/connections/:id/state` | Persist workspace state | None | **WebshellState** |
| `GET /api/webshell/connections/:id/ai-history` | Last AI conversation | None | None |
| `GET /api/webshell/connections/:id/ai-conversations` | AI conversation list | None | None |
| `POST /api/webshell/exec` | Command/connectivity/SQL transport | None | **WebshellExec** |
| `POST /api/webshell/file` | File operations | None | **WebshellFile** |

**WebshellConnectionInput** — both `cmdParam` and `cmd_param` are emitted by
the save caller:

```json
{
  "url": "https://lab.example.com/demo.php",
  "password": "demo-password",
  "type": "php",
  "method": "post",
  "cmdParam": "cmd",
  "cmd_param": "cmd",
  "remark": "Demo connection",
  "encoding": "auto",
  "os": "auto",
  "project_id": "proj-lab-web"
}
```

**WebshellExec**:

```json
{
  "connection_id": "ws-1",
  "url": "https://lab.example.com/demo.php",
  "password": "demo-password",
  "type": "php",
  "method": "post",
  "cmd_param": "cmd",
  "encoding": "auto",
  "os": "auto",
  "command": "pwd"
}
```

**WebshellFile** — same connection fields, followed by operation fields:

```json
{
  "connection_id": "ws-1",
  "url": "https://lab.example.com/demo.php",
  "password": "demo-password",
  "type": "php",
  "method": "post",
  "cmd_param": "cmd",
  "encoding": "auto",
  "os": "auto",
  "action": "list",
  "path": "."
}
```

Chunk upload uses `action: "upload_chunk"`, destination `path`, base64
`content` and zero-based `chunk_index`. `FileRequest` also permits
`target_path`, `total_chunks`, `upload_id` and operation-specific fields.
The SQL panel runs through `/api/webshell/exec`; it has no separate database API.

**WebshellState** — terminal tabs and database panel state are nested under
`state`. A profile contains editable connection, SQL, output and schema fields:

```json
{
  "state": {
    "terminalSessions": { "sessions": [{ "id": "t1", "name": "Terminal 1" }], "activeId": "t1" },
    "dbState": {
      "profiles": [
        {
          "id": "db-demo-1", "name": "DB-1", "type": "sqlite",
          "host": "127.0.0.1", "port": "", "username": "", "password": "",
          "database": "", "selectedDatabase": "", "sqlitePath": "/tmp/demo.db",
          "sql": "SELECT 1;", "output": "", "outputIsError": false, "schema": {}
        }
      ],
      "activeProfileId": "db-demo-1",
      "aiMemo": ""
    }
  }
}
```

WebShell AI reuses agent streams with `webshellConnectionId`, `conversationId`,
`role`, optional `projectId`/`reasoning`, and
`finalization.requireExecutionEvidence=true`. It also uses conversation GET,
DELETE, project-binding and agent-loop cancellation.

## 25. Terminal

Sources: `src/features/terminal/service.ts`, `src/platform/mock-transport.ts`,
`src/mock/routes/platform.ts`.

| Request | Purpose | Query | Body/protocol |
|---|---|---|---|
| `WS /api/terminal/ws` | Interactive PTY | `token` optional | WebSocket frames, not HTTP JSON |
| `POST /api/terminal/run` | Legacy demo command endpoint; mock-only | None | `{"command":"pwd"}` |
| `POST /api/terminal/run/stream` | Legacy demo streaming command endpoint; mock-only | None | `{"command":"pwd"}`; SSE response |

The interactive terminal sends raw text keystrokes and JSON resize frames:

```json
{ "type": "resize", "cols": 120, "rows": 30 }
```

The WebSocket URL uses `ws:` or `wss:` based on the page protocol. This endpoint
is emulated by demo transport rather than an `M.route` HTTP handler.

## 26. Files and chat uploads

Sources: `src/features/chat-files/service.ts`, `src/features/chat-files/model.ts`,
`src/app/chat/index.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body / upload |
|---|---|---|---|
| `GET /api/chat-uploads` | List files/folders | `conversation`, `project`, `source`, `search`, `page`, `pageSize` (number or `all`) | None |
| `POST /api/chat-uploads` | Upload file | None | Multipart **ChatUpload** |
| `DELETE /api/chat-uploads` | Delete file/folder | None | `{"path":"uploads/demo/notes.txt"}` |
| `GET /api/chat-uploads/content` | Read text file | `path` | None |
| `PUT /api/chat-uploads/content` | Save text file | None | `{"path":"uploads/demo/notes.txt","content":"Updated demo notes"}` |
| `GET /api/chat-uploads/download` | Download file | `path` | None; binary response |
| `GET /api/chat-uploads/export` | Export matching files | Same list filters | None; ZIP response |
| `GET /api/chat-uploads/path` | Resolve directory path | `kind=directory`, `path` | None |
| `POST /api/chat-uploads/mkdir` | Create folder | None | `{"parent":"uploads/demo","name":"reports"}` |
| `PUT /api/chat-uploads/rename` | Rename entry | None | `{"path":"uploads/demo/notes.txt","newName":"review.txt"}` |
| `GET /api/files` | Alternate file-list mock; mock-only | None | None |
| `POST /api/files/upload` | Alternate upload mock; mock-only | None | Mock does not inspect a body; no current UI upload contract identified |

**ChatUpload**: multipart fields `file` plus `relativeDir` for a directory
target, or `conversationId` if no directory is supplied. Composer uploads use
the same endpoint; the browser must send file bytes rather than JSON.

Example multipart field description (not a JSON request body):

```text
Content-Type: multipart/form-data; boundary=<browser-generated>
file           = <notes.txt bytes>
relativeDir    = uploads/demo
```

## 27. Storage

Sources: `src/features/storage/service.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/storage/status` | Usage and breakdown | `refresh=1` optional | None |
| `GET /api/storage/meta` | Cleanup policy | None | None |
| `POST /api/storage/cleanup` | Preview or execute cleanup | None | Preview: `{"dry_run":true}`; execute: `{"dry_run":false,"confirm":true}` |

Saving retention policy uses `PUT /api/config`:

```json
{ "storage": { "retention_days": 30, "auto_cleanup": false } }
```

## 28. System updates

Sources: `src/features/update/client.ts`, `src/features/update/service.ts`,
`src/platform/notification-browser.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/system/update` | Status/source/restart capability | None | None |
| `GET /api/system/update/job` | Poll update job | None | None |
| `POST /api/system/update/check` | Check for updates | None | None |
| `POST /api/system/update/apply` | Start update | None | `{"restart":true}` |
| `POST /api/system/update/restart` | Restart application | None | None |
| `POST /api/system/update/rollback` | Roll back | None | None |
| `POST /api/system/update/adopt` | Preview/confirm source adoption | None | Preview: `{"confirm":false}`; apply: `{"confirm":true,"restart":false}` |
| `POST /api/system/update/source` | Configure source repository | None | `{"repo":"https://github.com/example/demo-project.git"}` |

These actions are acknowledgements/placeholders in demo mode; the demo does not
perform a real update or restart.

## 29. Robots and bindings

Sources: `src/features/wechat-robot/client.ts`, `src/features/auth/service.ts`,
`src/features/settings/`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/robot/wechat/status` | Placeholder status; mock-only | None | None |
| `POST /api/robot/wechat/qrcode` | Start QR binding | None | `{"bot_type":"3"}` (UI default) |
| `GET /api/robot/wechat/qrcode/status` | Poll QR session | `session_key` | None |
| `POST /api/robot/wechat/qrcode/verify` | Submit verification code | None | `{"session_key":"session-demo-1","verify_code":"123456"}` |
| `POST /api/robot/test` | Test notification; mock-only | None | Handler ignores body; no current UI payload identified |
| `POST /api/robot/dingtalk` | Bot webhook mock; mock-only | None | Handler ignores body; provider-specific webhook JSON not inferred |
| `POST /api/robot/lark` | Bot webhook mock; mock-only | None | Handler ignores body; provider-specific webhook JSON not inferred |
| `POST /api/robot/wecom` | Bot webhook mock; mock-only | None | Handler ignores body; provider-specific webhook JSON not inferred |
| `GET /api/robot-bindings` | Platform binding mock; mock-only | None | None |
| `DELETE /api/robot-bindings/:id` | Remove binding in mock registry; mock-only | None | None |

Account-level bindings use `/api/auth/robot-bindings` and
`/api/auth/robot-binding-code` from section 1. General robot settings are saved
under the `robots` section using `PUT /api/config`; UI-supported robot types also
include Telegram, Slack, Discord and QQ without separate direct request paths
in these feature clients.

## 30. OpenAPI and miscellaneous

Sources: `src/features/api-docs/index.ts`, `src/mock/routes/platform.ts`.

| Request | Purpose | Query | JSON body |
|---|---|---|---|
| `GET /api/openapi/spec` | API Docs specification | None | None |
| `GET /api/v1/status` | Status placeholder; mock-only | None | None |
| `GET /api/events` | Empty event-list placeholder; mock-only | None | None |

In demo mode OpenAPI is generated from the mock route table. It contains path
parameters and response descriptions, but does **not** describe request bodies,
query filters or the client-only operations listed here. The API Docs request
runner can issue arbitrary operations from the loaded specification; those are
not additional hardcoded UI endpoints.

## Known UI/demo contract differences

These differences were found while reading current source. They explain why a
demo acknowledgement is not proof that a backend payload was applied. This
documentation does not change handlers or request code.

| Area | UI/client request | Current demo contract |
|---|---|---|
| Password | Settings and shared auth client send `oldPassword`, `newPassword` | Schema reads `current_password`, `new_password` |
| Own binding removal | `DELETE /api/auth/robot-bindings/:id` | Only `/api/robot-bindings/:id` is registered for deletion |
| Notification read | `eventIds` | Schema/handler uses `ids` |
| RBAC grants | `resource_ids` array and `auto_detect` | Mock schema/handler reads a single `resource_id` |
| Asset selection writes | `asset_ids`; bulk fields at the top level | Batch-delete/bulk schemas use `ids`, and bulk expects nested `patch`; several other asset action mocks only acknowledge |
| Alert subscription | `min_severity` | Mock reads `minSeverity` |
| HITL whitelist | `toolWhitelist` / `sensitiveTools` | Mock schema/handler uses `tools` / `tool` |
| HITL conversation config | `conversationId`, `sensitiveTools`, policy fields | Partial fixture schema omits some caller fields |
| HITL modes/history deletion | `approval`/`review_edit`; selected IDs or filtered deletion | Mock defaults use `manual`; log deletion clears the whole list |
| HITL audit strategy | Prompt fields | Mock schema uses `strategy`, `auditAgentEnabled` |
| Tool guard test | `config`, `toolName`, `arguments` | Mock reads `command` |
| C2 tasks | `session_id`, `task_type`, nested `payload` | Mock schema uses `sessionId`/`session` and `command` |
| C2 interval | `sleep_seconds`, `jitter_percent` | Mock reads `sleep` |
| C2 listener/profile writes | Feature draft shapes | Fixture schemas use a different subset/casing of fields |
| C2 task/event bulk deletion | Selected `ids` | Some handlers clear their whole demo list |
| MCP monitor bulk deletion | Selected `ids` | Demo handler clears the execution list |
| External MCP save | `{ "config": ... }` wrapper | Mock update schema is a partial flat MCP fixture |
| Skills / AI roles | Markdown `content`, `user_prompt`, workflow fields | Fixture schemas omit some authoring fields |
| Markdown agents | Full authoring DTO | Mock create reads only `filename`; update acknowledges |
| Chat-upload mkdir/rename | `parent`, `name` / `newName` | Path schema uses `path`, `newPath` |
| Chat-upload filters/deletion | List sends `project`; delete sends JSON `{ "path": "..." }` | Mock filters `project_id`; deletion reads `path` from the query string |
| Chat stream | Optional attachments, channel, HITL, reasoning, finalization | Mock agent schema keeps a narrower subset of request fields |
| Alternate chat client | `/api/ai/models`, `/api/mcp/...`, `POST /api/config` | These method/path pairs have no current mock registration |
| Binary/export operations | ZIP/package/download response expected by UI | Several demo routes return illustrative placeholder files |

The demo router can also acknowledge an unregistered request with an empty
success object while recording it as unhandled. A 200 response alone does not
establish that a client-only operation has a working mock implementation.

For body-less mock-only actions, no JSON schema is invented: the current
handler does not consume one. For all other writes, use the actual caller's
body example above rather than guessing from the response fixture.

## Source map and maintenance

- UI network boundaries: `src/features/**/client.ts`,
  `src/features/**/service.ts`, `src/app/chat/`, `src/api/clients/`.
- Shared request DTOs: `src/api/types/`.
- Demo registry: `src/mock/routes/auth.ts`, `chat.ts`, `security.ts`,
  `platform.ts`; request validation: `src/mock/bodies.ts`, `src/mock/types.ts`.
- Realtime emulation: `src/platform/mock-transport.ts`.
- Transport/base URL: `src/platform/http.ts`, `vite.config.ts`.
- Backend-owned chat transport selection: `src/platform/agent-endpoint.ts`.

When adding an API call, update its owning section with method, normalized
path, query keys, exact request JSON and source location. Record multipart,
SSE and WebSocket behavior explicitly instead of assigning them a fictitious
JSON body. Keep the file free of literal CJK characters to satisfy the
English-only source guard.
