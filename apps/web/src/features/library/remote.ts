import { apiFetch } from '../../platform/transport';

/* ───────────── Tradecraft library and observed analysis (integration ticket 14) ───────────── */
export interface LibrarySkillView {
  name: string
  description: string | null
  subdomain: string | null
  mitreIds: string[]
  whenToUse: string | null
  path: string | null
}

export interface LibraryView {
  skills: LibrarySkillView[]
  counts: { skills: number; techniques: number | null }
  excludedActions: string[]
  sources: { skills: string }
  source: 'graph'
}

export function isLibraryView(v: unknown): v is LibraryView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as LibraryView
  return Array.isArray(doc.skills) && typeof doc.counts === 'object' && doc.source === 'graph'
}

export function fetchLibrary(): Promise<LibraryView> {
  return apiFetch('/library', isLibraryView)
}

/** Canonical single-skill detail (the graph Skill node is the only publication). */
export interface LibrarySkillDetailView {
  name: string
  description: string | null
  subdomain: string | null
  mitreIds: string[]
  whenToUse: string | null
  path: string | null
  body: string
  contentSha256: string | null
  commitSha: string | null
  allowedTools: string[]
  publication: 'canonical'
}

export function fetchLibrarySkill(name: string): Promise<LibrarySkillDetailView> {
  return apiFetch(`/library/skills/${encodeURIComponent(name)}`, (v): v is LibrarySkillDetailView =>
    typeof v === 'object' && v !== null && (v as LibrarySkillDetailView).publication === 'canonical' && typeof (v as LibrarySkillDetailView).body === 'string')
}

export interface LibraryTechniqueDetailView {
  id: string
  name: string | null
  description: string | null
  url: string | null
  skills: { name: string }[]
}

export function fetchLibraryTechnique(id: string): Promise<LibraryTechniqueDetailView> {
  return apiFetch(`/library/techniques/${encodeURIComponent(id)}`, (v): v is LibraryTechniqueDetailView =>
    typeof v === 'object' && v !== null && typeof (v as LibraryTechniqueDetailView).id === 'string' && Array.isArray((v as LibraryTechniqueDetailView).skills))
}

/** ADR-0070 engagement-scoped library review proposals (never a corpus mutation API). */
export interface LibraryProposalReviewView {
  id: string
  proposalVersion: number
  decision: 'approved' | 'rejected'
  comment: string | null
  reviewerId: string
  createdAt: string
}

export interface LibraryProposalView {
  id: string
  engagementId: string
  skillName: string
  skillPath: string
  baseRevision: string
  status: 'draft' | 'proposed' | 'approved' | 'rejected'
  version: number
  proposedBody: string
  baseBody: string
  rationale: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  reviews: LibraryProposalReviewView[]
  canonicalCurrent?: boolean
}

export function isLibraryProposalView(v: unknown): v is LibraryProposalView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as LibraryProposalView
  return typeof doc.id === 'string' && typeof doc.skillName === 'string' && typeof doc.version === 'number' && Array.isArray(doc.reviews)
}

export function fetchLibraryProposals(engagementId: string): Promise<{ engagementId: string; proposals: LibraryProposalView[]; source: 'db' }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals`, (v): v is { engagementId: string; proposals: LibraryProposalView[]; source: 'db' } =>
    typeof v === 'object' && v !== null && Array.isArray((v as { proposals?: unknown }).proposals) && (v as { source?: unknown }).source === 'db')
}

/** W18: detail read by proposal id — the only place canonicalCurrent is authoritative. */
export function fetchLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && (v as LibraryProposalView).engagementId === engagementId)
}

export function submitLibraryProposal(engagementId: string, input: { skillName: string; proposedBody: string; rationale?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && v.status === 'draft' && v.version === 1,
  { method: 'POST', body: input })
}

export function amendLibraryProposal(engagementId: string, proposalId: string, input: { proposedBody: string; expectedVersion: number; rationale?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/amendments`, isLibraryProposalView,
    { method: 'POST', body: input })
}

export function proposeLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/propose`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && v.status === 'proposed',
  { method: 'POST' })
}

export function decideLibraryProposal(engagementId: string, proposalId: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; comment?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/decision`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && (v.status === 'approved' || v.status === 'rejected'),
  { method: 'POST', body: input })
}

export interface LibraryProposalExportView {
  kind: 'library-body-replacement-proposal'
  proposal: { id: string; engagementId: string; skillName: string; skillPath: string; baseRevision: string; status: string; version: number; createdBy: string }
  base: { body: string; revision: string }
  proposed: { body: string }
  diff: { before: string; after: string }
  reviews: LibraryProposalReviewView[]
  publicationContract: string[]
}

export function exportLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalExportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/export`, (v): v is LibraryProposalExportView =>
    typeof v === 'object' && v !== null && (v as LibraryProposalExportView).kind === 'library-body-replacement-proposal' && Array.isArray((v as LibraryProposalExportView).publicationContract))
}
