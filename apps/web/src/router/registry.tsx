/**
 * Route registry (ticket 07). The mounted module of every route key comes from the one declaration in routes.ts; this file
 * only maps each slice name to the module that holds its screens. Feature slices load on demand (one chunk per module); the
 * auth/system slice stays in the main bundle so the login screen renders without a chunk round-trip.
 */
import { lazy, type ComponentType } from 'react'
import { routes as systemRoutes } from '../screens/a'
import { ROUTES, type Slice } from './routes'
import { setKnownPages } from './history'

/** The module each slice loads. Every route in routes.ts names one of these. */
const slices: Record<Exclude<Slice, 'a'>, () => Promise<{ routes: Record<string, ComponentType> }>> = {
  b: () => import('../screens/b'),
  dp: () => import('../demo/project-detail/routes'),
  c: () => import('../features/operations/routes'),
  d: () => import('../screens/d'),
  e: () => import('../screens/e'),
  f: () => import('../features/reports/routes'),
  st: () => import('../features/settings/routes'),
  ov: () => import('../features/overview'),
  pj: () => import('../features/projects/routes'),
  g: () => import('../screens/g'),
  h: () => import('../screens/h'),
  i: () => import('../screens/infrastructure'),
  s: () => import('../demo/pages'),
}

/** The slice each key is mounted from, derived from routes.ts. */
const MANIFEST: Record<string, Slice> = Object.fromEntries(Object.entries(ROUTES).map(([key, decl]) => [key, decl.slice]))
setKnownPages(new Set(Object.keys(MANIFEST)))

const lazyCache = new Map<string, ComponentType>()

/** Resolves the component for a route key: static for the auth/system slice, a memoized React.lazy wrapper per key for feature slices. */
export function routeComponent(key: string): ComponentType | null {
  const slice = MANIFEST[key]
  if (!slice) return null
  if (slice === 'a') return systemRoutes[key] ?? null
  let component = lazyCache.get(key)
  if (!component) {
    component = lazy(async () => ({ default: (await slices[slice]()).routes[key] }))
    lazyCache.set(key, component)
  }
  return component
}

/** Whether a manifest entry exists for the key (unknown keys resolve to not-found). */
export const hasRoute = (key: string) => key in MANIFEST
