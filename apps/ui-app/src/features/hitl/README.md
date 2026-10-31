# HITL TypeScript module

`index.ts` is the feature entry point. `service.ts` owns API calls, configuration,
list/cache/page/filter/selection state, migrations and run recovery. `view.ts`
owns rendering, forms and delegated actions. The feature never reads `window`.
`../../legacy/hitl-bridge.ts` is the only compatibility boundary.

## Integration hooks (integrator-owned files)

The legacy `scripts/hitl.js` has been fully ported and deleted. Before starting
the application, the integrator must remove **`'hitl'`** from `legacyOrder` in
`src/legacy/order.ts` and install the bridge in `src/main.ts`:

```ts
import { installHitlBridge } from './legacy/hitl-bridge';

// After shell mounting and shared UI installation, before runClassicScripts:
const hitl = installHitlBridge();
runClassicScripts(appScripts());
// Invoke immediately after the classic runtime returns. Returns Promise<void>.
// Call before any startup code awaits the HITL default-readiness globals.
const hitlReady = hitl.afterClassicScripts();
sharedUi.afterClassicScripts();
await hitlReady;

// At application teardown / HMR disposal:
hitl.dispose();
```

Installation exposes compatibility functions and the shared readiness promise,
but does not fetch defaults, bind shell actions or subscribe to lifecycle events.
`afterClassicScripts()` is idempotent. It migrates only known HITL inline shell
handlers into explicit `data-action`, `data-change` and `data-keydown` attributes,
binds delegated actions, enhances log filters and fetches defaults. No inline
source is evaluated. Dynamic templates also use explicit data actions.

`dispose()` removes feature listeners, unwraps log-filter selects, invalidates
late renders and followers, resolves/cancels bridge sleeps, and restores globals
the bridge still owns. Later replacements by other owners survive disposal.
It does not remove listeners owned by chat's reviewer-toggle binder or the
settings pagination enhancer.

## Lazy dependencies supplied by the bridge

All callbacks resolve at call time; they may be defined by classic scripts after
bridge installation:

- Network: `apiFetch` (native `fetch` fallback).
- Translation/locale: `t`, `uiLocale`, `__locale` (navigator fallback).
- Context/navigation: `currentConversationId` (active conversation DOM fallback),
  `currentPage`, `switchPage`, `loadConversation`.
- Chat config UI/storage: `getHitlConfigForConversation`,
  `saveHitlConfigForConversation`, `applyHitlConfigToUI`,
  `readHitlConfigFromForm`, `updateHitlStatusUI`,
  `refreshHitlConfigByCurrentConversation`, `setHitlReviewerUI`,
  `bindHitlReviewerToggleListeners`.
- Run recovery: `attachRunningTaskEventStream`,
  `refreshLastAssistantProcessDetails`, `loadActiveTasks`.
- Workflow: `submitWorkflowHitlDecision`; when absent the service POSTs to
  `/api/workflows/runs/:encodedRunId/resume` with `{ approved, comment }`.
- Pagination: `initPaginationSelects`.
- Externally updated cache/engine fields: `csaiHitlGlobalToolWhitelist`,
  `csaiHitlAuditBackend`, `csaiHitlAuditModel`.
- Browser primitives: safe platform `storage`, dialogs, clock and cancellable
  sleep. No additional platform adapter is needed.

The bridge subscribes to window `hitl-interrupt` (refresh the active HITL panel)
and `pageshow` (deferred form/status reconciliation). The view subscribes to
document `languagechange`. Chat/monitor continue owning embedded approval panel
rendering, countdowns, reviewer controls, SSE and sidebar indicators; their
decision/config calls use the globals below.

## Exact globals installed

```text
saveHitlPageWhitelist
refreshHitlPageWhitelist
refreshHitlPending
refreshHitlLogs
refreshHitlActivePanel
renderHitlPageAuditEngine
renderHitlStrategyJevHint
switchHitlPageTab
switchHitlStrategyMode
resetHitlAuditStrategy
saveHitlAuditStrategy
refreshHitlAuditStrategy
openHitlLogModal
closeHitlLogModal
hitlLogsGoPage
hitlPendingGoPage
filterHitlLogs
filterHitlPending
batchDeleteHitlLogs
clearHitlLogs
selectAllHitlLogs
deselectAllHitlLogs
toggleHitlLogSelection
toggleHitlLogsSelectAll
onHitlLogsPageSizeChange
onHitlPendingPageSizeChange
submitHitlDecision
submitHitlDecisionWithPayload
submitWorkflowHitlDecisionFromPage
openHitlConversation
dismissHitlItem
followAgentRunAfterHitlDecision
syncHitlConfigToServerByCurrentConversation
saveHitlConversationConfig
mergeHitlGlobalToolWhitelist
fetchHitlDefaultConfig
putHitlDefaultConfig
syncHitlConfigFromServer
fetchHitlDefaultReviewer
putHitlDefaultReviewer
csaiHitlDefaultConfigReady
csaiHitlDefaultReviewerReady
```

Both readiness globals reference the same `Promise<void>`. Defaults/cache
publication additionally sets `csaiHitlDefaultConfig`,
`csaiHitlDefaultReviewer`, `csaiHitlGlobalToolWhitelist` (when loaded),
`csaiHitlAuditBackend` and `csaiHitlAuditModel` (when supplied).

## Scoped checks

Run from `ui-app`:

```powershell
npx eslint src/features/hitl src/legacy/hitl-bridge.ts
npx tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck src/features/hitl/index.ts src/features/hitl/service.test.ts src/features/hitl/browser.spec.ts src/features/hitl/playwright.config.ts src/legacy/hitl-bridge.ts
npx vitest run src/features/hitl/service.test.ts
npx playwright test --config src/features/hitl/playwright.config.ts
```

Browser tests generate a HITL-only bundle in memory and route the actual HITL
shell markup in Chromium; they start no server and use no shared build/preview
ports. Artifacts go to the pre-approved `Temp/opencode/hitl-browser-results`
directory. They cover deferred/lazy installation, static and dynamic handlers,
hostile IDs/context escaping, tool/workflow decisions, embedded globals, conflict
dismissal, audit detail/filters/selection/deletion, prompts, whitelist scope,
pagination persistence, translation/interrupt events, disposal and reinstall.

## Execution Approvals workspace

The `#hitl` page has three tabs: Requests, Policy, and History. Reviewer changes
use the existing chat configuration owner: a selected conversation is updated
on its own, while no selected conversation updates defaults for new chats.
The request/history lists cover accessible conversations, not just that reviewer
scope. Audit strategy and the tool whitelist are always global.

The whitelist selector preserves unknown tool names and loads registered tools
from `/api/config/tools`, including qualified external MCP names. Saving retains
the existing global replacement and conversation-tool migration behavior; this
consequence is explained beside the selector. Merely searching, selecting tools,
switching prompt modes, or switching tabs never saves a policy. Policy drafts
survive tab switches; Refresh explicitly reloads server values.

Demo endpoints now expose Go-shaped approval configuration, prompts, request
payloads, and audit history. Policy edits persist in local demo storage. Log
detail and filtered/selected deletion work without changing production APIs.
Missing historical conversation IDs remain absent rather than being fabricated.

`tests/e2e/approvals.spec.ts` exercises the production build with explicit Go DTO
fixtures at desktop, tablet, mobile, small-mobile, and dark-theme sizes. The live
HITL test in `migrated-modules.spec.ts` covers demo chat interruption, approval,
run continuation, and audit recording. These checks do not run a live Go backend.
