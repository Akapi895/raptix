/** Owns operation evidence uploads and their atomic audit record. */
import { can, ROLE_LABEL } from '../../domain/policy'
import { stamp } from '../../domain/demo-clock'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { Evidence } from '../../domain/entities'

export interface OperationEvidenceInput { name: string; kind: string; source: string; opId?: string; findingId?: string; sensitive: boolean }

export function addOperationEvidence(services: ConsoleServices, ctx: RequestContext, input: OperationEvidenceInput): ServiceResult<Evidence> {
  const db = services.authority.snapshot()
  const p = db.projects.find((x) => x.id === ctx.projectId)
  if (!p || !can(ctx.actor, 'run', p)) return { ok: false, failure: { kind: 'forbidden', message: 'Your role cannot attach evidence in this project.' } }
  if (!input.name.trim() || (input.opId && !db.operations.some((o) => o.id === input.opId && o.projectId === p.id)) || (input.findingId && !db.findings.some((f) => f.id === input.findingId && f.projectId === p.id))) return { ok: false, failure: { kind: 'validation', message: 'Evidence must name an accessible operation or finding in this project.' } }
  const id = 'EV-' + (400 + db.evidence.length + 1)
  services.authority.commit(ctx.corr, (d) => {
    d.evidence.push({ id, ...input, name: input.name.trim(), projectId: p.id, at: stamp(), by: ctx.actor.id })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Uploaded evidence', obj: id, projectId: p.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: services.authority.snapshot().evidence.find((e) => e.id === id)! }
}
