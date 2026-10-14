/** Mounted services own delayed demo responses across resets and remounts. */
import { afterEach, expect, it, vi } from 'vitest'

vi.useFakeTimers()
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react')
const { ServicesProvider, useServices } = await import('./services')
const { useSessionStore } = await import('./session')
const { createChatHandlers } = await import('../features/aichat/handlers')
const { sendChat } = await import('../features/demo/runtime')

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
