/**
 * Plan revision compare read model (ticket 42, ADR-0067).
 *
 * The version-diff presentation reads canonical plan revisions here: the
 * compared pair resolves from the `prevPlanId` chain ticket 39's revision
 * transactions maintain, and the step diff + re-approval notes derive from
 * those two stored records on every read — nothing persists a diff, so a
 * pinned version cannot drift and the approved plan's stored record stays
 * byte-identical after any revision. Reads are scope-checked with the plan
 * service's rules and share the factory's superseded-scope guard.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../domain/actor'
import type { Db } from '../../demo/seed';
import type { Plan, PlanStep } from '../../domain/entities'
import type { DbAuthority } from '../../demo/authority'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import { resolvePlan } from './service'

/** Step-level field changes between two revisions. */
export interface PlanDiff {
  added: PlanStep[]
  removed: PlanStep[]
  /** Changed steps with the per-field change descriptions (`agent X → Y` style). */
  changed: { step: PlanStep; f: string[] }[]
}

/** One compare read: the resolved adjacent revision pair and its derived diff. */
export interface PlanCompareRead {
  /** The older revision of the pair (this plan when it has a successor). */
  previous: Plan
  /** The newer revision of the pair (this plan when it has a predecessor). */
  current: Plan
  /** Step-level diff derived from the two stored revisions. */
  diff: PlanDiff
  /** Notes naming the changes an earlier approval does not cover. */
  notes: string[]
}

/** Step-level diff between two stored revisions, keyed by step id. */
export function stepDiff(a: Plan, b: Plan): PlanDiff {
  const key = (s: PlanStep) => s.id
  const am = new Map(a.steps.map((s) => [key(s), s])); const bm = new Map(b.steps.map((s) => [key(s), s]))
  const added = b.steps.filter((s) => !am.has(key(s)))
  const removed = a.steps.filter((s) => !bm.has(key(s)))
  const changed = b.steps.flatMap((s) => {
    const o = am.get(key(s)); if (!o) return []
    const f: string[] = []
    if (o.asset !== s.asset) f.push(`asset ${o.asset} → ${s.asset}`)
    if (o.agent !== s.agent) f.push(`agent ${o.agent} → ${s.agent}`)
    if (o.tool !== s.tool) f.push(`tool ${o.tool} → ${s.tool}`)
    if (o.risk !== s.risk) f.push(`risk ${o.risk} → ${s.risk}`)
    if (o.needsApproval !== s.needsApproval) f.push(`approval ${o.needsApproval ? 'required' : 'not required'} → ${s.needsApproval ? 'required' : 'not required'}`)
    return f.length ? [{ step: s, f }] : []
  })
  return { added, removed, changed }
}

/** Changes that invalidate an earlier approval (scope, tool, target, risk, concurrency, gates). */
export function reapprovalNotes(a: Plan, b: Plan, db: Db): string[] {
  const out: string[] = []
  const d = stepDiff(a, b)
  const addA = b.assets.filter((x) => !a.assets.includes(x)), remA = a.assets.filter((x) => !b.assets.includes(x))
  if (addA.length || remA.length) out.push(`Scope: target assets changed (${[...addA.map((x) => '+' + x), ...remA.map((x) => '-' + x)].join(', ')}).`)
  if (d.added.length || d.removed.length) out.push(`Scope: ${d.added.length} step(s) added, ${d.removed.length} removed.`)
  d.changed.forEach(({ step, f }) => f.forEach((x) => {
    const k = x.split(' ')[0]
    out.push(`${k === 'tool' ? 'Tool' : k === 'asset' ? 'Target' : k === 'risk' ? 'Risk' : k === 'agent' ? 'Agent' : 'Approval gate'} change on ${step.id}: ${x}.`)
  }))
  if (a.agents.length !== b.agents.length) {
    const g = db.branchGroups.find((x) => x.planId === a.id)
    out.push(`Concurrency: agent count ${a.agents.length} → ${b.agents.length}${g ? ` (branch group ${g.id} allows ${g.maxConcurrency} concurrent)` : ''}.`)
  }
  return out
}

/** The pair is (previous, this) when a predecessor exists, else (this, successor); neither is a conflict. */
export function readPlanCompare(db: Db, ctx: RequestContext, id: string): ServiceResult<PlanCompareRead> {
  const t = resolvePlan(db, ctx, id)
  if (!t.ok) return t
  const plan = t.plan
  const prev = plan.prevPlanId ? db.plans.find((x) => x.id === plan.prevPlanId) : undefined
  const succ = db.plans.find((x) => x.prevPlanId === plan.id)
  // Revisions never move projects (the revision transaction copies projectId), so the pair shares the addressed plan's scope.
  const previous = prev ?? plan
  const current = prev ? plan : succ
  if (!current || current.id === previous.id) {
    return { ok: false, failure: { kind: 'conflict', message: `${plan.id} has no previous or later revision to compare.`, entity: { kind: 'plan', id, projectId: plan.projectId } } }
  }
  return { ok: true, data: { previous, current, diff: stepDiff(previous, current), notes: reapprovalNotes(previous, current, db) } }
}

/** Typed compare surface (ticket 42) — deliberately read-only over the plan lifecycle service. */
export interface PlanCompareService {
  /** The scope-checked revision pair and its derived diff. */
  compare(ctx: RequestContext, id: string): Promise<ServiceResult<PlanCompareRead>>
}

/** Builds the typed compare service; `guard` is the factory's superseded-scope read guard. */
export function createPlanCompareService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): PlanCompareService {
  return {
    compare: (ctx, id) => guard(() => readPlanCompare(authority.snapshot(), ctx, id)),
  }
}

/** Feature-local key namespace: ['plan', scope, 'compare:<id>'] — plan commits invalidate it. */
export const planCompareKeys = {
  compare: (scope: QueryScope, id: string) => consoleKeys.entity('plan', scope, `compare:${id}`),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class PlanCompareError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'PlanCompareError'
  }
}

/** Query-backed compare read for the addressed plan in the current scope. */
export function usePlanCompare(id: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: planCompareKeys.compare(scope, id),
    queryFn: async (): Promise<PlanCompareRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .plansCompare(actor, scope.project)
        .compare({ actor, projectId: scope.project, corr: 'plan-compare' }, id)
      if (!res.ok) throw new PlanCompareError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}
