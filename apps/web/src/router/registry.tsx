/**
 * Route registry (ticket 07 — append-only manifest shared with the integrator).
 *
 * Adding a route key for a feature ticket is two append-only edits: export the
 * key from the feature's screen record, then add one `key: slice` line to
 * MANIFEST below. The router picks it up with no further shared edits; the
 * integrator serializes overlapping manifest writes (execution.md).
 *
 * Feature page slices load on demand (one chunk per screen module); the
 * auth/system slice stays in the main bundle so the login screen renders
 * without a chunk round-trip.
 */
import { lazy, type ComponentType } from 'react'
import { routes as systemRoutes } from '../screens/a'
import { isAssetMapEnabled } from '../features/asset-map/flag'
import { setKnownPages } from './history'

const slices = {
  b: () => import('../screens/b'),
  c: () => import('../screens/c'),
  d: () => import('../screens/d'),
  e: () => import('../screens/e'),
  f: () => import('../features/reports/routes'),
  st: () => import('../features/settings/routes'),
  ov: () => import('../features/overview/routes'),
  g: () => import('../screens/g'),
  h: () => import('../screens/h'),
  i: () => import('../screens/infrastructure'),
  s: () => import('../demo/pages'),
}
type Slice = keyof typeof slices | 'a'

/** 55 source route keys (see .scratch/web-improve-refactor/route-inventory.md). */
const MANIFEST: Record<string, Slice> = {
  login: 'a', forbidden: 'a', notfound: 'a', error: 'a', offline: 'a', 'session-expired': 'a', states: 'a', overview: 'ov', tasks: 'a',
  projects: 'b', 'project-new': 'b', project: 'b',
  operations: 'c', 'operation-new': 'c', preflight: 'c', 'operation-schedule': 'c', operation: 'c',
  infrastructure: 'i', agents: 'i', agent: 'd', assets: 'd', 'asset-new': 'd', 'asset-scope': 'd', asset: 'd', playbooks: 'd', playbook: 'd', technique: 'd', 'playbook-review': 'd',
  analysis: 'e', findings: 'e', 'finding-new': 'e', finding: 'e', evidence: 'e', 'evidence-inspector': 'e',
  reports: 'f', 'report-new': 'f', report: 'f', 'report-preview': 'f', 'report-review': 'f', settings: 'st',
  'ai-operator': 'g', 'ai-plan': 'g', 'ai-plan-review': 'g', 'ai-plan-compare': 'g', 'ai-trace': 'g', 'ai-history': 'g', 'ai-fanout': 'g', 'ai-branch': 'g',
  c2: 'i', 'c2-channel': 'h', 'c2-session': 'h', 'c2-console': 'h',
  scenarios: 's', workspaces: 's',
  // Feature-flagged (off by default): when off the key is absent, so the route resolves as unknown.
  ...(isAssetMapEnabled() ? { 'asset-map': 'a' as Slice } : {}),
}
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
