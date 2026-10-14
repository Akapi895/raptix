/**
 * Plan → operation bridge (ticket 40, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The one binding path between an approved plan and the canonical operation
 * APIs: an authorized human's "Create Operation" admits ONE draft operation
 * that keeps the plan's approval binding (Operation.planId ↔ Plan.opId).
 * Nothing here ever runs it — the draft starts only through ticket 26/27's
 * re-derived preflight/start gates, and the approval itself never starts an
 * operation (the plan's status stays `approved` until `startOperation`
 * flips it to `executed`).
 *
 * Gates — every refusal commits nothing and names its reason:
 * - unknown or foreign plan → not-found (no existence leak); a specific-
 *   project request for another project's plan → forbidden (switch first);
 * - read-only context (Viewer role, closed/cancelled project) → forbidden;
 * - the approval must be usable at BINDING time — ticket 39's
 *   `usableApproval` re-checked here with the factory clock — so draft/
 *   proposed/in_review/rejected/superseded plans and approvals past their
 *   absolute 24h deadline all refuse; an expired approval can never bridge
 *   even though its stored status string still reads `approved`;
 * - repeated requests are idempotent: an already-bound plan returns the same
 *   operation instead of duplicating it.
 *
 * The binding itself is ONE atomic ChangeSet: the draft operation (plan
 * steps/agents/assets and linkage), the plan's `opId` pin, the pool-agent
 * assignment and the audit row commit together, so the legacy store, the
 * operations console and My Tasks all observe the same publication. The
 * plans service surface stays proposal-shaped — execution is only reachable
 * through this explicit human path, never from chat (ticket 38).
 */
import { projectAccessible, readOnlyContext } from '../../auth/policy'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Operation } from '../../domain/entities'
import type { Clock, Instant, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import { planVer } from '../../data'
import type { Db, Plan } from '../../data'
import { usableApproval } from './service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The committed binding: the operation a plan admits (new or pre-existing). */
export interface PlanBridgeRead {
  planId: string
  projectId: string
  opId: string
  /** false when the binding already existed — repeated requests never duplicate. */
  created: boolean
  /** Absolute approval deadline the operation stays bound under (when stamped). */
  expiresAt?: Instant
}

/** Narrow existence/project lookup for the list screen's bridge click; the transaction re-derives every gate. */
export function readPlanProject(authority: DbAuthority, planId: string): string | undefined {
  return authority.snapshot().plans.find((x) => x.id === planId)?.projectId
}

/** Scope-checked plan resolution for the bridge (the plans service's read rules). */
function resolveBridgePlan(db: Db, ctx: RequestContext, id: string): { ok: true; plan: Plan } | { ok: false; failure: ServiceFailure } {
  const plan = db.plans.find((x) => x.id === id)
  const project = plan ? db.projects.find((x) => x.id === plan.projectId) : undefined
  if (!plan || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Plan ${id} does not exist or is not available for your account.`, entity: { kind: 'plan', id, projectId: plan?.projectId } } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== plan.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Plan ${id} belongs to project ${plan.projectId}. Switch to that project to create its operation.`, entity: { kind: 'plan', id, projectId: plan.projectId } } }
  }
  return { ok: true, plan }
}

/**
 * Creates (or returns the existing) draft operation bound to an approved
 * plan, in one atomic commit. The refusal order is: unknown/foreign plan →
 * not-found; wrong specific-project scope → forbidden; read-only context →
 * forbidden; approval not usable (status or expired deadline, re-checked at
 * this instant) → conflict; already bound → the same operation back.
 */
export function createOperationFromPlanTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, planId: string): ServiceResult<PlanBridgeRead> {
  const db = authority.snapshot()
  const t = resolveBridgePlan(db, ctx, planId)
  if (!t.ok) return t
  const plan = t.plan
  const project = db.projects.find((x) => x.id === plan.projectId)!
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access; operations cannot be created from a plan.' : `Project ${project.id} is ${project.status} — operations cannot be created from a plan.`, entity: { kind: 'plan', id: planId, projectId: project.id } } }
  }
  /* Ticket 39's rule, re-checked at binding time with the factory clock: the
   * approval must exist AND be inside its absolute 24h window. */
  const gate = usableApproval(plan, clock.now())
  if (!gate.ok) return { ok: false, failure: { kind: 'conflict', message: gate.error, entity: { kind: 'plan', id: planId, projectId: project.id } } }
  /* Idempotent: an already-bound plan returns the same operation. */
  const existing = plan.opId ? db.operations.find((o) => o.id === plan.opId) : undefined
  if (existing) return { ok: true, data: { planId, projectId: project.id, opId: existing.id, created: false, expiresAt: gate.expiresAt } }
  const at = formatDemoInstant(clock.now())
  let opId = ''
  authority.commit(ctx.corr, (d) => {
    const x = d.plans.find((y) => y.id === planId)!
    opId = 'OP-' + String(++d.counters.op).padStart(3, '0')
    const steps = x.steps.map((st, i) => ({ id: 'S' + pad2(i + 1), name: st.name, agent: st.agent, asset: st.asset, technique: st.technique, status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
    const op: Operation = { id: opId, projectId: x.projectId, name: x.title, status: 'draft', owner: ctx.actor.id, playbookId: x.playbookId, agents: x.agents, assets: x.assets, mode: 'Manual approval', startedAt: '—', updated: at, steps, planId: x.id }
    d.operations.push(op)
    x.opId = opId
    x.updated = at
    // Pool agents join the project with the same commit that references them.
    x.agents.forEach((aid) => { const a = d.agents.find((y) => y.id === aid); if (a && !a.projectId) a.projectId = x.projectId })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Created operation from plan', obj: opId, projectId: x.projectId, result: 'Success', reason: `Draft from ${x.id} ${planVer(x)} — approval binding kept; nothing started` })
  })
  return { ok: true, data: { planId, projectId: project.id, opId, created: true, expiresAt: gate.expiresAt } }
}

/**
 * Typed bridge surface (ticket 40). Deliberately separate from the plan
 * lifecycle service: the plans surface stays proposal-shaped (invariant 5 —
 * chat never reaches execution), and this is the only typed execution-
 * adjacent path, human-driven through the workbench and console screens.
 */
export interface PlanBridgeService {
  /** Creates (or returns the existing) draft operation bound to an approved plan. */
  createOperation(ctx: RequestContext, planId: string): Promise<ServiceResult<PlanBridgeRead>>
}

/** Builds the typed bridge service over the shared authority and clock. */
export function createPlanBridgeService(authority: DbAuthority, clock: Clock): PlanBridgeService {
  return {
    createOperation: (ctx, planId) => Promise.resolve(createOperationFromPlanTransaction(authority, clock, ctx, planId)),
  }
}
