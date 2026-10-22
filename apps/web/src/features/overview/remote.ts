import { apiFetch } from '../../platform/transport';
import { guarded } from '../../platform/adapter-shared';
import { utcMinute } from '../../platform/format';
import { listEngagements } from '../projects';
import type { OverviewService } from './service';

/* ───────────── Command center, tasks and notices (integration ticket 15) ───────────── */
export interface TaskItemView {
  kind: 'scope-revision' | 'business-plan' | 'c2-grant' | 'report-review' | 'finding-review' | 'active-stop'
  engagementId: string
  engagementName: string | null
  refId: string
  title: string
  createdAt: string
  href: string
  awaitingActor: boolean
}

export interface TaskEngagementView {
  engagementId: string
  name: string | null
  readiness: { state: 'available' | 'unavailable'; ok: boolean | null; failedChecks: number; reason: string | null }
}

export interface TasksView {
  tasks: TaskItemView[]
  engagements: TaskEngagementView[]
  counts: Record<string, number>
  source: 'db'
}

export function isTasksView(v: unknown): v is TasksView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as TasksView
  return Array.isArray(doc.tasks) && Array.isArray(doc.engagements) && typeof doc.counts === 'object' && doc.source === 'db'
}

export function fetchTasks(): Promise<TasksView> {
  return apiFetch('/tasks', isTasksView)
}

/* ───────────── System Overview (cross-project dashboard, per-domain reads) ───────────── */
export interface OverviewFindingsView {
  total: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  engagementsWithFindings: number
  engagements: number
  truncated: boolean
  source: 'db'
}

export function isOverviewFindingsView(v: unknown): v is OverviewFindingsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as OverviewFindingsView
  return typeof doc.total === 'number' && typeof doc.bySeverity === 'object' && doc.bySeverity !== null && typeof doc.byStatus === 'object' && doc.byStatus !== null && typeof doc.engagements === 'number' && doc.source === 'db'
}

export function fetchOverviewFindings(): Promise<OverviewFindingsView> {
  return apiFetch('/overview/findings', isOverviewFindingsView)
}

export interface OverviewC2CommandView {
  id: string
  engagementId: string
  sessionId: string
  status: string
  createdAt: string
}

export interface OverviewC2View {
  commandsByStatus: Record<string, number>
  recentCommands: OverviewC2CommandView[]
  pendingGrants: number
  source: 'db'
}

export function isOverviewC2View(v: unknown): v is OverviewC2View {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as OverviewC2View
  return typeof doc.commandsByStatus === 'object' && doc.commandsByStatus !== null && Array.isArray(doc.recentCommands) && typeof doc.pendingGrants === 'number' && doc.source === 'db'
}

export function fetchOverviewC2(): Promise<OverviewC2View> {
  return apiFetch('/overview/c2', isOverviewC2View)
}

/* ───────────── Real adapter for the overview port (Mốc 2) ───────────── */
/** Each section reads its own endpoint, so one failing source leaves the others loaded (see service.ts). */
export function createRealOverviewService(): OverviewService {
  return {
    projects: () => guarded(async () => {
      const projects = await listEngagements()
      return { ok: true, data: projects.map((p) => ({ id: p.id, name: p.displayName, detail: p.targetValue, status: p.lifecycleStatus, updatedAt: utcMinute(p.updatedAt) })) }
    }),
    findings: () => guarded(async () => {
      const view = await fetchOverviewFindings()
      return { ok: true, data: { total: view.total, engagements: view.engagements, engagementsWithFindings: view.engagementsWithFindings, bySeverity: view.bySeverity, byStatus: view.byStatus, truncated: view.truncated } }
    }),
    c2: () => guarded(async () => {
      const view = await fetchOverviewC2()
      return { ok: true, data: { pendingGrants: view.pendingGrants, commandsByStatus: view.commandsByStatus, recentCommands: view.recentCommands.map((c) => ({ ...c, createdAt: utcMinute(c.createdAt) })) } }
    }),
    tasks: () => guarded(async () => {
      const view = await fetchTasks()
      return { ok: true, data: view.tasks.map((t) => ({ kind: t.kind, refId: t.refId, engagementId: t.engagementId, engagementName: t.engagementName, title: t.title, createdAt: utcMinute(t.createdAt), href: t.href, awaitingActor: t.awaitingActor })) }
    }),
  }
}
