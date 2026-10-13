/**
 * Project detail read service (ticket 20, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One typed canonical read per detail URL: the factory's ProjectService
 * (`forScope`) owns the membership rule, so an unknown project and a project
 * outside the actor's scope collapse into the same `not-found` failure — the
 * blocked state can never leak record content. On success the read projects
 * the one database snapshot into a {@link ProjectDetail} view: cross-entity
 * slices reuse the Command Center aggregate projection and readiness/
 * completion/eligibility reuse the dashboard's pure domain functions (the
 * same semantics the dashboard tests pin — no duplicated math here).
 *
 * Scope-bound wrapper mirrors `dashboardForScope`: actor and project are
 * explicit per scope and never retargeted by a later request context.
 */
import { aggregateFor } from '../dashboard/service'
import { completion, eligibility, readiness } from '../dashboard/domain'
import type { Completion, DashboardAggregate, Eligibility, Readiness } from '../dashboard/domain'
import { projectAccessible } from '../../auth/policy'
import type { Db } from '../../data'
import type { Evidence, Project } from '../../domain/entities'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'

const SUPERSEDED = {
  ok: false as const,
  failure: { kind: 'unavailable' as const, message: 'Request superseded by a scope change.' },
}

/** Everything the migrated detail shell and scope/team panels render from. */
export interface ProjectDetail {
  project: Project
  /** Project-narrowed cross-entity slices (dashboard aggregate projection). */
  aggregate: DashboardAggregate
  /** Evidence is not part of the dashboard aggregate; the shell only counts it for the tab badge. */
  evidence: Evidence[]
  readiness: Readiness
  completion: Completion
  eligibility: Eligibility
}

/** Pure projection of one snapshot into the detail view; `undefined` when the project is unknown or out of scope (fail closed, no partial content). */
export function detailFor(db: Db, actor: ActorRef, id: string): ProjectDetail | undefined {
  const project = db.projects.find((x) => x.id === id)
  if (!project || !projectAccessible(project, actor)) return undefined
  const aggregate = aggregateFor(db, actor, id)
  return {
    project,
    aggregate,
    evidence: db.evidence.filter((e) => e.projectId === id),
    readiness: readiness(aggregate, id),
    completion: completion(aggregate, id),
    eligibility: eligibility(aggregate, id),
  }
}

/** Canonical detail read for one explicit request context. */
export async function readProjectDetail(services: ConsoleServices, ctx: RequestContext, id: string, signal?: AbortSignal): Promise<ServiceResult<ProjectDetail>> {
  // The typed project read enforces membership and the not-found collapse.
  const got = await services.forScope(ctx.actor, id).get(ctx, id)
  if (signal?.aborted) return SUPERSEDED
  if (!got.ok) return got
  const detail = detailFor(services.authority.snapshot(), ctx.actor, id)
  return detail ? { ok: true, data: detail } : SUPERSEDED
}

export interface ProjectDetailService {
  /** Detail read for one request scope; resolves `unavailable` when superseded. */
  read(ctx: RequestContext, signal?: AbortSignal): Promise<ServiceResult<ProjectDetail>>
}

/** Scope-bound detail reads for one actor/project pair. */
export function projectDetailForScope(services: ConsoleServices, actor: ActorRef, id: string): ProjectDetailService {
  return { read: (ctx, signal) => readProjectDetail(services, { ...ctx, actor, projectId: id }, id, signal) }
}
