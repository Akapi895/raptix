/**
 * Navigation model (ticket 08a, extracted from the shell monolith).
 *
 * `match` arrays are nav-highlighting aliases, not route keys — the 53-key
 * route inventory (.scratch/web-improve-refactor/route-inventory.md) is the
 * route authority. All screens are legacy until tickets 14+ migrate them, so
 * highlight matching stays `route.page` membership, exactly as before.
 */
import {
  Activity, Archive, BookOpen, ClipboardList, Crosshair, FileText, FolderKanban, Gauge, KeyRound, LayoutDashboard, Lock, Network, RadioTower, Scale, ScrollText, Server, Settings, ShieldAlert, Monitor, Users, type LucideIcon,
} from 'lucide-react'
import { useServiceProjection } from '../state/projection'
import { DATA_MODE } from '../real/mode'
import { readNavigationBadges } from '../features/navigation/service'

/**
 * Global sidebar (plan 2026-10-16, slice S3): 3 groups / 8 items. Global nav
 * answers "what is the system doing, what does it have, what needs me" —
 * per-project operations move into the project surface. `match` arrays are
 * nav-highlighting aliases, not route keys: operations/analysis/tasks
 * highlight Overview, global agents/C2 highlight Infrastructure, technique/
 * playbook highlight Library. Every retired screen keeps its route and its
 * entry links; only the sidebar slot is gone.
 */
export const NAV: { group: string; items: { page: string; label: string; icon: LucideIcon; match: string[] }[] }[] = [
  {
    group: 'WORKSPACE',
    items: [
      { page: 'overview', label: 'Overview', icon: LayoutDashboard, match: ['overview', 'command-center', 'dashboard', 'tasks', 'operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'analysis'] },
      { page: 'projects', label: 'Projects', icon: FolderKanban, match: ['projects', 'project-new', 'project', 'approval'] },
      { page: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings', 'finding', 'finding-new'] },
      { page: 'reports', label: 'Reports', icon: FileText, match: ['reports', 'report-new', 'report', 'report-preview', 'report-review'] },
    ],
  },
  {
    group: 'RESOURCES',
    items: [
      { page: 'infrastructure', label: 'Infrastructure', icon: RadioTower, match: ['infrastructure', 'agents', 'agent', 'c2', 'c2-channel', 'c2-session', 'c2-console'] },
      { page: 'assets', label: 'Assets', icon: Server, match: ['assets', 'asset', 'asset-new', 'asset-scope'] },
      { page: 'playbooks', label: 'Library', icon: BookOpen, match: ['playbooks', 'playbook', 'technique', 'playbook-review'] },
    ],
  },
  { group: 'ADMINISTRATION', items: [{ page: 'settings', label: 'Settings', icon: Settings, match: ['settings'] }] },
]

const WIDE_PAGES = ['c2-console', 'ai-operator']
export const isWide = (r: { page: string; tab?: string }) => WIDE_PAGES.includes(r.page) || (r.page === 'operation' && r.tab === 'live')

/**
 * Mock project tab IDs, kept as the validation authority for the project
 * screens' own `?tab=` deep links (the sidebar's grouped model below is the
 * navigation surface; these IDs own the URLs).
 */
export const MOCK_PROJECT_TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'scope', label: 'Scope & ROE', icon: Crosshair },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'plans', label: 'Planning', icon: ClipboardList },
  { id: 'findings', label: 'Findings', icon: ShieldAlert },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'objectives', label: 'Objectives', icon: Crosshair },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'team', label: 'Members & Approvals', icon: Users },
  { id: 'sessions', label: 'C2 Sessions', icon: RadioTower },
  { id: 'evidence', label: 'Evidence', icon: FileText },
  { id: 'audit', label: 'Audit', icon: ScrollText },
  { id: 'close', label: 'Closeout', icon: Lock },
]

/* ───────────── Project workspace sidebar (plan 2026-10-16 §3.2) ───────────── */
/**
 * The grouped project navigation. The sidebar replaces the project tab strip
 * as the nav between a project's sections; the tab IDs (`to`) stay the IDs
 * the project screens own (`plans` mock / `planning` real, `sessions` mock /
 * `c2` real — §3.3 keeps both). `match` holds the tab IDs and the resource
 * detail pages whose owning section the item is (§3.3): an operation detail
 * highlights Execution, a finding detail highlights Findings — the project
 * shell must survive drill-down instead of snapping back to global nav.
 */
export interface ProjectNavItem { to: string; label: string; icon: LucideIcon; match: string[] }
export interface ProjectNavGroup { group: string; items: ProjectNavItem[] }

