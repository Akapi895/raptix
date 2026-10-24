/**
 * The task inbox read (`GET /api/tasks`). This module is the only client caller of the endpoint: every surface that
 * lists workflow decisions or stops reads them through here, so one cache entry answers them all.
 */
import { apiFetch } from '../../platform/transport';

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
  /** Rows per kind as returned; a lower bound when `limited` is true. */
  counts: Record<string, number>
  /** True when a kind reached the server's row cap. Absent on a server that predates the flag: read as false. */
  limited?: boolean
  /** The kinds that reached the cap. Absent on a server that predates it: `limited` then covers every kind. */
  limitedKinds?: string[]
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
