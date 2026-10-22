/**
 * Legacy deep-link aliases (page-details proposal §1, MVP 2026-10-22).
 *
 * A legacy address keeps working after its screen moved: `RouteHost` replaces
 * it once with the canonical route, keeping `id`, `tab`, `engagementId` and
 * every other field, so the history never holds two addresses for one screen.
 * Only deep links are rewritten here; screens never branch on alias names.
 */
import { DATA_MODE, type DataMode } from '../state/mode'
import type { Route } from './history'

/** Page keys that now render another page. `command-center` rendered the same System Overview as `overview`. */
export const PAGE_ALIASES: Readonly<Record<string, string>> = { 'command-center': 'overview' }

/** Project tab ids old links may carry in both modes; each mode owns its own ids on top of these. */
const SHARED_TAB_ALIASES: Readonly<Record<string, string>> = {
  closure: 'close',
  closeout: 'close',
  members: 'team',
  approvals: 'team',
  'audit-log': 'audit',
  roe: 'scope',
}

/** Mock project tabs (`plans`, `sessions`) — the real screen's `planning` and `c2` map onto them. */
const MOCK_TAB_ALIASES: Readonly<Record<string, string>> = {
  ...SHARED_TAB_ALIASES,
  'ai-plans': 'plans',
  planning: 'plans',
  c2: 'sessions',
}

/** Real engagement tabs (`planning`, `c2`) — the mock screen's `plans` and `sessions` map onto them. */
const REAL_TAB_ALIASES: Readonly<Record<string, string>> = {
  ...SHARED_TAB_ALIASES,
  'ai-plans': 'planning',
  plans: 'planning',
  sessions: 'c2',
}

/** The project tab id a `?tab=` value resolves to in one mode; unknown ids pass through for the screen's own fallback. */
export function resolveProjectTab(tab: string, mode: DataMode = DATA_MODE): string {
  const table = mode === 'real' ? REAL_TAB_ALIASES : MOCK_TAB_ALIASES
  return table[tab] ?? tab
}

/** The route a URL should resolve to: the same object when it is already canonical, a new one when an alias applies. */
export function canonicalRoute(route: Route, mode: DataMode = DATA_MODE): Route {
  const page = PAGE_ALIASES[route.page]
  if (page) return { ...route, page }
  if (route.page === 'project' && route.tab) {
    const tab = resolveProjectTab(route.tab, mode)
    if (tab !== route.tab) return { ...route, tab }
  }
  return route
}
