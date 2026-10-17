import type { RequestContext, ServiceResult } from '../../domain/service'
import type { AuditQuery, AuditRead, AuditService } from '../../features/audit/service'
import { fetchEngagementAudit } from '../api'
import { guarded } from './shared'

export function createRealAuditService(): AuditService {
  return {
    read: (ctx: RequestContext, query: AuditQuery) => guarded(async (): Promise<ServiceResult<AuditRead>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'validation', message: 'Select an engagement before reading its audit log.' } }
      const view = await fetchEngagementAudit(ctx.projectId, query)
      return { ok: true, data: { entries: view.entries, total: view.total, truncated: view.truncated } }
    }),
  }
}
