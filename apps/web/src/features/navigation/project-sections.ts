/**
 * Project sections (WS-1). One table owns what the project menu shows, which tab id the URL carries, the legacy tab ids old
 * links may carry, and the routes a section owns for highlighting. Menus, tab resolution and highlight all read this table, so
 * a section cannot appear without its aliases and ownership.
 *
 * Tab ids stay the ids the URL already uses (`?tab=` is not renamed for cosmetic reasons). A section's `key` is its stable name.
 */
import { Activity, Archive, Bot, ClipboardList, Crosshair, FileText, Gauge, KeyRound, Lock, Monitor, Network, RadioTower, Scale, ScrollText, Server, Settings, ShieldAlert, Users, type LucideIcon } from 'lucide-react'
import { isAssetMapEnabled } from '../asset-map/flag'

export type ProjectGroupName = 'PROJECT' | 'PREPARATION' | 'OPERATIONS' | 'RESULTS' | 'MANAGEMENT'

export interface ProjectNavItem { to: string; label: string; icon: LucideIcon; match: string[] }
export interface ProjectNavGroup { group: string; items: ProjectNavItem[] }

interface SectionDef {
  key: string
  group: ProjectGroupName
  label: string
  icon: LucideIcon
  when?: () => boolean
  /** The `?tab=` id the section's screen is mounted under. */
  tab: string
  /** Route keys and tab ids this section owns for highlighting. */
  match: string[]
  /** Tab ids old links may carry, resolved to `tab`. */
  legacy?: string[]
}

const ASSET_MATCH = ['assets', 'asset', 'asset-new', 'asset-scope']
const EXECUTION_MATCH = ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'ai-trace', 'ai-fanout', 'ai-branch']
const REPORT_MATCH = ['reports', 'report', 'report-new', 'report-preview', 'report-review']
const FINDING_MATCH = ['findings', 'finding', 'finding-new']

/** Order inside a group is the menu order. */
const SECTIONS: readonly SectionDef[] = [
  { key: 'overview', group: 'PROJECT', label: 'Overview', icon: Gauge, tab: 'overview', match: ['overview'] },
  { key: 'scope', group: 'PREPARATION', label: 'Scope & ROE', icon: Crosshair, tab: 'scope', match: ['scope'], legacy: ['roe'] },
  { key: 'assets', group: 'PREPARATION', label: 'Assets', icon: Server, tab: 'assets', match: ASSET_MATCH },
  { key: 'planning', group: 'PREPARATION', label: 'Planning', icon: ClipboardList, tab: 'planning', match: ['planning', 'ai-plan', 'ai-plan-review', 'ai-plan-compare'], legacy: ['plans', 'ai-plans'] },
  { key: 'ai-workspace', group: 'OPERATIONS', label: 'AI Workspace', icon: Bot, tab: 'ai-workspace', match: ['ai-workspace', 'ai-operator', 'ai-history'] },
  { key: 'operations', group: 'OPERATIONS', label: 'Operations', icon: Activity, tab: 'operations', match: EXECUTION_MATCH },
  { key: 'asset-map', group: 'OPERATIONS', label: 'Asset Map', icon: Network, when: isAssetMapEnabled, tab: 'asset-map', match: ['asset-map'] },
  { key: 'sessions', group: 'OPERATIONS', label: 'Sessions', icon: RadioTower, tab: 'c2', match: ['c2', 'c2-channel', 'c2-session', 'c2-console'], legacy: ['sessions'] },
  { key: 'findings', group: 'RESULTS', label: 'Findings', icon: ShieldAlert, tab: 'findings', match: FINDING_MATCH },
  { key: 'evidence', group: 'RESULTS', label: 'Evidence', icon: Archive, tab: 'evidence', match: ['evidence', 'evidence-inspector'] },
  { key: 'analysis', group: 'RESULTS', label: 'Analysis', icon: Network, tab: 'analysis', match: ['analysis'] },
  { key: 'reports', group: 'RESULTS', label: 'Reports', icon: FileText, tab: 'reports', match: REPORT_MATCH },
  { key: 'team', group: 'MANAGEMENT', label: 'Team & Approvals', icon: Users, tab: 'team', match: ['team'], legacy: ['members', 'approvals'] },
  { key: 'fleet', group: 'MANAGEMENT', label: 'Fleet', icon: Monitor, tab: 'fleet', match: ['fleet', 'agents', 'agent'] },
  { key: 'audit', group: 'MANAGEMENT', label: 'Activity & Audit', icon: ScrollText, tab: 'audit', match: ['audit'], legacy: ['audit-log'] },
  { key: 'governance', group: 'MANAGEMENT', label: 'Governance', icon: Scale, tab: 'governance', match: ['governance'] },
  { key: 'vault', group: 'MANAGEMENT', label: 'Vault', icon: KeyRound, tab: 'vault', match: ['vault'] },
  { key: 'settings', group: 'MANAGEMENT', label: 'Project Settings', icon: Settings, tab: 'settings', match: ['settings'] },
  { key: 'close', group: 'MANAGEMENT', label: 'Closeout', icon: Lock, tab: 'close', match: ['close'], legacy: ['closure', 'closeout'] },
]

/**
 * Pages that show a global resource (not one project) when no project is scoped. The host applies the scope rule with
 * this set; it lives here, next to the menus, so the navigation rules are read from one module.
 */
export const GLOBAL_RESOURCE_PAGES: ReadonlySet<string> = new Set(['reports', 'operations', 'analysis', 'agents', 'c2'])

/** The project menu, grouped in table order. Asset Map is read through its flag when this is called. */
export function projectMenu(): ProjectNavGroup[] {
  const groups: ProjectNavGroup[] = []
  for (const section of SECTIONS) {
    if (section.when && !section.when()) continue
    let group = groups.find((g) => g.group === section.group)
    if (!group) {
      group = { group: section.group, items: [] }
      groups.push(group)
    }
    group.items.push({ to: section.tab, label: section.label, icon: section.icon, match: section.match })
  }
  return groups
}

const TAB_TABLE: Readonly<Record<string, string>> = Object.fromEntries(
  SECTIONS.flatMap((section) => (section.legacy ?? []).map((legacy) => [legacy, section.tab] as const)),
)

/** The project tab id a `?tab=` value resolves to; unknown ids pass through for the screen's own fallback. */
export function resolveProjectTab(tab: string): string {
  return TAB_TABLE[tab] ?? tab
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
