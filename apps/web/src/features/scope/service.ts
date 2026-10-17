/**
 * Scope and ROE governance port (plan P09, Scope slice).
 *
 * A revision is the authoritative record: an operator submits it, an
 * independent reviewer approves or rejects it, and an approval supersedes the
 * previously approved revision. Both modes serve this one model. The mock
 * adapter maps its approval records onto it and says so where its data is
 * coarser (`supports.roeFields` is false: the mock keeps no per-revision ROE
 * fields). The real adapter names what the backend does not yet model
 * (`unmodelled`) instead of rendering an empty list that reads as "none".
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
  /** The label the source shows for the approved version: `v3` from the backend, the project's own ROE label in mock mode. */
  versionLabel: string | null
  rootTarget: string | null
  inScope: string[]
  roe: ScopeRoe
  /** Human-readable testing window; the mock keeps free text, the real backend the structured windows above. */
  windowText: string | null
}

/** The sections of the scope read the source cannot supply, named instead of shown empty. */
export type ScopeUnmodelled = 'operations' | 'plans' | 'documents'

/** Operations and plans a scope change would affect. Null when the source has no such model. */
export interface ScopeImpact {
  prevVersion: number | null
  plans: string[]
  draftOps: string[]
  running: string[]
}

export interface ScopeRead {
  revisions: ScopeRevision[]
  latestApprovedVersion: number | null
  effective: EffectiveScope
  impact: ScopeImpact | null
  unmodelled: ScopeUnmodelled[]
  supports: { roeFields: boolean }
}

export interface ScopeSubmitInput { diff: ScopeDiff; roe: ScopeRoe }

export interface ScopeService {
  read(ctx: RequestContext): Promise<ServiceResult<ScopeRead>>
  submit(ctx: RequestContext, input: ScopeSubmitInput): Promise<ServiceResult<ScopeRevision>>
  /** `comment` is the reason a rejection needs; the mock's approval records require one, the real API takes none. */
  decide(ctx: RequestContext, revisionId: string, decision: 'approved' | 'rejected', comment?: string): Promise<ServiceResult<ScopeRevision>>
}

/** Every call resolves to an explicit unavailable outcome when the backend does not advertise scope. */
export function unavailableScopeService(): ScopeService {
  const failure = { kind: 'unavailable' as const, message: 'Scope revisions are not available on this server.' }
  return {
    read: () => Promise.resolve({ ok: false, failure }),
    submit: () => Promise.resolve({ ok: false, failure }),
    decide: () => Promise.resolve({ ok: false, failure }),
  }
}
