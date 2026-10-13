/**
 * My Tasks aggregate read service (ticket 15, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The inbox needs one cross-entity view per authorization scope, so this
 * feature-local handler reuses the Command Center aggregate read (ticket 14)
 * and projects it into the persona's {@link TasksSummary} — the same pattern
 * as the dashboard: the request context is authoritative, membership goes
 * through the shared `projectAccessible` rule, and the read honors the Query
 * layer's abort signal so the ScopeCancelBridge (ticket 05) supersedes a
 * stale read before it can restore previous visibility.
 */
import type { ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import { dashboardForScope } from '../dashboard/service'
import { taskItems } from './domain'
import type { TasksSummary } from './domain'

export interface TasksData {
  /** Scoped inbox for the request's actor and projects. */
  summary: TasksSummary
}

export interface TasksService {
  /** Aggregate inbox read for one request scope; resolves `unavailable` when superseded. */
  read(ctx: RequestContext, signal?: AbortSignal): Promise<ServiceResult<TasksData>>
}

/** Aggregate inbox read for one explicit request context. */
export async function readTasks(services: ConsoleServices, ctx: RequestContext, signal?: AbortSignal): Promise<ServiceResult<TasksData>> {
  const ds = await dashboardForScope(services, ctx.actor, ctx.projectId).read(ctx, signal)
  if (!ds.ok) return ds
  return { ok: true, data: { summary: taskItems(ds.data, ctx.actor) } }
}

/** Scope-bound inbox reads, mirroring `dashboardForScope`: actor and project are explicit per scope and never retargeted by the request context. */
export function tasksForScope(services: ConsoleServices, actor: ActorRef, projectId: string): TasksService {
  return { read: (ctx, signal) => readTasks(services, { ...ctx, actor, projectId }, signal) }
}
