import type { RequestContext, ServiceResult } from '../../domain/service'

/**
 * Closure port (plan P09, Closure slice). The checklist is the source's own
 * read of the conditions that block closure; `unavailable` checks name a source
 * the backend cannot read, so they block instead of passing silently. The
 * mock adapter derives the same checklist from its records and keeps the
 * documented no-findings waiver; the real backend has no waiver.
 */
export interface ClosureCheckView {
  id: string
  label: string
  ok: boolean
  unknown: boolean
  detail: string
  /** Where the operator resolves the condition; mock-only today. */
  fix?: { page: string; tab?: string; id?: string }
}

export interface ClosureRecordView {
  id: string
  status: 'requested' | 'confirmed' | 'rejected' | 'closed' | 'cancelled'
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  reason: string
  updatedAt: string
}

export interface ClosureRead {
  checklist: ClosureCheckView[]
  /** The checklist with the no-findings waiver applied, or null when this source has no waiver. */
  waivedChecklist: ClosureCheckView[] | null
  record: ClosureRecordView | null
  readOnly: boolean
  canRequest: boolean
  requestReason: string | null
  /** A source-side gate on submitting the request while conditions fail; null when the source does not gate it. */
  requestBlockReason: string | null
  canDecide: boolean
  decideReason: string | null
}

export interface ClosureRequestInput { reason: string; waiverNoFindings: boolean }

export interface ClosureService {
  read(ctx: RequestContext): Promise<ServiceResult<ClosureRead>>
  request(ctx: RequestContext, input: ClosureRequestInput): Promise<ServiceResult<ClosureRecordView>>
  /** Returns the record the decision leaves behind: null once a rejected or cancelled request has no closure record. */
  decide(ctx: RequestContext, decision: 'confirmed' | 'rejected' | 'cancelled', reason: string): Promise<ServiceResult<ClosureRecordView | null>>
}
