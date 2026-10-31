# Dashboard migration

Migrated from `src/legacy/scripts/dashboard.js` using `docs/ui-typescript-migration.md`.
The classic dashboard source is deleted. The domain uses strict TypeScript + DOM and
the existing CyberStrike Go API/mock, CSS selectors, IDs, SVG geometry, and translations.

## Installation and compatibility

```ts
import { installDashboardBridge } from './legacy/dashboard-bridge';

const dashboard = installDashboardBridge(); // shell mounted; before runClassicScripts
// The legacy router invokes refreshDashboard on dashboard entry.
// Teardown, when supported by the application:
dashboard.dispose();
```

The returned handle provides `refresh(): Promise<void>`, `syncAccessTabs(): void`,
`startAutoRefresh(): void`, `stopAutoRefresh(): void`, and `dispose(): void`.
Module consumers can use `initDashboard(document, dependencies)` from `index.ts` instead.
Its typed dependency interface supplies translation/application, navigation, active
project, locale/C2 configuration, token/notification entry points, and project/fact actions.
Only the legacy bridge resolves these callbacks from globals, lazily, so installation
before the classic scripts is safe.

Retained globals, confirmed by cross-file reference search:

| Name | Consumers |
| --- | --- |
| `refreshDashboard` | router, project switcher, C2 |
| `syncDashboardAccessTabs` | settings |
| `esc` | audit and HITL HTML/pagination |
| `formatTokenUsageCompact` | token-usage trend-axis labels |

Removed global requirements include `dashboardState`, all poll/chart/tooltip state and
constants; `startDashboardAutoRefresh`, `stopDashboardAutoRefresh`, `checkDashboardStale`;
`switchDashboardFeedTab`, `switchDashboardAccessTab`; `navigateToVulnerabilitiesWithFilter`,
`navigateToSeverityWithDashboardStatus`, `openDashboardSeverityVulnerabilities`;
`getDashboardSeverityStatusFilter`, `updateDashboardSeverityStatusFilter`,
`selectDashboardSeverityStatusFilter`, `toggleDashboardSeverityStatusFilterMenu`,
`closeDashboardSeverityStatusFilterMenu`, `syncDashboardSeverityStatusFilterUI`;
`openProjectFactFromDashboard`; and every dashboard rendering/helper function other than
the two retained formatting helpers above. Rendering functions are module-private.
The dashboard no longer calls the legacy `tokenUsageCacheRate` helper.

The frozen `src/legacy/shell.html` still contains the original source-inline dashboard
attributes. At initialization `view.ts` replaces **only** handlers in its explicit known
map inside `#page-dashboard`, removing their click/keydown attributes and assigning data
actions. A root click/keyboard listener handles these and generated content. Runtime
checks confirm zero inline click/keydown/change handlers in the dashboard. Shared shell
handlers outside that root (for example the logo's dashboard navigation) belong to the
shared-shell baseline. Generated dashboard HTML contains no inline event handlers.

## Responsibilities

- `types.ts`: dashboard read projections with Go JSON field names and dependency contracts.
- `client.ts`: typed HTTP boundary; 23 requests normally, 24 with a severity-status filter;
  independent failures produce null for that source.
- `service.ts`: request abort/sequence protection, captured project/locale scope, persisted
  status and tabs, batch/open-risk/resolution/tool metrics, event priority, session alert
  fingerprints and strict-subset dismissal rule, visibility polling/staleness, disposal.
- `view.ts`: shell binding, KPIs, status/risk presentation, access tabs and scoped entries,
  filter menu, navigation and observer wiring.
- `feeds.ts`: recent vulnerabilities/facts/events, empty/loading/error states and fact actions.
- `alerts.ts`: translated alert, MCP health and priority recommendations.
- `charts.ts`: original donut dimensions/gradients/leader placement, count-up and reduced
  motion, theme observation, hover/keyboard navigation, delayed/clamped tooltips, top-30 bars.
- `dom.ts`: DOM/format/translation helpers. The browser primitive adapter is
  `src/platform/dashboard-browser.ts`; storage and HTTP use the existing platform adapters.

Project scoping intentionally matches the original: only WebShell, the three C2 queries,
and seven-day token usage receive `project_id`. Project facts remain cross-project.
An aborted/superseded refresh cannot publish even when a transport ignores abort. Hidden
or inactive dashboards skip poll requests; returning after 30 seconds refreshes immediately;
60-second polling and 30-second stale checks are idempotent. Five-minute stale detection
and refresh-without-loading-flash are retained. Disposal cancels requests, timers, DOM
listeners, theme observers, animation frames, delayed actions and tooltip elements.

## Verification

Public seams: service commands observed through its published model/render notifications,
and the HTTP client against a fake transport returning Go-shaped JSON. No private-method
tests. Browser checks exercise the installed bridge and real demo production build.

```powershell
npm run typecheck
npx eslint src/features/dashboard src/legacy/dashboard-bridge.ts src/platform/dashboard-browser.ts
npm run test -- src/features/dashboard/service.test.ts src/features/dashboard/client.test.ts
npm run build:demo
npx playwright test --config src/features/dashboard/playwright.config.ts
```

To avoid concurrent agents rebuilding `dist-demo`, build to an isolated directory and set
`DASHBOARD_BUILD_DIR` to that directory before running the same Playwright command.
Playwright artifacts use the OS temporary directory under `opencode/dashboard-e2e-results`.

Migration checks (2026-10-28): 13 targeted tests passed; full Vitest suite at that point
passed 82 tests in 10 files. Typecheck and domain lint passed. Four browser tests passed and cover shell
handler removal, tooltips, keyboard/filter navigation, feed/access tabs, fact deep links,
alert dismissal, persistence, outside/Escape menu dismissal, language/theme rendering and
the remaining token-usage/audit/HITL compatibility consumers. Production and demo bundles built successfully.
An interim unrelated `src/mock/routes/chat.ts` type error was resolved by its owning agent
before the legacy dashboard was deleted.
