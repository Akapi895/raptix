/**
 * Navigation model (ticket 08a, extracted from the shell monolith).
 *
 * `match` arrays are nav-highlighting aliases, not route keys — the route
 * inventory (routes.ts) is the route authority. Highlight matching stays
 * `route.page` membership.
 * The project menu is generated from features/navigation, one table.
 */
import {
  Boxes, FolderKanban, LayoutDashboard, RadioTower, Server, Settings, ShieldAlert, type LucideIcon,
} from 'lucide-react'
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

/* ───────────── Project workspace sidebar (plan 2026-10-16 §3.2) ───────────── */
/**
 * The project menu comes from features/navigation/project-sections.ts. It is built once per load, so the Asset Map flag is
 * read when the app starts.
 */
export type { ProjectNavGroup, ProjectNavItem }

export const PROJECT_NAV: ProjectNavGroup[] = projectMenu()

export { projectSection }
