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
