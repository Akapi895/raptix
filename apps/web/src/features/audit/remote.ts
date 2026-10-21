import { apiFetch } from '../../platform/transport';

export interface AuditEntryView {
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

export interface AuditView {
  engagementId: string | null
  entries: AuditEntryView[]
  total: number
  truncated: boolean
  actors: string[]
  actions: string[]
  source: 'db'
}

export function isAuditView(v: unknown): v is AuditView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AuditView
  return Array.isArray(doc.entries) && doc.entries.every((e) => typeof e.id === 'string' && typeof e.action === 'string' && (e.source === 'web' || e.source === 'vault')) && typeof doc.total === 'number' && doc.source === 'db'
}

export interface AuditQueryInput { action?: string; actor?: string; q?: string; limit?: number }

export function auditQueryString(query: AuditQueryInput): string {
  const params = new URLSearchParams()
  if (query.action) params.set('action', query.action)
  if (query.actor) params.set('actor', query.actor)
  if (query.q) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const s = params.toString()
  return s.length > 0 ? `?${s}` : ''
}

export function fetchWorkspaceAudit(query: AuditQueryInput = {}): Promise<AuditView> {
  return apiFetch(`/audit${auditQueryString(query)}`, isAuditView)
}

export function fetchEngagementAudit(engagementId: string, query: AuditQueryInput = {}): Promise<AuditView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/audit${auditQueryString(query)}`, (v): v is AuditView => isAuditView(v) && v.engagementId === engagementId)
}
