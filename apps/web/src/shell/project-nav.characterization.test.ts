/**
 * Characterization of the project menu and tab resolution as shipped. The rows, highlight lists and legacy tab ids stay
 * pinned, so a change to the navigation table shows up here first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type Row = [group: string, to: string, label: string, match: string[]]

const MENU_ROWS: Row[] = [
  ['PROJECT', 'overview', 'Overview', ['overview']],
  ['PREPARATION', 'scope', 'Scope & ROE', ['scope']],
  ['PREPARATION', 'assets', 'Assets', ['assets', 'asset', 'asset-new', 'asset-scope']],
  ['PREPARATION', 'planning', 'Planning', ['planning', 'ai-plan', 'ai-plan-review', 'ai-plan-compare']],
  ['OPERATIONS', 'ai-workspace', 'AI Workspace', ['ai-workspace', 'ai-operator', 'ai-history']],
  ['OPERATIONS', 'operations', 'Operations', ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'ai-trace', 'ai-fanout', 'ai-branch']],
  ['OPERATIONS', 'c2', 'Sessions', ['c2', 'c2-channel', 'c2-session', 'c2-console']],
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

const RESOLVE: Readonly<Record<string, string>> = {
  plans: 'planning',
  planning: 'planning',
  'ai-plans': 'planning',
  sessions: 'c2',
  c2: 'c2',
  closeout: 'close',
  closure: 'close',
  approvals: 'team',
  members: 'team',
  'audit-log': 'audit',
  roe: 'scope',
  overview: 'overview',
}

afterEach(() => {
  globalThis.localStorage.removeItem('raptix.assetMap')
  vi.resetModules()
})

const rowsOf = (groups: { group: string; items: { to: string; label: string; match: string[] }[] }[]): Row[] =>
  groups.flatMap((g) => g.items.map((i): Row => [g.group, i.to, i.label, i.match]))

describe('project menu as shipped', () => {
  it('menu rows, groups and highlight lists', async () => {
    const nav = await import('./nav')
    expect(rowsOf(nav.PROJECT_NAV)).toEqual(MENU_ROWS)
  })

  it('the Asset Map row sits after Operations while the flag is on', async () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1')
    const nav = await import('./nav')
    const withMap = (rows: Row[]): Row[] => rows.flatMap((row) => (row[1] === 'operations' ? [row, ASSET_MAP_ROW] : [row]))
    expect(rowsOf(nav.PROJECT_NAV)).toEqual(withMap(MENU_ROWS))
  })
})

describe('project tab resolution as shipped', () => {
  it('maps every known id, and passes unknown ids through', async () => {
    const { resolveProjectTab } = await import('../router/aliases')
    for (const [tab, expected] of Object.entries(RESOLVE)) {
      expect(resolveProjectTab(tab), tab).toBe(expected)
    }
    expect(resolveProjectTab('no-such-tab')).toBe('no-such-tab')
  })
})

describe('project section ownership as shipped', () => {
  it('owns resource pages and legacy tabs by their section', async () => {
    const nav = await import('./nav')
    const owner = (route: { page: string; tab?: string }) => nav.projectSection(route, nav.PROJECT_NAV)?.to
    expect(owner({ page: 'project', tab: 'objectives' })).toBeUndefined()
    expect(owner({ page: 'project', tab: 'plans' })).toBeUndefined()
    expect(owner({ page: 'c2-session' })).toBe('c2')
    expect(owner({ page: 'report-review' })).toBe('reports')
    expect(owner({ page: 'asset-scope' })).toBe('assets')
    expect(owner({ page: 'project' })).toBe('overview')
    expect(owner({ page: 'no-such-page' })).toBeUndefined()
  })
})
