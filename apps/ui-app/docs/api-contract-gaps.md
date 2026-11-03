# API contract gaps and coverage

Snapshot: 2026-10-31. Source scope: ui-app only. No live Raptix backend is present or assessed. No application, mock, storage or transport behavior was changed.

## Exact inventory reconciliation

```json
{
  "http": 300,
  "paths": 229,
  "mockRegistrations": 287,
  "shared": 242,
  "frontendUsedOnly": 13,
  "mockOnly": 45,
  "legacy": 0,
  "sse": 5,
  "websocket": 1,
  "frontendOperations": 255,
  "withFrontendRequestSchemas": 111,
  "withMockRequestSchemas": 87,
  "withMockSuccessSchemas": 287,
  "withFrontendResponseExpectations": 160,
  "successfulMockJsonExamples": 254,
  "baselineHttp": 298,
  "addedSinceBaseline": [
    "GET /api/batch-tasks/runs",
    "GET /api/workflows/runs"
  ]
}
```

The old reference has **299 rows including one WS interface**: 298 HTTP operations, not 299 HTTP APIs. Current source adds GET /api/workflows/runs and GET /api/batch-tasks/runs, giving **300 HTTP operations plus one WebSocket interface**. All 287 runtime mock registrations are represented, with unique normalized method/path pairs. GET /api/hitl/logs/{id} is now mock-supported despite the old table's client-only label. RBAC frontend management was removed, so all fourteen RBAC mock routes are mock-only, not currently used compatibility calls. Legacy classification count is zero: a historical name alone is insufficient evidence of a compatibility-only API.

Counts overlap intentionally: SSE operations are HTTP operations, not extra method/path entries. A generic mock EventSource heartbeat is transport simulation, not an HTTP route registration. No synthetic GET /api/terminal/ws operation is added to OpenAPI; it is documented as a WebSocket protocol.

## Evidence quality and limitations

- Source AST walks concrete request calls, helper-expanded paths and runtime mock registrations. Conditional method/path pairs are correlated rather than counted as every Cartesian combination. Source evidence excerpts are retained per operation. Wrapper families (update, WeChat, C2 bulk/file) are explicitly expanded from their callers.
- TypeScript interfaces/aliases/index signatures/unions are expanded into reusable JSON Schema components. Zod schemas are exported in input mode, preserving known optionality, nullability, constraints and client defaults. Transforms/unknowns that cannot be expressed are marked UNKNOWN. Compiler-derived object requiredness is not server validation.
- Some exported client methods have no current UI consumer. `frontend-used` means source-level request definition, not verified interaction reachability. Unused client seams are retained in the inventory rather than quietly omitted.
- Mock response schemas are inferred from return expressions and their nested DTOs; empty arrays establish no element fields. Concrete mock examples use fresh in-memory fixture state, never network requests. Arrays in examples are limited to one element without removing nested object fields. A handler that returns an error for the structural request is shown as an error example, not a success.
- Structural request examples are type illustrations, not domain-valid requests or successful contract tests. Empty names/passwords/prompts may deliberately fail handler checks. Binary uploads and unresolved values have no fabricated JSON example.
- Caller-only exact success statuses, server auth enforcement/permissions, full validation, pagination bounds, missing error enums, and future Raptix compatibility remain UNKNOWN. Shared HTTP handles 401/403 centrally but this is not endpoint-specific server evidence.
- Named type index includes supporting UI models to make nested definitions traceable; a UI-only field must not automatically be treated as a wire field. OpenAPI x-frontend-* views are distinct from mock response schemas.
- Prior query notes are explicitly labeled prior-inventory where direct parameter mapping was not recovered; source excerpts remain the authority. No historical table claim silently upgrades to confirmed schema.

## Confirmed frontend/mock differences

