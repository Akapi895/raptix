import { apiFetch } from '../../platform/transport'

/**
 * One engagement's overview read: the governance preflight (or why it is unavailable), the completion counts the
 * server can confirm, and the latest audit entries for this engagement.
 */
export interface EngagementOverviewView {
  engagementId: string
  readiness: {
    state: 'available' | 'unavailable'
    ok: boolean | null
    failed: { id: string; detail: string | null }[]
    reason: string | null
  }
  completion: { findingsConfirmed: number | null; reportsDelivered: number | null; activeStops: number }
  activity: { action: string; actorId: string; createdAt: string }[]
  source: 'db'
}

export function fetchEngagementOverview(engagementId: string): Promise<EngagementOverviewView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/overview`, (v): v is EngagementOverviewView =>
    isEngagementOverview(v) && v.engagementId === engagementId)
}

function isEngagementOverview(v: unknown): v is EngagementOverviewView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as EngagementOverviewView
  return typeof doc.engagementId === 'string'
    && typeof doc.readiness === 'object' && doc.readiness !== null && Array.isArray(doc.readiness.failed)
    && typeof doc.completion === 'object' && doc.completion !== null
    && Array.isArray(doc.activity)
}
