/**
 * Navigation model (ticket 08a, extracted from the shell monolith).
 *
 * `match` arrays are nav-highlighting aliases, not route keys — the 53-key
 * route inventory (.scratch/web-improve-refactor/route-inventory.md) is the
 * route authority. All screens are legacy until tickets 14+ migrate them, so
 * highlight matching stays `route.page` membership, exactly as before.
 * The project menus are generated from features/navigation, one table for both modes.
 */
import {
  Activity, Bot, Boxes, ClipboardList, Crosshair, FileText, FolderKanban, Gauge, KeyRound, LayoutDashboard, Lock, RadioTower, ScrollText, Server, Settings, ShieldAlert, Users, type LucideIcon,
} from 'lucide-react'
import { useServiceProjection } from '../state/projection'
import { DATA_MODE } from '../state/mode'
import { readNavigationBadges } from '../features/navigation/service'
import { projectMenu, projectSection, type ProjectNavGroup, type ProjectNavItem } from '../features/navigation'

/**
 * Global sidebar: 3 groups / 7 items, the order of page-details proposal §2
 * (2026-10-22). Global nav answers "what is the system doing, what does it
 * have, what needs me" — per-project operations and Reports move into the
 * project surface. `match` arrays are nav-highlighting aliases, not route
 * keys: operations/analysis/tasks highlight Overview, global agents/C2
 * highlight Infrastructure, technique/playbook highlight Library. Every
 * retired screen keeps its route and its entry links; only the sidebar slot
 * is gone.
 */
export const NAV: { group: string; items: { page: string; label: string; icon: LucideIcon; match: string[] }[] }[] = [
  {
    group: 'WORKSPACE',
    items: [
      { page: 'overview', label: 'Overview', icon: LayoutDashboard, match: ['overview', 'tasks', 'operations', 'operation', 'operation-new', 'preflight', 'operation-schedule', 'analysis'] },
      { page: 'projects', label: 'Projects', icon: FolderKanban, match: ['projects', 'project-new', 'project', 'approval'] },
      { page: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings', 'finding', 'finding-new'] },
    ],
  },
  {
    group: 'RESOURCES',
    items: [
      { page: 'assets', label: 'Assets', icon: Server, match: ['assets', 'asset', 'asset-new', 'asset-scope'] },
      { page: 'capabilities', label: 'Capabilities', icon: Boxes, match: ['capabilities', 'playbook', 'technique', 'playbook-review'] },
      { page: 'infrastructure', label: 'Infrastructure', icon: RadioTower, match: ['infrastructure', 'agents', 'agent', 'c2', 'c2-channel', 'c2-session', 'c2-console'] },
    ],
  },
  { group: 'ADMINISTRATION', items: [{ page: 'settings', label: 'Settings', icon: Settings, match: ['settings'] }] },
]

const WIDE_PAGES = ['c2-console', 'ai-operator']
export const isWide = (r: { page: string; tab?: string }) => WIDE_PAGES.includes(r.page) || (r.page === 'operation' && r.tab === 'live')

/**
 * Mock project tab IDs, kept as the validation authority for the project
 * screens' own `?tab=` deep links (the sidebar's grouped model below is the
 * navigation surface; these IDs own the URLs). The demo project page owns
 * `objectives` and `activity`, which are tabs without a menu item of their own.
 */
export const MOCK_PROJECT_TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'scope', label: 'Scope & ROE', icon: Crosshair },
  { id: 'assets', label: 'Assets', icon: Server },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'ai-workspace', label: 'AI Workspace', icon: Bot },
  { id: 'plans', label: 'Planning', icon: ClipboardList },
  { id: 'findings', label: 'Findings', icon: ShieldAlert },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'objectives', label: 'Objectives', icon: Crosshair },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'team', label: 'Members & Approvals', icon: Users },
  { id: 'sessions', label: 'C2 Sessions', icon: RadioTower },
  { id: 'evidence', label: 'Evidence', icon: FileText },
  { id: 'audit', label: 'Audit', icon: ScrollText },
  { id: 'vault', label: 'Vault', icon: KeyRound },
  { id: 'close', label: 'Closeout', icon: Lock },
]

/* ───────────── Project workspace sidebar (plan 2026-10-16 §3.2) ───────────── */
/**
 * The project menus come from features/navigation/project-sections.ts. They are built once per load, so the
 * Asset Map flag is read when the app starts, as before.
 */
export type { ProjectNavGroup, ProjectNavItem }

export const MOCK_PROJECT_NAV: ProjectNavGroup[] = projectMenu('mock')

export const REAL_PROJECT_NAV: ProjectNavGroup[] = projectMenu('real')

export const projectNavGroups = (): ProjectNavGroup[] => (DATA_MODE === 'real' ? REAL_PROJECT_NAV : MOCK_PROJECT_NAV)

export { projectSection }

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
