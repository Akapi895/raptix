/**
 * Tradecraft library port (ADR-0067, ADR-0084). The library has two parts with
 * different authority:
 *
 *  - the canonical skill corpus: read-only here; the runtime's git-based
 *    publication gates are the only way its content changes;
 *  - library proposals: engagement-scoped review of a replacement SKILL.md body.
 *    A proposal is never a corpus mutation. Its lifecycle mirrors the server:
 *    submit (draft) → amend (draft, author only) → propose (proposed) →
 *    decide (approved or rejected, by a reviewer who is not the author) →
 *    export (approved only, for the git publication workflow).
 *
 * The mock implementation is `mock.ts`; the real adapter reports SHA-256 values
 * from the server.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export type LibraryProposalStatus = 'draft' | 'proposed' | 'approved' | 'rejected'

/** One canonical corpus skill. */
export interface LibrarySkill {
  name: string
  description: string | null
  subdomain: string | null
  mitreIds: string[]
  whenToUse: string | null
  path: string | null
}

export interface LibraryCorpusQuery {
  /** Case-insensitive substring over name and description. */
  q?: string
  subdomain?: string
  /** Skills that reference this technique id. */
  mitre?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
  pageSize?: number
}

export interface LibraryCorpusRead {
  items: LibrarySkill[]
  page: number
  pageSize: number
  total: number
  counts: { skills: number; techniques: number | null }
  subdomains: string[]
  /** Corpus actions the runtime excludes from the library, with their reasons. */
  excludedActions: string[]
}

/** One canonical skill with its body and content fingerprint. */
export interface LibrarySkillDetail extends LibrarySkill {
  body: string
  /** Fingerprint of the canonical body the proposals pin (SHA-256 in real mode). */
  contentSha256: string | null
  /** Commit that published the body; null when the source does not record one. */
  commitSha: string | null
  allowedTools: string[]
  publication: 'canonical'
}

export interface LibraryTechniqueRead {
  id: string
  name: string | null
  description: string | null
  url: string | null
  skills: { name: string }[]
}

export interface LibraryProposalReview {
  id: string
  proposalVersion: number
  decision: 'approved' | 'rejected'
  comment: string | null
  reviewerId: string
  createdAt: string
}

/** One engagement-scoped proposal to replace a canonical skill body. */
export interface LibraryProposal {
  id: string
  projectId: string
  skillName: string
  skillPath: string
  /** The canonical fingerprint the proposal was pinned to when it was proposed. */
  baseRevision: string
  status: LibraryProposalStatus
  version: number
  proposedBody: string
  baseBody: string
  rationale: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  reviews: LibraryProposalReview[]
  /** False when the canonical corpus changed after the proposal was pinned. */
  canonicalCurrent?: boolean
}

export interface LibraryProposalsRead {
  items: LibraryProposal[]
  counts: Record<LibraryProposalStatus, number>
}

/** The git publication handover of an approved proposal (the same shape the real export returns). */
export interface LibraryProposalExport {
  kind: 'library-body-replacement-proposal'
  proposal: { id: string; engagementId: string; skillName: string; skillPath: string; baseRevision: string; status: string; version: number; createdBy: string }
  base: { body: string; revision: string }
  proposed: { body: string }
  diff: { before: string; after: string }
  reviews: LibraryProposalReview[]
  publicationContract: string[]
}

export interface LibraryService {
  corpus(ctx: RequestContext, query?: LibraryCorpusQuery): Promise<ServiceResult<LibraryCorpusRead>>
  skill(ctx: RequestContext, name: string): Promise<ServiceResult<LibrarySkillDetail>>
  technique(ctx: RequestContext, id: string): Promise<ServiceResult<LibraryTechniqueRead>>
  proposals(ctx: RequestContext): Promise<ServiceResult<LibraryProposalsRead>>
  proposal(ctx: RequestContext, id: string): Promise<ServiceResult<LibraryProposal>>
  submit(ctx: RequestContext, input: { skillName: string; proposedBody: string; rationale?: string }): Promise<ServiceResult<LibraryProposal>>
  amend(ctx: RequestContext, id: string, input: { proposedBody: string; expectedVersion: number; rationale?: string }): Promise<ServiceResult<LibraryProposal>>
  propose(ctx: RequestContext, id: string): Promise<ServiceResult<LibraryProposal>>
  decide(ctx: RequestContext, id: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; comment?: string }): Promise<ServiceResult<LibraryProposal>>
  exportProposal(ctx: RequestContext, id: string): Promise<ServiceResult<LibraryProposalExport>>
}

/** Simulated content fingerprint in the server's `sha256:<hex>` form: stable for a body, not a cryptographic digest. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `sha256:${hash.toString(16).padStart(8, '0').repeat(8)}`
}
