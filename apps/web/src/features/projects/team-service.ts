/** Owns atomic project membership edits and their audit publication. */
import { can, ROLE_LABEL } from '../../auth/policy'
import type { Project } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext, ServiceResult } from '../../domain/service'
import { stamp } from '../../domain/demo-clock'

export function setProjectMembers(services: ConsoleServices, ctx: RequestContext, members: Project['members'], action: string, obj: string): ServiceResult<Project> {
  const p = services.authority.snapshot().projects.find((x) => x.id === ctx.projectId)
  if (!p || !can(ctx.actor, 'editScope', p)) return { ok: false, failure: { kind: 'forbidden', message: 'Only a Red Team Manager or Organization Admin can manage members in an editable project.' } }
  services.authority.commit(ctx.corr, (db) => {
    const project = db.projects.find((x) => x.id === p.id)!
    project.members = members
    project.updated = stamp()
    db.audit.unshift({ id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action, obj, projectId: p.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: services.authority.snapshot().projects.find((x) => x.id === p.id)! }
}
