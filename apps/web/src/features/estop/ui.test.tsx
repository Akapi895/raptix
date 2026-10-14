/**
 * Ticket 28: the emergency-stop machine UI. Every machine phase renders an
 * actionable control (invariant 1: a stop is always an action with an
 * immediate visible response, never a passive status); the user-driven
 * transitions run the typed estop handlers through the one authority with
 * the gates holding (a role without `estop` cannot drive the machine and the
 * refusal commits nothing); the simulated outcomes are labeled as demo
 * orchestration and never bypass the transactions; and a machine-driven
 * commit refetches Query consumers through the ChangeSet bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'

vi.useFakeTimers()
const { mountServices } = await import('../../test/helpers')
const { emergencyStop, resolveStop, resetDemo } = await import('../../features/demo/runtime')
const { useSessionStore } = await import('../../state/session')
const { useDb } = await import('../../state/console')
const { useServices } = await import('../../state/services')
const { consoleKeys, useQueryScope } = await import('../../state/keys')
const { EmergencyStopDialog, StopStatePanel } = await import('./ui')

afterEach(() => {
  cleanup()
  if (vi.isFakeTimers()) vi.clearAllTimers()
})

const OP14 = 'OP-014'

/* mountServices wires the service authority + console Query providers; `run`
   wraps mutations in act() and `flush` drains react-query's microtask pipeline. */
function mount(ui: React.ReactNode) {
  const view = mountServices(ui)
  return { db: view.db, as: view.as, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}
const flush = () => act(async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  // react-query batches listener notifications with setTimeout(0), frozen by
  // the suite's fake timers — a 1 ms advance (below every store delay) fires it.
  vi.advanceTimersByTime(1)
})

function Panel() {
  const op = useDb().operations.find((o) => o.id === OP14)!
  return <StopStatePanel op={op} />
}

function DialogOpen() {
  const op = useDb().operations.find((o) => o.id === OP14)!
  return <EmergencyStopDialog op={op} open onClose={() => {}} />
}

function requestFromDialog() {
  fireEvent.change(screen.getByPlaceholderText('Why is an emergency stop needed?'), { target: { value: 'ROE violation observed' } })
  fireEvent.click(screen.getByLabelText(/I understand the impact/))
  fireEvent.click(screen.getByRole('button', { name: 'Request Emergency Stop' }))
}

