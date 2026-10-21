import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

vi.useFakeTimers()
const { mountServices } = await import('../helpers')
const { emergencyStop, retryStop, resolveStop } = await import('../../features/demo/runtime')
const { useSessionStore } = await import('../../state/session')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

describe('emergency stop outcomes (requested → acknowledged/failed/unknown → stopped)', () => {
  it('an acknowledged stop halts the operation, marks ambiguous steps, revokes linked sessions and releases agents', () => {
    const h = mountServices()
    h.run(() => emergencyStop('operation', 'OP-014', 'ROE violation observed'))
    let d = h.db()
    expect(d.stopState).toMatchObject({ scope: 'operation', id: 'OP-014', phase: 'requested', by: 'Alex Morgan' })
    expect(d.operations.find((o) => o.id === 'OP-014')?.status).toBe('running')
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    d = h.db()
    const op = d.operations.find((o) => o.id === 'OP-014')!
    expect(d.stopState?.phase).toBe('acknowledged')
    expect(op.status).toBe('estop')
    expect(op.stopReason).toBe('ROE violation observed')
    expect(op.steps.find((s) => s.id === 'S12')?.status).toBe('notrun')
    expect(d.sessions.filter((s) => s.opId === 'OP-014').every((s) => s.state === 'revoking')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    d = h.db()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.sessions.filter((s) => s.opId === 'OP-014').every((s) => s.state === 'terminated')).toBe(true)
    expect(d.agents.find((a) => a.id === 'AG-007')?.op).toBeNull()
    h.unmount()
  })

  it('a project-scoped stop halts only that project’s operations', () => {
    const h = mountServices()
    h.run(() => emergencyStop('project', 'RT-2026-014', 'contain project'))
    act(() => {
      vi.advanceTimersByTime(3800)
    })
    const d = h.db()
    expect(d.operations.find((o) => o.id === 'OP-014')?.status).toBe('estop')
    expect(d.operations.find((o) => o.id === 'OP-015')?.status).toBe('running')
    h.unmount()
  })

  it('a failed acknowledgement records the explicit failure and leaves operations running', () => {
    const h = mountServices()
    h.run(() => useSessionStore.getState().setStopOutcome('fail'))
    h.run(() => emergencyStop('operation', 'OP-014', 'halt now'))
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    const d = h.db()
    expect(d.stopState?.phase).toBe('failed')
    expect(d.operations.find((o) => o.id === 'OP-014')?.status).toBe('running')
    expect(d.audit[0].action).toBe('Emergency stop failed')
    h.unmount()
  })

  it('retry after a failed stop re-requests the stop and reaches acknowledged → stopped', () => {
    const h = mountServices()
    h.run(() => useSessionStore.getState().setStopOutcome('fail'))
    h.run(() => emergencyStop('operation', 'OP-014', 'halt now'))
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    h.run(() => retryStop())
    expect(h.db().stopState?.phase).toBe('requested')
    act(() => {
      vi.advanceTimersByTime(3800)
    })
    const d = h.db()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.operations.find((o) => o.id === 'OP-014')?.status).toBe('estop')
    h.unmount()
  })

  it('an unknown outcome records explicit uncertainty and the manual confirm path closes the stop state', () => {
    const h = mountServices()
    h.run(() => useSessionStore.getState().setStopOutcome('unknown'))
    h.run(() => emergencyStop('operation', 'OP-014', 'halt now'))
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    expect(h.db().stopState?.phase).toBe('unknown')
    expect(h.db().operations.find((o) => o.id === 'OP-014')?.status).toBe('running')
    h.run(() => resolveStop('confirmed-stopped'))
    expect(h.db().stopState?.phase).toBe('stopped')
    h.unmount()
  })

  it('emergency-stopped operations are never resumed automatically (requirement 22)', () => {
    const h = mountServices()
    h.run(() => emergencyStop('workspace', 'all', 'halt everything'))
    act(() => {
      vi.advanceTimersByTime(3800)
    })
    expect(h.db().stopState?.phase).toBe('stopped')
    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    const d = h.db()
    expect(d.operations.find((o) => o.id === 'OP-014')?.status).toBe('estop')
    expect(d.operations.find((o) => o.id === 'OP-015')?.status).toBe('estop')
    expect(d.operations.every((o) => o.status !== 'running')).toBe(true)
    h.unmount()
  })
})