| Area | Frontend expectation | Mock behavior / source | Consequence |
| --- | --- | --- | --- |
| Password change | oldPassword/newPassword (src/api/clients/auth.ts; src/features/settings/client.ts:32) | current_password/new_password (src/mock/bodies.ts:10; routes/auth.ts:68) | camelCase stripped/missing; 400 rather than successful change |
| Notifications read | eventIds (src/features/notifications/client.ts) | ids (bodies.ids; routes/security.ts:104) | missing ids means mock marks all read |
| Assets import | created/updated/skipped, normalized legacy imported fallback (src/api/clients/assets.ts) | imported counter and sparse asset DTOs (routes/security.ts:437) | explicit normalization; missing timestamps must not be fabricated |
| Assets bulk/delete | asset_ids plus direct patch fields (src/features/assets/service.ts:132–135) | ids and nested patch (src/mock/bodies.ts:15; routes/security.ts:450–463) | request names/shape differ; empty/no-op operations possible |
| Asset project binding/merge/scan links | mutations sent by source (src/features/assets/service.ts) | unconditional acknowledgements (routes/security.ts:448–464) | mock success does not prove a state change |
| Vulnerability batch | DELETE with filters, no body (src/features/vulnerability/service.ts:41) | ids decoder, absent body defaults {}, handler selects matching (routes/security.ts:334) | two modes must be distinguished |
| Vulnerability subscription | min_severity (src/features/vulnerability/service.ts:45) | minSeverity (src/mock/bodies.ts:14; routes/security.ts:379) | casing mismatch; submitted threshold can be discarded |
| Vulnerability pagination (resolved historical gap) | total_pages required by shared client decoder | current mock now includes total_pages (routes/security.ts:295–302); shared adapter retains old missing-field fallback (src/api/clients/vulnerabilities.ts:6) | old omission claim is obsolete; fallback preserved, not an active mock mismatch |
| Facts/edges | rich keys/confidence/categories and graph views | mock only honors selected fields and literal true checks (routes/security.ts:192–277) | exclude_deprecated=1 or view semantics not equivalent; some fields default rather than persist |
| Run cancellation | conversationId plus optional mode/note controls in chat/progress/tasks.ts | bodies.agent only retains message/conversationId/projectId/role; cancel flag only (routes/chat.ts:243) | stop-tool/continue semantics not simulated |
| Queue schedule (resolved historical gap) | scheduleEnabled; compatibility can also add enabled (src/features/tasks/service.ts:79) | current mock reads scheduleEnabled ?? enabled (routes/security.ts:623) | fallback remains, but camelCase request now works directly |
| Tool guard test | config, toolName, arguments (src/features/tool-guard/service.ts:98) | command-only regex with blocked/reason (routes/platform.ts:127) | UI expected match metadata not simulated |
| MCP configuration | PUT {config:{...}}; servers record/config nesting, upsert-style UI (src/features/settings/client.ts:33–37) | flat bodies.mcp; PUT requires existing name and merges limited flat fields (routes/platform.ts:395–450) | new-server save/config changes may fail or be discarded |
| Skills content | POST/PUT description/content and package file writes | bodies.skill has metadata but no content; file PUT acknowledges without persistence (routes/platform.ts:184–224) | metadata fixtures do not prove content edits |
| Knowledge content | title/content/category plus frontend wire variants (src/features/knowledge/service.ts) | narrowed knowledge DTO and fixed indexing simulation (routes/platform.ts:291–379) | metadata/index coverage incomplete |
| Markdown agents | id/name/instruction/tools/bind_role/max_iterations/kind (src/features/agents/service.ts:21) | POST filename-only, PUT ignores body, GET returns template (routes/platform.ts:272–287) | no full definition persistence |
| Workflow graph | richer frontend graph config, edge labels/config, graph_json string or object | mock graph drops unsupported fields; validate/dry-run abbreviated (src/mock/types.ts:39; routes/platform.ts:464–530) | successful mock save is not full-fidelity orchestration validation |
| Workflow draft/package | AiResult and inspection/import decoder with id/workflow/conflict | abbreviated nodes and inspectionId/importId placeholder payloads; alias normalization in package-client.ts | draft adapter composes special demo response; package bytes not a real .csapkg.zip |
| C2 payload build | PayloadBuild artifact metadata (src/features/c2/model.ts) | HTTP 200 {error:"Beacon compilation is unavailable..."} (routes/platform.ts:665) | semantic failure on successful HTTP; no binary generated |
| C2 file/terminal tasks | typed tasks, resultText, task_id/task, approval and result-file stages | partial fixed task simulation; staged upload/result-file no mock registration (src/features/c2/service.ts; routes/platform.ts:609–639) | cannot infer successful remote transfers |
| WebShell exec/files | ExecResult.ok and output (src/features/webshell/model.ts; service.ts:134–166) | success:true instead of ok; file returns entries, not parser output (routes/platform.ts:719–725) | UI reports execution/file failure, despite 200 |
| WebShell AI list | plain AiConversation[] (src/features/webshell/service.ts) | {conversations:[]} (routes/platform.ts:717) | consumer .map failure |
| WebShell persistence | dbState/terminalSessions (src/features/webshell/service.ts:86–100) | PUT acknowledgement; GET empty state (routes/platform.ts:714–715) | no persisted workspace state in demo |
| Storage cleanup | dry_run/confirm and rich cleanup model | request ignored, fixed freed_bytes/message (routes/platform.ts:738) | preview and execute not differentiated |
| Update console | status/job/source objects (src/features/update/types.ts; service.ts:36–42) | mostly flat version/status placeholders (routes/platform.ts:740–749) | UI treats much of payload as absent; not a real updater |
| Recon parse/search | provider/text for parse; SearchForm options and provider limits for search (src/features/info-collect/service.ts:38–42) | query-only input; fixed rows (routes/platform.ts:753–763) | parse text/provider dropped; no provider-specific execution |
| WeChat binding | session_key, URL/image/status details (src/features/wechat-robot/types.ts) | empty qrcode/demo/idle/success:false (routes/platform.ts:765–768) | clearly unavailable real binding, not an API success claim |
| Generic mock fallback | absent endpoint should not be assumed supported | router.ts:79 returns 200 {} and logs unhandled | a green HTTP status alone does not establish a contract |
| AI role fields | user_prompt, icon and workflow_id/version/policy in RolePayload (src/features/roles/service.ts:6,67–73) | mock aiRole schema retains prompt/skills metadata instead (src/mock/types.ts:33; bodies.ts:22) | richer role/workflow associations are not fully simulated |

Authentication has caller-specific exceptions: C2's native EventSource uses a
`token` query parameter, while the update restart watchdog deliberately issues
a bare same-origin fetch and interprets 401 as process-ready. These are recorded
in the catalog and OpenAPI security/evidence fields; they must not be rewritten
as universal bearer-header requirements.

## Frontend-used operations without HTTP mock registrations

| Operation | Classification | Evidence |
| --- | --- | --- |
| POST `/api/eino-agent` | frontend-used | src/api/clients/chat.ts:11 |
| POST `/api/multi-agent` | frontend-used | src/api/clients/chat.ts:11 |
| DELETE `/api/auth/robot-bindings/{id}` | frontend-used | src/features/auth/service.ts:239 |
| GET `/api/c2/events/{id}` | frontend-used | src/features/c2/service.ts:298 |
| GET `/api/c2/events/stream` | frontend-used | src/platform/access-browser.ts:68 |
| POST `/api/c2/files/upload` | frontend-used | src/features/c2/service.ts:198 |
| GET `/api/c2/tasks/{id}/result-file` | frontend-used | src/features/c2/service.ts:212; src/features/c2/service.ts:296; src/features/c2/service.ts:208–215,296 |
| GET `/api/ai/models` | frontend-used | src/features/chat/client.ts:25 |
| POST `/api/config` | frontend-used | src/features/chat/client.ts:28 |
| GET `/api/mcp/executions/{id}` | frontend-used | src/features/chat/client.ts:31 |
| POST `/api/mcp/executions/{id}/cancel` | frontend-used | src/features/chat/client.ts:32 |
| GET `/api/mcp/external` | frontend-used | src/features/chat/client.ts:30 |
| GET `/api/mcp/tools` | frontend-used | src/features/chat/client.ts:29 |

