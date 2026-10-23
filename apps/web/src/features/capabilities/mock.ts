/**
 * Mock tradecraft library over the database authority (ADR-0067, ADR-0084). The
 * corpus is read-only skills derived from the playbook seed; proposals live in
 * `db.libraryProposals`. Fingerprints are simulated; the real adapter reports the
 * server's SHA-256 values.
 */
import { TECHNIQUES } from '../../domain/catalog'
import type { Db } from '../../demo/seed'
import type { DbAuthority } from '../../demo/authority'
import type { Playbook } from '../../domain/entities'
import { formatDemoInstant } from '../../domain/clock'
import { projectAccessible, projectLocked } from '../../domain/policy'
import type { ActorRef, Clock, RequestContext, ServiceResult } from '../../domain/service'
import { fingerprint, summarizeCorpus, type LibrarySkill, type LibraryCorpusQuery, type LibraryCorpusRead, type LibrarySkillDetail, type LibraryTechniqueRead, type LibraryProposal, type LibraryProposalsRead, type LibraryProposalExport, type LibraryService } from './service'

/** Roles that may submit, amend and propose a library proposal (server: operator and above). */
const SUBMIT_ROLES: readonly string[] = ['admin', 'manager', 'operator']

/** Roles that may decide a proposal (server: reviewer and above; never the author). */
const DECIDE_ROLES: readonly string[] = ['admin', 'manager', 'reviewer']

/** The canonical body of a corpus skill, derived from its playbook seed. */
export function skillBody(p: Playbook): string {
  return [`# ${p.name}`, '', p.goal, '', ...p.steps.map((step, index) => `${index + 1}. ${step}`)].join('\n')
}

export function toSkill(p: Playbook): LibrarySkill {
  const tactic = TECHNIQUES.find((t) => p.techniques.includes(t.id))?.tactic ?? null
  return {
    name: p.id,
    description: p.desc,
    subdomain: tactic,
    mitreIds: p.techniques,
    whenToUse: p.goal,
    path: `skills/${p.id}/SKILL.md`,
  }
}

/** The corpus is organization-wide reference data: any signed-in actor reads it. */
export function corpusSkills(db: Db): Playbook[] {
  return db.playbooks
}

/** Proposal access follows project membership; a foreign project reads as not found. */
export function projectOf(db: Db, actor: ActorRef, projectId: string): ServiceResult<true> {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project || !projectAccessible(project, actor)) return { ok: false, failure: { kind: 'not-found', message: 'Library proposals for this engagement are not available for your account.' } }
  return { ok: true, data: true }
}

export function specificScope(ctx: RequestContext): ServiceResult<string> {
  if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'validation', message: 'Select an engagement before working with library proposals.' } }
  return { ok: true, data: ctx.projectId }
}

export function listCorpus(db: Db, query: LibraryCorpusQuery = {}): ServiceResult<LibraryCorpusRead> {
  const needle = query.q?.trim().toLowerCase() ?? ''
  const all = corpusSkills(db).map(toSkill)
  const rows = all.filter((skill) =>
    (!needle || skill.name.toLowerCase().includes(needle) || (skill.description ?? '').toLowerCase().includes(needle))
    && (!query.subdomain || skill.subdomain === query.subdomain)
    && (!query.mitre || skill.mitreIds.includes(query.mitre)))
  const pageSize = Math.min(Math.max(1, query.pageSize ?? 10), 100)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
  return {
    ok: true,
    data: {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: rows.length,
      counts: { skills: all.length, techniques: TECHNIQUES.length },
      ...summarizeCorpus(all),
      excludedActions: [],
    },
  }
}

export function skillDetail(db: Db, name: string): ServiceResult<LibrarySkillDetail> {
  const playbook = corpusSkills(db).find((p) => p.id === name)
  if (!playbook) return { ok: false, failure: { kind: 'not-found', message: `Skill ${name} does not exist in the corpus.` } }
  const body = skillBody(playbook)
  return { ok: true, data: { ...toSkill(playbook), body, contentSha256: fingerprint(body), commitSha: null, allowedTools: [], publication: 'canonical' } }
}

export function techniqueDetail(db: Db, id: string): ServiceResult<LibraryTechniqueRead> {
  const technique = TECHNIQUES.find((t) => t.id === id)
  if (!technique) return { ok: false, failure: { kind: 'not-found', message: `Technique ${id} does not exist in the ATT&CK catalog.` } }
  const skills = corpusSkills(db).filter((p) => p.techniques.includes(id)).map((p) => ({ name: p.id }))
  return { ok: true, data: { id, name: technique.name, description: technique.desc, url: null, skills } }
}

/** A proposal's canonical pin is current while the corpus body still has the fingerprint it was pinned to. */
export function withCanonical(db: Db, row: LibraryProposal): LibraryProposal {
  const playbook = corpusSkills(db).find((p) => p.id === row.skillName)
  const current = playbook ? fingerprint(skillBody(playbook)) === row.baseRevision : false
  return { ...row, canonicalCurrent: current }
}

