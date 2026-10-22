import { apiFetch } from '../../platform/transport';
import { owned } from '../../platform/ownership';

/* ───────────── Scope/ROE governance (integration ticket 08) ───────────── */
export interface ScopeRevisionView {
  id: string
  engagementId: string
  version: number
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
  diff: { added: string[]; removed: string[]; rationale: string }
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  createdAt: string
}

export interface ScopeRevisionsView {
  engagementId: string
  revisions: ScopeRevisionView[]
  latestApprovedVersion: number | null
  submitSupported: true
  source: 'db'
}

export function isScopeRevisionsView(v: unknown): v is ScopeRevisionsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as ScopeRevisionsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.revisions) && doc.source === 'db'
    && doc.revisions.every((r) => typeof r.id === 'string' && typeof r.version === 'number' && typeof r.status === 'string'
      && typeof r.diff === 'object' && Array.isArray(r.diff.added) && typeof r.roe === 'object')
}

export function fetchScopeRevisions(engagementId: string): Promise<ScopeRevisionsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions`, owned(engagementId, isScopeRevisionsView))
}

export interface SubmitScopeRevisionInput {
  diff: { added: string[]; removed: string[]; rationale: string }
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
}

export function submitScopeRevision(engagementId: string, input: SubmitScopeRevisionInput): Promise<ScopeRevisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions`, (v): v is ScopeRevisionView =>
    typeof v === 'object' && v !== null && typeof (v as ScopeRevisionView).id === 'string' && typeof (v as ScopeRevisionView).version === 'number',
  { method: 'POST', body: input })
}

export function decideScopeRevision(engagementId: string, revisionId: string, decision: 'approved' | 'rejected'): Promise<ScopeRevisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions/${encodeURIComponent(revisionId)}/decision`, (v): v is ScopeRevisionView =>
    typeof v === 'object' && v !== null && (v as ScopeRevisionView).status === decision,
  { method: 'POST', body: { decision } })
}

/** W07-3: cumulative effective scope snapshot (ADR-0072 read bridge). */
export interface EffectiveScopeView {
  engagementId: string
  version: number | null
  rootTarget: string | null
  inScope: string[]
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
  source: 'db'
}

export function isEffectiveScopeView(v: unknown): v is EffectiveScopeView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as EffectiveScopeView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.inScope) && doc.source === 'db'
}

export function fetchEffectiveScope(engagementId: string): Promise<EffectiveScopeView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/effective`, owned(engagementId, isEffectiveScopeView))
}
