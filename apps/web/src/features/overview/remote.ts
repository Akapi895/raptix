import { apiFetch } from '../../platform/transport';
import { guarded } from '../../platform/adapter-shared';
import { utcMinute } from '../../platform/format';
import { listEngagements } from '../projects';
import { fetchTasks, inboxLimits } from '../decisions';
import type { OverviewService } from './service';


/* ───────────── System Overview (cross-project dashboard, per-domain reads) ───────────── */
export interface OverviewFindingsView {
  total: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  engagementsWithFindings: number
  engagements: number
  unresolvedBySeverity: Record<string, number>
  latestCreatedAt: string | null
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

export interface OverviewOperationView {
  id: string
  engagementId: string
  engagementName: string | null
  threadId: string | null
  status: string
  updatedAt: string
}

export interface OverviewOperationsView {
  counts: Record<string, number>
  recent: OverviewOperationView[]
  engagements: number
  truncated: boolean
  source: 'db'
}

export function isOverviewOperationsView(v: unknown): v is OverviewOperationsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as OverviewOperationsView
  return typeof doc.counts === 'object' && doc.counts !== null && Array.isArray(doc.recent) && typeof doc.engagements === 'number' && typeof doc.truncated === 'boolean' && doc.source === 'db'
}

export function fetchOverviewOperations(): Promise<OverviewOperationsView> {
  return apiFetch('/overview/operations', isOverviewOperationsView)
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
      return { ok: true, data: { total: view.total, engagements: view.engagements, engagementsWithFindings: view.engagementsWithFindings, bySeverity: view.bySeverity, byStatus: view.byStatus, unresolvedBySeverity: view.unresolvedBySeverity, latestCreatedAt: view.latestCreatedAt === null ? null : utcMinute(view.latestCreatedAt), truncated: view.truncated }}
    }),
    c2: () => guarded(async () => {
      const view = await fetchOverviewC2()
      return { ok: true, data: { pendingGrants: view.pendingGrants, commandsByStatus: view.commandsByStatus, recentCommands: view.recentCommands.map((c) => ({ ...c, createdAt: utcMinute(c.createdAt) })) } }
    }),
    operations: () => guarded(async () => {
      const view = await fetchOverviewOperations()
      return { ok: true, data: { counts: view.counts, recent: view.recent.map((o) => ({ ...o, updatedAt: utcMinute(o.updatedAt) })), engagements: view.engagements, truncated: view.truncated } }
    }),
    tasks: () => guarded(async () => {
      const view = await fetchTasks()
      const limits = inboxLimits(view)
      return { ok: true, data: { items: view.tasks.map((t) => ({ kind: t.kind, refId: t.refId, engagementId: t.engagementId, engagementName: t.engagementName, title: t.title, createdAt: utcMinute(t.createdAt), href: t.href, awaitingActor: t.awaitingActor })), limited: limits.decisions, stopsLimited: limits.stops } }
    }),
  }
}
