/**
 * Ticket 47: the mounted console's command path. The safe actions commit
 * command history through the 46 grant-enforced transaction — exercised in
 * both bridge directions (the UI's legacy entry, and the typed transaction
 * updating the mounted console) — while the rendered deadline comes from the
 * typed read. Deadline−1/at/+1 authorization boundaries stay in
 * ./grants.test.tsx; the expiry interrupt of an in-flight command stays in
 * ../safety/grants.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.useFakeTimers()
const { act, cleanup, fireEvent, screen } = await import('@testing-library/react')
const { mountServices } = await import('../../test/helpers')
const { go, selectProject } = await import('../../router/navigate')
const { routes } = await import('../../screens/h')
const { sessionCommandTransaction } = await import('./grants')


afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  window.location.hash = ''
})

function mountConsole(me = 'Taylor Chen') {
  window.location.hash = '#/c2'
  const Screen = routes['c2-console']
  return mountServices(<Screen />, me)
}

/** Fires React Query's setTimeout(0) notifications and flushes the fetch microtasks (0ms — never advances the demo clock). */
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }

async function until(check: () => boolean) {
  for (let i = 0; i < 60 && !check(); i++) await flush()
  expect(check()).toBe(true)
}

describe('console command path (ticket 47)', () => {
  it('a safe action commits command history through the grant-enforced transaction and the typed read renders it', async () => {
    const h = mountConsole()
    act(() => { selectProject('RT-2026-014'); go('c2-console', { id: 'SS-041' }) })
    // The rendered deadline (typed read) and the real command handler are separate concerns:
    // the countdown here, the transaction boundary at the commit below.
    await until(() => screen.queryByText(/Expires in 33 min/) !== null)
    const userLines = () => h.db().sessions.find((s) => s.id === 'SS-041')!.transcript.filter((l) => l.who === 'user')
    expect(userLines().length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show host summary' }))
    expect(screen.getAllByText(/Busy — command in progress/).length).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    await until(() => screen.queryAllByText('[simulated] Show host summary').length > 0)
    expect(userLines().length).toBe(3)
    // The session events panel observes the same commit through the typed audit rows.
    fireEvent.click(screen.getByRole('tab', { name: /Session Events/ }))
    await until(() => screen.queryByText('Session action (simulated)') !== null)
    h.unmount()
  })

  it('a typed command commit reaches the mounted console through the bridge without a reload', async () => {
    const h = mountConsole()
    act(() => { selectProject('RT-2026-014'); go('c2-console', { id: 'SS-041' }) })
    await until(() => screen.queryByText('Interactive Session') !== null)
    const before = h.db().sessions.find((s) => s.id === 'SS-041')!.transcript.length
    act(() => {
      const r = sessionCommandTransaction(h.svc().authority, h.svc().clock, { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 'typed' }, { sessionId: 'SS-041', label: 'Show network interfaces (simulated)' })
      expect(r.ok).toBe(true)
    })
    await until(() => screen.queryAllByText('[simulated] Show network interfaces (simulated)').length > 0)
    expect(h.db().sessions.find((s) => s.id === 'SS-041')!.transcript.length).toBe(before + 2)
    h.unmount()
  })
})
