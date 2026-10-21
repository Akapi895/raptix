import { apiFetch } from '../../platform/transport';

/* ───────────── Engagement closure (integration ticket 17) ───────────── */
export interface ClosureChecklistEntryView {
  id: string
  state: 'pass' | 'fail' | 'unavailable'
  detail: string | null
}

export interface ClosureView {
  id: string
  engagementId: string
  status: 'requested' | 'confirmed' | 'rejected' | 'closed' | 'cancelled'
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  reason: string
  checklist: { entries: ClosureChecklistEntryView[]; ok: boolean }
  createdAt: string
  updatedAt: string
  source: 'db'
}

export interface ClosureSurfaceView {
  engagementId: string
  closure: ClosureView | null
  readOnly: boolean
  checklist: { entries: ClosureChecklistEntryView[]; ok: boolean }
  source: 'db'
}

export function isClosureSurfaceView(engagementId: string): (v: unknown) => v is ClosureSurfaceView {
  return (v): v is ClosureSurfaceView =>
    typeof v === 'object' && v !== null && (v as ClosureSurfaceView).engagementId === engagementId
    && typeof (v as ClosureSurfaceView).readOnly === 'boolean' && (v as ClosureSurfaceView).source === 'db'
}

export function fetchClosure(engagementId: string): Promise<ClosureSurfaceView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure`, isClosureSurfaceView(engagementId))
}

export function requestClosure(engagementId: string, reason: string): Promise<ClosureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure/request`, (v): v is ClosureView =>
    typeof v === 'object' && v !== null && typeof (v as ClosureView).id === 'string' && typeof (v as ClosureView).status === 'string',
  { method: 'POST', body: { reason } })
}

export function decideClosure(engagementId: string, decision: 'confirmed' | 'rejected' | 'cancelled'): Promise<ClosureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure/decision`, (v): v is ClosureView =>
    typeof v === 'object' && v !== null && typeof (v as ClosureView).status === 'string',
  { method: 'POST', body: { decision } })
}