export const MOCK_PROJECT_NAV: ProjectNavGroup[] = [
  {
    group: 'PROJECT',
    items: [{ to: 'overview', label: 'Overview', icon: Gauge, match: ['overview', 'objectives'] }],
  },
  {
    group: 'PREPARATION',
    items: [
      { to: 'scope', label: 'Scope & ROE', icon: Crosshair, match: ['scope', 'asset', 'asset-new', 'asset-scope', 'document'] },
      { to: 'plans', label: 'Planning', icon: ClipboardList, match: ['plans', 'ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history'] },
    ],
  },
  {
    group: 'EXECUTION',
    items: [
      { to: 'operations', label: 'Execution', icon: Activity, match: ['operations', 'operation', 'operation-new', 'preflight', 'operation-schedule'] },
      { to: 'sessions', label: 'C2 Sessions', icon: RadioTower, match: ['sessions', 'c2-session', 'c2-console', 'c2-channel'] },
    ],
  },
  {
    group: 'RESULTS',
    items: [
      { to: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings', 'finding', 'finding-new'] },
      { to: 'evidence', label: 'Evidence', icon: Archive, match: ['evidence'] },
      { to: 'reports', label: 'Reports', icon: FileText, match: ['reports', 'report', 'report-new', 'report-preview', 'report-review'] },
    ],
  },
  {
    group: 'MANAGEMENT',
    items: [
      { to: 'team', label: 'Team & Approvals', icon: Users, match: ['team', 'members', 'approvals'] },
      { to: 'audit', label: 'Activity & Audit', icon: ScrollText, match: ['audit', 'activity'] },
      { to: 'close', label: 'Closeout', icon: Lock, match: ['close', 'closure', 'closeout'] },
    ],
  },
]

/**
 * Real-mode groups keep every existing engagement surface reachable
 * (§3.2: Governance/Vault/Settings stay in Management; Fleet/Analysis keep
 * their sections). IDs are the real engagement tab IDs.
 */
export const REAL_PROJECT_NAV: ProjectNavGroup[] = [
  {
    group: 'PROJECT',
    items: [{ to: 'overview', label: 'Overview', icon: Gauge, match: ['overview'] }],
  },
  {
    group: 'PREPARATION',
    items: [
      { to: 'scope', label: 'Scope & ROE', icon: Crosshair, match: ['scope'] },
      { to: 'planning', label: 'Planning', icon: ClipboardList, match: ['planning'] },
    ],
  },
  {
    group: 'EXECUTION',
    items: [
      { to: 'operations', label: 'Execution', icon: Activity, match: ['operations'] },
      { to: 'fleet', label: 'Fleet', icon: Monitor, match: ['fleet'] },
      { to: 'c2', label: 'C2 Sessions', icon: RadioTower, match: ['c2'] },
    ],
  },
  {
    group: 'RESULTS',
    items: [
      { to: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings'] },
      { to: 'analysis', label: 'Analysis', icon: Network, match: ['analysis'] },
      { to: 'reports', label: 'Reports', icon: FileText, match: ['reports'] },
    ],
  },
  {
    group: 'MANAGEMENT',
    items: [
      { to: 'team', label: 'Team & Approvals', icon: Users, match: ['team'] },
      { to: 'audit', label: 'Activity & Audit', icon: ScrollText, match: ['audit'] },
      { to: 'governance', label: 'Governance', icon: Scale, match: ['governance'] },
      { to: 'vault', label: 'Vault', icon: KeyRound, match: ['vault'] },
      { to: 'settings', label: 'Project Settings', icon: Settings, match: ['settings'] },
      { to: 'close', label: 'Closeout', icon: Lock, match: ['close'] },
    ],
  },
]

export const projectNavGroups = (): ProjectNavGroup[] => (DATA_MODE === 'real' ? REAL_PROJECT_NAV : MOCK_PROJECT_NAV)

/** The owning project section of a route: the project page matches by tab, resource pages by page (§3.3). */
export function projectSection(route: { page: string; tab?: string }, groups: ProjectNavGroup[]): ProjectNavItem | undefined {
  for (const g of groups) {
    for (const it of g.items) {
      const hit = route.page === 'project' ? it.match.includes(route.tab ?? 'overview') : it.match.includes(route.page)
      if (hit) return it
    }
  }
  return undefined
}

/**
 * Pending-work badges shown on the sidebar items, derived from the shared
 * store read model. Real mode has no demo projection — badges stay empty
 * (the mode constant keeps the branch stable for hook ordering).
 */
export function useBadges(): Record<string, number> {
  if (DATA_MODE === 'real') return {}
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useServiceProjection(readNavigationBadges)
}
