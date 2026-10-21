/** Owns audit records for simulated UI actions and exports. */
import { ROLE_LABEL } from '../../domain/policy'
import { stamp } from '../../domain/demo-clock'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface AuditInput { action: string; obj: string; result: string; reason: string }

/**
 * Engagement audit read port (plan P09, Vault/Audit/Notices slice). The real
 * adapter returns the authoritative records with the attribution they carry;
 * vault lifecycle rows have no actor and stay actor-less.
 */
export interface AuditRecord {
  id: string
  engagementId: string | null
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  reason: string | null
  createdAt: string
  source: 'web' | 'vault'
}

export interface AuditQuery { action?: string; q?: string }

export interface AuditRead { entries: AuditRecord[]; total: number; truncated: boolean }

export interface AuditService {
  read(ctx: RequestContext, query: AuditQuery): Promise<ServiceResult<AuditRead>>
}

/** Mock mode keeps its own Activity & Audit tab; this port answers unavailable there. */
export function unavailableAuditService(): AuditService {
  const failure = { kind: 'unavailable' as const, message: 'The mock console shows its audit log in the project Activity & Audit tab; this port serves the real backend only.' }
  return { read: () => Promise.resolve({ ok: false, failure }) }
}

export function recordAudit(services: ConsoleServices, ctx: RequestContext, input: AuditInput): void {
  services.authority.commit(ctx.corr, (db) => {
    db.audit.unshift({
      corr: ctx.projectId === 'RT-2026-014' && /^(SS|AR)-/.test(input.obj) ? 'COR-014-01' : undefined,
      id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role],
      projectId: ctx.projectId, ...input,
    })
  })
}
