/**
 * The write gates every operation write shares: membership and role at the project, and the step linkage of a created draft. Pure over
 * the dataset it is given, so the port file and the mock implementation import these without importing each other.
 */
import { can, projectAccessible, projectLocked, readOnlyContext } from '../../domain/policy'
import type { Db } from '../../demo/seed'
import type { Playbook, Plan, Project, Step } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

const pad2 = (n: number) => String(n).padStart(2, '0')

export const IN_FLIGHT: readonly string[] = ['running', 'paused', 'done', 'cancelled', 'estop', 'error']

/** Membership + role gate shared by every operation write. `action` is the active verb phrase
 * ("create operations"); `passive` is its participle ("created") for refusal messages. */
export function operationWriteGate(
  db: Db,
  ctx: RequestContext,
  projectId: string,
  action: string,
  passive: string,
): ServiceResult<Project> {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `The Viewer role has read-only access${projectLocked(project) ? ` (project ${project.id} is ${project.status})` : ''}; operations cannot be ${passive}.` } }
  }
  if (!can({ id: ctx.actor.id, role: ctx.actor.role }, 'run', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Manager or Operator can ${action}.` } }
  }
  return { ok: true, data: project }
}


/** Step linkage for a created draft: plan steps win, otherwise the approved playbook's sequence (legacy parity). */
export function draftSteps(planSteps: Plan['steps'] | undefined, pb: Playbook | undefined, agents: string[], assetNames: string[]): Step[] {
  if (planSteps) {
    return planSteps.map((st, i) => ({ id: 'S' + pad2(i + 1), name: st.name, agent: st.agent, asset: st.asset, technique: st.technique, status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
  }
  const techs = pb?.techniques || ['T1082']
  return (pb?.steps || []).map((name, i) => ({ id: 'S' + pad2(i + 1), name, agent: agents.length ? agents[i % agents.length] : '—', asset: assetNames.length ? assetNames[i % assetNames.length] : '—', technique: techs[i % techs.length], status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
}

