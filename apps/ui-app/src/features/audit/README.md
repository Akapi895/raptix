# Audit and token usage migration

The original `audit.js`, `audit-datetime-picker.js`, and `token-usage.js` are fully
ported and removed. The feature views retain the shell's CSS classes and IDs.
Static inline handlers are converted once at mount; generated controls use
explicit data actions and listeners. No classic source is loaded by these modules.

## Integration owner hooks

`src/legacy/analytics-bridge.ts` exports `installAnalyticsBridge()`:

1. Install after shell insertion and **before** `runClassicScripts(appScripts())`.
2. Remove `token-usage`, `audit-datetime-picker`, and `audit` from `legacyOrder`.
3. Call `analytics.afterClassicScripts()` immediately after classic execution.
4. Register `analytics.dispose()` with the entry's cleanup stack.

The installer publishes compatibility hooks immediately, but queues startup calls
until activation. Async hooks preserve promises; disposal settles queued calls,
aborts active list/detail/token requests, removes listeners, closes the owned
modal/popover, and restores owned global descriptors when no later owner replaced
them. Mounting and activation are idempotent.

Settings uses `initAuditLogsSection`, `refreshTokenUsage`, and
`stopTokenUsageRequests`. Router uses the token refresh/stop hooks. Dashboard uses
`openDashboardTokenUsage`. RBAC uses `formatAuditTime` and wraps the audit export
hooks; delegated export actions also call `requirePermission('audit:read')`.
`tokenUsageCount`, `tokenUsageCacheRate`, `tokenUsageMetrics`, and
`tokenUsageTimeline` remain available for compatibility. Audit paging, filters,
detail/resource links, presets, export, and `AuditDatetimePicker` hooks are also
provided by the bridge.

## Dependencies and contracts

- Feature clients use `platform/http`; auth, 401/403 events, base URL, and the demo
  transport stay shared. Views do not perform network requests.
- Audit page size uses `platform/storage` and the existing
  `raptix_audit_page_size` key (10/20/50/100).
- The bridge resolves translation/locale, project scope, navigation/settings,
  conversation loading, toast, permission, modal/deferred-content, and pagination
  helpers lazily from their existing owners.
- `platform/analytics-browser.ts` supplies viewport, hash navigation and blob
  downloads. Token charts import `formatTokenUsageCompact` through the dashboard
  public entry. There are no new package dependencies.
- Audit filters use browser-local minutes, converted to UTC RFC3339 at the client
  boundary. The picker keeps local calendar/time values. Token timeline gaps are
  filled only between server-returned day keys, never to browser-local endpoints.
- Go audit detail `{ log }` and demo bare-record responses are both accepted.
  Go `page_size` and demo `pageSize` are represented without altering the shared
  API/mock. Missing demo summary failure/recent counters retain zero defaults.
- The existing demo export endpoint returns JSON even for `format=csv`; this port
  preserves the response bytes and requested filename, as the old UI did.

## Scoped verification

From `ui-app`:

```text
npx tsc --noEmit -p src/features/audit/tsconfig.json
npx eslint src/features/audit src/features/token-usage src/legacy/analytics-bridge.ts src/platform/analytics-browser.ts
npx vitest run src/features/audit/service.test.ts src/features/token-usage/service.test.ts
```

The feature tsconfig inherits strict/noUncheckedIndexedAccess from the application
and includes both domains, the bridge, adapter, and their imported dependencies.
Public service/client tests cover filters, storage/page bounds, stale responses,
abort/disposal, exports, authenticated permissions/expiry, Go/demo detail shapes,
resource destinations, local dates/presets/calendar grids, project scope, periods,
metrics, and server-day chart gaps. Shared builds and live browser smoke checks
belong to the main integration owner.