## Mock-only / currently unused HTTP operations

| Operation | Classification | Evidence |
| --- | --- | --- |
| GET `/api/roles/{name}` | mock-only | src/mock/routes/platform.ts:248 |
| GET `/api/conversations/{id}/attack-chain` | mock-only | src/mock/routes/platform.ts:885 |
| DELETE `/api/audit/logs` | mock-only | src/mock/routes/security.ts:866 |
| GET `/api/audit/meta` | mock-only | src/mock/routes/security.ts:853 |
| GET `/api/c2/listeners/{id}` | mock-only | src/mock/routes/platform.ts:558 |
| DELETE `/api/c2/sessions/{id}` | mock-only | src/mock/routes/platform.ts:597 |
| POST `/api/c2/sessions/{id}/tasks` | mock-only | src/mock/routes/platform.ts:609 |
| PUT `/api/config/tools` | mock-only | src/mock/routes/platform.ts:117 |
| GET `/api/conversations/{id}/results` | mock-only | src/mock/routes/chat.ts:119 |
| GET `/api/notifications` | mock-only | src/mock/routes/security.ts:100 |
| POST `/api/external-mcp` | mock-only | src/mock/routes/platform.ts:417 |
| GET `/api/files` | mock-only | src/mock/routes/platform.ts:880 |
| POST `/api/files/upload` | mock-only | src/mock/routes/platform.ts:881 |
| GET `/api/hitl/default-reviewer` | mock-only | src/mock/routes/security.ts:684 |
| PUT `/api/hitl/default-reviewer` | mock-only | src/mock/routes/security.ts:685 |
| GET `/api/monitor/executions` | mock-only | src/mock/routes/security.ts:782 |
| GET `/api/events` | mock-only | src/mock/routes/platform.ts:887 |
| GET `/api/v1/status` | mock-only | src/mock/routes/platform.ts:163 |
| GET `/api/rbac/me` | mock-only | src/mock/routes/auth.ts:85 |
| GET `/api/rbac/metadata` | mock-only | src/mock/routes/auth.ts:91 |
| GET `/api/rbac/resource-assignments` | mock-only | src/mock/routes/auth.ts:172 |
| POST `/api/rbac/resource-assignments` | mock-only | src/mock/routes/auth.ts:176 |
| DELETE `/api/rbac/resource-assignments/{id}` | mock-only | src/mock/routes/auth.ts:185 |
| GET `/api/rbac/resources` | mock-only | src/mock/routes/auth.ts:163 |
| GET `/api/rbac/roles` | mock-only | src/mock/routes/auth.ts:102 |
| POST `/api/rbac/roles` | mock-only | src/mock/routes/auth.ts:106 |
| DELETE `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:123 |
| PUT `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:114 |
| GET `/api/rbac/users` | mock-only | src/mock/routes/auth.ts:132 |
| POST `/api/rbac/users` | mock-only | src/mock/routes/auth.ts:137 |
| DELETE `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:154 |
| PUT `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:146 |
| GET `/api/projects/{id}/fact-edges` | mock-only | src/mock/routes/security.ts:244 |
| GET `/api/info-collect` | mock-only | src/mock/routes/platform.ts:883 |
| GET `/api/robot-bindings` | mock-only | src/mock/routes/platform.ts:773 |
| DELETE `/api/robot-bindings/{id}` | mock-only | src/mock/routes/platform.ts:774 |
| POST `/api/robot/dingtalk` | mock-only | src/mock/routes/platform.ts:770 |
| POST `/api/robot/lark` | mock-only | src/mock/routes/platform.ts:771 |
| POST `/api/robot/test` | mock-only | src/mock/routes/platform.ts:769 |
| GET `/api/robot/wechat/status` | mock-only | src/mock/routes/platform.ts:765 |
| POST `/api/robot/wecom` | mock-only | src/mock/routes/platform.ts:772 |
| DELETE `/api/skills/{name}/stats` | mock-only | src/mock/routes/platform.ts:182 |
| POST `/api/terminal/run` | mock-only | src/mock/routes/platform.ts:671 |
| POST `/api/terminal/run/stream` | mock-only | src/mock/routes/platform.ts:676 |
| GET `/api/workflows/{id}` | mock-only | src/mock/routes/platform.ts:523 |

## Unresolved response definitions

The following operations have no resolved concrete frontend response type; their mock schema (if any) is separately documented. Operations returning untyped acknowledgements are intentionally retained.