describe('every machine phase renders an actionable control (invariant 1)', () => {
  it('requested, acknowledged and stopped each expose their next control', () => {
    const h = mount(<Panel />)
    expect(screen.queryByText(/Emergency stop \(operation\)/)).not.toBeInTheDocument()
    h.run(() => emergencyStop('operation', OP14, 'ROE violation observed'))
    expect(screen.getByRole('button', { name: 'Acknowledge now (demo)' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1800) })
    expect(screen.getByRole('button', { name: 'Finalize now (demo)' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    h.unmount()
  })

  it('the failed and unknown phases expose retry and manual-confirm controls', () => {
    const h = mount(<Panel />)
    h.run(() => useSessionStore.getState().setStopOutcome('fail'))
    h.run(() => emergencyStop('operation', OP14, 'halt now'))
    act(() => { vi.advanceTimersByTime(1800) })
    expect(screen.getByRole('button', { name: 'Retry Stop' })).toBeInTheDocument()
    h.run(() => resolveStop('dismiss'))
    expect(screen.queryByRole('button', { name: 'Retry Stop' })).not.toBeInTheDocument()
    h.run(() => useSessionStore.getState().setStopOutcome('unknown'))
    h.run(() => emergencyStop('operation', OP14, 'halt now (retry)'))
    act(() => { vi.advanceTimersByTime(1800) })
    expect(screen.getByRole('button', { name: 'Confirm Manually Stopped' })).toBeInTheDocument()
    h.unmount()
  })
})

describe('the panel transitions run the typed handlers (gates hold)', () => {
  it('the demo acknowledge/finalize controls commit the same handler transitions', () => {
    const h = mount(<Panel />)
    h.run(() => emergencyStop('operation', OP14, 'halt now'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge now (demo)' }))
    let d = h.db()
    expect(d.stopState?.phase).toBe('acknowledged')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop acknowledged', result: 'Success' })
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'revoking')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Finalize now (demo)' }))
    d = h.db()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.sessions.filter((s) => s.opId === OP14).every((s) => s.state === 'terminated')).toBe(true)
    h.unmount()
  })

  it('the manual confirm control closes the machine with the halt actually committed (G-10)', () => {
    const h = mount(<Panel />)
    h.run(() => useSessionStore.getState().setStopOutcome('unknown'))
    h.run(() => emergencyStop('operation', OP14, 'halt now'))
    act(() => { vi.advanceTimersByTime(1800) })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Manually Stopped' }))
    const d = h.db()
    expect(d.stopState?.phase).toBe('stopped')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('estop')
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop confirmed manually', result: 'Success' })
    h.unmount()
  })

  it('a role without estop cannot drive the machine and the refusal commits nothing', () => {
    const h = mount(<Panel />)
    h.run(() => emergencyStop('operation', OP14, 'halt now'))
    h.run(() => h.as('Riley Brooks'))
    const gated = screen.getByText('Acknowledge now (demo)')
    // The Gated wrapper keeps the control rendered, visibly disabled, and
    // explains why on interaction (its own widget tests cover the tooltip).
    expect(gated.closest('[aria-disabled="true"]')).not.toBeNull()
    fireEvent.click(gated.parentElement!.parentElement!)
    expect(screen.getByText(/Only a Red Team Manager or Admin can drive an Emergency Stop/)).toBeInTheDocument()
    const d = h.db()
    expect(d.stopState?.phase).toBe('requested')
    expect(d.operations.find((o) => o.id === OP14)?.status).toBe('running')
    h.unmount()
  })
})

describe('the request dialog', () => {
  it('gates on role, reason and impact acknowledgement before the request can fire', () => {
    const h = mount(<DialogOpen />)
    h.run(() => h.as('Riley Brooks'))
    const submit = screen.getByRole('button', { name: 'Request Emergency Stop' })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/Request is disabled: Your role cannot trigger an Emergency Stop/)).toBeInTheDocument()
    h.unmount()
  })

  it('commits the immediate requested state through the delegating action', () => {
    const h = mount(<DialogOpen />)
    expect(screen.getByRole('button', { name: 'Request Emergency Stop' })).toBeDisabled()
    requestFromDialog()
    const d = h.db()
    expect(d.stopState).toMatchObject({ scope: 'operation', id: OP14, phase: 'requested', by: 'Alex Morgan' })
    expect(d.audit[0]).toMatchObject({ action: 'Emergency stop requested', result: 'Pending' })
    h.unmount()
  })

  it('labels the request as simulated demo orchestration', () => {
    const h = mount(<DialogOpen />)
    expect(screen.getByText(/Prototype only. This simulates a stop request; no real system is affected/)).toBeInTheDocument()
    expect(screen.getAllByText('Demo data').length).toBeGreaterThan(0)
    h.unmount()
  })
})

describe('demo outcome switch and ChangeSet refetch', () => {
  it('the banner carries the labeled demo outcome switch in every phase', () => {
    const h = mount(<Panel />)
    h.run(() => emergencyStop('operation', OP14, 'halt now'))
    const sel = screen.getByLabelText('Demo outcome of the next emergency stop')
    expect(sel).toBeInTheDocument()
    expect(screen.getAllByText('Demo data').length).toBeGreaterThan(0)
    act(() => { vi.advanceTimersByTime(3800) })
    expect(screen.getByLabelText('Demo outcome of the next emergency stop')).toBeInTheDocument()
    h.unmount()
  })

  it('a machine-driven stop commit refetches Query consumers through the ChangeSet bridge', async () => {
    let fetches = 0
    const StopProbe = () => {
      const scope = useQueryScope()
      const svc = useServices()
      const q = useQuery({ queryKey: consoleKeys.view('estop-probe', scope), queryFn: () => { fetches++; return svc.authority.snapshot().stopState?.phase ?? 'none' } })
      return <p data-testid="stop-q">{String(q.data)}</p>
    }
    const h = mount(<><StopProbe /><Panel /></>)
    await flush()
    expect(screen.getByTestId('stop-q')).toHaveTextContent('none')
    expect(fetches).toBe(1)
    h.run(() => emergencyStop('operation', OP14, 'refetch probe'))
    await flush()
    expect(fetches).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('stop-q')).toHaveTextContent('requested')
    h.run(() => resetDemo())
    h.unmount()
  })
})
