/**
 * Characterization of the project menus and tab resolution as they are shipped. Written before the navigation
 * table moved into features/navigation, so the rows, highlight lists and legacy tab ids of both modes stay pinned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type Row = [group: string, to: string, label: string, match: string[]]

const MOCK_ROWS: Row[] = [
  ['PROJECT', 'overview', 'Overview', ['overview', 'objectives']],
  ['PREPARATION', 'scope', 'Scope & ROE', ['scope', 'document']],
  ['PREPARATION', 'assets', 'Assets', ['assets', 'asset', 'asset-new', 'asset-scope']],
  ['PREPARATION', 'plans', 'Planning', ['plans', 'ai-plan', 'ai-plan-review', 'ai-plan-compare']],
  ['OPERATIONS', 'ai-workspace', 'AI Workspace', ['ai-workspace', 'ai-operator', 'ai-history']],
  ['OPERATIONS', 'operations', 'Operations', ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'ai-trace', 'ai-fanout', 'ai-branch']],
  ['OPERATIONS', 'sessions', 'C2 Sessions', ['sessions', 'c2-session', 'c2-console', 'c2-channel']],
  ['RESULTS', 'findings', 'Findings', ['findings', 'finding', 'finding-new']],
  ['RESULTS', 'evidence', 'Evidence', ['evidence']],
  ['RESULTS', 'reports', 'Reports', ['reports', 'report', 'report-new', 'report-preview', 'report-review']],
  ['MANAGEMENT', 'team', 'Team & Approvals', ['team', 'members', 'approvals']],
  ['MANAGEMENT', 'audit', 'Activity & Audit', ['audit', 'activity']],
  ['MANAGEMENT', 'vault', 'Vault', ['vault']],
  ['MANAGEMENT', 'close', 'Closeout', ['close', 'closure', 'closeout']],
]

const REAL_ROWS: Row[] = [
  ['PROJECT', 'overview', 'Overview', ['overview']],
  ['PREPARATION', 'scope', 'Scope & ROE', ['scope']],
  ['PREPARATION', 'assets', 'Assets', ['assets', 'asset', 'asset-new', 'asset-scope']],
  ['PREPARATION', 'planning', 'Planning', ['planning', 'ai-plan', 'ai-plan-review', 'ai-plan-compare']],
  ['OPERATIONS', 'ai-workspace', 'AI Workspace', ['ai-workspace', 'ai-operator', 'ai-history']],
  ['OPERATIONS', 'operations', 'Operations', ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'ai-trace', 'ai-fanout', 'ai-branch']],
  ['OPERATIONS', 'c2', 'C2 Sessions', ['c2', 'c2-channel', 'c2-session', 'c2-console']],
  ['RESULTS', 'findings', 'Findings', ['findings', 'finding', 'finding-new']],
  ['RESULTS', 'evidence', 'Evidence', ['evidence', 'evidence-inspector']],
  ['RESULTS', 'analysis', 'Analysis', ['analysis']],
  ['RESULTS', 'reports', 'Reports', ['reports', 'report', 'report-new', 'report-preview', 'report-review']],
  ['MANAGEMENT', 'team', 'Team & Approvals', ['team']],
  ['MANAGEMENT', 'fleet', 'Fleet', ['fleet', 'agents', 'agent']],
  ['MANAGEMENT', 'audit', 'Activity & Audit', ['audit']],
  ['MANAGEMENT', 'governance', 'Governance', ['governance']],
  ['MANAGEMENT', 'vault', 'Vault', ['vault']],
  ['MANAGEMENT', 'settings', 'Project Settings', ['settings']],
  ['MANAGEMENT', 'close', 'Closeout', ['close']],
]

const ASSET_MAP_ROW: Row = ['OPERATIONS', 'asset-map', 'Asset Map', ['asset-map']]

const RESOLVE: Readonly<Record<'mock' | 'real', Record<string, string>>> = {
  mock: { plans: 'plans', planning: 'plans', 'ai-plans': 'plans', sessions: 'sessions', c2: 'sessions', closeout: 'close', closure: 'close', approvals: 'team', members: 'team', 'audit-log': 'audit', roe: 'scope', overview: 'overview', 'no-such-tab': 'no-such-tab' },
  real: { plans: 'planning', planning: 'planning', 'ai-plans': 'planning', sessions: 'c2', c2: 'c2', closeout: 'close', closure: 'close', approvals: 'team', members: 'team', 'audit-log': 'audit', roe: 'scope', overview: 'overview', 'no-such-tab': 'no-such-tab' },
}

afterEach(() => {
  globalThis.localStorage.removeItem('raptix.assetMap')
  vi.resetModules()
})

const rowsOf = (groups: { group: string; items: { to: string; label: string; match: string[] }[] }[]): Row[] =>
  groups.flatMap((g) => g.items.map((i): Row => [g.group, i.to, i.label, i.match]))

describe('project menus as shipped', () => {
  it('mock menu rows, groups and highlight lists', async () => {
    const nav = await import('./nav')
    expect(rowsOf(nav.MOCK_PROJECT_NAV)).toEqual(MOCK_ROWS)
  })

  it('real menu rows, groups and highlight lists', async () => {
    const nav = await import('./nav')
    expect(rowsOf(nav.REAL_PROJECT_NAV)).toEqual(REAL_ROWS)
  })

  it('the Asset Map row sits after Operations in both menus while the flag is on', async () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1')
    const nav = await import('./nav')
    const withMap = (rows: Row[]): Row[] => rows.flatMap((row) => (row[1] === 'operations' ? [row, ASSET_MAP_ROW] : [row]))
    expect(rowsOf(nav.MOCK_PROJECT_NAV)).toEqual(withMap(MOCK_ROWS))
    expect(rowsOf(nav.REAL_PROJECT_NAV)).toEqual(withMap(REAL_ROWS))
  })
})

describe('project tab resolution as shipped', () => {
  it('maps every known id in each mode, and passes unknown ids through', async () => {
    const { resolveProjectTab } = await import('../router/aliases')
    for (const mode of ['mock', 'real'] as const) {
      for (const [tab, expected] of Object.entries(RESOLVE[mode])) {
        expect(resolveProjectTab(tab, mode), `${mode}:${tab}`).toBe(expected)
      }
    }
  })
})

describe('project section ownership as shipped', () => {
  it('owns resource pages and legacy tabs by the mode-specific section', async () => {
    const nav = await import('./nav')
    const owner = (groups: typeof nav.MOCK_PROJECT_NAV, route: { page: string; tab?: string }) => nav.projectSection(route, groups)?.to
    expect(owner(nav.MOCK_PROJECT_NAV, { page: 'project', tab: 'objectives' })).toBe('overview')
    expect(owner(nav.MOCK_PROJECT_NAV, { page: 'project', tab: 'activity' })).toBe('audit')
    expect(owner(nav.MOCK_PROJECT_NAV, { page: 'c2-console' })).toBe('sessions')
    expect(owner(nav.MOCK_PROJECT_NAV, { page: 'ai-plan-review' })).toBe('plans')
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'project', tab: 'objectives' })).toBeUndefined()
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'project', tab: 'plans' })).toBeUndefined()
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'c2-session' })).toBe('c2')
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'report-review' })).toBe('reports')
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'asset-scope' })).toBe('assets')
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'project' })).toBe('overview')
    expect(owner(nav.REAL_PROJECT_NAV, { page: 'no-such-page' })).toBeUndefined()
  })
})
