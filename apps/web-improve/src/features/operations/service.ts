/**
 * Operations inventory read model (ticket 24, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handler for the operations list: one scope-checked read that
 * returns the page of accessible canonical operations plus the categorized
 * counts, filter options and approved-plans references the screen renders.
 * Every request captures actor and project explicitly; a non-member's
 * specific-project read is denied with `not-found` (no existence leak), and
 * the aggregate scope (`'all'` or `''`) folds in only projects the actor can
 * access. Reads are pure projections — mutations stay with the legacy
 * actions until their owning tickets migrate.
 */
import { projectAccessible } from '../../auth/policy'
import { planVer } from '../../data'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Operation } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Filter state for the operations inventory (all optional; empty = unfiltered). */
export interface OperationListQuery {
  /** Category key (''|draft|needs|running|done) or one detailed OpStatus value. */
  status?: string
  /** ATT&CK technique id; matches operations with at least one step using it. */
  technique?: string
  /** Case-insensitive substring over id + name. */
  q?: string
  /** Explicit project filter (aggregate view only). */
  project?: string
  owner?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
}

export type OperationCategory = 'all' | 'draft' | 'needs' | 'running' | 'done'

/** One table row: the canonical operation plus the labels its columns render. */
export interface OperationListItem {
  op: Operation
  /** Linked plan reference, formatted "PL-021 v1.2". */
  planLabel?: string
  /** Playbook name when no plan label is available. */
  playbookName?: string
  roeVersion?: string
}

/** Approved plan ready to become an operation (legacy bridge action still creates it). */
export interface ReadyPlanRef { id: string; ver: string; title: string }

/** The whole list read: page + counts + filter options + ready plans. */
export interface OperationListRead {
  items: OperationListItem[]
  page: number
  pageSize: number
  total: number
  counts: Record<OperationCategory, number>
  owners: string[]
  projects: string[]
  readyPlans: ReadyPlanRef[]
}

export interface OperationService {
  list(ctx: RequestContext, query?: OperationListQuery): Promise<ServiceResult<OperationListRead>>
}

/** Category → statuses the category pill covers ("needs" also takes review-pending drafts). */
const CATEGORIES: readonly (readonly [Exclude<OperationCategory, 'all'>, readonly string[]])[] = [
  ['draft', ['draft']], ['needs', ['pending']], ['running', ['running', 'paused']], ['done', ['done']],
]
const PAGE_SIZE = 10

function matchesStatus(op: Operation, status: string, inReviewPlans: ReadonlySet<string>): boolean {
  if (!status) return true
  const cat = CATEGORIES.find(([k]) => k === status)
  if (cat) {
    if (cat[1].includes(op.status)) return true
    return status === 'needs' && op.status === 'draft' && !!op.planId && inReviewPlans.has(op.planId)
  }
  return op.status === status
}

/**
 * Pure list/read handler. Scope semantics: a specific projectId reads only
 * that project's operations and only for members (elevated roles included);
 * `'all'`/`''` aggregates across the actor's accessible projects. Counts and
 * filter options derive from the same accessible base set, with the status
 * category excluded from the counts so the pills always show live totals.
 */
export function listOperations(db: Db, ctx: RequestContext, query: OperationListQuery = {}): ServiceResult<OperationListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = db.operations.filter((o) => (aggregate ? accessible.has(o.projectId) : o.projectId === pid))
  const inReviewPlans = new Set(db.plans.filter((pl) => pl.status === 'in_review').map((pl) => pl.id))
  const q = (query.q || '').toLowerCase()
  const pre = base.filter((o) =>
    (!query.technique || o.steps.some((s) => s.technique === query.technique)) &&
    (!query.project || o.projectId === query.project) &&
    (!query.owner || o.owner === query.owner) &&
    (!q || (o.id + o.name).toLowerCase().includes(q)))
  const categories: OperationCategory[] = ['all', 'draft', 'needs', 'running', 'done']
  const counts = Object.fromEntries(categories.map((c) => [c, pre.filter((o) => matchesStatus(o, c === 'all' ? '' : c, inReviewPlans)).length])) as Record<OperationCategory, number>
  const rows = pre.filter((o) => matchesStatus(o, query.status || '', inReviewPlans))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const planById = new Map(db.plans.map((pl) => [pl.id, pl]))
  const playbookById = new Map(db.playbooks.map((pb) => [pb.id, pb]))
  const projectById = new Map(db.projects.map((p) => [p.id, p]))
  const items: OperationListItem[] = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((op) => {
    const pl = op.planId ? planById.get(op.planId) : undefined
    return {
      op,
      planLabel: pl ? `${pl.id} ${planVer(pl)}` : undefined,
      playbookName: !pl ? playbookById.get(op.playbookId)?.name : undefined,
      roeVersion: projectById.get(op.projectId)?.roeVersion,
    }
  })
  const scopePlans = aggregate ? db.plans.filter((pl) => accessible.has(pl.projectId)) : db.plans.filter((pl) => pl.projectId === pid)
  const readyPlans: ReadyPlanRef[] = scopePlans
    .filter((pl) => pl.status === 'approved' && !(pl.opId && db.operations.some((o) => o.id === pl.opId)))
    .map((pl) => ({ id: pl.id, ver: planVer(pl), title: pl.title }))
  return {
    ok: true,
    data: {
      items, page, pageSize: PAGE_SIZE, total: rows.length, counts,
      owners: [...new Set(base.map((o) => o.owner))].sort(),
      projects: [...new Set(base.map((o) => o.projectId))],
      readyPlans,
    },
  }
}

/** Builds the typed list service; `guard` is the factory's superseded-scope read guard. */
export function createOperationService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): OperationService {
  return {
    list: (ctx, query) => guard(() => listOperations(authority.snapshot(), ctx, query)),
  }
}
