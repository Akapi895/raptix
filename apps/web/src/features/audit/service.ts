/** Owns audit records for simulated UI actions and exports. */
import { ROLE_LABEL } from '../../auth/policy'
import { stamp } from '../../domain/demo-clock'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'

export interface AuditInput { action: string; obj: string; result: string; reason: string }

export function recordAudit(services: ConsoleServices, ctx: RequestContext, input: AuditInput): void {
  services.authority.commit(ctx.corr, (db) => {
    db.audit.unshift({
      corr: ctx.projectId === 'RT-2026-014' && /^(SS|AR)-/.test(input.obj) ? 'COR-014-01' : undefined,
      id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role],
      projectId: ctx.projectId, ...input,
    })
  })
}
