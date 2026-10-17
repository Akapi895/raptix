/**
 * Library port (corpus and proposals). The rules mirror the server: submit and
 * amend need operator and above, only the author amends, decisions need a
 * reviewer who did not write the proposal, versions pin every write, a moved
 * canonical body makes a proposal stale, and only an approved proposal exports.
 */
import { describe, expect, it } from 'vitest'
import { createConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const OPERATOR: ActorRef = { id: 'Riley Brooks', role: 'operator' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const CASEY: ActorRef = { id: 'Casey Nguyen (Client)', role: 'viewer' }
const P14 = 'RT-2026-014'

let corr = 0
const ctx = (actor: ActorRef, projectId = P14): RequestContext => ({ actor, projectId, corr: `library-test-${++corr}` })

function firstSkill(services: ReturnType<typeof createConsoleServices>) {
  return services.authority.snapshot().playbooks[0]!
}

describe('library corpus reads', () => {
  it('lists the canonical skills with counts, filters by technique and reads one skill with a fingerprint', async () => {
    const svc = createConsoleServices()
    const library = svc.library(ALEX, P14)
    const corpus = await library.corpus(ctx(ALEX))
    expect(corpus.ok).toBe(true)
    if (!corpus.ok) return
    expect(corpus.data.total).toBe(svc.authority.snapshot().playbooks.length)
    expect(corpus.data.counts.skills).toBe(corpus.data.total)
    const skill = firstSkill(svc)
    const byTechnique = await library.corpus(ctx(ALEX), { mitre: skill.techniques[0] })
    expect(byTechnique.ok && byTechnique.data.items.map((s) => s.name)).toContain(skill.id)
    const detail = await library.skill(ctx(ALEX), skill.id)
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.body).toContain(skill.name)
    expect(detail.data.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(detail.data.publication).toBe('canonical')
  })

  it('refuses an unknown skill and an unknown technique as not found', async () => {
    const library = createConsoleServices().library(ALEX, P14)
    expect((await library.skill(ctx(ALEX), 'PB-NOPE')).ok).toBe(false)
    expect((await library.technique(ctx(ALEX), 'T0000')).ok).toBe(false)
  })
})

describe('library proposal lifecycle', () => {
  it('submits a draft, amends it at the version read, proposes it and lets a reviewer approve it', async () => {
    const svc = createConsoleServices()
    const skill = firstSkill(svc)
    const draft = await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: '# Revised\n\nNew steps.' })
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    expect(draft.data.status).toBe('draft')
    expect(draft.data.version).toBe(1)
    const amended = await svc.library(OPERATOR, P14).amend(ctx(OPERATOR), draft.data.id, { proposedBody: '# Revised\n\nNew steps, reordered.', expectedVersion: 1 })
    expect(amended.ok && amended.data.version).toBe(2)
    const stale = await svc.library(OPERATOR, P14).amend(ctx(OPERATOR), draft.data.id, { proposedBody: 'late', expectedVersion: 1 })
    expect(stale.ok === false && stale.failure.kind).toBe('conflict')
    const proposed = await svc.library(OPERATOR, P14).propose(ctx(OPERATOR), draft.data.id)
    expect(proposed.ok && proposed.data.status).toBe('proposed')
    const approved = await svc.library(PAT, P14).decide(ctx(PAT), draft.data.id, { decision: 'approved', expectedVersion: 2, comment: 'Verified against the corpus.' })
    expect(approved.ok && approved.data.status).toBe('approved')
    const exported = await svc.library(ALEX, P14).exportProposal(ctx(ALEX), draft.data.id)
    expect(exported.ok && exported.data.kind).toBe('library-body-replacement-proposal')
    expect(exported.ok && exported.data.proposed.body).toContain('reordered')
  })

  it('refuses a viewer to submit, a non-author to amend and the author to decide their own proposal', async () => {
    const svc = createConsoleServices()
    const skill = firstSkill(svc)
    const viewer = await svc.library(CASEY, P14).submit(ctx(CASEY), { skillName: skill.id, proposedBody: 'x' })
    expect(viewer.ok === false && viewer.failure.kind).toBe('forbidden')
    const draft = await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: 'Body' })
    if (!draft.ok) throw new Error('setup refused')
    const notAuthor = await svc.library(ALEX, P14).amend(ctx(ALEX), draft.data.id, { proposedBody: 'Edited', expectedVersion: 1 })
    expect(notAuthor.ok === false && notAuthor.failure.kind).toBe('forbidden')
    await svc.library(OPERATOR, P14).propose(ctx(OPERATOR), draft.data.id)
    const selfDecision = await svc.library(OPERATOR, P14).decide(ctx(OPERATOR), draft.data.id, { decision: 'approved', expectedVersion: 1 })
    expect(selfDecision.ok === false && selfDecision.failure.kind).toBe('forbidden')
    const exportRefused = await svc.library(PAT, P14).exportProposal(ctx(PAT), draft.data.id)
    expect(exportRefused.ok === false && exportRefused.failure.kind).toBe('conflict')
  })

  it('refuses a second proposal for a skill that is already in review', async () => {
    const svc = createConsoleServices()
    const skill = firstSkill(svc)
    await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: 'One' })
    const second = await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: 'Two' })
    expect(second.ok === false && second.failure.kind).toBe('conflict')
  })

  it('marks a proposal stale when the canonical body moves, and refuses to propose it until it is amended', async () => {
    const svc = createConsoleServices()
    const skill = firstSkill(svc)
    const draft = await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: 'Pinned body' })
    if (!draft.ok) throw new Error('setup refused')
    expect(draft.data.canonicalCurrent).toBe(true)
    svc.authority.commit('library-drift', (d) => {
      const target = d.playbooks.find((p) => p.id === skill.id)!
      target.steps = [...target.steps, 'An additional canonical step.']
    })
    const stale = await svc.library(OPERATOR, P14).proposal(ctx(OPERATOR), draft.data.id)
    expect(stale.ok && stale.data.canonicalCurrent).toBe(false)
    const refused = await svc.library(OPERATOR, P14).propose(ctx(OPERATOR), draft.data.id)
    expect(refused.ok === false && refused.failure.kind).toBe('conflict')
  })

  it('keeps proposals of a foreign project out of reach', async () => {
    const svc = createConsoleServices()
    const skill = firstSkill(svc)
    const draft = await svc.library(OPERATOR, P14).submit(ctx(OPERATOR), { skillName: skill.id, proposedBody: 'Scoped' })
    if (!draft.ok) throw new Error('setup refused')
    const foreign = await svc.library(CASEY, 'RT-2026-009').proposal(ctx(CASEY, 'RT-2026-009'), draft.data.id)
    expect(foreign.ok).toBe(false)
  })
})
