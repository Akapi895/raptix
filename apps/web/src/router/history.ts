/**
 * Route codecs for the hash-format URLs kept across the migration (ticket 07).
 *
 * The console keeps its `#/page/id?tab=` deep links: hash routing survives
 * base-path deployments (vite `base` may be a public sub-path) and preserves
 * every legacy route key verbatim, so pre-migration links keep resolving.
 * The React Router data router is the single location writer; the store's
 * `route` is a projection of the router location.
 *
 * The empty-hash landing differs by mode: real mode lands on the System
 * Overview (the cross-project dashboard); the mock demo still lands on its
 * sign-in screen.
 */
import { DATA_MODE } from '../state/mode'
export interface Route { page: string; id?: string; tab?: string; engagementId?: string }

/** Landing page for an empty location ('' hash or '/' pathname). */
const landingPage = (): string => (DATA_MODE === 'real' ? 'overview' : 'login')

/** Pages that render outside the console shell (public, own full-page layout). */
export const OUTSIDE_SHELL: ReadonlySet<string> = new Set(['scenarios', 'workspaces'])

let knownPages: ReadonlySet<string> | null = null
/** Registers the manifest keys; called once by the router registry module. */
export function setKnownPages(pages: ReadonlySet<string>) { knownPages = pages }
/** Whether a page key is a registered route; false before the registry loads. */
export function isKnownPage(page: string) { return knownPages?.has(page) ?? false }

/** Percent-decodes a path segment; malformed encodings keep the raw value instead of throwing. */
function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/** Parses a legacy `#/page/id?tab=` hash into a Route (empty hash is the landing route). */
export function parseHash(hash = window.location.hash): Route {
  const h = hash.replace(/^#\/?/, '')
  if (!h) return { page: landingPage() }
  const [path, qs] = h.split('?')
  const [page, id] = path.split('/')
  const tab = qs ? new URLSearchParams(qs).get('tab') || undefined : undefined
  const engagementId = qs ? new URLSearchParams(qs).get('engagement') || undefined : undefined
  return { page: page || landingPage(), id: id ? safeDecode(id) : undefined, tab, ...(engagementId ? { engagementId } : {}) }
}

/** Serializes a Route back into the legacy hash format. */
export function toHash(r: Route): string {
  const query = new URLSearchParams()
  if (r.tab) query.set('tab', r.tab)
  if (r.engagementId) query.set('engagement', r.engagementId)
  return `#/${r.page}${r.id ? '/' + encodeURIComponent(r.id) : ''}${query.size ? '?' + query.toString() : ''}`
}

/** Serializes a Route into the path form `router.navigate` expects (same URL, without the leading `#`). */
export function toHref(r: Route): string {
  return toHash(r).slice(1)
}

/** Projects a router location ({ pathname, search }) into the legacy Route shape. */
export function parseLocation(loc: { pathname: string; search: string }): Route {
  const seg = loc.pathname.split('/').filter(Boolean)
  return {
    page: seg[0] ? safeDecode(seg[0]) : landingPage(),
    id: seg[1] ? safeDecode(seg[1]) : undefined,
    tab: new URLSearchParams(loc.search).get('tab') || undefined,
    ...(new URLSearchParams(loc.search).get('engagement') ? { engagementId: new URLSearchParams(loc.search).get('engagement')! } : {}),
  }
}

export const sameRoute = (a: Route, b: Route) => a.page === b.page && a.id === b.id && a.tab === b.tab && a.engagementId === b.engagementId
