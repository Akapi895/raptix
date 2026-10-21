import { apiFetch } from '../../platform/transport';

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
