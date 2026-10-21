/**
 * Command Center domain functions (ticket 14, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Pure computations for the dashboard feature: eligibility, the readiness
 * checklist, project completion, KPI summaries, the attention queue and
 * grant countdowns. They consume the aggregate dataset a typed service read
 * produced — never the legacy store context — and return view-ready data.
 * Time-sensitive derivations take the absolute instant from the factory
 * clock; seeded expiry strings are normalized with `parseDemoInstant`.
 * Semantics are ported verbatim from the pre-migration store helpers and
 * pinned by the feature tests at this site.
 */
import { APR } from '../data'
import { can as policyCan } from './policy'
import { parseDemoInstant } from './clock'
import type { CanAction } from './permissions'
import type { ActorRef, Instant } from './service'
import type {
  Agent, Approval, Asset, Audit, C2Node, Finding, FindingStatus, Operation, Plan, Project,
  Report, Session, SessionRequest, Step, ToolEvent,
} from './entities'
import type { Route } from '../router/history'

/** Cross-entity slice the Command Center aggregates over (service-produced). */
export interface DashboardAggregate {
  projects: Project[]
  operations: Operation[]
  agents: Agent[]
  assets: Asset[]
  sessions: Session[]
  sessionRequests: SessionRequest[]
  findings: Finding[]
  reports: Report[]
  plans: Plan[]
  approvals: Approval[]
  audit: Audit[]
  toolEvents: ToolEvent[]
  c2Nodes: C2Node[]
}

/** Authorization decision for the aggregate's actor against a scope project. */
export const canDo = (ds: DashboardAggregate, actor: ActorRef, action: CanAction, projectId?: string) =>
  policyCan(actor, action, ds.projects.find((p) => p.id === projectId))

/* ───────────── Eligibility ───────────── */
export type EligKind = 'locked' | 'ready' | 'eligible' | 'active' | 'closed'
export interface Reason { text: string; to?: Route }
export interface Eligibility { kind: EligKind; label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'cyan'; reasons: Reason[] }

export const projectAgentsOnline = (ds: DashboardAggregate, pid: string) =>
  ds.agents.filter((a) => a.projectId === pid && (a.status === 'online' || a.status === 'idle'))

export function eligibility(ds: DashboardAggregate, pid: string): Eligibility {
  const p = ds.projects.find((x) => x.id === pid)
  if (!p) return { kind: 'locked', label: 'No project selected', tone: 'neutral', reasons: [] }
  if (p.status === 'closed') return { kind: 'closed', label: 'Read-only — project closed', tone: 'neutral', reasons: [] }
  const reasons: Reason[] = []
  const approvedAssets = ds.assets.filter((a) => a.projectId === pid && a.scope === 'in').length
  if (!['approved', 'active', 'review', 'paused'].includes(p.status)) reasons.push({ text: `Project is ${p.status === 'draft' ? 'a draft' : 'not approved'}`, to: { page: 'project', id: pid } })
  if (p.roeStatus !== 'approved') reasons.push({ text: `${p.roeVersion} is ${p.roeStatus === 'none' ? 'missing' : p.roeStatus}, not approved`, to: { page: 'project', id: pid, tab: 'scope' } })
  if (approvedAssets === 0) reasons.push({ text: '0 approved assets in scope', to: { page: 'assets' } })
  if (!p.emergency) reasons.push({ text: 'No emergency contact on the ROE', to: { page: 'project', id: pid, tab: 'scope' } })
  if (reasons.length) return { kind: 'locked', label: p.roeStatus !== 'approved' ? 'Execution locked — ROE not approved' : 'Execution locked', tone: 'bad', reasons }
  if (ds.operations.some((o) => o.projectId === pid && ['running', 'paused'].includes(o.status))) return { kind: 'active', label: 'Execution active', tone: 'cyan', reasons: [] }
  const agentsOk = projectAgentsOnline(ds, pid).length
  if (!agentsOk) reasons.push({ text: 'No connected project agents', to: { page: 'agents' } })
  const ready = ds.operations.some((o) => o.projectId === pid && o.status === 'ready')
  if (ready) return { kind: 'eligible', label: 'Eligible to start', tone: 'ok', reasons }
  return { kind: 'ready', label: reasons.length ? 'Ready for preflight (agents needed)' : 'Ready for preflight', tone: reasons.length ? 'warn' : 'ok', reasons }
}

/* ───────────── Readiness ───────────── */
export interface ReadyItem { id: string; label: string; ok: boolean; detail: string; to?: Route }
export interface Readiness { items: ReadyItem[]; done: number; total: number; pct: number }

