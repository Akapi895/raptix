/**
 * Ticket 42: plan revision compare on typed reads — the diff derives from
 * the canonical revision chain ticket 39's transactions maintain
 * (src/features/plans/compare.ts).
 *
 * Covered here: the compare read resolves the adjacent revision pair from
 * `prevPlanId` and derives the step diff and re-approval notes from those
 * two stored revisions (a revision is a NEW plan record, so a pinned
 * version's stored record is byte-identical after any revision); the
 * revision transaction's gate changes are visible in the derived diff;
 * out-of-scope reads are refused without leaking revision content; a plan
 * with no adjacent revision is a conflict; and the rendered compare route
 * refetches when plan commits land — from the legacy store actions and from
 * the typed decide handler (bridge both directions).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { go } from '../../router/navigate'
import { requestPlanReviewTransaction, revisePlanTransaction } from './service'
import { createConsoleServices } from '../../demo/services';
import type { ActorRef, RequestContext } from '../../domain/service'
import { seed } from '../../demo/seed';
import { AiPlanCompare } from './views/plan-pages'
import { readPlanCompare } from './compare'

afterEach(() => { cleanup(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
let corrSeq = 0
const ctx = (actor: ActorRef, projectId = 'all'): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

/** Mounts the providers with the compare route for PL-021 and a probe. */
function mountCompare(me = 'Taylor Chen') {
  window.location.hash = '#/ai-plan-compare/PL-021'
  return mountServices(<AiPlanCompare />, me)
}

describe('plan compare read model (ticket 42)', () => {
  it('derives the diff from the canonical revision chain (seeded PL-020 → PL-021)', () => {
    const res = readPlanCompare(seed(), ctx(TAYLOR), 'PL-021')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.previous).toMatchObject({ id: 'PL-020', ver: 'v1.1', status: 'superseded' })
    expect(res.data.current).toMatchObject({ id: 'PL-021', ver: 'v1.2', status: 'approved' })
    // The seeded revision changed step agents (AG-009 was removed) — the diff derives it from the stored steps.
    expect(res.data.diff.added).toHaveLength(0)
    expect(res.data.diff.removed).toHaveLength(0)
    expect(res.data.diff.changed.length).toBeGreaterThan(0)
    expect(res.data.diff.changed.some(({ f }) => f.some((x) => x.startsWith('agent ')))).toBe(true)
    // Re-approval notes name the uncovered consequences; the requested-change annotations come from the revision record.
    expect(res.data.notes.some((n) => n.startsWith('Agent change on '))).toBe(true)
    expect(res.data.notes.some((n) => n.startsWith('Concurrency: agent count 3 → 2'))).toBe(true)
    expect(res.data.current.changes).toEqual(['Added approval gate to step 10 (defense simulation)', 'Removed AG-009 (disconnected)'])
  })

  it('compares a fresh revision from ticket 39\'s transaction; the pinned approved plan never drifts', async () => {
    const svc = createConsoleServices()
    const before = svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')!
    const rev = await svc.plans(TAYLOR, 'all').revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'])
    expect(rev.ok).toBe(true)
    const newId = rev.ok ? rev.data.planId : ''
    const cmp = readPlanCompare(svc.authority.snapshot(), ctx(TAYLOR), newId)
    expect(cmp.ok).toBe(true)
    if (!cmp.ok) return
    expect(cmp.data.previous.id).toBe('PL-021')
    expect(cmp.data.current).toMatchObject({ id: 'PL-024', ver: 'v1.3', status: 'draft' })
    expect(cmp.data.current.changes).toEqual(['Add an approval gate to step 3'])
    // The revision transaction's gate keyword flipped a step gate — visible in the derived diff.
    expect(cmp.data.diff.changed.some(({ f }) => f.some((x) => x.includes('approval')))).toBe(true)
    // Pinned versions do not drift: the approved plan's stored record is byte-identical after the revision.
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')).toEqual(before)
    svc.dispose()
  })

  it('refuses out-of-scope compare reads without leaking revision content; a plan with no adjacent revision conflicts', () => {
    const db = seed()
    // Riley is not a member of PL-022's project: not-found, no existence or content leak.
    const riley = readPlanCompare(db, ctx(RILEY, 'RT-2026-015'), 'PL-022')
    expect(riley.ok).toBe(false)
    if (!riley.ok) {
      expect(riley.failure.kind).toBe('not-found')
      expect(riley.failure.message).not.toContain('Cloud configuration validation')
    }
    // A specific-project request for another project's plan is refused with the owning project.
    const cross = readPlanCompare(db, ctx(TAYLOR, 'RT-2026-015'), 'PL-021')
    expect(cross.ok).toBe(false)
    if (!cross.ok) {
      expect(cross.failure.kind).toBe('forbidden')
      expect(cross.failure.message).toContain('RT-2026-014')
      expect(cross.failure.message).not.toContain('Internal environment discovery')
    }
    const lonely = readPlanCompare(db, ctx(TAYLOR), 'PL-022')
    expect(lonely.ok).toBe(false)
    if (!lonely.ok) {
      expect(lonely.failure.kind).toBe('conflict')
      expect(lonely.failure.message).toContain('no previous or later revision')
    }
  })
})

describe('compare route on the typed read (ticket 42)', () => {
  it('keeps the pinned pair stable and refetches review decisions on the new revision', async () => {
    const h = mountCompare('Taylor Chen')
    // The seeded pair renders from the typed read; PL-021 is the approved re-approved version.
    await waitFor(() => expect(screen.getAllByText('PL-020').length).toBeGreaterThan(0))
    expect(screen.getAllByText('v1.1').length).toBeGreaterThan(0)
    expect(screen.getByText(/was re-approved/)).toBeInTheDocument()
    // A legacy store revision creates PL-024; the pinned pair for PL-021 does not drift.
    h.run(() => { expect(revisePlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'], 'tighten gates').ok).toBe(true) })
    await waitFor(() => expect(h.db().plans.some((p) => p.id === 'PL-024')).toBe(true))
    expect(screen.getAllByText('PL-020').length).toBeGreaterThan(0)
    expect(screen.queryByText('PL-024')).toBeNull()
    // Direct compare link preserves plan identity: opening the revision's own compare.
    h.run(() => { go('ai-plan-compare', { id: 'PL-024' }) })
    await waitFor(() => expect(screen.getAllByText('PL-024').length).toBeGreaterThan(0))
    expect(screen.getAllByText('v1.3').length).toBeGreaterThan(0)
    expect(screen.getByText('Approval required')).toBeInTheDocument()
    // Legacy → typed: a store action commits; the Query-backed view refetches without a reload.
    h.run(() => { expect(requestPlanReviewTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-024').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('In Review')).toBeInTheDocument())
    // Typed → legacy: the typed decide handler commits; the same view refetches.
    await act(async () => { await h.svc().plans(PAT, 'all').decide(ctx(PAT), 'PL-024', 'approved', 'Within ROE') })
    await waitFor(() => expect(screen.getByText(/PL-024 v1\.3 was re-approved/)).toBeInTheDocument())
    h.unmount()
  })

  it('the compare route renders the refusal state for a plan with no revision to compare', async () => {
    window.location.hash = '#/ai-plan-compare/PL-023'
    mountServices(<AiPlanCompare />, 'Taylor Chen')
    await waitFor(() => expect(screen.getByText('No revision to compare')).toBeInTheDocument())
    expect(screen.getByText(/no previous or later revision/)).toBeInTheDocument()
    expect(screen.queryByText(/Loading comparison/)).toBeNull()
    cleanup()
  })
})