| Operation | Classification | Evidence |
| --- | --- | --- |
| GET `/api/agent-loop/task-events` | shared | src/features/chat/replay/attach.ts:98; src/mock/routes/chat.ts:251 |
| POST `/api/eino-agent/stream` | shared | src/features/webshell/service.ts:257; src/api/clients/chat.ts:14; src/features/chat/client.ts:13; src/mock/routes/chat.ts:424 |
| POST `/api/multi-agent/stream` | shared | src/features/webshell/service.ts:257; src/api/clients/chat.ts:14; src/features/chat/client.ts:13; src/mock/routes/chat.ts:425 |
| POST `/api/roles` | shared | src/features/roles/service.ts:69; src/mock/routes/platform.ts:239 |
| DELETE `/api/roles/{name}` | shared | src/features/roles/service.ts:78; src/mock/routes/platform.ts:263 |
| GET `/api/roles/{name}` | mock-only | src/mock/routes/platform.ts:248 |
| PUT `/api/roles/{name}` | shared | src/features/roles/service.ts:69; src/mock/routes/platform.ts:254 |
| DELETE `/api/assets/{id}` | shared | src/features/assets/service.ts:131; src/api/clients/assets.ts:36; src/mock/routes/security.ts:473 |
| POST `/api/assets/batch-delete` | shared | src/features/assets/service.ts:134; src/mock/routes/security.ts:450 |
| PUT `/api/assets/bulk` | shared | src/features/assets/service.ts:133; src/mock/routes/security.ts:457 |
| POST `/api/assets/merge` | shared | src/features/assets/service.ts:135; src/mock/routes/security.ts:448 |
| PUT `/api/assets/project-binding` | shared | src/features/assets/service.ts:132; src/features/projects/client.ts:44; src/mock/routes/security.ts:464 |
| POST `/api/assets/scan-links` | shared | src/features/assets/service.ts:146; src/mock/routes/security.ts:449 |
| GET `/api/conversations/{id}/attack-chain` | mock-only | src/mock/routes/platform.ts:885 |
| DELETE `/api/audit/logs` | mock-only | src/mock/routes/security.ts:866 |
| GET `/api/audit/logs/export` | shared | src/features/audit/client.ts:20; src/mock/routes/security.ts:862 |
| GET `/api/audit/meta` | mock-only | src/mock/routes/security.ts:853 |
| DELETE `/api/auth/robot-bindings/{id}` | frontend-used | src/features/auth/service.ts:239 |
| DELETE `/api/batch-tasks/{queueId}` | shared | src/features/tasks/service.ts:69; src/mock/routes/security.ts:541 |
| PUT `/api/batch-tasks/{queueId}/metadata` | shared | src/features/tasks/service.ts:73; src/mock/routes/security.ts:603 |
| POST `/api/batch-tasks/{queueId}/pause` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:560 |
| POST `/api/batch-tasks/{queueId}/rerun` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:561 |
| PUT `/api/batch-tasks/{queueId}/schedule` | shared | src/features/tasks/service.ts:77; src/mock/routes/security.ts:611 |
| PUT `/api/batch-tasks/{queueId}/schedule-enabled` | shared | src/features/tasks/service.ts:81; src/mock/routes/security.ts:620 |
| POST `/api/batch-tasks/{queueId}/start` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:559 |
| POST `/api/batch-tasks/{queueId}/tasks` | shared | src/features/tasks/service.ts:85; src/mock/routes/security.ts:563 |
| DELETE `/api/batch-tasks/{queueId}/tasks/{taskId}` | shared | src/features/tasks/service.ts:87; src/mock/routes/security.ts:582 |
| PUT `/api/batch-tasks/{queueId}/tasks/{taskId}` | shared | src/features/tasks/service.ts:85; src/mock/routes/security.ts:572 |
| GET `/api/c2/events/stream` | frontend-used | src/platform/access-browser.ts:68 |
| POST `/api/c2/listeners` | shared | src/features/c2/service.ts:131; src/mock/routes/platform.ts:551 |
| DELETE `/api/c2/listeners/{id}` | shared | src/features/c2/service.ts:135; src/mock/routes/platform.ts:570 |
| GET `/api/c2/listeners/{id}` | mock-only | src/mock/routes/platform.ts:558 |
| PUT `/api/c2/listeners/{id}` | shared | src/features/c2/service.ts:131; src/mock/routes/platform.ts:562 |
| POST `/api/c2/listeners/{id}/start` | shared | src/features/c2/service.ts:135; src/mock/routes/platform.ts:575 |
| POST `/api/c2/listeners/{id}/stop` | shared | src/features/c2/service.ts:135; src/mock/routes/platform.ts:580 |
| GET `/api/c2/payloads/{id}/download` | shared | src/features/c2/service.ts:308; src/mock/routes/platform.ts:667 |
| POST `/api/c2/profiles` | shared | src/features/c2/service.ts:303; src/mock/routes/platform.ts:648 |
| DELETE `/api/c2/profiles/{id}` | shared | src/features/c2/service.ts:305; src/mock/routes/platform.ts:660 |
| PUT `/api/c2/profiles/{id}` | shared | src/features/c2/service.ts:303; src/mock/routes/platform.ts:654 |
| DELETE `/api/c2/sessions/{id}` | mock-only | src/mock/routes/platform.ts:597 |
| PUT `/api/c2/sessions/{id}/sleep` | shared | src/features/c2/service.ts:289; src/mock/routes/platform.ts:608 |
| POST `/api/c2/sessions/{id}/tasks` | mock-only | src/mock/routes/platform.ts:609 |
| POST `/api/c2/tasks/{id}/cancel` | shared | src/features/c2/service.ts:297; src/mock/routes/platform.ts:633 |
| POST `/api/config` | frontend-used | src/features/chat/client.ts:28 |
| PUT `/api/config` | shared | src/features/settings/client.ts:15; src/features/storage/service.ts:53; src/features/chat/session/model-picker.ts:369; src/mock/routes/platform.ts:86 |
| POST `/api/config/apply` | shared | src/features/settings/client.ts:16; src/features/chat/session/model-picker.ts:375; src/mock/routes/platform.ts:94 |
| PUT `/api/config/tools` | mock-only | src/mock/routes/platform.ts:117 |
| POST `/api/conversations/{id}/delete-turn` | shared | src/features/chat/conversation/delete.ts:30; src/features/chat/client.ts:20; src/mock/routes/chat.ts:107 |
| PUT `/api/conversations/{id}/pinned` | shared | src/features/chat/conversations/context.ts:288; src/api/clients/conversations.ts:20; src/mock/routes/chat.ts:91 |
| PUT `/api/conversations/{id}/project` | shared | src/features/projects/client.ts:46; src/features/webshell/service.ts:226; src/api/clients/conversations.ts:17; src/mock/routes/chat.ts:99 |
| GET `/api/conversations/{id}/results` | mock-only | src/mock/routes/chat.ts:119 |
| GET `/api/notifications` | mock-only | src/mock/routes/security.ts:100 |
| POST `/api/notifications/read` | shared | src/features/notifications/client.ts:13; src/mock/routes/security.ts:104 |
| POST `/api/external-mcp` | mock-only | src/mock/routes/platform.ts:417 |
| DELETE `/api/external-mcp/{name}` | shared | src/features/settings/client.ts:36; src/mock/routes/platform.ts:434 |
| GET `/api/external-mcp/{name}` | shared | src/features/settings/client.ts:34; src/mock/routes/platform.ts:411 |
| PUT `/api/external-mcp/{name}` | shared | src/features/settings/client.ts:35; src/mock/routes/platform.ts:426 |
| POST `/api/external-mcp/{name}/start` | shared | src/features/settings/client.ts:37; src/mock/routes/platform.ts:449 |
| POST `/api/external-mcp/{name}/stop` | shared | src/features/settings/client.ts:37; src/mock/routes/platform.ts:450 |
| POST `/api/chat-uploads` | shared | src/features/chat-files/service.ts:60; src/mock/routes/platform.ts:839 |
| GET `/api/files` | mock-only | src/mock/routes/platform.ts:880 |
| POST `/api/files/upload` | mock-only | src/mock/routes/platform.ts:881 |
| GET `/api/hitl/audit-strategy` | shared | src/features/hitl/service.ts:298; src/features/hitl/service.ts:325; src/mock/routes/security.ts:702 |
| PUT `/api/hitl/audit-strategy` | shared | src/features/hitl/service.ts:303; src/mock/routes/security.ts:703 |
| PUT `/api/hitl/config` | shared | src/features/hitl/service.ts:73; src/mock/routes/security.ts:688 |
| GET `/api/hitl/config/{conversationId}` | shared | src/features/hitl/service.ts:58; src/mock/routes/security.ts:675 |
| POST `/api/hitl/decision` | shared | src/features/hitl/service.ts:227; src/mock/routes/security.ts:733 |
| GET `/api/hitl/default-config` | shared | src/features/hitl/service.ts:46; src/mock/routes/security.ts:679 |
| PUT `/api/hitl/default-config` | shared | src/features/hitl/service.ts:50; src/mock/routes/security.ts:680 |
| GET `/api/hitl/default-reviewer` | mock-only | src/mock/routes/security.ts:684 |
| PUT `/api/hitl/default-reviewer` | mock-only | src/mock/routes/security.ts:685 |
| POST `/api/hitl/dismiss` | shared | src/features/hitl/service.ts:194; src/mock/routes/security.ts:737 |
| DELETE `/api/hitl/logs` | shared | src/features/hitl/service.ts:190; src/mock/routes/security.ts:656 |
| GET `/api/hitl/logs` | shared | src/features/hitl/service.ts:179; src/mock/routes/security.ts:648 |
| GET `/api/hitl/logs/{id}` | shared | src/features/hitl/service.ts:324; src/mock/routes/security.ts:652 |
| GET `/api/hitl/tool-whitelist` | shared | src/features/hitl/service.ts:115; src/mock/routes/security.ts:708 |
| POST `/api/hitl/tool-whitelist` | shared | src/features/hitl/service.ts:135; src/mock/routes/security.ts:712 |
| PUT `/api/hitl/tool-whitelist` | shared | src/features/hitl/service.ts:131; src/mock/routes/security.ts:709 |
| DELETE `/api/knowledge/items/{id}` | shared | src/features/knowledge/service.ts:86; src/mock/routes/platform.ts:336 |
| DELETE `/api/knowledge/retrieval-logs/{id}` | shared | src/features/knowledge/service.ts:117; src/mock/routes/platform.ts:373 |
| POST `/api/multi-agent/markdown-agents` | shared | src/features/agents/service.ts:37; src/mock/routes/platform.ts:285 |
| DELETE `/api/multi-agent/markdown-agents/{filename}` | shared | src/features/agents/service.ts:38; src/mock/routes/platform.ts:287 |
| PUT `/api/multi-agent/markdown-agents/{filename}` | shared | src/features/agents/service.ts:37; src/mock/routes/platform.ts:286 |
| POST `/api/mcp/executions/{id}/cancel` | frontend-used | src/features/chat/client.ts:32 |
| GET `/api/mcp/external` | frontend-used | src/features/chat/client.ts:30 |
| GET `/api/mcp/tools` | frontend-used | src/features/chat/client.ts:29 |
| DELETE `/api/monitor/execution/{id}` | shared | src/features/monitor/service.ts:42; src/mock/routes/security.ts:802 |
| GET `/api/monitor/executions` | mock-only | src/mock/routes/security.ts:782 |
| GET `/api/events` | mock-only | src/mock/routes/platform.ts:887 |
| GET `/api/v1/status` | mock-only | src/mock/routes/platform.ts:163 |
| GET `/api/rbac/me` | mock-only | src/mock/routes/auth.ts:85 |
| GET `/api/rbac/metadata` | mock-only | src/mock/routes/auth.ts:91 |
| GET `/api/rbac/resource-assignments` | mock-only | src/mock/routes/auth.ts:172 |
| POST `/api/rbac/resource-assignments` | mock-only | src/mock/routes/auth.ts:176 |
| DELETE `/api/rbac/resource-assignments/{id}` | mock-only | src/mock/routes/auth.ts:185 |
| GET `/api/rbac/resources` | mock-only | src/mock/routes/auth.ts:163 |
| GET `/api/rbac/roles` | mock-only | src/mock/routes/auth.ts:102 |
| POST `/api/rbac/roles` | mock-only | src/mock/routes/auth.ts:106 |
| DELETE `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:123 |
| PUT `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:114 |
| GET `/api/rbac/users` | mock-only | src/mock/routes/auth.ts:132 |
| POST `/api/rbac/users` | mock-only | src/mock/routes/auth.ts:137 |
| DELETE `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:154 |
| PUT `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:146 |
| GET `/api/projects/{id}/fact-edges` | mock-only | src/mock/routes/security.ts:244 |
| POST `/api/projects/{id}/fact-edges` | shared | src/features/projects/client.ts:41; src/mock/routes/security.ts:248 |
| DELETE `/api/projects/{id}/fact-edges/{edgeId}` | shared | src/features/projects/client.ts:42; src/mock/routes/security.ts:261 |
| DELETE `/api/projects/{id}/facts/{factId}` | shared | src/features/projects/client.ts:38; src/mock/routes/security.ts:227 |
| POST `/api/projects/{id}/facts/deprecate` | shared | src/features/projects/client.ts:39; src/mock/routes/security.ts:241 |
| POST `/api/projects/{id}/facts/restore` | shared | src/features/projects/client.ts:39; src/mock/routes/security.ts:242 |
| GET `/api/info-collect` | mock-only | src/mock/routes/platform.ts:883 |
| GET `/api/robot-bindings` | mock-only | src/mock/routes/platform.ts:773 |
| DELETE `/api/robot-bindings/{id}` | mock-only | src/mock/routes/platform.ts:774 |
| POST `/api/robot/dingtalk` | mock-only | src/mock/routes/platform.ts:770 |
| POST `/api/robot/lark` | mock-only | src/mock/routes/platform.ts:771 |
| POST `/api/robot/test` | mock-only | src/mock/routes/platform.ts:769 |
| GET `/api/robot/wechat/status` | mock-only | src/mock/routes/platform.ts:765 |
| POST `/api/robot/wecom` | mock-only | src/mock/routes/platform.ts:772 |
| POST `/api/skills` | shared | src/features/skills/service.ts:96; src/mock/routes/platform.ts:184 |
| PUT `/api/skills/{name}` | shared | src/features/skills/service.ts:100; src/mock/routes/platform.ts:199 |
| PUT `/api/skills/{name}/file` | shared | src/features/skills/service.ts:100; src/mock/routes/platform.ts:224 |
| DELETE `/api/skills/{name}/stats` | mock-only | src/mock/routes/platform.ts:182 |
| DELETE `/api/skills/stats` | shared | src/features/skills/service.ts:120; src/mock/routes/platform.ts:181 |
| POST `/api/storage/cleanup` | shared | src/features/storage/service.ts:48; src/mock/routes/platform.ts:738 |
| POST `/api/terminal/run` | mock-only | src/mock/routes/platform.ts:671 |
| POST `/api/terminal/run/stream` | mock-only | src/mock/routes/platform.ts:676 |
| PUT `/api/vulnerability-alerts/subscription` | shared | src/features/vulnerability/service.ts:45; src/mock/routes/security.ts:379 |
| POST `/api/webshell/connections` | shared | src/features/webshell/service.ts:121; src/mock/routes/platform.ts:691 |
| DELETE `/api/webshell/connections/{id}` | shared | src/features/webshell/service.ts:125; src/mock/routes/platform.ts:708 |
| PUT `/api/webshell/connections/{id}` | shared | src/features/webshell/service.ts:121; src/features/webshell/service.ts:156; src/mock/routes/platform.ts:700 |
| PUT `/api/webshell/connections/{id}/state` | shared | src/features/webshell/service.ts:87; src/mock/routes/platform.ts:714 |
| POST `/api/workflow-package-imports` | shared | src/features/workflows/package-client.ts:50; src/mock/routes/platform.ts:529 |
| GET `/api/workflow-package-imports/{importId}` | shared | src/features/workflows/package-client.ts:52; src/mock/routes/platform.ts:530 |
| POST `/api/workflow-package-inspections` | shared | src/features/workflows/package-client.ts:45; src/mock/routes/platform.ts:527 |
| GET `/api/workflow-package-inspections/{inspectionId}` | shared | src/features/workflows/package-client.ts:47; src/mock/routes/platform.ts:528 |
| DELETE `/api/workflows/{id}` | shared | src/features/workflows/service.ts:48; src/mock/routes/platform.ts:491 |
| GET `/api/workflows/{id}` | mock-only | src/mock/routes/platform.ts:523 |
| GET `/api/workflows/{id}/package` | shared | src/features/workflows/service.ts:67; src/mock/routes/platform.ts:522 |
| GET `/api/workflows/runs/{runId}/replay` | shared | src/features/workflows/service.ts:87; src/mock/routes/platform.ts:510 |
| POST `/api/workflows/validate` | shared | src/features/workflows/service.ts:42; src/mock/routes/platform.ts:497 |

