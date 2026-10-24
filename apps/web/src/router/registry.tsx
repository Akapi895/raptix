/**
 * Route registry (ticket 07). A key's real rendering comes from the one declaration in routes.ts. This file maps the slice
 * names of the shared presentations to the modules that hold them; feature and component surfaces render from routes.ts
 * directly. Slice modules load on demand (one chunk per module); the system pages stay in the main bundle so the crash and
 * sign-in-expired screens render without a chunk round-trip.
 */
import { lazy, type ComponentType } from 'react'
import { routes as systemRoutes } from './slice-a'
import { ROUTES, type SharedSlice } from './routes'
import { setKnownPages } from './history'

/** The module each shared slice loads. */
const sharedSlices: Record<SharedSlice, () => Promise<{ routes: Record<string, ComponentType> }>> = {
  ov: () => import('../features/overview'),
  pj: () => import('../features/projects/routes'),
  d: () => import('./slice-d'),
  e: () => import('./slice-e'),
  f: () => import('../features/reports/routes'),
  st: () => import('../features/settings/routes'),
}

setKnownPages(new Set(Object.keys(ROUTES)))

const lazyCache = new Map<string, ComponentType>()

/**
 * The screen a key mounts in real mode: a shared presentation (a memoized React.lazy wrapper per key) or a system page
 * (static). Null for every other key, which renders from routes.ts.
 */
export function routeComponent(key: string): ComponentType | null {
  const surface = ROUTES[key]?.real
  if (surface?.kind === 'system') return systemRoutes[key] ?? null
  if (surface?.kind !== 'shared') return null
  let component = lazyCache.get(key)
  if (!component) {
    const slice = surface.slice
    component = lazy(async () => ({ default: (await sharedSlices[slice]()).routes[key] }))
    lazyCache.set(key, component)
  }
  return component
}

/** Whether a route key exists (unknown keys resolve to not-found). */
export const hasRoute = (key: string) => key in ROUTES
