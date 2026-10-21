/**
 * Plan policy-check derivation (ticket 39, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The workbench's risk assessment (scope / ROE binding / agents / approval
 * gates / window) is a pure projection of canonical state, owned by the
 * plans feature and shared by the screen and the service layer — the same
 * pattern as ticket 26's preflight derivation. The screen renders it; the
 * handler-side approval gates (role, self-approval, current ROE binding)
 * live in service.ts and stay the enforced subset.
 */
import type { Plan } from '../../domain/entities'
import type { Db } from '../../demo/seed';

export type Chk = { id: string; label: string; state: 'pass' | 'warn' | 'fail'; detail: string; to?: { page: string; id?: string; tab?: string } }

/** Simulated policy-engine projection: PASS / WARN / FAIL per prerequisite. */
export function policyChecks(plan: Plan, db: Db): Chk[] {
  const p = db.projects.find((x) => x.id === plan.projectId)!
  const assets = plan.assets.map((a) => db.assets.find((x) => x.id === a))
  const outs = assets.filter((a) => a?.scope !== 'in')
  const agents = plan.agents.map((a) => db.agents.find((x) => x.id === a))
  const badAg = agents.filter((a) => a && a.status !== 'online' && a.status !== 'idle')
  const excluded = db.agents.filter((a) => a.projectId === plan.projectId && a.status === 'lost' && !plan.agents.includes(a.id))
  const ungated = plan.steps.filter((s) => s.risk !== 'low' && !s.needsApproval)
  const gated = plan.steps.filter((s) => s.needsApproval).length
  const live = ['approved', 'active', 'review', 'paused'].includes(p.status)
  return [
    { id: 'scope', label: 'Scope', state: plan.assets.length === 0 ? 'fail' : outs.length ? 'fail' : 'pass', detail: plan.assets.length === 0 ? '0 approved assets — nothing in scope to target.' : outs.length ? `${outs.map((a) => a?.name).join(', ')} not in approved scope.` : `${plan.assets.length} of ${plan.assets.length} target assets are approved in scope.`, to: { page: 'assets' } },
    { id: 'roe', label: 'ROE version', state: p.roeStatus !== 'approved' ? 'fail' : plan.roeVersion !== p.roeVersion ? 'fail' : 'pass', detail: p.roeStatus !== 'approved' ? `${p.roeVersion} is ${p.roeStatus}, not approved.` : plan.roeVersion !== p.roeVersion ? `Plan is pinned to ${plan.roeVersion}; project is now on ${p.roeVersion}.` : `Plan pinned to ${plan.roeVersion} (approved).`, to: { page: 'project', id: p.id, tab: 'scope' } },
    { id: 'agents', label: 'Agents', state: plan.agents.length === 0 ? 'fail' : badAg.length ? 'fail' : 'pass', detail: plan.agents.length === 0 ? 'No project agents assigned.' : badAg.length ? `${badAg.map((a) => `${a!.id} ${a!.host}`).join(', ')} not connected.` : `${plan.agents.length} of ${plan.agents.length} assigned agents connected${excluded.length ? `; ${excluded.map((a) => a.id).join(', ')} excluded (disconnected)` : ''}.`, to: { page: 'agents' } },
    { id: 'gates', label: 'Approval gates', state: ungated.length ? 'warn' : 'pass', detail: ungated.length ? `${ungated.length} medium/high-risk step(s) have no approval gate: ${ungated.map((s) => s.id).join(', ')}.` : `${gated} step(s) require explicit action approval; all medium/high-risk steps are gated.` },
    { id: 'window', label: 'Time window', state: live ? 'pass' : 'warn', detail: live ? `Inside ROE window: ${p.window}` : `Project is ${p.status}; window ${p.window} has not started or is not approved.`, to: { page: 'project', id: p.id, tab: 'scope' } },
  ]
}
