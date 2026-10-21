/**
 * My Tasks domain functions (ticket 15, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Pure projections of the Command Center aggregate into the persona's task
 * inbox: pending project/scope/closure approvals, plans awaiting approval,
 * pending session access requests and report/finding reviews. Each row
 * carries the shared policy's allow/deny decision plus the reason a role
 * cannot decide, so restrictions stay visible without granting actions.
 * Seeded expiry strings are normalized with `parseDemoInstant` at this
 * boundary; the display countdown derives from the factory-clock instant the
 * Query hook supplies (24h plan-approval window, §1.7).
 */
import { APR } from '../../domain/catalog';
import { parseDemoInstant } from '../../domain/clock'
import type { CanAction } from '../../domain/permissions'
import type { ActorRef, Instant } from '../../domain/service'
import type { Approval, Finding, Plan, Report, Severity, SessionRequest } from '../../domain/entities'
import type { Route } from '../../router/history'
import { canDo } from '../../domain/dashboard'
import type { DashboardAggregate } from '../../domain/dashboard'

/** Task groups the inbox aggregates, by work type. */
export type TaskKind = 'project' | 'scope' | 'closure' | 'plan' | 'access' | 'report' | 'finding'
export const TASK_KINDS: readonly TaskKind[] = ['project', 'scope', 'closure', 'plan', 'access', 'report', 'finding']

export interface TaskItem {
  id: string
  kind: TaskKind
  label: string
  title: string
  sub: string
  project: string
  by: string
  at: string
  /** True when the persona's role may decide this item (the "assigned to me" filter). */
  allowed: boolean
  /** Why the role cannot decide — rendered for read-only rows. */
  why: string
  /** Absolute 24h plan-approval expiry instant; undefined when no deadline is set. */
  expiresAt?: Instant
  /** Scoped detail route for the row's links. */
  to: Route
}

export interface TasksSummary {
  tasks: TaskItem[]
  counts: Record<TaskKind, number>
  /** Items the persona's role can act on. */
  mine: number
}

const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' }

/** Absolute expiry instant of a plan's 24h approval window; undefined when not set. */
export const planExpiry = (p: Plan): Instant | undefined => parseDemoInstant(p.expires ?? '')

/** Minutes from the shared-clock instant `now` until an absolute deadline. */
export const minutesLeft = (at: Instant | undefined, now: Instant): number | undefined =>
  at === undefined ? undefined : Math.round((at - now) / 60_000)

const task = (a: CanAction, why: string, to: Route) => (ds: DashboardAggregate, actor: ActorRef, projectId: string) => ({
  allowed: canDo(ds, actor, a, projectId),
  why,
  to,
})

function apprItem(ds: DashboardAggregate, actor: ActorRef, a: Approval): TaskItem {
  const closure = a.type === APR.close
  const kind: TaskKind = closure ? 'closure' : a.type === APR.scope ? 'scope' : 'project'
  const base = task(closure ? 'confirmClose' : 'approve',
    closure ? 'Closure is confirmed by a Reviewer or Organization Admin.' : 'Project and scope approvals require the Reviewer or Organization Admin role.',
    { page: 'project', id: a.projectId, tab: closure ? 'close' : a.type === APR.scope ? 'scope' : undefined })(ds, actor, a.projectId)
  return {
    id: a.id, kind, label: a.type, title: `${a.type} — ${a.projectId}`,
    sub: a.diff || a.note || 'No details provided.',
    project: a.projectId, by: a.by, at: a.at, ...base,
  }
}

function planItem(ds: DashboardAggregate, actor: ActorRef, p: Plan): TaskItem {
  const selfReview = p.requestedBy === actor.id
  const base = task('approvePlan', selfReview
    ? 'You requested this plan. Another reviewer must decide.'
    : 'Plan approval requires the Reviewer or Organization Admin role.',
    { page: 'ai-plan-review', id: p.id })(ds, actor, p.projectId)
  return {
    id: p.id, kind: 'plan', label: 'Plan approval', title: `${p.id} — ${p.title}`,
    sub: `${p.steps.length} steps · ${p.steps.filter((x) => x.needsApproval).length} need explicit approval · ROE ${p.roeVersion}`,
    project: p.projectId, by: p.requestedBy, at: p.updated, allowed: base.allowed && !selfReview,
    why: base.why, expiresAt: planExpiry(p), to: base.to,
  }
}

function reqItem(ds: DashboardAggregate, actor: ActorRef, r: SessionRequest): TaskItem {
  const base = task('approveAccess', 'Session access is decided by a Red Team Manager or Organization Admin.',
    { page: 'c2-session', id: r.sessionId })(ds, actor, r.projectId)
  return {
    id: r.id, kind: 'access', label: 'Session access', title: `${r.id} — ${r.mode} access to ${r.sessionId}`,
    sub: `${r.duration} · ${r.reason}`,
    project: r.projectId, by: r.by, at: r.at, ...base,
  }
}

function repItem(ds: DashboardAggregate, actor: ActorRef, r: Report): TaskItem {
  const base = task('approveReport', 'Report approval requires the Reviewer role.',
    { page: 'report-review', id: r.id })(ds, actor, r.projectId)
  return {
    id: r.id, kind: 'report', label: 'Report review', title: `${r.id} — ${r.title}`,
    sub: `Version ${r.version} · reviewer ${r.reviewer}`,
    project: r.projectId, by: r.author, at: r.updated, ...base,
  }
}

function findItem(ds: DashboardAggregate, actor: ActorRef, f: Finding): TaskItem {
  const base = task('reviewFinding', 'Finding review requires a Manager or Reviewer.',
    { page: 'finding', id: f.id })(ds, actor, f.projectId)
  return {
    id: f.id, kind: 'finding', label: 'Finding review', title: `${f.id} — ${f.title}`,
    sub: `${SEV_LABEL[f.severity]} · ${f.asset}`,
    project: f.projectId, by: f.owner, at: f.updated, ...base,
  }
}

/**
 * One scoped inbox per actor: every pending decision across the aggregate's
 * accessible projects, in seed-stable group order (approvals, plans, access,
 * reports, findings). Records outside the aggregate never appear — the
 * service read already narrowed the scope.
 */
export function taskItems(ds: DashboardAggregate, actor: ActorRef): TasksSummary {
  const tasks: TaskItem[] = [
    ...ds.approvals.filter((a) => a.status === 'pending').map((a) => apprItem(ds, actor, a)),
    ...ds.plans.filter((p) => p.status === 'in_review').map((p) => planItem(ds, actor, p)),
    ...ds.sessionRequests.filter((r) => r.status === 'pending').map((r) => reqItem(ds, actor, r)),
    ...ds.reports.filter((r) => r.status === 'review').map((r) => repItem(ds, actor, r)),
    ...ds.findings.filter((f) => f.status === 'review').map((f) => findItem(ds, actor, f)),
  ]
  const counts = Object.fromEntries(TASK_KINDS.map((k) => [k, 0])) as Record<TaskKind, number>
  for (const t of tasks) counts[t.kind]++
  return { tasks, counts, mine: tasks.filter((t) => t.allowed).length }
}
