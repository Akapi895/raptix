import { describe, expect, it } from 'vitest'
import { parseRoute, routePath } from '../../src/app/router'
import { ACTIVE_NAV_ITEMS, NAV_GROUPS } from '../../src/app/navigation'

describe('correct-source visual routing', () => {
  it('exposes exactly the 13 requested workspace pages in the requested order', () => {
    expect(ACTIVE_NAV_ITEMS.map(item => item.label)).toEqual([
      'Charter & ROE', 'Scope & Boundary', 'Operator Console', 'Vector Campaigns', 'C2 & Sessions',
      'Infrastructure & Data', 'Assets & Inventory', 'Credentials Vault',
      'Findings & Evidence', 'Operations Log', 'Reports', 'Members', 'Settings',
    ])
    expect(NAV_GROUPS.filter(group => group.label).map(group => group.label)).toEqual(['ENGAGEMENT', 'EXECUTION', 'INFRASTRUCTURE & DATA', 'OUTCOMES'])
  })
  it('round-trips project identity for each visual page and starts at Charter', () => {
    for (const item of ACTIVE_NAV_ITEMS) expect(parseRoute(routePath(item.id, 'project with space'))).toEqual({ screen: item.id, projectId: 'project with space' })
    expect(parseRoute('/projects/1')).toEqual({ screen: 'charter', projectId: '1' })
  })
  it('rejects retired pages and malformed paths instead of mounting extra screens', () => {
    for (const path of ['/projects/%zz/charter', '/projects/1/overview', '/projects/1/runs', '/projects/1/graphs', '/projects/1/attack-graph', '/projects/1/evidence', '/projects/1/findings/1', '/projects/1//console']) expect(parseRoute(path).notFound).toBe(true)
  })
})
