/**
 * Tickets 61c/61d: rendered contracts of the demo module.
 *
 * Walkthrough (61c): launching a guide renders the panel with the guide
 * id/persona/step; the panel's controls are keyboard-operable buttons
 * (Prev/Next/Finish/collapse/end); the auto-advance follows the user to the
 * next step's screen; the WF-F simulated actions drive the agent
 * disconnect/restore through the DemoKit seam over the bridged demo actions;
 * ending the guide clears the panel.
 *
 * Launcher/workspaces (61d): the scenarios and workspaces pages render as
 * public full-page routes outside the shell; persona selection and workspace
 * sign-in flow through the single auth entries; the page's Reset Demo State
 * action runs the ONE authority reset chain through its confirm modal
 * (including re-arming the seeded grant deadline on the fresh dataset) and a
 * second reset on the same mount stays coherent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import type { Store } from '../../store'

/* Captured before the fake timers are installed: `until` needs a REAL
   event-loop turn because the fake timers only flush microtasks, so the
   first lazy-slice chunk load (real module I/O) would otherwise never
   complete inside the polling loop. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis)
vi.useFakeTimers()
const realYield = () => new Promise<void>((r) => { realSetTimeout(r, 0) })
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

/** Settles the lazy scenario-slice chunk under fake timers (findBy's polling timer is faked). */
async function until(probe: () => boolean, what: string) {
  for (let i = 0; i < 80 && !probe(); i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(25); await realYield() })
  }
  if (!probe()) throw new Error(`condition not reached: ${what}`)
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

describe('scenario launcher and workspaces (ticket 61d)', () => {
  it('scenarios renders as a public full-page route outside the shell', async () => {
    mountApp('#/scenarios')
    await until(() => screen.queryByText('Prototype Home') !== null, 'Prototype Home')
    expect(screen.queryByLabelText('Main navigation')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Persona')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset Demo State' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Enter app' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: 'Start E2E-01' }).length).toBeGreaterThan(0)
  })

  it('workspace selection signs in with the chosen organization and enters the console', async () => {
    mountApp('#/workspaces')
    await until(() => screen.queryByRole('heading', { name: 'Select a workspace' }) !== null, 'workspace heading')
    expect(screen.queryByLabelText('Main navigation')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search workspaces'), { target: { value: 'purple' } })
    expect(screen.getByText('Acme Security — Purple Team Lab')).toBeInTheDocument()
    expect(screen.queryByText('Northwind Bank — Client Portal (Demo)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }))
    expect(useAuthStore.getState().authed).toBe(true)
    expect(useAuthStore.getState().org).toBe('Acme Security — Purple Team Lab')
    expect(window.location.hash).toBe('#/command-center')
  })

  it('scenario reset runs the one authority chain through the page confirm modal and re-arms the deadline workflows', async () => {
    const store = mountApp('#/scenarios')
    await until(() => screen.queryByText('Prototype Home') !== null, 'Prototype Home')
    act(() => { store().A.loseAgent('AG-008') })
    expect(store().db.agents.find((a) => a.id === 'AG-008')!.status).toBe('lost')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Demo State' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('All changes made in this prototype session are discarded')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Demo State' }))
    expect(store().db.agents.find((a) => a.id === 'AG-008')!.status).not.toBe('lost')
    expect(store().db.stopState).toBeNull()
    /* the Scheduler re-armed against the fresh dataset: the seeded Taylor Chen
       grant on SS-041 (expires 11:15 AM, anchor + 33 min) expires on its
       deadline with no C2 screen mounted. */
    act(() => { vi.advanceTimersByTime(40 * 60 * 1000) })
    expect(store().db.sessions.find((s) => s.id === 'SS-041')!.grants).toHaveLength(0)
  })

  it('a second reset on the same mount stays coherent (no duplicate publications or toasts)', async () => {
    const store = mountApp('#/scenarios')
    await until(() => screen.queryByText('Prototype Home') !== null, 'Prototype Home')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Demo State' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset Demo State' }))
    act(() => { store().A.loseAgent('AG-007') })
    fireEvent.click(screen.getByRole('button', { name: 'Reset Demo State' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset Demo State' }))
    expect(store().db.agents.find((a) => a.id === 'AG-007')!.status).not.toBe('lost')
    expect(screen.getAllByText('Demo state reset.')).toHaveLength(1)
  })

  it('enter app signs the selected persona in through the single auth entry and lands on the console', async () => {
    const store = mountApp('#/scenarios')
    await until(() => screen.queryByText('Prototype Home') !== null, 'Prototype Home')
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'Taylor Chen' } })
    expect(useAuthStore.getState().meName).toBe('Taylor Chen')
    fireEvent.click(screen.getByRole('button', { name: 'Enter app' }))
    expect(useAuthStore.getState().authed).toBe(true)
    expect(window.location.hash).toBe('#/command-center')
  })
})
