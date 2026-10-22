import type { RequestContext, ServiceResult } from '../../domain/service'
import type { LibraryCorpusQuery, LibraryCorpusRead, LibraryProposal, LibraryProposalExport, LibraryProposalsRead, LibraryProposalStatus, LibraryService, LibrarySkill, LibrarySkillDetail, LibraryTechniqueRead } from './service';
import { amendLibraryProposal, decideLibraryProposal, exportLibraryProposal, fetchLibrary, fetchLibraryProposal, fetchLibraryProposals, fetchLibrarySkill, fetchLibraryTechnique, proposeLibraryProposal, submitLibraryProposal, type LibraryProposalView } from './endpoints';
import { guarded } from '../../platform/adapter-shared'

const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function notFound<T>(message: string): ServiceResult<T> {
  return { ok: false, failure: { kind: 'not-found', message } }
}

function toProposal(view: LibraryProposalView): LibraryProposal {
  return {
    id: view.id,
    projectId: view.engagementId,
    skillName: view.skillName,
    skillPath: view.skillPath,
    baseRevision: view.baseRevision,
    status: view.status,
    version: view.version,
    proposedBody: view.proposedBody,
    baseBody: view.baseBody,
    rationale: view.rationale,
    createdBy: view.createdBy,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    reviews: view.reviews.map((review) => ({ id: review.id, proposalVersion: review.proposalVersion, decision: review.decision, comment: review.comment, reviewerId: review.reviewerId, createdAt: review.createdAt })),
    canonicalCurrent: view.canonicalCurrent ?? undefined,
  }
}

function countOf(rows: readonly LibraryProposal[]): LibraryProposalsRead['counts'] {
  const counts: Record<LibraryProposalStatus, number> = { draft: 0, proposed: 0, approved: 0, rejected: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}

/** The canonical corpus is organization-wide reference data, readable by any signed-in actor. */
function signedIn<T>(ctx: RequestContext): ServiceResult<T> | null {
  return ctx.actor.id ? null : { ok: false, failure: { kind: 'forbidden', message: 'Sign in to read the library corpus.' } }
}

function specificProject(ctx: RequestContext): ServiceResult<string> {
  if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'unavailable', message: 'Select an engagement before working with library proposals.' } }
  return { ok: true, data: ctx.projectId }
}

/**
 * Real LibraryService (ADR-0084). The corpus is the server's canonical skill
 * set and is read-only here. Proposals are the engagement-scoped review workflow
 * and every write sends the version the caller read.
 */
export function createRealLibraryService(): LibraryService {
  return {
    corpus: (ctx, query: LibraryCorpusQuery = {}) => guarded(async (): Promise<ServiceResult<LibraryCorpusRead>> => {
      const denied = signedIn<LibraryCorpusRead>(ctx)
      if (denied) return denied
      const view = await fetchLibrary()
      const needle = query.q?.trim().toLowerCase() ?? ''
      const rows: LibrarySkill[] = view.skills.filter((skill) =>
        (!needle || skill.name.toLowerCase().includes(needle) || (skill.description ?? '').toLowerCase().includes(needle))
        && (!query.subdomain || skill.subdomain === query.subdomain)
        && (!query.mitre || skill.mitreIds.includes(query.mitre)))
      const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE)
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
      const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
      return {
        ok: true,
        data: {
          items: rows.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: rows.length,
          counts: view.counts,
          subdomains: [...new Set(view.skills.map((skill) => skill.subdomain).filter((s): s is string => s !== null))].sort(),
          excludedActions: view.excludedActions,
        },
      }
    }),

    skill: (ctx, name: string) => guarded(async (): Promise<ServiceResult<LibrarySkillDetail>> => {
      const denied = signedIn<LibrarySkillDetail>(ctx)
      if (denied) return denied
      if (!name) return notFound(`Skill ${name} does not exist in the corpus.`)
      const detail = await fetchLibrarySkill(name)
      return {
        ok: true,
        data: {
          name: detail.name,
          description: detail.description,
          subdomain: detail.subdomain,
          mitreIds: detail.mitreIds,
          whenToUse: detail.whenToUse,
          path: detail.path,
          body: detail.body,
          contentSha256: detail.contentSha256,
          commitSha: detail.commitSha,
          allowedTools: detail.allowedTools,
          publication: 'canonical',
        },
      }
    }),

    technique: (ctx, id: string) => guarded(async (): Promise<ServiceResult<LibraryTechniqueRead>> => {
      const denied = signedIn<LibraryTechniqueRead>(ctx)
      if (denied) return denied
      const detail = await fetchLibraryTechnique(id)
      return { ok: true, data: { id: detail.id, name: detail.name, description: detail.description, url: detail.url, skills: detail.skills } }
    }),

    proposals: (ctx) => guarded(async (): Promise<ServiceResult<LibraryProposalsRead>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      const view = await fetchLibraryProposals(project.data)
      const items = view.proposals.map(toProposal)
      return { ok: true, data: { items, counts: countOf(items) } }
    }),

    proposal: (ctx, id: string) => guarded(async (): Promise<ServiceResult<LibraryProposal>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      return { ok: true, data: toProposal(await fetchLibraryProposal(project.data, id)) }
    }),

    submit: (ctx, input) => guarded(async (): Promise<ServiceResult<LibraryProposal>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      return { ok: true, data: toProposal(await submitLibraryProposal(project.data, input)) }
    }),

    amend: (ctx, id, input) => guarded(async (): Promise<ServiceResult<LibraryProposal>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      return { ok: true, data: toProposal(await amendLibraryProposal(project.data, id, input)) }
    }),

    propose: (ctx, id) => guarded(async (): Promise<ServiceResult<LibraryProposal>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      return { ok: true, data: toProposal(await proposeLibraryProposal(project.data, id)) }
    }),

    decide: (ctx, id, input) => guarded(async (): Promise<ServiceResult<LibraryProposal>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      return { ok: true, data: toProposal(await decideLibraryProposal(project.data, id, input)) }
    }),

    exportProposal: (ctx, id) => guarded(async (): Promise<ServiceResult<LibraryProposalExport>> => {
      const project = specificProject(ctx)
      if (!project.ok) return project
      const view = await exportLibraryProposal(project.data, id)
      return {
        ok: true,
        data: {
          kind: view.kind,
          proposal: { id: view.proposal.id, engagementId: view.proposal.engagementId, skillName: view.proposal.skillName, skillPath: view.proposal.skillPath, baseRevision: view.proposal.baseRevision, status: view.proposal.status, version: view.proposal.version, createdBy: view.proposal.createdBy },
          base: view.base,
          proposed: view.proposed,
          diff: view.diff,
          reviews: view.reviews.map((review) => ({ id: review.id, proposalVersion: review.proposalVersion, decision: review.decision, comment: review.comment, reviewerId: review.reviewerId, createdAt: review.createdAt })),
          publicationContract: view.publicationContract,
        },
      }
    }),
  }
}
