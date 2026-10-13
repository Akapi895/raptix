import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'

vi.useFakeTimers()
const { mountStore, mountScreen } = await import('../test/helpers')
const { findingRoutes } = await import('../screens/e-findings')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

const respond = () =>
  act(() => {
    vi.advanceTimersByTime(900)
  })

describe('AI plans exist only as proposals (requirement 42)', () => {
  it('a chat plan request records a proposal and starts nothing', () => {
    const h = mountStore('Sam Patel')
    const convId = h.store().A.createConversation('RT-2026-015', 'propose')
    h.run(() => h.store().A.sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    respond()
    const d = h.store().db
    const plan = d.plans[0]
    expect(plan.status).toBe('proposed')
    expect(d.operations).toHaveLength(6)
    const last = d.conversations.find((c) => c.id === convId)!.messages.at(-1)!
    expect(last.text).toContain('This is a proposal only; nothing has run.')
    h.unmount()
  })

  it('an execution request in propose mode is refused without creating any operation', () => {
    const h = mountStore('Sam Patel')
    const convId = h.store().A.createConversation('RT-2026-015', 'propose')
    h.run(() => h.store().A.sendChat(convId, 'Execute the approved plan right now.'))
    respond()
    const d = h.store().db
    expect(d.conversations.find((c) => c.id === convId)!.messages.at(-1)!.text).toContain('Execution needs Approved Execution mode and an approved plan.')
    expect(d.operations).toHaveLength(6)
    h.unmount()
  })

  it('executing an approved plan creates a draft operation — nothing runs until preflight and a human start', () => {
    const h = mountStore('Sam Patel')
    const convId = h.store().A.createConversation('RT-2026-015', 'propose')
    h.run(() => h.store().A.sendChat(convId, 'Plan a validation run for the in-scope cloud assets.'))
    respond()
    const planId = h.store().db.plans[0].id
    h.run(() => h.store().A.requestPlanApproval(planId))
    expect(h.store().db.plans[0].status).toBe('in_review')
    expect(h.store().A.decidePlan(planId, 'approved', 'ok')).toMatchObject({ ok: false, error: 'You cannot approve a plan you requested. Ask another reviewer.' })
    h.as('Pat Kim')
    h.run(() => h.store().A.decidePlan(planId, 'approved', 'Within ROE'))
    let res!: { ok: boolean; opId?: string; error?: string }
    h.run(() => {
      res = h.store().A.executePlan(planId)
    })
    expect(res.ok).toBe(true)
    const op = h.store().db.operations.find((o) => o.id === res.opId)!
    expect(op.status).toBe('draft')
    expect(op.startedAt).toBe('—')
    expect(h.store().db.operations.filter((o) => o.planId === planId).map((o) => o.status)).toEqual(['draft'])
    h.unmount()
  })

  it('executePlan refuses plans that are not approved and never duplicates an operation for an executed plan', () => {
    const h = mountStore()
    expect(h.store().A.executePlan('PL-022')).toEqual({ ok: false, error: 'Only an approved plan can be executed.' })
    expect(h.store().A.executePlan('PL-023')).toEqual({ ok: false, error: 'Only an approved plan can be executed.' })
    const before = h.store().db.operations.length
    expect(h.store().A.executePlan('PL-021')).toEqual({ ok: true, opId: 'OP-014' })
    expect(h.store().db.operations).toHaveLength(before)
    h.unmount()
  })
})

describe('AI tool proposals are policy-gated (requirement 41/45)', () => {
  it('an out-of-scope target is blocked, recorded as a denied tool event and audited — nothing executes', () => {
    const h = mountStore('Taylor Chen')
    const tools = h.store().db.toolEvents.length
    h.run(() => h.store().A.sendChat('CV-014-03', 'Scan prod-payments-db too.'))
    respond()
    const d = h.store().db
    expect(d.toolEvents).toHaveLength(tools + 1)
    expect(d.toolEvents[0]).toMatchObject({ state: 'denied', target: 'prod-payments-db' })
    expect(d.toolEvents[0].reason).toContain('Out of scope')
    expect(d.audit[0].action).toBe('Blocked tool call')
    expect(d.conversations.find((c) => c.id === 'CV-014-03')!.messages.at(-1)!.kind).toBe('blocked')
    h.unmount()
  })

  it('observe mode stays read-only: no plan and no tool event is produced', () => {
    const h = mountStore()
    const plans = h.store().db.plans.length
    const tools = h.store().db.toolEvents.length
    h.run(() => h.store().A.sendChat('CV-014-01', 'Plan an assessment for me.'))
    respond()
    const d = h.store().db
    expect(d.plans).toHaveLength(plans)
    expect(d.toolEvents).toHaveLength(tools)
    expect(d.conversations.find((c) => c.id === 'CV-014-01')!.messages.at(-1)!.text).toContain('Observe mode — read-only')
    h.unmount()
  })
})

describe('AI-suggested findings are imported by a human into review (requirement 34)', () => {
  it('the finding screen offers verify (not auto-confirm) and blocks report inclusion for AI suggestions', async () => {
    window.location.hash = '#/finding/FD-012'
    const view = mountScreen(findingRoutes.finding, 'Taylor Chen')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // fake timers gate Query's scheduled notifications (ticket 31)
    })
    const verify = screen.getByRole('button', { name: /Verify & create finding/i })
    expect(verify).toBeEnabled()
    const report = screen.getByRole('button', { name: /Add to Report/i })
    expect(report).toBeDisabled()
    expect(report.getAttribute('title')).toContain('AI suggestions are unverified')
    view.unmount()
  })

  it('human verification moves an AI suggestion to review — never straight to confirmed', () => {
    const h = mountStore('Taylor Chen')
    h.run(() => h.store().A.setFindingStatus('FD-012', 'review', 'Verified from AI suggestion by a human'))
    const f = h.store().db.findings.find((x) => x.id === 'FD-012')!
    expect(f.status).toBe('review')
    expect(f.history.at(-1)?.text).toContain('Verified from AI suggestion by a human')
    h.unmount()
  })
})
