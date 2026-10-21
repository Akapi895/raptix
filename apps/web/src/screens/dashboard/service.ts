/**
 * Command Center aggregate read service (ticket 14, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The dashboard needs one cross-entity view per authorization scope, so this
 * feature-local handler projects the one database authority into a
 * {@link DashboardAggregate} for an explicit actor/project pair — the same
 * pattern as the factory's representative `forScope` ProjectService: the
 * request context is authoritative, membership goes through the shared
 * `projectAccessible` rule, and a project the actor cannot access yields an
 * empty aggregate instead of an existence signal. Reads honor the Query
 * layer's abort signal, so the ScopeCancelBridge (ticket 05) supersedes a
 * stale read before it can restore previous visibility.
 */
import type { Db } from '../../demo/seed';
import { projectAccessible } from '../../domain/policy'
import type { ConsoleServices } from '../../domain/console-services';
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { DashboardAggregate } from '../../domain/dashboard'

const SUPERSEDED = {
  ok: false as const,
  failure: { kind: 'unavailable' as const, message: 'Request superseded by a scope change.' },
}

/** Projects the aggregate draws from: accessible to the actor, narrowed to the selected scope. */
function scopeIds(db: Db, actor: ActorRef, projectId: string): Set<string> {
  const accessible = db.projects.filter((p) => projectAccessible(p, actor))
  const scoped = projectId ? accessible.filter((p) => p.id === projectId) : accessible
  return new Set(scoped.map((p) => p.id))
}

/** Pure projection of one snapshot into the scoped aggregate; `''` is the all-projects view. */
export function aggregateFor(db: Db, actor: ActorRef, projectId: string): DashboardAggregate {
  const ids = scopeIds(db, actor, projectId)
  const aggregate = projectId === ''
  const inScope = <T extends { projectId: string }>(rows: readonly T[]) =>
    rows.filter((x) => ids.has(x.projectId) || (aggregate && x.projectId === ''))
  return {
    projects: db.projects.filter((p) => ids.has(p.id)),
    operations: inScope(db.operations),
    agents: inScope(db.agents),
    assets: inScope(db.assets),
    sessions: inScope(db.sessions),
    sessionRequests: inScope(db.sessionRequests),
    findings: inScope(db.findings),
    reports: inScope(db.reports),
    plans: inScope(db.plans),
    approvals: inScope(db.approvals),
    audit: inScope(db.audit),
    toolEvents: inScope(db.toolEvents),
    c2Nodes: db.c2Nodes.filter((n) => n.projectIds.some((p) => ids.has(p)) || (aggregate && n.projectIds.length === 0)),
  }
}

export interface DashboardService {
  /** Aggregate read for one request scope; resolves `unavailable` when superseded. */
  read(ctx: RequestContext, signal?: AbortSignal): Promise<ServiceResult<DashboardAggregate>>
}

/** Aggregate read for one explicit request context. */
export async function readDashboard(services: ConsoleServices, ctx: RequestContext, signal?: AbortSignal): Promise<ServiceResult<DashboardAggregate>> {
  await Promise.resolve()
  if (signal?.aborted) return SUPERSEDED
  return { ok: true, data: aggregateFor(services.authority.snapshot(), ctx.actor, ctx.projectId) }
}

/** Scope-bound aggregate reads, mirroring `ConsoleServices.forScope`: actor and project are explicit per scope and never retargeted by the request context. */
export function dashboardForScope(services: ConsoleServices, actor: ActorRef, projectId: string): DashboardService {
  return { read: (ctx, signal) => readDashboard(services, { ...ctx, actor, projectId }, signal) }
}
