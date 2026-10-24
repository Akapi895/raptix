import { describe, expect, it } from 'vitest'
import { canonicalRoute, resolveProjectTab } from './aliases'

describe('page aliases', () => {
  it('moves command-center to overview and keeps the rest of the route', () => {
    expect(canonicalRoute({ page: 'command-center', tab: 'x', engagementId: 'eng-1' })).toEqual({ page: 'overview', tab: 'x', engagementId: 'eng-1' })
  })

  it('returns the same object for a canonical route', () => {
    const route = { page: 'project', id: 'eng-1', tab: 'overview' }
    expect(canonicalRoute(route)).toBe(route)
  })
})

describe('project tab aliases', () => {
  it('maps the legacy ids onto the engagement tabs', () => {
    expect(resolveProjectTab('plans')).toBe('planning')
    expect(resolveProjectTab('sessions')).toBe('c2')
    expect(resolveProjectTab('ai-plans')).toBe('planning')
  })

  it('maps the shared legacy ids', () => {
    expect(resolveProjectTab('closeout')).toBe('close')
    expect(resolveProjectTab('approvals')).toBe('team')
    expect(resolveProjectTab('audit-log')).toBe('audit')
    expect(resolveProjectTab('roe')).toBe('scope')
  })

  it('passes unknown ids through so the screen keeps its own fallback', () => {
    expect(resolveProjectTab('no-such-tab')).toBe('no-such-tab')
  })

  it('rewrites only the project tab, never another page', () => {
    expect(canonicalRoute({ page: 'project', id: 'eng-1', tab: 'plans' })).toEqual({ page: 'project', id: 'eng-1', tab: 'planning' })
    expect(canonicalRoute({ page: 'reports', tab: 'plans' })).toEqual({ page: 'reports', tab: 'plans' })
  })
})