export function readiness(ds: DashboardAggregate, pid: string): Readiness {
  const p = ds.projects.find((x) => x.id === pid)
  const assets = ds.assets.filter((a) => a.projectId === pid && a.scope === 'in').length
  const ag = ds.agents.filter((a) => a.projectId === pid)
  const agOn = ag.filter((a) => a.status === 'online' || a.status === 'idle').length
  const plan = ds.plans.find((x) => x.projectId === pid && ['approved', 'executed'].includes(x.status))
  const pf = ds.operations.some((o) => o.projectId === pid && (o.preflightAt || o.status === 'ready' || o.status === 'running'))
  const items: ReadyItem[] = [
    { id: 'r1', label: 'ROE approved', ok: p?.roeStatus === 'approved', detail: p ? `${p.roeVersion} · ${p.roeStatus}` : '—', to: { page: 'project', id: pid, tab: 'scope' } },
    { id: 'r2', label: 'Approved assets in scope', ok: assets > 0, detail: `${assets} approved`, to: { page: 'assets' } },
    { id: 'r3', label: 'Emergency contact set', ok: !!p?.emergency, detail: p?.emergency || 'Not set', to: { page: 'project', id: pid, tab: 'scope' } },
    { id: 'r4', label: 'Project agents connected', ok: agOn > 0 && agOn === ag.length, detail: `${agOn}/${ag.length} connected`, to: { page: 'agents' } },
    { id: 'r5', label: 'AI plan approved', ok: !!plan, detail: plan ? `${plan.id} ${plan.ver ?? 'v' + plan.version}` : 'No approved plan', to: { page: 'ai-operator' } },
    { id: 'r6', label: 'Preflight passed', ok: pf, detail: pf ? 'Latest preflight passed' : 'Not run', to: { page: 'operations' } },
  ]
  const done = items.filter((i) => i.ok).length
  return { items, done, total: items.length, pct: Math.round((done / items.length) * 100) }
}

/* ───────────── Completion ───────────── */
/** The closure checklist counts completion's delivery share needs (full checks are ticket 22's governance surface). */
function closureSummary(ds: DashboardAggregate, pid: string): { done: number; total: number } {
  const ops = ds.operations.filter((o) => o.projectId === pid)
  const fs = ds.findings.filter((f) => f.projectId === pid)
  const reps = ds.reports.filter((r) => r.projectId === pid)
  const checks = [
    !ops.some((o) => ['running', 'paused'].includes(o.status)),
    !ds.sessions.some((s) => s.projectId === pid && ['connected', 'available', 'awaiting', 'suspended', 'revoking'].includes(s.state)),
    !fs.some((f) => ['draft', 'review', 'returned'].includes(f.status)),
    reps.some((r) => r.status === 'delivered'),
    !ds.approvals.some((a) => a.projectId === pid && a.status === 'pending' && a.type !== APR.close),
  ]
  return { done: checks.filter(Boolean).length, total: checks.length }
}

export interface Completion {
  pct: number; objPct: number; ops: number; opsDone: number
  confirmed: number; suggested: number; inReview: number
  repLabel: string; delivered: boolean; closeDone: number; closeTotal: number
}

export function completion(ds: DashboardAggregate, pid: string): Completion {
  const p = ds.projects.find((x) => x.id === pid)
  const objs = p?.objectives ?? []
  const objPct = objs.length ? Math.round(objs.reduce((a, o) => a + o.progress, 0) / objs.length) : 0
  const ops = ds.operations.filter((o) => o.projectId === pid)
  const opsDone = ops.filter((o) => o.status === 'done').length
  const fs = ds.findings.filter((f) => f.projectId === pid)
  const confirmed = fs.filter((f) => ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)).length
  const suggested = fs.filter((f) => f.status === 'ai_suggested').length
  const inReview = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length
  const reps = ds.reports.filter((r) => r.projectId === pid)
  const delivered = reps.some((r) => r.status === 'delivered')
  const repLabel = delivered ? 'Delivered' : reps.length ? reps.map((r) => r.status).sort()[0].replace(/^./, (c) => c.toUpperCase()) : 'None'
  const close = closureSummary(ds, pid)
  const pct = Math.round(objPct * 0.5 + (delivered ? 30 : reps.some((r) => ['approved', 'exported'].includes(r.status)) ? 20 : 0) + (close.done / close.total) * 20)
  return { pct, objPct, ops: ops.length, opsDone, confirmed, suggested, inReview, repLabel, delivered, closeDone: close.done, closeTotal: close.total }
}

/* ───────────── KPIs, findings, progress ───────────── */
export const OPEN_FINDING: readonly FindingStatus[] = ['review', 'confirmed', 'remediation', 'retest', 'returned']
export const openFindings = (ds: DashboardAggregate) => ds.findings.filter((f) => OPEN_FINDING.includes(f.status))

export const opProgress = (steps: Step[]) =>
  steps.length ? Math.round((steps.filter((x) => x.status === 'ok' || x.status === 'fail').length / steps.length) * 100) : 0

export interface DashboardKpis {
  activeProjects: number; accessibleProjects: number
  running: number; totalOps: number
  reviewPlans: number; otherApprovals: number
  healthyAgents: number; totalAgents: number; offlineAgents: number
  liveSessions: number; trackedSessions: number
  openFindings: number; aiSuggested: number; criticalOrHigh: number
}

