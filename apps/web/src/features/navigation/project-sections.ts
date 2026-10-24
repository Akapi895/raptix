/**
 * Project sections for both data modes (WS-1). One table owns what each mode shows in the project menu, which tab
 * id each mode uses in the URL, the legacy tab ids old links may carry, and the routes a section owns for
 * highlighting. Menus, tab resolution and highlight all read this table, so a section cannot appear in one mode
 * without its aliases and ownership.
 *
 * Tab ids stay the ids each mode already uses (`?tab=` is not renamed for cosmetic reasons). A section's `key` is
 * the mode-independent name, so `c2` in real and `sessions` in mock are the same section.
 */
import { Activity, Archive, Bot, ClipboardList, Crosshair, FileText, Gauge, KeyRound, Lock, Monitor, Network, RadioTower, Scale, ScrollText, Server, Settings, ShieldAlert, Users, type LucideIcon } from 'lucide-react'
import { DATA_MODE, type DataMode } from '../../state/mode'
import { isAssetMapEnabled } from '../asset-map/flag'

export type ProjectMode = DataMode
export type ProjectGroupName = 'PROJECT' | 'PREPARATION' | 'OPERATIONS' | 'RESULTS' | 'MANAGEMENT'

export interface ProjectNavItem { to: string; label: string; icon: LucideIcon; match: string[] }
export interface ProjectNavGroup { group: string; items: ProjectNavItem[] }

interface ModeEntry { tab: string; match: string[]; legacy: string[] }
interface SectionDef { key: string; group: ProjectGroupName; label: string; icon: LucideIcon; when?: () => boolean; mock?: ModeEntry; real?: ModeEntry }

const entry = (tab: string, match: string[], legacy: string[] = []): ModeEntry => ({ tab, match, legacy })
const shared = (tab: string, match: string[], legacy: string[] = []) => ({ mock: entry(tab, match, legacy), real: entry(tab, match, legacy) })

const ASSET_MATCH = ['assets', 'asset', 'asset-new', 'asset-scope']
const EXECUTION_MATCH = ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'ai-trace', 'ai-fanout', 'ai-branch']
const REPORT_MATCH = ['reports', 'report', 'report-new', 'report-preview', 'report-review']
const FINDING_MATCH = ['findings', 'finding', 'finding-new']

