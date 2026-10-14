/**
 * Ticket 22: emergency-stop console migration. The invariant under test: an
 * emergency stop is ALWAYS an action with an immediate visible response,
 * never a passive status — the request transaction commits the requested
 * stop state, the Pending audit row and the workspace notice in ONE
 * immediate commit, before any simulated acknowledgement delay. The demo
 * outcome transitions run through the typed handlers, so the demo runtime
 * and direct typed callers observe the same authority state (one authority,
 * both entries). Ticket 28 hardened the machine: a manual confirm completes
 * it coherently (ledger G-10) and the finalize sweep is scope-matched, so
 * concurrent stops never touch out-of-scope records.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { RequestContext } from '../../domain/service'

vi.useFakeTimers()
const { mountServices } = await import('../../test/helpers')
const { createConsoleServices } = await import('../../domain/service-factory')
const { emergencyStop, retryStop, resolveStop } = await import('../../features/demo/runtime')
const { useSessionStore } = await import('../../state/session')
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

  it('the demo emergencyStop runtime observes the same immediate state (runtime → typed handler)', () => {
    const h = mountServices()
    h.run(() => emergencyStop('operation', OP14, 'ROE violation observed'))
    const d = h.db()
    expect(d.stopState).toMatchObject({ phase: 'requested', by: 'Alex Morgan' })
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop requested', result: 'Pending' })
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    h.unmount()
  })

  it('a typed request and the demo runtime resolve are observed through the one authority (both entries)', () => {
    const h = mountServices()
    // Typed → authority: a direct handler request is committed and visible in the snapshot.
    act(() => {
      requestEmergencyStopTransaction(h.svc().authority, h.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c-x1' }, { scope: 'operation', id: OP14, reason: 'halt now' })
    })
    expect(h.db().stopState).toMatchObject({ phase: 'requested', by: 'Alex Morgan' })
    // Runtime → authority: the demo dismiss clears the stop state in the same authority.
    act(() => { resolveStop('dismiss') })
    expect(h.db().stopState).toBeNull()
    h.unmount()
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

  it('a manual confirm completes the machine coherently — linked operations halt, sessions terminate, agents release (G-10, ticket 28)', async () => {
        const svc = createConsoleServices()
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c13' }, { scope: 'operation', id: OP14, reason: 'halt now' }).ok).toBe(true)
    expect(unknownEmergencyStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c14' }, { scope: 'operation', id: OP14 }).ok).toBe(true)
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c15' }, 'confirmed-stopped').ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.stopState?.phase).toBe('stopped')
    // The confirmed stop never contradicts the records: the halt is real, so
    // the demo ticker cannot keep progressing a "stopped" operation.
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.operations.find((o) => o.id === OP14)?.steps.find((s) => s.id === 'S12')?.status).toBe('notrun')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    expect(d.agents.find((a) => a.id === 'AG-007')?.op).toBeNull()
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop confirmed manually', result: 'Success', reason: 'Operator verified agents halted out-of-band' })
    // Dismissing clears the stop state; confirming with none in progress is an explicit refusal.
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c16' }, 'dismiss').ok).toBe(true)
    expect(svc.authority.snapshot().stopState).toBeNull()
    expect(resolveStopTransaction(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: P14, corr: 'c17' }, 'confirmed-stopped'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('No emergency stop is in progress') }) })
    svc.dispose()
  })

  it('concurrent stops keep out-of-scope operations, sessions and reservations unchanged', async () => {
    const svc = createConsoleServices()
    const ctx = (projectId: string, corr: string): RequestContext => ({ actor: { id: 'Alex Morgan', role: 'manager' }, projectId, corr })
    // Two stops committed against different scopes at the "same time".
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, ctx(P14, 'k1'), { scope: 'operation', id: OP14, reason: 'halt 014' }).ok).toBe(true)
    expect(requestEmergencyStopTransaction(svc.authority, svc.clock, ctx('RT-2026-015', 'k2'), { scope: 'operation', id: 'OP-015', reason: 'halt 015' }).ok).toBe(true)
    expect(acknowledgeEmergencyStopTransaction(svc.authority, svc.clock, ctx(P14, 'k3'), { scope: 'operation', id: OP14, reason: 'halt 014' }).ok).toBe(true)
    expect(finalizeEmergencyStopTransaction(svc.authority, svc.clock, ctx(P14, 'k4'), { scope: 'operation', id: OP14 }).ok).toBe(true)
    const d = svc.authority.snapshot()
    // Only the OP-014 scope moved; OP-015's records are exactly as seeded.
    expect(d.operations.find((o) => o.id === 'OP-015')?.status).toBe('running')
    expect(d.sessions.find((s) => s.id === 'SS-043')?.state).toBe('connected')
    expect(d.agents.find((a) => a.id === 'AG-010')?.op).toBe('OP-015')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    svc.dispose()
  })
})

describe('the demo orchestration through the runtime handlers still reaches stopped', () => {
  it('requested → acknowledged → stopped with sessions terminated and agents released', () => {
    const h = mountServices()
    h.run(() => emergencyStop('operation', OP14, 'ROE violation observed'))
    act(() => { vi.advanceTimersByTime(1800) })
    let d = h.db()
    expect(d.stopState?.phase).toBe('acknowledged')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'revoking')).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) })
    d = h.db()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    expect(d.agents.find((a) => a.id === 'AG-007')?.op).toBeNull()
    h.unmount()
  })

  it('a workspace stop and the failed/unknown outcome paths behave through the same handlers', () => {
    const h = mountServices()
    h.run(() => useSessionStore.getState().setStopOutcome('fail'))
    h.run(() => emergencyStop('workspace', 'all', 'halt everything'))
    act(() => { vi.advanceTimersByTime(1800) })
    expect(h.db().stopState?.phase).toBe('failed')
    expect(h.db().audit[0]).toMatchObject({ action: 'Emergency stop failed', obj: 'Workspace', result: 'Failed' })
    h.run(() => retryStop())
    expect(h.db().stopState?.phase).toBe('requested')
    act(() => { vi.advanceTimersByTime(3800) })
    expect(h.db().stopState?.phase).toBe('stopped')
    expect(h.db().operations.every((o) => o.status !== 'running')).toBe(true)
    h.unmount()
  })
})
