import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { computePreflight, preflightPass } from '../store'
import { seed } from '../data'
import { mountStore } from '../test/helpers'

afterEach(cleanup)

const db = seed()
const checksFor = (opId: string) => {
  const op = db.operations.find((o) => o.id === opId)!
  return Object.fromEntries(computePreflight(db, op).map((c) => [c.code, c]))
}

describe('operation preflight (8-point gate)', () => {
  it('an operation on an approved, active project with approved ROE/in-scope targets/agents passes all eight checks', () => {
    const op = db.operations.find((o) => o.id === 'OP-014')!
    const checks = computePreflight(db, op)
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
    expect(preflightPass(computePreflight(db, db.operations.find((o) => o.id === 'OP-016')!))).toBe(false)
  })

  it('denies a draft project: unapproved ROE, no targets, no agents and no emergency contact all fail', () => {
    const checks = checksFor('OP-DRAFT-017')
    expect(checks).toMatchObject({ 'PRE-01': { state: 'fail' }, 'PRE-02': { state: 'fail' }, 'PRE-03': { state: 'fail' }, 'PRE-06': { state: 'fail' }, 'PRE-08': { state: 'fail' } })
  })

  it('fails the targets check when an out-of-scope asset is selected and names the asset', () => {
    const d = seed()
    const op = d.operations.find((o) => o.id === 'OP-016')!
    op.assets = [...op.assets, 'AS-0153']
    const targets = computePreflight(d, op).find((c) => c.code === 'PRE-03')!
    expect(targets.state).toBe('fail')
    expect(targets.detail).toContain('prod-payments-db')
  })

  it('marks required approvals as review — not pass — while the linked plan awaits approval, blocking start', () => {
    const op = db.operations.find((o) => o.id === 'OP-015')!
    const approvals = computePreflight(db, op).find((c) => c.code === 'PRE-07')!
    expect(approvals.state).toBe('review')
    expect(preflightPass(computePreflight(db, op))).toBe(false)
  })
})

describe('preflight gates execution at the store actions', () => {
  it('confirmPreflight marks a fully passing operation ready and leaves a failing one in draft', () => {
    // The pool assignment in the setup is role-gated at the typed handler
    // (ticket 49): managers/admins assign immediately, so this setup runs as
    // the manager persona; the preflight assertions are persona-independent.
    const h = mountStore()
    h.run(() => h.store().A.assignAgent('AG-012', 'RT-2026-014'))
    const opId = h.store().A.createOperation({ name: 'Preflight gate check', projectId: 'RT-2026-014', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
    h.run(() => h.store().A.confirmPreflight(opId))
    expect(h.store().db.operations.find((o) => o.id === opId)?.status).toBe('ready')
    h.run(() => h.store().A.confirmPreflight('OP-DRAFT-017'))
    expect(h.store().db.operations.find((o) => o.id === 'OP-DRAFT-017')?.status).toBe('draft')
    h.unmount()
  })

  it('startOp refuses to start an operation whose preflight has a failing check', () => {
    const h = mountStore('Taylor Chen')
    const opId = h.store().A.createOperation({ name: 'Blocked start', projectId: 'RT-2026-016', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-014'], assets: ['AS-0301'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
    h.run(() => h.store().A.confirmPreflight(opId))
    h.run(() => h.store().A.startOp(opId))
    const op = h.store().db.operations.find((o) => o.id === opId)!
    expect(op.status).toBe('draft')
    expect(op.startedAt).toBe('—')
    h.unmount()
  })
})
