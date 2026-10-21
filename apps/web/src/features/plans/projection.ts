/**
 * Plan-workbench typed views (ticket 67, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One cached projection per authority publication replaces the plan screens'
 * direct database scans: the plan, its linked records and the project-scoped
 * slices are assembled at the owning feature boundary with the request
 * context applied. A plan outside the actor's grants reads as missing, never
 * as data; a plan in another of the actor's projects still loads so the
 * screen can explain the cross-project isolation. The policy checks are
 * derived per candidate plan version (locally edited drafts included) with
 * the derivation the approval handlers enforce.
 */
import type { Db } from '../../demo/seed';
import type { Plan } from '../../domain/entities'
import type { RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
import { projectView } from '../../domain/projection'
import { projectAccessible } from '../../domain/policy'
import { useServiceProjection } from '../../state/projection'
import { policyChecks, type Chk } from './policy'

export interface PlanView {
  plan: Plan
  project: Db['projects'][number]
  playbook?: Db['playbooks'][number]
  /** The operation bound to the plan, when bound. */
  op?: Db['operations'][number]
  /** Child revision, when one exists. */
  next?: Plan
  /** Parent revision, when the plan is a revision. */
  prev?: Plan
  /** The plan's version chain (root → latest). */
  chain: Plan[]
  /** Resolves any agent id (shared-pool entries included). */
  agentOf: (id: string) => Db['agents'][number] | undefined
  /** Resolves an asset id. */
  assetOf: (id: string) => Db['assets'][number] | undefined
  /** Resolves a step target by asset name within the plan's project. */
  assetByName: (name: string) => Db['assets'][number] | undefined
  /** The plan's project operations (version-history usage). */
  operations: Db['operations']
  /** The project's branch groups (own-plan groups and siblings). */
  branchGroups: Db['branchGroups']
  /** Branches of the project's branch groups. */
  branches: Db['branches']
  /** The project's tool events (step drawers). */
  toolEvents: Db['toolEvents']
  /** The project's evidence (overview links). */
  evidence: Db['evidence']
  /** Audit rows addressed to the plan. */
  audit: Db['audit']
}

export function readPlanView(services: ConsoleServices, ctx: RequestContext, planId: string): PlanView | undefined {
  return projectView(services, ctx, 'plan.' + planId, (db) => {
    const plan = db.plans.find((p) => p.id === planId)
    const project = plan ? db.projects.find((p) => p.id === plan.projectId) : undefined
    if (!plan || !project || !projectAccessible(project, ctx.actor)) return undefined
    const back: Plan[] = []
    for (let c: Plan | undefined = plan; c; c = c.prevPlanId ? db.plans.find((x) => x.id === c.prevPlanId) : undefined) back.unshift(c)
    const fwd: Plan[] = []
    for (let c = db.plans.find((x) => x.prevPlanId === plan.id); c; c = db.plans.find((x) => x.prevPlanId === c.id)) fwd.push(c)
    return {
      plan,
      project,
      playbook: db.playbooks.find((x) => x.id === plan.playbookId),
      op: plan.opId ? db.operations.find((o) => o.id === plan.opId) : undefined,
      next: db.plans.find((x) => x.prevPlanId === plan.id),
      prev: plan.prevPlanId ? db.plans.find((x) => x.id === plan.prevPlanId) : undefined,
      chain: [...back, ...fwd],
      agentOf: (id) => db.agents.find((a) => a.id === id),
      assetOf: (id) => db.assets.find((a) => a.id === id),
      assetByName: (name) => db.assets.find((a) => a.name === name && a.projectId === plan.projectId),
      operations: db.operations.filter((o) => o.projectId === plan.projectId),
      branchGroups: db.branchGroups.filter((g) => g.projectId === plan.projectId),
      branches: db.branches.filter((b) => db.branchGroups.some((g) => g.projectId === plan.projectId && g.id === b.groupId)),
      toolEvents: db.toolEvents.filter((t) => t.projectId === plan.projectId),
      evidence: db.evidence.filter((e) => e.projectId === plan.projectId),
      audit: db.audit.filter((a) => a.obj === plan.id),
    }
  })
}

export function usePlanView(planId: string): PlanView | undefined {
  return useServiceProjection((services, ctx) => readPlanView(services, ctx, planId))
}

/** The selected project's plans, for the route's pick-a-plan table. */
export function readProjectPlans(services: ConsoleServices, ctx: RequestContext, projectId: string): { plans: Db['plans'] } {
  return projectView(services, ctx, 'plans.' + projectId, (db) => ({
    plans: projectId === 'all' ? [] : db.plans.filter((p) => p.projectId === projectId),
  }))
}

export function useProjectPlans(projectId: string): { plans: Db['plans'] } {
  return useServiceProjection((services, ctx) => readProjectPlans(services, ctx, projectId))
}

/** Policy checks for one candidate plan version (locally edited drafts included), cached per content. */
const checksStamp = (plan: Plan) => JSON.stringify([plan.id, plan.projectId, plan.roeVersion, plan.assets, plan.agents, plan.steps])

export function readPlanChecks(services: ConsoleServices, ctx: RequestContext, plan: Plan): Chk[] {
  return projectView(services, ctx, 'plan-checks.' + checksStamp(plan), (db) => policyChecks(plan, db))
}

export function usePlanChecks(plan: Plan): Chk[] {
  return useServiceProjection((services, ctx) => readPlanChecks(services, ctx, plan))
}

/** Policy checks re-derived from current state at call time (click handlers). */
export function readPlanChecksNow(services: ConsoleServices, plan: Plan): Chk[] {
  return policyChecks(plan, services.authority.snapshot())
}
