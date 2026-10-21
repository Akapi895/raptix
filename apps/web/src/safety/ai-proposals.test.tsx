import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import type { RequestContext } from '../domain/service'

vi.useFakeTimers()
const { mountServices } = await import('../test/helpers')
const { sendChat } = await import('../features/demo/runtime')
const { requestPlanReviewTransaction, decidePlanTransaction } = await import('../features/plans/service')
const { createOperationFromPlanTransaction } = await import('../features/plans/bridge')
const { importFindingSuggestion, transitionFinding, uploadFindingEvidence } = await import('../features/findings/service')
const { findingRoutes } = await import('../router/findings')

afterEach(() => { cleanup(); vi.clearAllTimers() })

const sam: RequestContext = { actor: { id: 'Sam Patel', role: 'manager' }, projectId: 'RT-2026-015', corr: 'proposal' }
const pat: RequestContext = { actor: { id: 'Pat Kim', role: 'reviewer' }, projectId: 'RT-2026-015', corr: 'review' }
const alex: RequestContext = { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'all', corr: 'binding' }
const respond = () => act(() => { vi.advanceTimersByTime(900) })
function createConversation(h: ReturnType<typeof mountServices>): string {
  const res = h.run(() => h.svc().chat(sam.actor, sam.projectId).create(sam, sam.projectId, 'propose'))
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error(res.failure.message)
  return res.data.id
}

describe('AI plans exist only as proposals (requirement 42)', () => {
  it('a chat plan request records a proposal and starts nothing', () => {
    const h = mountServices(null, 'Sam Patel')
    const convId = createConversation(h)
    h.run(() => sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    respond()
    const d = h.db()
    expect(d.plans[0].status).toBe('proposed')
    expect(d.operations).toHaveLength(6)
    expect(d.conversations.find((c) => c.id === convId)!.messages.at(-1)!.text).toContain('This is a proposal only; nothing has run.')
    h.unmount()
  })

  it('an execution request in propose mode is refused without creating any operation', () => {
    const h = mountServices(null, 'Sam Patel')
    const convId = createConversation(h)
    h.run(() => sendChat(convId, 'Execute the approved plan right now.'))
    respond()
    const d = h.db()
    expect(d.conversations.find((c) => c.id === convId)!.messages.at(-1)!.text).toContain('Execution needs Approved Execution mode and an approved plan.')
    expect(d.operations).toHaveLength(6)
    h.unmount()
  })

  it('an independently approved proposal creates a draft, never a running operation', () => {
    const h = mountServices(null, 'Sam Patel')
    const convId = createConversation(h)
    h.run(() => sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    respond()
    const planId = h.db().plans[0].id
    h.run(() => { expect(requestPlanReviewTransaction(h.svc().authority, h.svc().clock, sam, planId).ok).toBe(true) })
    expect(h.db().plans[0].status).toBe('in_review')
    expect(decidePlanTransaction(h.svc().authority, h.svc().clock, sam, planId, 'approved', 'ok')).toMatchObject({ ok: false, failure: { message: 'You cannot approve a plan you requested. Ask another reviewer.' } })
    h.as('Pat Kim')
    h.run(() => { expect(decidePlanTransaction(h.svc().authority, h.svc().clock, pat, planId, 'approved', 'Within ROE').ok).toBe(true) })
    const res = h.run(() => createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, pat, planId))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.failure.message)
    const op = h.db().operations.find((o) => o.id === res.data.opId)!
    expect(op.status).toBe('draft')
    expect(op.startedAt).toBe('—')
    expect(h.db().operations.filter((o) => o.planId === planId).map((o) => o.status)).toEqual(['draft'])
    h.unmount()
  })

  it('plan binding refuses unapproved plans and never duplicates an already-bound operation', () => {
    const h = mountServices()
    for (const id of ['PL-022', 'PL-023']) {
      expect(createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, alex, id)).toMatchObject({ ok: false, failure: { message: 'Only an approved plan can be executed.' } })
    }
    const before = h.db().operations.length
    expect(createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, alex, 'PL-021')).toMatchObject({ ok: true, data: { opId: 'OP-014' } })
    expect(h.db().operations).toHaveLength(before)
    h.unmount()
  })
})

describe('AI tool proposals are policy-gated (requirement 41/45)', () => {
  it('an out-of-scope target is denied and audited without execution', () => {
    const h = mountServices(null, 'Taylor Chen')
    const tools = h.db().toolEvents.length
    h.run(() => sendChat('CV-014-03', 'Scan prod-payments-db too.'))
    respond()
    const d = h.db()
    expect(d.toolEvents).toHaveLength(tools + 1)
    expect(d.toolEvents[0]).toMatchObject({ state: 'denied', target: 'prod-payments-db' })
    expect(d.toolEvents[0].reason).toContain('Out of scope')
    expect(d.audit[0].action).toBe('Blocked tool call')
    expect(d.conversations.find((c) => c.id === 'CV-014-03')!.messages.at(-1)!.kind).toBe('blocked')
    h.unmount()
  })

  it('observe mode stays read-only without producing plans or tool events', () => {
    const h = mountServices()
    const plans = h.db().plans.length
    const tools = h.db().toolEvents.length
    h.run(() => sendChat('CV-014-01', 'Plan an assessment for me.'))
    respond()
    const d = h.db()
    expect(d.plans).toHaveLength(plans)
    expect(d.toolEvents).toHaveLength(tools)
    expect(d.conversations.find((c) => c.id === 'CV-014-01')!.messages.at(-1)!.text).toContain('Observe mode — read-only')
    h.unmount()
  })
})

describe('AI finding suggestions require human verification (requirement 34)', () => {
  it('the finding screen offers verification and blocks report inclusion', async () => {
    window.location.hash = '#/finding/FD-012'
    const Finding = findingRoutes.finding
    const view = mountServices(<Finding />, 'Taylor Chen')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('button', { name: /Verify & create finding/i })).toBeEnabled()
    const report = screen.getByRole('button', { name: /Add to Report/i })
    expect(report).toBeDisabled()
    expect(report.getAttribute('title')).toContain('AI suggestions are unverified')
    view.unmount()
  })

  it('human import and evidence permit review but never auto-confirm', () => {
    const h = mountServices(null, 'Taylor Chen')
    const ctx: RequestContext = { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 'finding-verification' }
    h.run(() => {
      expect(transitionFinding(h.svc().authority, h.svc().clock, ctx, 'FD-012', 'review').ok).toBe(false)
      expect(importFindingSuggestion(h.svc().authority, h.svc().clock, ctx, 'FD-012').ok).toBe(true)
      expect(h.db().findings.find((f) => f.id === 'FD-012')!.status).toBe('draft')
      expect(uploadFindingEvidence(h.svc().authority, h.svc().clock, ctx, { findingId: 'FD-012', name: 'verification.txt', kind: 'Text', source: 'Human verification', sensitive: false }).ok).toBe(true)
      expect(transitionFinding(h.svc().authority, h.svc().clock, ctx, 'FD-012', 'review', 'Verified from AI suggestion by a human').ok).toBe(true)
    })
    const f = h.db().findings.find((x) => x.id === 'FD-012')!
    expect(f.status).toBe('review')
    expect(f.history.at(-1)?.text).toContain('Verified from AI suggestion by a human')
    h.unmount()
  })
})
