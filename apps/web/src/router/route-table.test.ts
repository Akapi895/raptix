/**
 * Structural hardening (2026-10-16): `route-table.ts` is the one place that
 * decides which keys render through `RealFeatureRoute` and what each shows.
 * These checks guard the invariants that used to be implicit when
 * `router/host.tsx` and `real/screens/feature-route.tsx` each kept their own
 * copy of the key list.
 */
import { describe, expect, it } from 'vitest'
import { FEATURE_ROUTE_SURFACES, MIGRATED_ROUTES, type PanelGroup } from './route-table'
import { hasRoute } from './registry'

const KNOWN_PANEL_GROUPS: ReadonlySet<PanelGroup> = new Set([
  'operations', 'governance', 'fleet', 'scope',
  'analysis', 'c2', 'campaigns', 'assets', 'library-review',
])

describe('FEATURE_ROUTE_SURFACES', () => {
  it('gives every entry a title and at least one panel', () => {
    for (const [key, surface] of Object.entries(FEATURE_ROUTE_SURFACES)) {
      expect(surface.title.length, key).toBeGreaterThan(0)
      expect(surface.panels.length, key).toBeGreaterThan(0)
    }
  })

  it('only references panel groups feature-route.tsx actually implements', () => {
    for (const [key, surface] of Object.entries(FEATURE_ROUTE_SURFACES)) {
      for (const group of surface.panels) expect(KNOWN_PANEL_GROUPS.has(group), `${key} -> ${group}`).toBe(true)
    }
  })

  it('documents at least one mock screen per entry', () => {
    for (const [key, surface] of Object.entries(FEATURE_ROUTE_SURFACES)) {
      expect(surface.mockScreens.length, key).toBeGreaterThan(0)
    }
  })

  it('every key is a registered route (router/registry.tsx MANIFEST)', () => {
    for (const key of Object.keys(FEATURE_ROUTE_SURFACES)) expect(hasRoute(key), key).toBe(true)
  })

  // Regression snapshot: router/host.tsx used to hand-maintain this exact key
  // list. If a key is ever added to or dropped from this table without
  // intending a routing change, this test is the signal.
  it('keeps the current real-feature-route key set', () => {
    expect(Object.keys(FEATURE_ROUTE_SURFACES).sort()).toEqual([
      'agent', 'agents', 'ai-branch', 'ai-fanout', 'ai-plan', 'ai-plan-compare', 'ai-plan-review',
      'analysis', 'asset', 'asset-new', 'asset-scope', 'c2', 'c2-channel', 'c2-console', 'c2-session',
      'operation',
      'operation-new', 'operation-schedule', 'operations', 'playbook-review', 'preflight',
    ].sort())
  })

  it('never routes a migrated key through the real feature panels', () => {
    for (const key of MIGRATED_ROUTES) expect(key in FEATURE_ROUTE_SURFACES, key).toBe(false)
  })
})