## Missing or ignored body definitions

A write without a resolved frontend body may intentionally send no body. This list does not claim all of these need JSON. Mock-only writes without a decoder are genuinely UNKNOWN/ignored, not confirmed empty-object contracts.

| Operation | Classification | Evidence |
| --- | --- | --- |
| DELETE `/api/roles/{name}` | shared | src/features/roles/service.ts:78; src/mock/routes/platform.ts:263 |
| DELETE `/api/assets/{id}` | shared | src/features/assets/service.ts:131; src/api/clients/assets.ts:36; src/mock/routes/security.ts:473 |
| POST `/api/attack-chain/{conversationId}/regenerate` | shared | src/features/chat/attack-chain/flow.ts:147; src/features/chat/client.ts:38; src/mock/routes/chat.ts:179 |
| DELETE `/api/audit/logs` | mock-only | src/mock/routes/security.ts:866 |
| POST `/api/auth/logout` | shared | src/features/auth/service.ts:226; src/api/clients/auth.ts:13; src/mock/routes/auth.ts:62 |
| POST `/api/auth/robot-binding-code` | shared | src/features/auth/service.ts:232; src/mock/routes/auth.ts:79 |
| DELETE `/api/auth/robot-bindings/{id}` | frontend-used | src/features/auth/service.ts:239 |
| DELETE `/api/batch-tasks/{queueId}` | shared | src/features/tasks/service.ts:69; src/mock/routes/security.ts:541 |
| POST `/api/batch-tasks/{queueId}/pause` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:560 |
| POST `/api/batch-tasks/{queueId}/rerun` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:561 |
| POST `/api/batch-tasks/{queueId}/start` | shared | src/features/tasks/service.ts:68; src/mock/routes/security.ts:559 |
| DELETE `/api/batch-tasks/{queueId}/tasks/{taskId}` | shared | src/features/tasks/service.ts:87; src/mock/routes/security.ts:582 |
| POST `/api/batch-tasks/{queueId}/tasks/{taskId}/run` | shared | src/features/tasks/service.ts:89; src/mock/routes/security.ts:590 |
| DELETE `/api/c2/sessions/{id}` | mock-only | src/mock/routes/platform.ts:597 |
| POST `/api/c2/sessions/{id}/tasks` | mock-only | src/mock/routes/platform.ts:609 |
| POST `/api/config/apply` | shared | src/features/settings/client.ts:16; src/features/chat/session/model-picker.ts:375; src/mock/routes/platform.ts:94 |
| PUT `/api/config/tools` | mock-only | src/mock/routes/platform.ts:117 |
| DELETE `/api/conversations/{id}` | shared | src/features/webshell/service.ts:318; src/features/chat/conversation/delete.ts:53; src/api/clients/conversations.ts:13; src/mock/routes/chat.ts:82 |
| POST `/api/external-mcp` | mock-only | src/mock/routes/platform.ts:417 |
| DELETE `/api/external-mcp/{name}` | shared | src/features/settings/client.ts:36; src/mock/routes/platform.ts:434 |
| POST `/api/external-mcp/{name}/start` | shared | src/features/settings/client.ts:37; src/mock/routes/platform.ts:449 |
| POST `/api/external-mcp/{name}/stop` | shared | src/features/settings/client.ts:37; src/mock/routes/platform.ts:450 |
| POST `/api/files/upload` | mock-only | src/mock/routes/platform.ts:881 |
| PUT `/api/hitl/default-reviewer` | mock-only | src/mock/routes/security.ts:685 |
| POST `/api/knowledge/index` | shared | src/features/knowledge/service.ts:90; src/mock/routes/platform.ts:354 |
| DELETE `/api/knowledge/items/{id}` | shared | src/features/knowledge/service.ts:86; src/mock/routes/platform.ts:336 |
| DELETE `/api/knowledge/retrieval-logs/{id}` | shared | src/features/knowledge/service.ts:117; src/mock/routes/platform.ts:373 |
| POST `/api/knowledge/scan` | shared | src/features/knowledge/service.ts:87; src/mock/routes/platform.ts:360 |
| DELETE `/api/multi-agent/markdown-agents/{filename}` | shared | src/features/agents/service.ts:38; src/mock/routes/platform.ts:287 |
| DELETE `/api/monitor/execution/{id}` | shared | src/features/monitor/service.ts:42; src/mock/routes/security.ts:802 |
| POST `/api/rbac/resource-assignments` | mock-only | src/mock/routes/auth.ts:176 |
| DELETE `/api/rbac/resource-assignments/{id}` | mock-only | src/mock/routes/auth.ts:185 |
| POST `/api/rbac/roles` | mock-only | src/mock/routes/auth.ts:106 |
| DELETE `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:123 |
| PUT `/api/rbac/roles/{id}` | mock-only | src/mock/routes/auth.ts:114 |
| POST `/api/rbac/users` | mock-only | src/mock/routes/auth.ts:137 |
| DELETE `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:154 |
| PUT `/api/rbac/users/{id}` | mock-only | src/mock/routes/auth.ts:146 |
| DELETE `/api/projects/{id}` | shared | src/features/projects/client.ts:28; src/api/clients/projects.ts:15; src/mock/routes/security.ts:156 |
| DELETE `/api/projects/{id}/fact-edges/{edgeId}` | shared | src/features/projects/client.ts:42; src/mock/routes/security.ts:261 |
| DELETE `/api/projects/{id}/facts/{factId}` | shared | src/features/projects/client.ts:38; src/mock/routes/security.ts:227 |
| POST `/api/projects/{id}/promote-attack-chain/{conversationId}` | shared | src/features/projects/client.ts:47; src/mock/routes/security.ts:279 |
| DELETE `/api/robot-bindings/{id}` | mock-only | src/mock/routes/platform.ts:774 |
| POST `/api/robot/dingtalk` | mock-only | src/mock/routes/platform.ts:770 |
| POST `/api/robot/lark` | mock-only | src/mock/routes/platform.ts:771 |
| POST `/api/robot/test` | mock-only | src/mock/routes/platform.ts:769 |
| POST `/api/robot/wecom` | mock-only | src/mock/routes/platform.ts:772 |
| DELETE `/api/skills/{name}` | shared | src/features/skills/service.ts:112; src/mock/routes/platform.ts:208 |
| DELETE `/api/skills/{name}/stats` | mock-only | src/mock/routes/platform.ts:182 |
| DELETE `/api/skills/stats` | shared | src/features/skills/service.ts:120; src/mock/routes/platform.ts:181 |
| POST `/api/system/update/check` | shared | src/features/update/service.ts:140; src/features/update/types.ts:32; src/mock/routes/platform.ts:744 |
| POST `/api/system/update/restart` | shared | src/features/update/service.ts:171; src/features/update/types.ts:32; src/mock/routes/platform.ts:746 |
| POST `/api/system/update/rollback` | shared | src/features/update/service.ts:180; src/features/update/types.ts:32; src/mock/routes/platform.ts:747 |
| POST `/api/terminal/run` | mock-only | src/mock/routes/platform.ts:671 |
| POST `/api/terminal/run/stream` | mock-only | src/mock/routes/platform.ts:676 |
| DELETE `/api/vulnerabilities/{id}` | shared | src/features/vulnerability/service.ts:40; src/api/clients/vulnerabilities.ts:25; src/mock/routes/security.ts:357 |
| DELETE `/api/vulnerabilities/batch` | shared | src/features/vulnerability/service.ts:41; src/mock/routes/security.ts:334 |
| DELETE `/api/webshell/connections/{id}` | shared | src/features/webshell/service.ts:125; src/mock/routes/platform.ts:708 |
| DELETE `/api/workflows/{id}` | shared | src/features/workflows/service.ts:48; src/mock/routes/platform.ts:491 |

