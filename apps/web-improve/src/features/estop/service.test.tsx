/**
 * Ticket 22: emergency-stop console migration. The invariant under test: an
 * emergency stop is ALWAYS an action with an immediate visible response,
 * never a passive status — the request transaction commits the requested
 * stop state, the Pending audit row and the workspace notice in ONE
 * immediate commit, before any simulated acknowledgement delay. The demo
 * outcome transitions run through the typed handlers, so legacy actions and
 * direct callers observe the same state (both bridge directions). The
 * documented baseline behavior whose hardening belongs to ticket 28 (a
 * manual confirm leaving linked operations untouched) is preserved, not
 * silently changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'

vi.useFakeTimers()
const { mountStore } = await import('../../test/helpers')
const { createConsoleServices } = await import('../../domain/service-factory')
const { requestEmergencyStopTransaction, acknowledgeEmergencyStopTransaction, finalizeEmergencyStopTransaction, failEmergencyStopTransaction, unknownEmergencyStopTransaction, resolveStopTransaction } = await import('./service')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

const OP14 = 'OP-014'
const P14 = 'RT-2026-014'

describe('the stop request is an immediate committed action (invariant 1)', () => {
  it('the typed request lands the visible state, Pending audit and notice in the request tick — no timer involved', () => {
    const svc = createConsoleServices()
    const res = requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c1' }, { scope: 'operation', id: OP14, reason: 'ROE violation observed' })
    expect(res).toEqual({ ok: true, data: { operations: [OP14], projectId: P14 } })
    const d = svc.authority.snapshot()
    expect(d.stopState).toMatchObject({ scope: 'operation', id: OP14, phase: 'requested', by: 'Alex Morgan' })
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop requested', result: 'Pending', obj: OP14, projectId: P14, reason: 'ROE violation observed' })
    expect(d.notices[0]).toMatchObject({ text: expect.stringContaining('Emergency stop requested (operation)'), category: 'system' })
    // Nothing has stopped yet — the request alone is not a halt.
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    svc.dispose()
  })

  it('the legacy emergencyStop action observes the same immediate state (legacy action â†’ typed handler)', () => {
    const h = mountStore()
    h.run(() => h.store().A.emergencyStop('operation', OP14, 'ROE violation observed'))
    const d = h.store().db
    expect(d.stopState).toMatchObject({ phase: 'requested', by: 'Alex Morgan' })
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop requested', result: 'Pending' })
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    h.unmount()
  })

  it('a direct typed request is observed by the legacy consumer and vice versa (both bridges)', async () => {
    const { StoreProvider, useServices, useStore } = await import('../../store')
    const { ConsoleProviders } = await import('../../state/query')
    const { createElement } = await import('react')
    const { render } = await import('@testing-library/react')
    let store!: Store
    let svc!: ConsoleServices
    const BridgeProbe = ({ ready }: { ready: (s: Store, v: ConsoleServices) => void }) => {
      ready(useStore(), useServices())
      return null
    }
    const view = render(
      createElement(StoreProvider, null,
        createElement(ConsoleProviders, null,
          createElement(BridgeProbe, { ready: (s, v) => { store = s; svc = v } })),
      ),
    )
    // Typed â†’ legacy: a direct handler request appears in the store context.
    act(() => {
      requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c-x1' }, { scope: 'operation', id: OP14, reason: 'halt now' })
    })
    expect(store.db.stopState).toMatchObject({ phase: 'requested', by: 'Alex Morgan' })
    // Legacy â†’ typed: the store's dismiss is observed by the authority snapshot.
    act(() => { store.A.resolveStop('dismiss') })
    expect(svc.authority.snapshot().stopState).toBeNull()
    view.unmount()
  })
})

describe('handler-level gates and transitions', () => {
  it('a role without estop and a missing reason are refused and commit nothing', async () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Riley Brooks', role: 'analyst' }, projectId: P14, corr: 'c2' }, { scope: 'project', id: P14, reason: 'contain' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('cannot trigger an Emergency Stop') }) })
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c3' }, { scope: 'project', id: P14, reason: '   ' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A reason is required') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    svc.dispose()
  })

  it('acknowledgement halts the linked operations, revokes sessions and records the audit row in one commit', async () => {
        const svc = createConsoleServices()
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c4' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    const seen: string[] = []
    svc.authority.subscribe((cs) => seen.push(cs.corr))
    expect(acknowledgeEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c5' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('acknowledged')
    const op = d.operations.find((o) => o.id === OP14)!
    expect(op).toMatchObject({ status: 'estop', stopReason: 'halt now', stopBy: 'Alex Morgan' })
    expect(op.steps.find((s) => s.id === 'S12')?.status).toBe('notrun')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'revoking')).toBe(true)
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop acknowledged', result: 'Success', reason: 'Agents confirmed halt' })
    // One commit published the whole transition.
    expect(seen).toHaveLength(1)
    svc.dispose()
  })

  it('finalization terminates the revoked sessions, releases the reserved agents and completes the stop', async () => {
        const svc = createConsoleServices()
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c6' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    expect(acknowledgeEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c7' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    expect(finalizeEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c8' }, { scope: 'operation', id: OP14 }).ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    expect(d.agents.find((a) => a.id === 'AG-007')?.op).toBeNull()
    svc.dispose()
  })

  it('the failed and unknown outcomes record the explicit uncertainty and leave operations running', async () => {
        const svc = createConsoleServices()
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c9' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    expect(failEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c10' }, { scope: 'operation', id: OP14 }).ok).toBe(true)
    let d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('failed')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop failed', result: 'Failed', reason: 'No acknowledgement — agents did not confirm halt' })

    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c11' }, { scope: 'operation', id: OP14, reason: 'halt now (retry)' }).ok).toBe(true)
    expect(unknownEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c12' }, { scope: 'operation', id: OP14 }).ok).toBe(true)
    d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('unknown')
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop status unknown', result: 'Unknown', reason: 'Acknowledgement timed out' })
    svc.dispose()
  })

  it('a manual confirm marks the stop stopped with an explicit audit row and leaves linked operations untouched (ticket 28 owns the hardening)', async () => {
        const svc = createConsoleServices()
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c13' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    expect(unknownEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c14' }, { scope: 'operation', id: OP14 }).ok).toBe(true)
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c15' }, 'confirmed-stopped').ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop confirmed manually', result: 'Success', reason: 'Operator verified agents halted out-of-band' })
    // Dismissing clears the stop state; confirming with none in progress is an explicit refusal.
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c16' }, 'dismiss').ok).toBe(true)
    expect(svc.authority.snapshot().stopState).toBeNull()
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c17' }, 'confirmed-stopped'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('No emergency stop is in progress') }) })
    svc.dispose()
  })
})

describe('the demo orchestration through the legacy action still reaches stopped', () => {
  it('requested â†’ acknowledged â†’ stopped with sessions terminated and agents released', () => {
    const h = mountStore()
    h.run(() => h.store().A.emergencyStop('operation', OP14, 'ROE violation observed'))
    act(() => { vi.advanceTimersByTime(1800) })
    let d = h.store().db
    expect(d.stopState?.phase).toBe('acknowledged')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'revoking')).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) })
    d = h.store().db
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    expect(d.agents.find((a) => a.id === 'AG-007')?.op).toBeNull()
    h.unmount()
  })

  it('a workspace stop and the failed/unknown outcome paths behave through the same handlers', () => {
    const h = mountStore()
    h.run(() => h.store().setStopOutcome('fail'))
    h.run(() => h.store().A.emergencyStop('workspace', 'all', 'halt everything'))
    act(() => { vi.advanceTimersByTime(1800) })
    expect(h.store().db.stopState?.phase).toBe('failed')
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Emergency stop failed', obj: 'Workspace', result: 'Failed' })
    h.run(() => h.store().A.retryStop())
    expect(h.store().db.stopState?.phase).toBe('requested')
    act(() => { vi.advanceTimersByTime(3800) })
    expect(h.store().db.stopState?.phase).toBe('stopped')
    expect(h.store().db.operations.every((o) => o.status !== 'running')).toBe(true)
    h.unmount()
  })
})