/** Order inside a group is the menu order. Sections a mode does not list are absent from that mode's menu. */
const SECTIONS: readonly SectionDef[] = [
  { key: 'overview', group: 'PROJECT', label: 'Overview', icon: Gauge, mock: entry('overview', ['overview', 'objectives']), real: entry('overview', ['overview']) },
  { key: 'scope', group: 'PREPARATION', label: 'Scope & ROE', icon: Crosshair, mock: entry('scope', ['scope', 'document'], ['roe']), real: entry('scope', ['scope'], ['roe']) },
  { key: 'assets', group: 'PREPARATION', label: 'Assets', icon: Server, ...shared('assets', ASSET_MATCH) },
  { key: 'planning', group: 'PREPARATION', label: 'Planning', icon: ClipboardList, mock: entry('plans', ['plans', 'ai-plan', 'ai-plan-review', 'ai-plan-compare'], ['planning', 'ai-plans']), real: entry('planning', ['planning', 'ai-plan', 'ai-plan-review', 'ai-plan-compare'], ['plans', 'ai-plans']) },
  { key: 'ai-workspace', group: 'OPERATIONS', label: 'AI Workspace', icon: Bot, ...shared('ai-workspace', ['ai-workspace', 'ai-operator', 'ai-history']) },
  { key: 'operations', group: 'OPERATIONS', label: 'Operations', icon: Activity, ...shared('operations', EXECUTION_MATCH) },
  { key: 'asset-map', group: 'OPERATIONS', label: 'Asset Map', icon: Network, when: isAssetMapEnabled, ...shared('asset-map', ['asset-map']) },
  { key: 'sessions', group: 'OPERATIONS', label: 'C2 Sessions', icon: RadioTower, mock: entry('sessions', ['sessions', 'c2-session', 'c2-console', 'c2-channel'], ['c2']), real: entry('c2', ['c2', 'c2-channel', 'c2-session', 'c2-console'], ['sessions']) },
  { key: 'findings', group: 'RESULTS', label: 'Findings', icon: ShieldAlert, ...shared('findings', FINDING_MATCH) },
  { key: 'evidence', group: 'RESULTS', label: 'Evidence', icon: Archive, mock: entry('evidence', ['evidence']), real: entry('evidence', ['evidence', 'evidence-inspector']) },
  { key: 'analysis', group: 'RESULTS', label: 'Analysis', icon: Network, real: entry('analysis', ['analysis']) },
  { key: 'reports', group: 'RESULTS', label: 'Reports', icon: FileText, ...shared('reports', REPORT_MATCH) },
  { key: 'team', group: 'MANAGEMENT', label: 'Team & Approvals', icon: Users, mock: entry('team', ['team', 'members', 'approvals'], ['members', 'approvals']), real: entry('team', ['team'], ['members', 'approvals']) },
  { key: 'fleet', group: 'MANAGEMENT', label: 'Fleet', icon: Monitor, real: entry('fleet', ['fleet', 'agents', 'agent']) },
  { key: 'audit', group: 'MANAGEMENT', label: 'Activity & Audit', icon: ScrollText, mock: entry('audit', ['audit', 'activity'], ['audit-log']), real: entry('audit', ['audit'], ['audit-log']) },
  { key: 'governance', group: 'MANAGEMENT', label: 'Governance', icon: Scale, real: entry('governance', ['governance']) },
  { key: 'vault', group: 'MANAGEMENT', label: 'Vault', icon: KeyRound, ...shared('vault', ['vault']) },
  { key: 'settings', group: 'MANAGEMENT', label: 'Project Settings', icon: Settings, real: entry('settings', ['settings']) },
  { key: 'close', group: 'MANAGEMENT', label: 'Closeout', icon: Lock, mock: entry('close', ['close', 'closure', 'closeout'], ['closure', 'closeout']), real: entry('close', ['close'], ['closure', 'closeout']) },
]

/**
 * Pages that show a global resource (not one project) when no project is scoped. The host applies the scope rule with
 * this set; it lives here, next to the menus, so the navigation rules are read from one module.
 */
export const GLOBAL_RESOURCE_PAGES: ReadonlySet<string> = new Set(['reports', 'operations', 'analysis', 'agents', 'c2'])

/** Menu for one mode, grouped in table order. Asset Map is read through its flag when this is called. */
export function projectMenu(mode: ProjectMode): ProjectNavGroup[] {
  const groups: ProjectNavGroup[] = []
  for (const section of SECTIONS) {
    const mine = section[mode]
    if (!mine || (section.when && !section.when())) continue
    let group = groups.find((g) => g.group === section.group)
    if (!group) {
      group = { group: section.group, items: [] }
      groups.push(group)
    }
    group.items.push({ to: mine.tab, label: section.label, icon: section.icon, match: mine.match })
  }
  return groups
}

/** Legacy and canonical tab ids of one mode, each mapped to that mode's canonical tab id. */
function tabTable(mode: ProjectMode): Readonly<Record<string, string>> {
  const table: Record<string, string> = {}
  for (const section of SECTIONS) {
    const mine = section[mode]
    if (!mine) continue
    for (const legacy of mine.legacy) table[legacy] = mine.tab
  }
  return table
}

const TAB_TABLES: Readonly<Record<ProjectMode, Readonly<Record<string, string>>>> = { mock: tabTable('mock'), real: tabTable('real') }

/** The project tab id a `?tab=` value resolves to in one mode; unknown ids pass through for the screen's own fallback. */
export function resolveProjectTab(tab: string, mode: ProjectMode = DATA_MODE): string {
  return TAB_TABLES[mode][tab] ?? tab
}

/** The menu item that owns a route: the project page matches by tab, resource pages by page. */
export function projectSection(route: { page: string; tab?: string }, groups: ProjectNavGroup[]): ProjectNavItem | undefined {
  for (const group of groups) {
    for (const item of group.items) {
      const hit = route.page === 'project' ? item.match.includes(route.tab ?? 'overview') : item.match.includes(route.page)
      if (hit) return item
    }
  }
  return undefined
}
