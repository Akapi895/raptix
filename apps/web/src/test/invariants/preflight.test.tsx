import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mountServices } from '../helpers'
import { computePreflightChecks, preflightPass } from '../../features/operations/preflight'
import { MockClock } from '../../domain/clock'
import type { Db } from '../../demo/seed';
import type { Operation } from '../../domain/entities'
import type { ActorRef, RequestContext } from '../../domain/service'
import { createOperationDraft, runOperationPreflight, startOperation } from '../../features/operations/service'
import { assignAgentTransaction } from '../../features/agents/writes'
import { seed } from '../../demo/seed';

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const ctxOf = (projectId: string, actor: ActorRef = ALEX): RequestContext => ({ actor, projectId, corr: 'legacy' })

/** Mounts the service authority (one handle since ticket 67). */
function mountPreflight(me = 'Alex Morgan') {
  return mountServices(me)
}

const db = seed()
/* Ticket 67: the store's computePreflight demo-anchor wrapper is retired — the
   derivation resolves at the factory mock clock's instant (same class and demo
   anchor as createConsoleServices: Oct 13, 2026, 10:42 AM UTC+7). */
const pf = (d: Db, op: Operation) => computePreflightChecks(d, op, new MockClock().now())
const checksFor = (opId: string) => {
  const op = db.operations.find((o) => o.id === opId)!
  return Object.fromEntries(pf(db, op).map((c) => [c.code, c]))
}

const assign = (h: ReturnType<typeof mountPreflight>, agentId: string, projectId: string) => {
  const res = assignAgentTransaction(h.svc().authority, h.svc().clock, ctxOf(projectId), agentId, { projectId })
  if (!res.ok) throw new Error(res.failure.message)
}

describe('operation preflight (8-point gate)', () => {
  it('an operation on an approved, active project with approved ROE/in-scope targets/agents passes all eight checks', () => {
    const op = db.operations.find((o) => o.id === 'OP-014')!
    const checks = pf(db, op)
    expect(checks.map((c) => c.code)).toEqual(['PRE-01', 'PRE-02', 'PRE-03', 'PRE-04', 'PRE-05', 'PRE-06', 'PRE-07', 'PRE-08'])
    expect(checks.every((c) => c.state === 'pass')).toBe(true)
    expect(preflightPass(checks)).toBe(true)
  })

  it('records the time-window check as the documented always-pass placeholder (real window enforcement: ticket 26)', () => {
    expect(checksFor('OP-014')['PRE-04'].state).toBe('pass')
  })

  it('denies an approved project whose ROE is still draft (PRE-02 fail)', () => {
    const roe = checksFor('OP-016')['PRE-02']
    expect(roe.state).toBe('fail')
    expect(preflightPass(pf(db, db.operations.find((o) => o.id === 'OP-016')!))).toBe(false)
  })

  it('denies a draft project: unapproved ROE, no targets, no agents and no emergency contact all fail', () => {
    const checks = checksFor('OP-DRAFT-017')
    expect(checks).toMatchObject({ 'PRE-01': { state: 'fail' }, 'PRE-02': { state: 'fail' }, 'PRE-03': { state: 'fail' }, 'PRE-06': { state: 'fail' }, 'PRE-08': { state: 'fail' } })
  })

  it('fails the targets check when an out-of-scope asset is selected and names the asset', () => {
    const d = seed()
    const op = d.operations.find((o) => o.id === 'OP-016')!
    op.assets = [...op.assets, 'AS-0153']
    const targets = pf(d, op).find((c) => c.code === 'PRE-03')!
    expect(targets.state).toBe('fail')
    expect(targets.detail).toContain('prod-payments-db')
  })

  it('marks required approvals as review — not pass — while the linked plan awaits approval, blocking start', () => {
    const op = db.operations.find((o) => o.id === 'OP-015')!
    const approvals = pf(db, op).find((c) => c.code === 'PRE-07')!
    expect(approvals.state).toBe('review')
    expect(preflightPass(pf(db, op))).toBe(false)
  })
})

describe('preflight gates execution at the typed handlers', () => {
  it('runOperationPreflight marks a fully passing operation ready and leaves a failing one in draft', () => {
    // The pool assignment in the setup is role-gated at the typed handler
    // (ticket 49): managers/admins assign immediately, so this setup runs as
    // the manager persona; the preflight assertions are persona-independent.
    const h = mountPreflight()
    h.run(() => assign(h, 'AG-012', 'RT-2026-014'))
    let opId = ''
    h.run(() => {
      const res = createOperationDraft(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), { name: 'Preflight gate check', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
      if (!res.ok) throw new Error(res.failure.message)
      opId = res.data.op.id
    })
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), opId) })
    expect(h.db().operations.find((o) => o.id === opId)?.status).toBe('ready')
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf('RT-2026-017'), 'OP-DRAFT-017') })
    expect(h.db().operations.find((o) => o.id === 'OP-DRAFT-017')?.status).toBe('draft')
    h.unmount()
  })

  it('startOperation refuses to start an operation whose preflight has a failing check', () => {
    const h = mountPreflight('Taylor Chen')
    let opId = ''
    h.run(() => {
      const res = createOperationDraft(h.svc().authority, h.svc().clock, ctxOf('RT-2026-016', TAYLOR), { name: 'Blocked start', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-014'], assets: ['AS-0301'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
      if (!res.ok) throw new Error(res.failure.message)
      opId = res.data.op.id
    })
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf('RT-2026-016'), opId) })
    h.run(() => { startOperation(h.svc().authority, h.svc().clock, ctxOf('RT-2026-016'), opId) })
    const op = h.db().operations.find((o) => o.id === opId)!
    expect(op.status).toBe('draft')
    expect(op.startedAt).toBe('—')
    h.unmount()
  })
})