## Legacy, duplicate and dynamic dependencies

- Alternate /api/mcp/* versus /api/monitor/*; /api/ai/models versus /api/config/list-models; POST /api/config versus PUT /api/config; JSON agent methods versus streaming methods; these are distinct method/path operations, not safe renames.
- Shared src/api/clients assets/projects/vulnerabilities/chat/auth factories have no non-test imports found outside their modules in this snapshot. Their request definitions remain included; actual UI often uses feature-owned services. src/features/chat/client.ts does import the shared conversations client. Do not classify the entire typed client library as runtime-reachable UI or delete it based on this report.
- API Docs dynamically invokes a selected specification path/method with user-entered fields (src/features/api-docs/index.ts); arbitrary external specification operations cannot be enumerated statically. The mock OpenAPI response lists registered mock routes only and omits body/response contracts; it is not this extracted specification.
- C2 profile URI /api/v1/status is configuration/example content, not an extra call site. Legacy strings in comments are not evidence of reachable operations. Generic transport prefix /api/ is not an endpoint.
- No compatibility-only endpoint caller was confirmed; legacy count 0. Fourteen RBAC endpoints still exist in mock source despite removal of their page.

## Reconciliation details

- Unmatched previous HTTP rows: 0.
- Runtime mock registrations omitted: 0 (asserted by generator).
- Added since the previous catalog: GET /api/batch-tasks/runs; GET /api/workflows/runs.
- Excluded static-analysis artifacts (conditional combinations/query delimiter branches), with source evidence:

```json
[
  {
    "key": "POST /api/c2/listeners/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:131",
      "src/features/c2/service.ts:135"
    ]
  },
  {
    "key": "PUT /api/c2/listeners",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:131"
    ]
  },
  {
    "key": "DELETE /api/c2/listeners/{}/start",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:135"
    ]
  },
  {
    "key": "DELETE /api/c2/listeners/{}/stop",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:135"
    ]
  },
  {
    "key": "GET /api/c2/files/upload",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:198"
    ]
  },
  {
    "key": "POST /api/c2/profiles/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:303"
    ]
  },
  {
    "key": "PUT /api/c2/profiles",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/c2/service.ts:303"
    ]
  },
  {
    "key": "GET /api/webshell/connections&project_id={}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/dashboard/client.ts:32"
    ]
  },
  {
    "key": "GET /api/c2/listeners&project_id={}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/dashboard/client.ts:33"
    ]
  },
  {
    "key": "POST /api/knowledge/items/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/knowledge/service.ts:83"
    ]
  },
  {
    "key": "PUT /api/knowledge/items",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/knowledge/service.ts:83"
    ]
  },
  {
    "key": "POST /api/roles/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/roles/service.ts:69"
    ]
  },
  {
    "key": "PUT /api/roles",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/roles/service.ts:69"
    ]
  },
  {
    "key": "POST /api/workflows/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/workflows/service.ts:44"
    ]
  },
  {
    "key": "PUT /api/workflows",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/workflows/service.ts:44"
    ]
  },
  {
    "key": "POST /api/batch-tasks/{}/tasks/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/tasks/service.ts:85"
    ]
  },
  {
    "key": "PUT /api/batch-tasks/{}/tasks",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/tasks/service.ts:85"
    ]
  },
  {
    "key": "POST /api/webshell/connections/{}",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/webshell/service.ts:121"
    ]
  },
  {
    "key": "PUT /api/webshell/connections",
    "reason": "conditional method/path correlation or query delimiter; not a real operation",
    "sources": [
      "src/features/webshell/service.ts:121"
    ]
  }
]
```

## Validation record

Generation ran local TypeScript AST/type analysis and instantiated only fresh in-memory mocks without browser startup/interception. Generated schemas must be checked as JSON Schema 2020-12; OpenAPI structure and reference/example validation results are recorded after execution below. No frontend–backend compatibility check, real terminal session, upload, bot message, security action or deployment occurred.

The deliverables retain UNKNOWN fields/statuses instead of inventing backend contracts. All operations require future comparison against the real Raptix backend, including those with complete mock definitions.

### Executed final validation

Validation used the existing Python PyYAML 6.0.3 and `jsonschema` installation;
no packages or application dependencies were installed. OpenAPI was checked
against the official schema at
<https://spec.openapis.org/oas/3.1/schema/2025-09-15>, loaded in memory.

| Check | Actual result |
| --- | --- |
| YAML/JSON parsing | Passed; `openapi.yaml` uses the JSON subset of YAML 1.2 |
| Official OpenAPI 3.1 structural schema | Passed, zero errors |
| Component JSON Schema 2020-12 syntax | 1,061 checked, zero errors |
| Internal schema references | 2,960 resolved, zero dangling references |
| Method/path and operation ID uniqueness | Passed |
| Path-template parameters and duplicate parameters | Passed |
| Catalog versus OpenAPI operation set | Exact equality: 300 operations |
| Actual mock registry reconciliation | All 287 registrations accounted for; zero duplicates or omissions |
| Prior inventory reconciliation | All 298 prior HTTP rows accounted for; two run-list operations added; WebSocket counted separately |
| Request examples versus their extracted schemas | 118 checked, zero failures |
| Response examples versus their extracted schemas | 278 checked, zero failures |
| Supported JSON Schema format checks on examples | Enabled with `FormatChecker`; zero failures |
| Historical-only query-name references | Zero remain; all names have current-source corroboration, with evidence strength labeled |
| Entry HTML and public asset API-call search | No additional operations; matches were existing login documentation, comments, provider configuration URLs and finding-title examples |

The 278 response examples include **254 successful isolated mock JSON results**
and **24 type-derived success-shape illustrations**, explicitly labeled as
illustrations rather than successful mock requests. Raw download examples and
SSE examples are documented separately and are not included in that JSON count.
Structural validity does not establish semantic/domain validity, mock persistence,
or behavior against a real backend.

Of the 255 frontend-defined HTTP operations, **160 have at least one resolved
frontend response view** and **95 do not**. Together with the 45 mock-only
operations, this produces the 140 rows in the unresolved-frontend-response list.
The 160 count does not mean fully closed schemas: open records, extensible
configuration, dynamic tool arguments, unknown event data and unrepresentable
types remain explicitly annotated inside the components. The mock success
schema count of 287 includes streaming responses and empty-array placeholders;
it is not a count of complete production contracts.

Frontend tests/builds were not rerun for this documentation-only extraction.
No live backend, browser network session, real stream or remote terminal was
used. Runtime mock examples were created in isolated memory without installing
browser interception or persisting state.