export function count(rows: readonly LibraryProposal[]): LibraryProposalsRead['counts'] {
  return {
    draft: rows.filter((r) => r.status === 'draft').length,
    proposed: rows.filter((r) => r.status === 'proposed').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  }
}

export function listProposals(db: Db, ctx: RequestContext): ServiceResult<LibraryProposalsRead> {
  const scope = specificScope(ctx)
  if (!scope.ok) return scope
  const access = projectOf(db, ctx.actor, scope.data)
  if (!access.ok) return access
  const rows = db.libraryProposals.filter((r) => r.projectId === scope.data).map((r) => withCanonical(db, r))
  return { ok: true, data: { items: rows, counts: count(rows) } }
}

export function ownedProposal(db: Db, ctx: RequestContext, id: string): ServiceResult<LibraryProposal> {
  const scope = specificScope(ctx)
  if (!scope.ok) return scope
  const access = projectOf(db, ctx.actor, scope.data)
  if (!access.ok) return access
  const row = db.libraryProposals.find((r) => r.id === id && r.projectId === scope.data)
  if (!row) return { ok: false, failure: { kind: 'not-found', message: `Library proposal ${id} does not exist for this engagement.` } }
  return { ok: true, data: row }
}

export function getProposal(db: Db, ctx: RequestContext, id: string): ServiceResult<LibraryProposal> {
  const row = ownedProposal(db, ctx, id)
  return row.ok ? { ok: true, data: withCanonical(db, row.data) } : row
}

/** Common write gate: a specific engagement, an open project and the role for the action. */
export function writeGate(db: Db, ctx: RequestContext, roles: readonly string[], message: string): ServiceResult<string> {
  const scope = specificScope(ctx)
  if (!scope.ok) return scope
  const project = db.projects.find((p) => p.id === scope.data)
  if (!project || !projectAccessible(project, ctx.actor)) return { ok: false, failure: { kind: 'not-found', message: 'Library proposals for this engagement are not available for your account.' } }
  if (projectLocked(project)) return { ok: false, failure: { kind: 'forbidden', message: 'The engagement is closed; library proposals are read-only.' } }
  if (!roles.includes(ctx.actor.role)) return { ok: false, failure: { kind: 'forbidden', message } }
  return { ok: true, data: scope.data }
}

export function submitProposal(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: { skillName: string; proposedBody: string; rationale?: string }): ServiceResult<LibraryProposal> {
  const db = authority.snapshot()
  const gate = writeGate(db, ctx, SUBMIT_ROLES, 'Your role cannot submit library proposals.')
  if (!gate.ok) return gate
  const skillName = input.skillName.trim()
  const playbook = corpusSkills(db).find((p) => p.id === skillName)
  if (!playbook) return { ok: false, failure: { kind: 'validation', message: `Skill ${skillName || '(none)'} is not in the canonical corpus.` } }
  if (input.proposedBody.trim().length === 0) return { ok: false, failure: { kind: 'validation', message: 'The replacement body is required.' } }
  if (db.libraryProposals.some((r) => r.projectId === gate.data && r.skillName === skillName && (r.status === 'draft' || r.status === 'proposed'))) {
    return { ok: false, failure: { kind: 'conflict', message: `A proposal for ${skillName} is already in independent review.` } }
  }
  const at = formatDemoInstant(clock.now())
  const row: LibraryProposal = {
    id: `LP-${db.libraryProposals.length + 1}`,
    projectId: gate.data,
    skillName,
    skillPath: `skills/${skillName}/SKILL.md`,
    baseRevision: fingerprint(skillBody(playbook)),
    status: 'draft',
    version: 1,
    proposedBody: input.proposedBody,
    baseBody: skillBody(playbook),
    rationale: input.rationale?.trim() || null,
    createdBy: ctx.actor.id,
    createdAt: at,
    updatedAt: at,
    reviews: [],
  }
  authority.commit(ctx.corr, (d) => { d.libraryProposals.push(row) })
  return { ok: true, data: withCanonical(db, row) }
}

export function amendProposal(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: { proposedBody: string; expectedVersion: number; rationale?: string }): ServiceResult<LibraryProposal> {
  const db = authority.snapshot()
  const gate = writeGate(db, ctx, SUBMIT_ROLES, 'Your role cannot amend library proposals.')
  if (!gate.ok) return gate
  const row = ownedProposal(db, ctx, id)
  if (!row.ok) return row
  if (row.data.createdBy !== ctx.actor.id) return { ok: false, failure: { kind: 'forbidden', message: 'Only the original author can amend a library proposal.' } }
  if (row.data.version !== input.expectedVersion) return { ok: false, failure: { kind: 'conflict', message: `Concurrent edit: the proposal moved to version ${row.data.version} while you edited version ${input.expectedVersion}.` } }
  if (input.proposedBody.trim().length === 0) return { ok: false, failure: { kind: 'validation', message: 'The replacement body is required.' } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const target = d.libraryProposals.find((r) => r.id === id)!
    target.proposedBody = input.proposedBody
    target.rationale = input.rationale?.trim() || target.rationale
    target.version += 1
    target.status = 'draft'
    target.updatedAt = at
  })
  return getProposal(authority.snapshot(), ctx, id)
}

