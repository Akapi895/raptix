/** Derives the displayed preflight checklist alongside the canonical execution checks. */
import { planVer, type Db, type Operation } from '../../data'
import type { Instant } from '../../domain/service'
import type { Route } from '../../router/history'
import { computePreflightChecks, roeWindowIssue, scheduleInstantOf } from './preflight'

export type PfState = 'pass' | 'warn' | 'fail' | 'nc'
export interface PfCheck { n: number; code: string; label: string; state: PfState; detail: string; fix?: string; to?: Route }

export function specChecks(db: Db, op: Operation, now: Instant): PfCheck[] {
  const raw = computePreflightChecks(db, op, now)
  const g = (c: string) => raw.find((x) => x.code === c)!
  const p = db.projects.find((x) => x.id === op.projectId)!
  const pl = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const roeTo: Route = { page: 'project', tab: 'scope', id: p.id }
  const st = (c: { state: string }): PfState => (c.state === 'pass' ? 'pass' : 'fail')
  const out: PfCheck[] = []
  const r1 = g('PRE-01'), r2 = g('PRE-02')
  out.push({ n: 1, code: 'PF-1', label: 'Project status and ROE approval / version', state: r1.state !== 'pass' || r2.state !== 'pass' ? 'fail' : 'pass', detail: r1.state !== 'pass' ? r1.detail : r2.detail, fix: 'Open Scope & ROE', to: roeTo })
  const r3 = g('PRE-03')
  out.push({ n: 2, code: 'PF-2', label: 'Target allowlist and excluded assets', state: st(r3), detail: r3.state === 'pass' ? `${r3.detail}. Excluded assets are not targeted.` : r3.detail, fix: 'Review assets', to: r3.fixRoute })
  const start = op.schedule && op.schedule !== 'now' ? scheduleInstantOf(op.schedule) : undefined
  const wi = start != null ? roeWindowIssue(p, start) : ''
  out.push({ n: 3, code: 'PF-3', label: 'Time window and project timezone', state: wi ? 'warn' : 'pass', detail: wi || `${p.window}; project timezone Asia/Ho_Chi_Minh (UTC+7)`, fix: wi ? 'Reschedule' : undefined, to: wi ? { page: 'operation-schedule', id: op.id } : undefined })
  const r5 = g('PRE-05'), r7 = g('PRE-07')
  out.push({ n: 4, code: 'PF-4', label: 'Approved plan / playbook version and risk review', state: r5.state !== 'pass' || r7.state !== 'pass' ? 'fail' : 'pass', detail: r5.state !== 'pass' ? r5.detail : r7.state !== 'pass' ? r7.detail : `${r5.detail}${pl ? `; plan ${pl.id} ${planVer(pl)} approved` : '; manual operation, no AI plan'}`, fix: r5.state !== 'pass' ? r5.fix : r7.fix, to: r5.state !== 'pass' ? r5.fixRoute : r7.fixRoute })
  const r6 = g('PRE-06')
  const lostAgents = op.agents.map((id) => db.agents.find((a) => a.id === id)).filter((a) => a && a.status !== 'online')
  out.push({ n: 5, code: 'PF-5', label: 'Agent connectivity, assignment and reservation', state: st(r6), detail: lostAgents.length ? `${lostAgents.map((a) => `${a!.id} (${a!.host}) is ${a!.status === 'lost' ? 'disconnected' : a!.status}, last seen ${a!.lastSeen}`).join('; ')}. Remedy: restore the agent or replace it.` : r6.detail, fix: lostAgents.length ? `View ${lostAgents[0]!.id}` : r6.fix, to: lostAgents.length ? { page: 'agent', id: lostAgents[0]!.id } : r6.fixRoute })
  const ch = db.channels.filter((c) => c.projectId === p.id)
  const nodes = ch.map((c) => db.c2Nodes.find((n) => n.id === c.nodeId)).filter(Boolean)
  const badCh = ch.filter((c) => c.status === 'disconnected'), warnCh = ch.filter((c) => c.status === 'degraded' || db.c2Nodes.find((n) => n.id === c.nodeId)?.status === 'degraded')
  out.push({ n: 6, code: 'PF-6', label: 'C2 channel health (if relevant)', state: op.agents.length === 0 || ch.length === 0 ? 'nc' : badCh.length ? 'fail' : warnCh.length ? 'warn' : 'pass',
    detail: op.agents.length === 0 ? 'Not checked: no agents are assigned, so no channel is relevant yet.' : ch.length === 0 ? 'Not checked: this project has no C2 channel configured.' : badCh.length ? `Channel ${badCh.map((c) => c.id).join(', ')} is disconnected.` : warnCh.length ? `Channel ${warnCh.map((c) => c.id).join(', ')} is degraded (node ${nodes.filter((n) => n!.status === 'degraded').map((n) => n!.name).join(', ') || 'latency'}). Execution may continue with higher latency.` : `${ch.length} channel(s) healthy`, fix: 'Open C2', to: { page: 'c2' } })
  const r8 = g('PRE-08')
  const member = p.members.find((m) => m.user === op.owner)
  const opOk = !!member && ['manager', 'operator'].includes(member.role)
  out.push({ n: 7, code: 'PF-7', label: 'Emergency contact and authorized operator', state: r8.state !== 'pass' ? 'fail' : opOk ? 'pass' : 'warn', detail: r8.state !== 'pass' ? r8.detail : opOk ? `${r8.detail}; operator ${op.owner} authorized` : `${r8.detail}; ${op.owner} is not a Manager/Operator on this project team`, fix: r8.state !== 'pass' ? 'Update ROE' : 'Open team', to: r8.state !== 'pass' ? roeTo : { page: 'project', tab: 'team', id: p.id } })
  const upstream = out.filter((c) => c.state === 'fail').length
  out.push({ n: 8, code: 'PF-8', label: 'Runtime policy decision and audit readiness', state: upstream ? 'nc' : 'pass', detail: upstream ? 'Not checked until checks 1-7 have no failures. No policy decision can be made yet.' : 'Policy decision: Allowed within approved ROE and scope. Audit log writable (simulated).' })
  return out
}
