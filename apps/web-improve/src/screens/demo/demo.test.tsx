/**
 * Ticket 61c: rendered contract of the guided walkthrough module. Launching a
 * guide renders the panel with the guide id/persona/step; the panel's controls
 * are keyboard-operable buttons (Prev/Next/Finish/collapse/end); the
 * auto-advance follows the user to the next step's screen; the WF-F simulated
 * actions drive the agent disconnect/restore through the DemoKit seam over the
 * bridged demo actions; ending the guide clears the panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import type { Store } from '../../store'

vi.useFakeTimers()
const { StoreProvider, useStore } = await import('../../store')
const { ConsoleProviders } = await import('../../state/query')
const { useAuthStore } = await import('../../state/stores')
const { setActiveRouter } = await import('../../router/active')
const { RouteHost, RouteErrorBoundary } = await import('../../router/host')
const { launchGuide, stopGuide } = await import('./launch')

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
  act(() => stopGuide())
  if (vi.isFakeTimers()) vi.clearAllTimers()
})

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  let store!: Store
  function Probe({ ready }: { ready: (s: Store) => void }) {
    ready(useStore())
    return null
  }
  const router = createHashRouter([
    { path: '*', element: <><Probe ready={(s) => (store = s)} /><RouteHost /></>, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  return () => store
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

const signedOut = () => !useAuthStore.getState().authed

/** Launches a guide and settles its jump/toast timers. */
function start(store: () => Store, id: string, at = 0) {
  act(() => { launchGuide(store, id, at) })
  act(() => { vi.advanceTimersByTime(250) })
}

describe('walkthrough panel (ticket 61c)', () => {
  it('launching a guide renders the panel with guide id, persona and step state', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    expect(screen.getByLabelText('Demo walkthrough')).toBeInTheDocument()
    expect(screen.getByText('Demo walkthrough · E2E-03')).toBeInTheDocument()
    expect(screen.getByText('Step 1/3')).toBeInTheDocument()
    expect(screen.getByText('Create Operation', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan', { selector: 'span' })).toBeInTheDocument()
  })

  it('launching a guide from a signed-out state enters the app and shows the panel', () => {
    const store = mountApp('#/command-center')
    expect(signedOut()).toBe(true)
    start(store, 'E2E-03')
    expect(store().authed).toBe(true)
    expect(screen.getByLabelText('Demo walkthrough')).toBeInTheDocument()
  })

  it('Prev/Next move between steps and the last step offers Finish', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Step 2/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Step 3/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.queryByLabelText('Demo walkthrough')).not.toBeInTheDocument()
  })

  it('every control is a keyboard-operable named button (focus reaches the panel actions)', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    for (const name of [/Next/, 'Go to this screen', 'Collapse walkthrough', 'End walkthrough']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.tabIndex).toBe(0)
      act(() => { btn.focus() })
      expect(btn).toHaveFocus()
    }
  })

  it('opening the next step\'s screen auto-advances the guide', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    expect(screen.getByText('Step 1/3')).toBeInTheDocument()
    act(() => { store().go('preflight', { id: 'OP-DRAFT-017' }) })
    expect(screen.getByText('Step 2/3')).toBeInTheDocument()
  })

  it('collapse reduces the panel to a pill and expanding restores it', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse walkthrough' }))
    expect(screen.getByRole('button', { name: 'Expand demo walkthrough' })).toHaveTextContent('Demo E2E-03 · Step 1/3')
    fireEvent.click(screen.getByRole('button', { name: 'Expand demo walkthrough' }))
    expect(screen.getByLabelText('Demo walkthrough')).toBeInTheDocument()
  })

  it('the WF-F simulated actions drive the agent disconnect and restore through the kit', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'WF-F')
    expect(screen.getByText('Step 1/6')).toBeInTheDocument()
    expect(store().db.agents.find((a) => a.id === 'AG-008')!.status).not.toBe('lost')
    fireEvent.click(screen.getByRole('button', { name: 'Simulated action: Simulate AG-008 disconnect' }))
    expect(store().db.agents.find((a) => a.id === 'AG-008')!.status).toBe('lost')
    expect(screen.getByText('Simulated: AG-008 disconnected. Demo data only.')).toBeInTheDocument()
    act(() => { launchGuide(store, 'WF-F', 5) })
    act(() => { vi.advanceTimersByTime(250) })
    fireEvent.click(screen.getByRole('button', { name: 'Simulated action: Restore AG-008' }))
    expect(store().db.agents.find((a) => a.id === 'AG-008')!.status).toBe('online')
    expect(screen.getByText('Simulated: AG-008 restored. Demo data only.')).toBeInTheDocument()
  })

  it('ending the walkthrough clears the guide state', () => {
    const store = mountApp('#/command-center')
    signIn()
    start(store, 'E2E-03')
    fireEvent.click(screen.getByRole('button', { name: 'End walkthrough' }))
    expect(screen.queryByLabelText('Demo walkthrough')).not.toBeInTheDocument()
  })
})