export function dashboardKpis(ds: DashboardAggregate): DashboardKpis {
  const open = openFindings(ds)
  return {
    activeProjects: ds.projects.filter((p) => ['active', 'approved', 'review', 'paused'].includes(p.status)).length,
    accessibleProjects: ds.projects.length,
    running: ds.operations.filter((o) => o.status === 'running').length,
    totalOps: ds.operations.length,
    reviewPlans: ds.plans.filter((p) => p.status === 'in_review').length,
    otherApprovals: ds.approvals.filter((a) => a.status === 'pending').length + ds.sessionRequests.filter((r) => r.status === 'pending').length,
    healthyAgents: ds.agents.filter((a) => a.status === 'online' || a.status === 'idle').length,
    totalAgents: ds.agents.length,
    offlineAgents: ds.agents.filter((a) => a.status === 'lost' || a.status === 'unhealthy').length,
    liveSessions: ds.sessions.filter((x) => x.state === 'connected').length,
    trackedSessions: ds.sessions.length,
    openFindings: open.length,
    aiSuggested: ds.findings.filter((f) => f.status === 'ai_suggested').length,
    criticalOrHigh: open.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
  }
}

/* ───────────── Attention queue ───────────── */
export type AttnTone = 'bad' | 'warn' | 'cyan'
export type AttnSource = 'agent' | 'plan' | 'request' | 'roe' | 'c2'
export interface AttentionItem {
  id: string; source: AttnSource; tone: AttnTone; kind: string
  title: string; sub: string; project: string; at?: string; cta: string; to: Route
}

/** Agent outages, plan approvals, session access and ROE issues, most urgent tone first (stable within a tone). */
export function attentionItems(ds: DashboardAggregate, actor: ActorRef): AttentionItem[] {
  const can = (action: CanAction, projectId?: string) => canDo(ds, actor, action, projectId)
  const offline = ds.agents.filter((a) => a.status === 'lost' || a.status === 'unhealthy')
  const roeIssues = ds.projects.filter((p) => ['active', 'approved', 'pending'].includes(p.status) && p.roeStatus !== 'approved')
  const items: AttentionItem[] = [
    ...offline.map((a): AttentionItem => ({ id: 'ag' + a.id, source: 'agent', tone: 'bad', kind: 'Agent offline', title: `Agent ${a.host} is ${a.status === 'lost' ? 'offline' : 'unhealthy'}`, sub: a.op ? `Assigned to ${a.op}. Last seen ${a.lastSeen}.` : `Last seen ${a.lastSeen}.`, project: a.projectId, at: a.lastSeen, cta: 'Open agent', to: { page: 'agent', id: a.id } })),
    ...ds.plans.filter((p) => p.status === 'in_review').map((p): AttentionItem => ({ id: 'pl' + p.id, source: 'plan', tone: 'warn', kind: 'Plan awaiting approval', title: `Plan ${p.id} awaiting approval`, sub: `${p.title} · requested by ${p.requestedBy}`, project: p.projectId, at: p.updated, cta: can('approvePlan', p.projectId) ? 'Review plan' : 'View plan', to: { page: 'ai-plan-review', id: p.id } })),
    ...ds.sessionRequests.filter((r) => r.status === 'pending').map((r): AttentionItem => ({ id: 'sr' + r.id, source: 'request', tone: 'warn', kind: 'Session access request', title: `${r.by} requests ${r.mode} access to ${r.sessionId}`, sub: `${r.duration} · ${r.reason}`, project: r.projectId, at: r.at, cta: can('approveAccess', r.projectId) ? 'Review request' : 'View request', to: { page: 'c2-session', id: r.sessionId } })),
    ...roeIssues.map((p): AttentionItem => ({ id: 'roe' + p.id, source: 'roe', tone: 'bad', kind: 'ROE issue', title: `${p.id} has no approved ROE (${p.roeStatus === 'none' ? 'not created' : p.roeStatus})`, sub: 'Operations cannot pass preflight until the ROE is approved.', project: p.id, at: p.updated, cta: 'Open project', to: { page: 'project', id: p.id } })),
    ...ds.c2Nodes.filter((n) => n.status === 'offline' || n.status === 'degraded').map((n): AttentionItem => ({ id: 'c2' + n.id, source: 'c2', tone: n.status === 'offline' ? 'bad' : 'warn', kind: 'C2 node', title: `C2 node ${n.name} is ${n.status}`, sub: `${n.kind} · ${n.region} · last seen ${n.last}`, project: '', at: n.last, cta: 'Open C2', to: { page: 'c2' } })),
  ]
  const rank: Record<AttnTone, number> = { bad: 0, warn: 1, cyan: 2 }
  return items.sort((a, b) => rank[a.tone] - rank[b.tone])
}

/* ───────────── Grant countdown (display; enforcement is ticket 46) ───────────── */
/** Minutes until a seeded expiry instant; undefined when the string is not a demo timestamp. */
export const grantMinutesLeft = (expires: string, now: Instant): number | undefined => {
  const at = parseDemoInstant(expires)
  return at === undefined ? undefined : Math.round((at - now) / 60_000)
}
export const formatCountdown = (mins: number | undefined) =>
  mins === undefined ? 'time unknown' : mins <= 0 ? 'expired' : mins >= 60 ? `expires in ${Math.floor(mins / 60)} h ${mins % 60} min` : `expires in ${mins} min`
