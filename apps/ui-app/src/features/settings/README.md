# Settings — step 10

Real TypeScript source port of the complete 4,924-line `legacy/scripts/settings.js`.
`contracts.ts` is the pre-existing contract; it is retained. No classic source is
loaded, evaluated, embedded or used as a facade by this feature.

## Integration hooks

The integration owner must wire `legacy/settings-bridge.ts` into the application:

```ts
import { installSettingsBridge } from './legacy/settings-bridge';

// After shell mount and before runClassicScripts. Use the application's
// installed(...) helper so failed startup and hot reload both dispose it.
const settings = installed(installSettingsBridge());

// After runClassicScripts, with the other feature after-hooks:
settings.afterClassicScripts();
```

Remove `settings` from `legacy/order.ts`'s `legacyOrder` when integrating: its source
has been deleted. Otherwise the existing loader intentionally throws
`Missing legacy script: settings`. This change does not edit main, order, shared
configuration, package metadata, API, mocks, shared e2e or migration status.

Both `afterClassicScripts()` and `dispose()` are idempotent. Public helpers exist
immediately after installation. Activation binds events without issuing eager
settings requests; router/auth retain control of page loading. Disposal cancels
list/config requests, delayed section work, MCP interval/bounded polls and probe
continuations, removes listeners, closes owned modals, restores native selects,
removes floating menus, and restores bridge globals if nobody else replaced them.

## Ownership

- `model.ts`: public Go configuration/channel/tool/MCP shapes and decoders,
  normalization, stable tool identity, and stdio/HTTP/SSE JSON validation.
- `client.ts`: configuration GET/PUT/apply, tool pages/schema, model listing and
  connection tests, password change and MCP endpoints. Handles Go model-list
  responses and the demo's `{ models }` response.
- `service.ts`: configuration, channels/default/selection/probe results,
  bounded two-worker probes, tools/dirty edits/baselines/pins/page size/filters,
  robot auth drafts, MCP editor/list state, persistence and cancellation.
- `forms.ts`: complete original field inventory, including AI reasoning/token
  limits, vision, four discovery providers, HITL/TypeSafe, agent/MCP resilience,
  multi-agent/failover/context budgets, knowledge embedding/retrieval/rerank/
  indexing and all eight robots. Existing opaque fields and masked secrets are
  retained when updating sections. Numeric zero and documented `-1` resilience
  values survive round trips.
- `selects.ts`: shared floating custom selects/pagination and model dropdowns,
  keyboard controls, disabled state, viewport placement and cleanup.
- `view.ts`: DOM rendering only. It performs no requests.
- `controller.ts`: explicit UI actions, section lifecycle, forms/validation,
  lazy child-feature hooks, tool details/filtering, password and MCP workflows.
- `actions.ts`: exact audited shell-attribute-to-data-action bindings; no event
  source parsing or execution. Dynamic markup is generated with data actions.
- `platform/settings-browser.ts`: viewport/events, settings hash replacement,
  and the legacy dashboard's `__c2Enabled` flag/restoration.

## Lazy dependencies

The bridge resolves these at invocation time, so their hubs can install later:

- Transport, translation, permissions: `apiFetch` (platform HTTP fallback), `t`
  (runtime i18n fallback), `requirePermission`, `notifyApiError`.
- Routing: `switchPage`, `switchSettingsSection`. Static settings navigation
  goes through the current global section hook so the router's later
  hash-persistence wrapper remains effective.
- Section entry/exit: `refreshTokenUsage`, `stopTokenUsageRequests`,
  `loadVulnerabilityAlertSubscription`, `initTerminal`, `initAuditLogsSection`,
  `initStorageSection`, `loadUpdateConsole`, `stopUpdatePolling`.
- Dashboard/chat/robot/auth: `syncDashboardAccessTabs`,
  `refreshChatConfig`, `populateChatAIChannelSelect`,
  `refreshMentionTools`, `refreshWechatRobotBoundUI`, `handleUnauthorized`.
- Monitor detail close: `closeMCPDetail`.

Child-feature actions such as audit/config downloads, update streams, robot
binding and skills/roles continue through their existing
owners. Settings does not replace or evaluate their handlers. MCP SSE transport
configuration is supported; `settings.js` did not own an EventSource stream.

## Compatibility globals

The actual complete list is the `globals` object in `legacy/settings-bridge.ts`.
Important cross-feature contracts include:

- `initSettingsCustomSelects(root?)`, `initPaginationSelects(root)`,
  `enhanceSettingsSelect(select)`, `syncSettingsCustomSelect(select)`,
  `refreshSettingsCustomSelects()`, `closeAllSettingsCustomSelects()`,
  `openSettingsCustomSelect(select)`, `closeSettingsCustomSelect(select)`.
- `loadConfig(loadTools = true, { silent? })`, `openSettings`, `closeSettings`,
  `switchSettingsSection`, `applySettings`, `syncC2NavOnceFromServer`,
  `syncC2NavFromConfig`, `refreshRobotManager`, `syncHitlAuditBackendUI`.
- `loadToolsList(page, keyword, { refreshExternal? })`, filtering/search,
  selection/pinning/statistics/page-size helpers and `saveToolsConfig`.
- AI channel create/copy/select/save/default/delete/bulk probe/bulk delete,
  model listing and main/vision/audit connection test helpers.
- MCP list/render/editor/save/start/stop/delete/polling helpers, including
  `startExternalMcpPoll` and `stopExternalMcpPoll` for router lifecycle.
- Robot editor/auth/modal helpers and password validation/change helpers.

State such as `currentConfig`, `toolsPagination`, tool maps and probe maps is
service-owned. The old router's guarded lexical `toolsPagination` preparation
becomes inert; each list request now reads `toolsPageSize` storage directly.
No new ambient declarations or custom browser globals are needed by features.

## Scoped verification

```sh
npx tsc --project src/features/settings/tsconfig.json
npx eslint src/features/settings src/legacy/settings-bridge.ts src/platform/settings-browser.ts
npx vitest run src/features/settings/service.test.ts src/features/settings/browser.test.ts
```

The browser suite compiles only the bridge to memory (`write: false`), loads the
real shell/CSS in headless Chromium, and fulfills requests locally through
Playwright. It starts no server or listening port and does not write shared
builds or use shared e2e fixtures. It exercises late hubs/activation/disposal,
shared selects, static/dynamic handlers, config forms and preserved credentials,
robot drafts, channel CRUD/default/probes, all model scopes, cross-page tool
edits/filtering/schema, MCP JSON/CRUD/transport handling, passwords, permissions,
language refresh and C2 visibility. Public service tests cover persistence,
request sequencing/errors, dirty-state identity, canonical pins, concurrency,
abort races and bounded polling teardown.

Full application build/e2e and live Go server smoke checks belong to integration
after startup/order wiring; these scoped checks do not claim those gates.
