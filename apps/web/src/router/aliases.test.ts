import { describe, expect, it } from 'vitest'
import { canonicalRoute, resolveProjectTab } from './aliases'

describe('page aliases', () => {
  it('moves command-center to overview and keeps the rest of the route', () => {
    expect(canonicalRoute({ page: 'command-center', tab: 'x', engagementId: 'eng-1' }, 'real')).toEqual({ page: 'overview', tab: 'x', engagementId: 'eng-1' })
  })

  it('returns the same object for a canonical route', () => {
    const route = { page: 'project', id: 'eng-1', tab: 'overview' }
    expect(canonicalRoute(route, 'real')).toBe(route)
  })
})

describe('project tab aliases', () => {
  it('maps the mock tab ids onto the real engagement tabs in real mode', () => {
    expect(resolveProjectTab('plans', 'real')).toBe('planning')
    expect(resolveProjectTab('sessions', 'real')).toBe('c2')
    expect(resolveProjectTab('ai-plans', 'real')).toBe('planning')
  })

  it('maps the real tab ids onto the mock project tabs in mock mode', () => {
    expect(resolveProjectTab('planning', 'mock')).toBe('plans')
    expect(resolveProjectTab('c2', 'mock')).toBe('sessions')
  })

  it('maps the shared legacy ids in both modes', () => {
    for (const mode of ['mock', 'real'] as const) {
      expect(resolveProjectTab('closeout', mode)).toBe('close')
      expect(resolveProjectTab('approvals', mode)).toBe('team')
      expect(resolveProjectTab('audit-log', mode)).toBe('audit')
      expect(resolveProjectTab('roe', mode)).toBe('scope')
    }
  })

  it('passes unknown ids through so the screen keeps its own fallback', () => {
    expect(resolveProjectTab('no-such-tab', 'real')).toBe('no-such-tab')
  })

  it('rewrites only the project tab, never another page', () => {
    expect(canonicalRoute({ page: 'project', id: 'eng-1', tab: 'plans' }, 'real')).toEqual({ page: 'project', id: 'eng-1', tab: 'planning' })
    expect(canonicalRoute({ page: 'reports', tab: 'plans' }, 'real')).toEqual({ page: 'reports', tab: 'plans' })
  })
})