export function proposeProposal(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<LibraryProposal> {
  const db = authority.snapshot()
  const gate = writeGate(db, ctx, SUBMIT_ROLES, 'Your role cannot propose library proposals.')
  if (!gate.ok) return gate
  const row = ownedProposal(db, ctx, id)
  if (!row.ok) return row
  if (row.data.status !== 'draft') return { ok: false, failure: { kind: 'conflict', message: `Proposal is already ${row.data.status}.` } }
  if (!withCanonical(db, row.data).canonicalCurrent) {
    return { ok: false, failure: { kind: 'conflict', message: `The canonical corpus changed since proposal v${row.data.version} was pinned; amend the proposal against the current content before review.` } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const target = d.libraryProposals.find((r) => r.id === id)!
    target.status = 'proposed'
    target.updatedAt = at
  })
  return getProposal(authority.snapshot(), ctx, id)
}

export function decideProposal(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; comment?: string }): ServiceResult<LibraryProposal> {
  const db = authority.snapshot()
  const gate = writeGate(db, ctx, DECIDE_ROLES, 'Only a reviewer can decide a library proposal.')
  if (!gate.ok) return gate
  const row = ownedProposal(db, ctx, id)
  if (!row.ok) return row
  if (row.data.createdBy === ctx.actor.id) return { ok: false, failure: { kind: 'forbidden', message: 'The author cannot decide their own library proposal.' } }
  if (row.data.status !== 'proposed') return { ok: false, failure: { kind: 'conflict', message: `Proposal is ${row.data.status}, not in review.` } }
  if (row.data.version !== input.expectedVersion) return { ok: false, failure: { kind: 'conflict', message: `The proposal moved to version ${row.data.version}; reload before deciding.` } }
  if (!withCanonical(db, row.data).canonicalCurrent) return { ok: false, failure: { kind: 'conflict', message: 'The canonical corpus changed since this proposal was pinned; amend it before deciding.' } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const target = d.libraryProposals.find((r) => r.id === id)!
    target.status = input.decision
    target.updatedAt = at
    target.reviews.push({ id: `LPR-${target.reviews.length + 1}-${id}`, proposalVersion: target.version, decision: input.decision, comment: input.comment?.trim() || null, reviewerId: ctx.actor.id, createdAt: at })
  })
  return getProposal(authority.snapshot(), ctx, id)
}

export function exportProposal(db: Db, ctx: RequestContext, id: string): ServiceResult<LibraryProposalExport> {
  const row = ownedProposal(db, ctx, id)
  if (!row.ok) return row
  if (row.data.status !== 'approved') return { ok: false, failure: { kind: 'conflict', message: 'Only an approved proposal can be exported for the git publication workflow.' } }
  const proposal = row.data
  return {
    ok: true,
    data: {
      kind: 'library-body-replacement-proposal',
      proposal: { id: proposal.id, engagementId: proposal.projectId, skillName: proposal.skillName, skillPath: proposal.skillPath, baseRevision: proposal.baseRevision, status: proposal.status, version: proposal.version, createdBy: proposal.createdBy },
      base: { body: proposal.baseBody, revision: proposal.baseRevision },
      proposed: { body: proposal.proposedBody },
      diff: { before: proposal.baseBody, after: proposal.proposedBody },
      reviews: proposal.reviews,
      publicationContract: ['Export is the handover for the runtime git publication workflow; it does not change the canonical corpus.'],
    },
  }
}

/** The simulated store holds no generated console data, so these reads say so rather than inventing entries. */
const CONSOLE_DATA_UNAVAILABLE: ServiceResult<never> = { ok: false, failure: { kind: 'unavailable', message: 'Knowledge and the capability catalog are read from the server in real mode only.' } }

export function createLibraryService(authority: DbAuthority, clock: Clock, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): LibraryService {
  return {
    knowledge: () => Promise.resolve(CONSOLE_DATA_UNAVAILABLE),
    knowledgeItem: () => Promise.resolve(CONSOLE_DATA_UNAVAILABLE),
    catalog: () => Promise.resolve(CONSOLE_DATA_UNAVAILABLE),
    corpus: (ctx, query) => guard(() => listCorpus(authority.snapshot(), query)),
    skill: (ctx, name) => guard(() => skillDetail(authority.snapshot(), name)),
    technique: (ctx, id) => guard(() => techniqueDetail(authority.snapshot(), id)),
    proposals: (ctx) => guard(() => listProposals(authority.snapshot(), ctx)),
    proposal: (ctx, id) => guard(() => getProposal(authority.snapshot(), ctx, id)),
    submit: (ctx, input) => Promise.resolve(submitProposal(authority, clock, ctx, input)),
    amend: (ctx, id, input) => Promise.resolve(amendProposal(authority, clock, ctx, id, input)),
    propose: (ctx, id) => Promise.resolve(proposeProposal(authority, clock, ctx, id)),
    decide: (ctx, id, input) => Promise.resolve(decideProposal(authority, clock, ctx, id, input)),
    exportProposal: (ctx, id) => guard(() => exportProposal(authority.snapshot(), ctx, id)),
  }
}
