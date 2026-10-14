/** Rendered typed reads must observe delayed commits beside synchronous identity reads. */
import { afterEach, expect, it, vi } from 'vitest'

vi.useFakeTimers()
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react')
const { ServicesProvider, useServices } = await import('./services')
const { ConsoleProviders } = await import('./query')
const { useMe } = await import('./console')
const { useAuthStore, useProjectStore } = await import('./stores')
const { useC2Session } = await import('../features/c2/query')
const { sessionCommandTransaction } = await import('../features/c2/grants')

afterEach(() => { cleanup(); vi.clearAllTimers() })

function CommandRead(): React.JSX.Element {
  const services = useServices()
  const me = useMe()
  const detail = useC2Session('SS-041')
  return <>
    <button onClick={() => window.setTimeout(() => {
      sessionCommandTransaction(services.authority, services.clock, {
        actor: { id: me.name, role: me.role }, projectId: 'RT-2026-014', corr: 'delayed-command',
      }, { sessionId: 'SS-041', label: 'Show host summary' })
    }, 2500)}>Run safe action</button>
    <div role="log">{detail.data?.session.transcript.map((line, i) => <p key={i}>{line.text}</p>)}</div>
    {detail.data && <span>Session loaded</span>}
  </>
}

async function flushReads(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

it('renders command output committed by a timer while identity observes the same authority', async () => {
  render(<ServicesProvider><ConsoleProviders><CommandRead /></ConsoleProviders></ServicesProvider>)
  act(() => { useAuthStore.getState().setMe('Taylor Chen'); useProjectStore.getState().setPid('RT-2026-014') })
  await flushReads()
  expect(screen.getByText('Session loaded')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Run safe action' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  await flushReads()
  expect(screen.getByText('[simulated] Show host summary')).toBeInTheDocument()
})
