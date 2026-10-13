/**
 * Navigation model (ticket 08a, extracted from the shell monolith).
 *
 * `match` arrays are nav-highlighting aliases, not route keys — the 53-key
 * route inventory (.scratch/web-improve-refactor/route-inventory.md) is the
 * route authority. All screens are legacy until tickets 14+ migrate them, so
 * highlight matching stays `route.page` membership, exactly as before.
 */
import {
  Activity, BookOpen, Bot, FileText, FolderKanban, LayoutDashboard, Network, RadioTower, Server, Settings, ShieldAlert, Monitor, type LucideIcon,
} from 'lucide-react'
import { useStore } from '../store'

export const NAV: { group: string; items: { page: string; label: string; icon: LucideIcon; match: string[] }[] }[] = [
  { group: 'OVERVIEW', items: [{ page: 'command-center', label: 'Command Center', icon: LayoutDashboard, match: ['command-center', 'dashboard', 'tasks'] }] },
  {
    group: 'PLANNING',
    items: [
      { page: 'projects', label: 'Projects', icon: FolderKanban, match: ['projects', 'project-new', 'project', 'approval'] },
      { page: 'playbooks', label: 'Playbooks & TTPs', icon: BookOpen, match: ['playbooks', 'playbook', 'technique', 'playbook-review'] },
    ],
  },
  {
    group: 'AI & EXECUTION',
    items: [
      { page: 'ai-operator', label: 'AI Operator', icon: Bot, match: ['ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history'] },
      { page: 'operations', label: 'Operations', icon: Activity, match: ['operations', 'operation-new', 'preflight', 'operation', 'operation-schedule'] },
      { page: 'c2', label: 'C2 & Sessions', icon: RadioTower, match: ['c2', 'c2-session', 'c2-console', 'c2-channel'] },
    ],
  },
  {
    group: 'INFRASTRUCTURE',
    items: [
      { page: 'agents', label: 'Agents', icon: Monitor, match: ['agents', 'agent'] },
      { page: 'assets', label: 'Assets', icon: Server, match: ['assets', 'asset', 'asset-new', 'asset-scope'] },
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      { page: 'analysis', label: 'Attack Analysis', icon: Network, match: ['analysis'] },
      { page: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings', 'finding', 'finding-new'] },
      { page: 'reports', label: 'Reports', icon: FileText, match: ['reports', 'report-new', 'report', 'report-preview', 'report-review'] },
    ],
  },
  { group: 'SYSTEM', items: [{ page: 'settings', label: 'Settings', icon: Settings, match: ['settings'] }] },
]

const WIDE_PAGES = ['c2-console', 'ai-operator']
export const isWide = (r: { page: string; tab?: string }) => WIDE_PAGES.includes(r.page) || (r.page === 'operation' && r.tab === 'live')

/** Pending-work badges shown on the sidebar items, derived from the shared store read model. */
export function useBadges() {
  const { db, scoped, me, can } = useStore()
  const d = db as any
  const pendingAppr = (d.approvals || []).filter((a: any) => a.status === 'pending').length
  return {
    projects: me.role === 'reviewer' || can('approve') ? pendingAppr : 0,
    'ai-operator': (d.plans?.filter((p: any) => p.status === 'in_review' || p.status === 'proposed').length as number) || 0,
    c2: (d.sessionRequests?.filter((r: any) => r.status === 'pending').length as number) || 0,
    operations: scoped(db.operations).filter((o) => o.status === 'running').length,
  } as Record<string, number>
}
