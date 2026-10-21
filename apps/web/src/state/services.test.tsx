/** Mounted services own delayed demo responses across resets and remounts. */
import { afterEach, expect, it, vi } from 'vitest'

vi.useFakeTimers()
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react')
const { ServicesProvider, useServices } = await import('./services')
const { useSessionStore } = await import('./session')
const { createChatHandlers } = await import('../features/aichat/handlers')
const { sendChat, resetDemo } = await import('../demo/runtime')
const { useState } = await import('react')
const { hhmm } = await import('../demo/display-clock')

afterEach(() => { cleanup(); vi.clearAllTimers() })

function ChatResponse(): React.JSX.Element {
  const services = useServices()
  const busy = useSessionStore((s) => s.aiBusy)
  return <>
    <button onClick={() => {
      const chat = createChatHandlers(services, { id: 'Alex Morgan', role: 'manager' }, 'all')
      const created = chat.create('RT-2026-015', 'propose')
      if (!created.ok) throw new Error(created.failure.message)
      sendChat(created.data.id, 'Plan a validation run for the in-scope cloud assets.')
    }}>Start response</button>
    <span>{busy ? 'Response pending' : 'Response idle'}</span>
  </>
}

it('an unmounted response cannot clear the next provider mount’s pending response', () => {
  const first = render(<ServicesProvider><ChatResponse /></ServicesProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Start response' }))
  act(() => { vi.advanceTimersByTime(100) })
  first.unmount()
  render(<ServicesProvider><ChatResponse /></ServicesProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Start response' }))
  act(() => { vi.advanceTimersByTime(800) })
  expect(screen.getByText('Response pending')).toBeInTheDocument()
})

function ResetDeadline(): React.JSX.Element {
  const services = useServices()
  const [due, setDue] = useState(false)
  return <>
    <button onClick={() => {
      resetDemo()
      resetDemo()
      services.schedule(services.clock.now() + 15_000, () => setDue(true))
    }}>Reset and schedule</button>
    <span>{due ? 'Deadline reached' : 'Deadline pending'}</span>
  </>
}

it('resetting twice between clock ticks does not charge pre-reset elapsed time to a new deadline', () => {
  render(<ServicesProvider><ResetDeadline /></ServicesProvider>)
  act(() => { vi.advanceTimersByTime(7000) })
  fireEvent.click(screen.getByRole('button', { name: 'Reset and schedule' }))
  act(() => { vi.advanceTimersByTime(8000) })
  expect(screen.getByText('Deadline pending')).toBeInTheDocument()
})

function ResetDisplay(): React.JSX.Element {
  const [label, setLabel] = useState('')
  return <>
    <button onClick={() => { resetDemo(); resetDemo(); setLabel(hhmm()) }}>Reset display clock</button>
    <span>{label}</span>
  </>
}

it('demo reset restores the countdown display to the dataset anchor', () => {
  render(<ServicesProvider><ResetDisplay /></ServicesProvider>)
  act(() => { vi.advanceTimersByTime(60_000) })
  fireEvent.click(screen.getByRole('button', { name: 'Reset display clock' }))
  expect(screen.getByText('10:42')).toBeInTheDocument()
})
