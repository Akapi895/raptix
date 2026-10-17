import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'

vi.useFakeTimers()
const { mountServices } = await import('../test/helpers')
const { hhmm } = await import('../features/c2/service')
const { expireGrantTransaction } = await import('../features/c2/grants')
const { minutesUntil, useGrantWatch, Console } = await import('../screens/h-session')
const { go, selectProject } = await import('../router/navigate')
const { useToastStore } = await import('../state/stores')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  window.location.hash = ''
})

/* Ticket 47: the console reads through the typed session query, so waits are
   needed for the fetch + the bridge refetch. advanceTimersByTimeAsync(0)
   fires React Query's setTimeout(0) notifications without advancing the demo
   clock (the countdowns below stay exact). */
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
async function until(check: () => boolean) {
  for (let i = 0; i < 60 && !check(); i++) await flush()
  expect(check()).toBe(true)
}

function GrantWatchProbe() {
  useGrantWatch()
  return null
}

describe('grant countdown against the simulated clock (requirement 50)', () => {
  it('measures minutes between the ROE timestamp format and the module clock', () => {
    expect(hhmm()).toBe('10:42')
    expect(minutesUntil('Oct 13, 2026, 11:15 AM (UTC+7)', '10:42')).toBe(33)
    expect(minutesUntil('Oct 13, 2026, 10:42 AM (UTC+7)', '10:42')).toBe(0)
  })

  it('a live grant survives several 15-second watch ticks and shows its remaining time', async () => {
    // selectProject must run while the route is NOT a detail page: its guarded
    // redirect would retarget the route away from the section we navigate to
    // next. The order below mirrors the console's own flow: pick the project
    // from the switcher, then open the session detail route.
    window.location.hash = '#/c2'
    const view = mountServices(Console, 'Taylor Chen')
    act(() => {
      selectProject('RT-2026-014')
      go('c2-console', { id: 'SS-041' })
    })
    await until(() => screen.queryByText(/Expires in 33 min/) !== null)
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(screen.getByText(/Expires in 32 min/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show host summary' })).toBeEnabled()
    view.unmount()
  })
})

describe('grant expiry (requirement 50/51 baseline: enforced by the mounted useGrantWatch)', () => {
  it('the watch removes the grant at the deadline and the console locks its input', async () => {
    window.location.hash = '#/c2'
    const view = mountServices(Console, 'Taylor Chen')
    act(() => {
      selectProject('RT-2026-014')
      go('c2-console', { id: 'SS-041' })
    })
    await until(() => screen.queryByRole('button', { name: 'Show host summary' }) !== null)
    act(() => {
      vi.advanceTimersByTime(1_980_000)
    })
    await until(() => screen.queryByLabelText('Command input')?.hasAttribute('disabled') === true)
    expect(screen.getAllByText(/Access expired\. Request a new grant\./).length).toBeGreaterThan(0)
    view.unmount()
  })

  it('expiry revokes the grant, expires the approved request, records the transcript line and warns the holder', () => {
    const view = mountServices(GrantWatchProbe, 'Taylor Chen')
    expect(view.db().sessions.find((s) => s.id === 'SS-041')!.grants.map((g) => g.user)).toEqual(['Taylor Chen'])
    act(() => {
      vi.advanceTimersByTime(1_980_000)
    })
    const d = view.db()
    expect(d.sessions.find((s) => s.id === 'SS-041')!.grants).toEqual([])
    expect(d.sessionRequests.find((r) => r.id === 'AR-011')?.status).toBe('expired')
    expect(d.sessions.find((s) => s.id === 'SS-041')!.transcript.some((l) => l.text === 'Interactive grant for Taylor Chen expired.')).toBe(true)
    expect(useToastStore.getState().toasts.some((t) => t.text.includes('Your interactive grant on SS-041 expired'))).toBe(true)
    view.unmount()
  })

  it('an in-flight command rechecks access before committing output (requirement 113 deadline semantics)', async () => {
    window.location.hash = '#/c2'
    const view = mountServices(Console, 'Taylor Chen')
    act(() => {
      selectProject('RT-2026-014')
      go('c2-console', { id: 'SS-041' })
    })
    await until(() => screen.queryByRole('button', { name: 'Show host summary' }) !== null)
    const userLines = () => view.db().sessions.find((s) => s.id === 'SS-041')!.transcript.filter((l) => l.who === 'user').length
    expect(userLines()).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show host summary' }))
    expect(screen.getAllByText(/Busy — command in progress/).length).toBeGreaterThan(0)
    act(() => {
      expireGrantTransaction(view.svc().authority, view.svc().clock, 'legacy', 'SS-041', 'Taylor Chen')
    })
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    expect(useToastStore.getState().toasts.some((t) => t.text === 'Command interrupted — access changed while it was running.')).toBe(true)
    expect(userLines()).toBe(2)
    view.unmount()
  })
})

describe('useGrantWatch scope', () => {
  it('a non-holder sees grants expire too, without a personal warning', () => {
    const view = mountServices(GrantWatchProbe, 'Alex Morgan')
    act(() => {
      vi.advanceTimersByTime(1_980_000)
    })
    const d = view.db()
    expect(d.sessions.find((s) => s.id === 'SS-041')!.grants).toEqual([])
    expect(useToastStore.getState().toasts.some((t) => t.text.includes('Your interactive grant'))).toBe(false)
    view.unmount()
  })
})
