/**
 * The route declaration (routes.ts) is the one place a key's mock slice and its real rendering are declared. These checks
 * guard the invariants the derived lists depend on: every key is registered, feature surfaces name only panel groups that
 * feature-route.tsx implements, and the key sets the real console depends on do not drift without a deliberate change.
 */
import { describe, expect, it } from 'vitest'
import { FEATURE_SURFACES, GLOBAL_RESOURCE_PAGES, ROUTES, SHARED_ROUTES, type PanelGroup } from './routes'
import { hasRoute } from './registry'

const KNOWN_PANEL_GROUPS: ReadonlySet<PanelGroup> = new Set(['operations', 'governance', 'fleet', 'scope', 'analysis', 'c2', 'campaigns'])

describe('route declaration', () => {
  it('registers every declared key in the registry manifest', () => {
    for (const key of Object.keys(ROUTES)) expect(hasRoute(key), key).toBe(true)
  })

  it('gives every feature surface a title and at least one known panel group', () => {
    for (const [key, surface] of Object.entries(FEATURE_SURFACES)) {
      expect(surface.title.length, key).toBeGreaterThan(0)
      expect(surface.panels.length, key).toBeGreaterThan(0)
      for (const group of surface.panels) expect(KNOWN_PANEL_GROUPS.has(group), `${key} -> ${group}`).toBe(true)
    }
  })

  // Regression snapshot: the real feature routes. A key added or dropped here changes what real mode renders.
  it('keeps the current real feature-route key set', () => {
    expect(Object.keys(FEATURE_SURFACES).sort()).toEqual([
      'agent', 'agents', 'ai-branch', 'ai-fanout', 'ai-plan', 'ai-plan-compare', 'ai-plan-review',
      'analysis', 'c2', 'c2-channel', 'c2-console', 'c2-session',
      'operation',
      'operation-new', 'operation-schedule', 'operations', 'preflight',
    ].sort())
  })

  it('never routes a shared key through the real feature panels', () => {
    for (const key of SHARED_ROUTES) expect(key in FEATURE_SURFACES, key).toBe(false)
  })

  it('shows the global resource only for the pages the scope rule names', () => {
    expect([...GLOBAL_RESOURCE_PAGES].sort()).toEqual(['agents', 'analysis', 'c2', 'findings', 'operations', 'reports'])
  })
})
