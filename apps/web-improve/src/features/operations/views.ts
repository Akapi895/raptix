/**
 * Operation-centric typed views for the console screens (ticket 67,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One cached projection per authority publication replaces the screens'
 * direct database scans: the operation, its linked records and the
 * project-scoped slices are assembled at the owning feature boundary with
 * the request context applied, and components subscribe through the sync
 * projection hook. Access follows the one membership rule; an operation
 * outside the actor's grants reads as missing, never as data.
 */
import type { Db, Operation, Project } from '../../data'
import type { Instant, RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
import { projectView } from '../../domain/projection'
import { projectAccessible } from '../../auth/policy'
import { useServiceProjection } from '../../state/projection'
import { computePreflightChecks, eligibility, scheduleInstantOf, type Check, type EligKind, type Reason } from './preflight'
import { specChecks, type PfCheck } from './checklist'
import { findScheduleConflicts, type ScheduleConflict } from './service'

export interface OperationView {
  op: Operation
  project: Project
  plan?: Db['plans'][number]
  playbook?: Db['playbooks'][number]
  conversation?: Db['conversations'][number]
  /** Agents assigned to the operation (shared-pool entries included). */
  agents: Db['agents']
  /** Assets assigned to the operation. */
  assets: Db['assets']
  /** Project assets, for by-name step target resolution. */
  projectAssets: Db['assets']
  sessions: Db['sessions']
  evidence: Db['evidence']
  findings: Db['findings']
  branches: Db['branches']
  branchGroups: Db['branchGroups']
  toolEvents: Db['toolEvents']
  channels: Db['channels']
  c2Nodes: Db['c2Nodes']
  /** Project ROE approvals. */
  approvals: Db['approvals']
  /** Other operations of the same project. */
  siblings: Db['operations']
  /** Audit rows addressed to the operation (newest-first, capped at 30). */
  audit: Db['audit']
}

export function readOperationView(services: ConsoleServices, ctx: RequestContext, opId: string): OperationView | undefined {
  return projectView(services, ctx, 'operation.' + opId, (db) => {
    const op = db.operations.find((o) => o.id === opId)
    const project = op ? db.projects.find((p) => p.id === op.projectId) : undefined
    if (!op || !project || !projectAccessible(project, ctx.actor)) return undefined
    const plan = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
    return {
      op,
      project,
      plan,
      playbook: db.playbooks.find((x) => x.id === op.playbookId),
      conversation: plan ? db.conversations.find((c) => c.id === plan.conversationId) : undefined,
      agents: op.agents.map((id) => db.agents.find((a) => a.id === id)).filter((a): a is Db['agents'][number] => !!a),
      assets: op.assets.map((id) => db.assets.find((a) => a.id === id)).filter((a): a is Db['assets'][number] => !!a),
      projectAssets: db.assets.filter((a) => a.projectId === op.projectId),
      sessions: db.sessions.filter((s) => s.opId === opId || s.id === op.sessionId),
      evidence: db.evidence.filter((e) => e.opId === opId || op.steps.some((s) => s.evidence === e.id)),
      findings: db.findings.filter((f) => f.op === opId),
      branches: db.branches.filter((b) => b.opId === opId),
      branchGroups: db.branchGroups.filter((g) => g.opId === opId),
      toolEvents: db.toolEvents.filter((t) => t.opId === opId),
      channels: db.channels.filter((c) => c.projectId === op.projectId),
      c2Nodes: db.c2Nodes.filter((n) => n.projectIds.includes(op.projectId)),
      approvals: db.approvals.filter((a) => a.projectId === op.projectId),
      siblings: db.operations.filter((o) => o.projectId === op.projectId),
      audit: db.audit.filter((a) => a.obj.startsWith(opId)).slice(0, 30),
    }
  })
}

export function useOperationView(opId: string): OperationView | undefined {
  return useServiceProjection((services, ctx) => readOperationView(services, ctx, opId))
}

/** Gate outcome for one operation route: existence, access and selected-project checks. */
export type OperationGate =
  | { state: 'ok'; op: Operation }
  | { state: 'missing' }
  | { state: 'denied'; projectId: string }
  | { state: 'foreign'; projectId: string }

export function readOperationGate(services: ConsoleServices, ctx: RequestContext, opId: string): OperationGate {
  return projectView(services, ctx, 'gate.' + opId, (db) => {
    const op = db.operations.find((o) => o.id === opId)
    if (!op) return { state: 'missing' } as OperationGate
    if (!projectAccessible(db.projects.find((p) => p.id === op.projectId), ctx.actor)) return { state: 'denied', projectId: op.projectId } as OperationGate
    if (ctx.projectId !== 'all' && ctx.projectId !== op.projectId) return { state: 'foreign', projectId: op.projectId } as OperationGate
    return { state: 'ok', op } as OperationGate
  })
}

export function useOperationGate(opId: string): OperationGate {
  return useServiceProjection((services, ctx) => readOperationGate(services, ctx, opId))
}

/** Re-derives the canonical preflight checks from current state at the caller's instant. */
export function readOperationPreflight(services: ConsoleServices, op: Operation, now: Instant): Check[] {
  return computePreflightChecks(services.authority.snapshot(), op, now)
}

/** The displayed 8-check derivation, re-derived from current state at the caller's instant. */
export function readOperationSpecChecks(services: ConsoleServices, op: Operation, now: Instant): PfCheck[] {
  return specChecks(services.authority.snapshot(), op, now)
}

/** Project-level execution eligibility, derived from canonical state. */
export type ProjectEligibility = { kind: EligKind; label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'cyan'; reasons: Reason[] }

export function readProjectEligibility(services: ConsoleServices, ctx: RequestContext, projectId: string): ProjectEligibility {
  return projectView(services, ctx, 'eligibility.' + projectId, (db) => eligibility(db, projectId))
}

export function useProjectEligibility(projectId: string): ProjectEligibility {
  return useServiceProjection((services, ctx) => readProjectEligibility(services, ctx, projectId))
}

/** Scheduling conflicts for a candidate start, re-derived from current state. */
export interface ScheduleProbe { id?: string; agents: string[]; assets: string[]; at: string; mins: number; nowInst: number }

export function readScheduleConflicts(services: ConsoleServices, ctx: RequestContext, probe: ScheduleProbe): ScheduleConflict[] {
  return projectView(services, ctx, 'schedule.' + JSON.stringify(probe), (db) => {
    const inst = scheduleInstantOf(probe.at)
    return inst == null ? [] : findScheduleConflicts(db, { id: probe.id, agents: probe.agents, assets: probe.assets, start: inst, mins: probe.mins }, probe.nowInst)
  })
}

export function useScheduleConflicts(probe: ScheduleProbe): ScheduleConflict[] {
  return useServiceProjection((services, ctx) => readScheduleConflicts(services, ctx, probe))
}

/** Narrow existence/project lookup for lifecycle click handlers; the write handlers re-derive every gate themselves. */
export function readOperationMeta(services: ConsoleServices, opId: string): { id: string; projectId: string } | undefined {
  const op = services.authority.snapshot().operations.find((o) => o.id === opId)
  return op ? { id: op.id, projectId: op.projectId } : undefined
}

/** Failure / agent-loss replanning read for a project's active operation (AI-V3-07). */
export interface ReplanRead {
  op: Operation
  idx: number
  step?: Operation['steps'][number]
  /** Disconnected assigned agent ids. */
  lost: string[]
  /** The operation's active plan revision; without one there is no replan surface. */
  cur: Db['plans'][number]
  pending: boolean
  /** The revision's parent version, for the draft banner. */
  prev?: Db['plans'][number]
  /** Connected assigned agent ids, for replacement suggestions. */
  healthy: string[]
}

export function readProjectReplan(services: ConsoleServices, ctx: RequestContext, projectId: string): ReplanRead | undefined {
  return projectView(services, ctx, 'replan.' + projectId, (db) => {
    const op = db.operations.find((o) => o.projectId === projectId && ['running', 'paused'].includes(o.status) && o.planId)
    if (!op) return undefined
    const idx = op.steps.findIndex((x) => ['review', 'fail', 'unknown'].includes(x.status))
    const lost = op.agents.filter((id) => db.agents.find((a) => a.id === id)?.status === 'lost')
    const cur = db.plans.find((p) => p.id === op.planId)
    if (!cur) return undefined
    const pending = !['approved', 'executed'].includes(cur.status)
    if (idx < 0 && !lost.length && !pending) return undefined
    return {
      op,
      idx,
      step: idx >= 0 ? op.steps[idx] : undefined,
      lost,
      cur,
      pending,
      prev: cur.prevPlanId ? db.plans.find((p) => p.id === cur.prevPlanId) : undefined,
      healthy: op.agents.filter((id) => db.agents.find((a) => a.id === id && (a.status === 'online' || a.status === 'idle'))),
    }
  })
}

export function useProjectReplan(projectId: string): ReplanRead | undefined {
  return useServiceProjection((services, ctx) => readProjectReplan(services, ctx, projectId))
}
