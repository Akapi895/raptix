/**
 * Legacy deep-link aliases (page-details proposal §1, MVP 2026-10-22).
 *
 * A legacy address keeps working after its screen moved: `RouteHost` replaces
 * it once with the canonical route, keeping `id`, `tab`, `engagementId` and
 * every other field, so the history never holds two addresses for one screen.
 * Only deep links are rewritten here; screens never branch on alias names.
 * Project tab aliases live with the project sections (features/navigation).
 */
import { DATA_MODE, type DataMode } from '../state/mode'
import { resolveProjectTab } from '../features/navigation'
import type { Route } from './history'

export { resolveProjectTab }

/** Page keys that now render another page. `command-center` rendered the same System Overview as `overview`. */
export const PAGE_ALIASES: Readonly<Record<string, string>> = { 'command-center': 'overview' }

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
