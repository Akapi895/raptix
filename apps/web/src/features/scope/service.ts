/**
 * Scope and ROE governance port (plan P09, Scope slice).
 *
 * A revision is the authoritative record: an operator submits it, an
 * independent reviewer approves or rejects it, and an approval supersedes the
 * previously approved revision. The real adapter reads the engagement's
 * revisions and its cumulative effective scope. The mock console keeps the
 * Scope tab of its project detail; this port answers "unavailable" there
 * until the operations and plans ports land, because that tab reads them too.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface ScopeWindow { start: string; end: string; tz: string }

export interface ScopeRoe { windows: ScopeWindow[]; emergencyContacts: string[]; restrictions: string[] }

export interface ScopeDiff { added: string[]; removed: string[]; rationale: string }

export type ScopeRevisionStatus = 'pending' | 'approved' | 'rejected' | 'superseded'

export interface ScopeRevision {
  id: string
  version: number
  status: ScopeRevisionStatus
  diff: ScopeDiff
  roe: ScopeRoe
  requestedBy: string
  decidedBy: string | null
  decisionComment: string | null
}

export interface EffectiveScope {
  version: number | null
  rootTarget: string | null
  inScope: string[]
  roe: ScopeRoe
}

export interface ScopeRead {
  revisions: ScopeRevision[]
  latestApprovedVersion: number | null
  effective: EffectiveScope
}

export interface ScopeSubmitInput { diff: ScopeDiff; roe: ScopeRoe }

export interface ScopeService {
  read(ctx: RequestContext): Promise<ServiceResult<ScopeRead>>
  submit(ctx: RequestContext, input: ScopeSubmitInput): Promise<ServiceResult<ScopeRevision>>
  decide(ctx: RequestContext, revisionId: string, decision: 'approved' | 'rejected'): Promise<ServiceResult<ScopeRevision>>
}

const MOCK_MESSAGE = 'Scope revisions are shown in the project Scope tab of the mock console; this port serves the real backend only.'

/** Every call resolves to an explicit unavailable outcome when no real scope adapter is wired. */
export function unavailableScopeService(): ScopeService {
  const failure = { kind: 'unavailable' as const, message: MOCK_MESSAGE }
  return {
    read: () => Promise.resolve({ ok: false, failure }),
    submit: () => Promise.resolve({ ok: false, failure }),
    decide: () => Promise.resolve({ ok: false, failure }),
  }
}
