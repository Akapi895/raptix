/**
 * Global Infrastructure route (plan 2026-10-16 S2). Covers the tab contract
 * (URL-driven tab, unknown tab → agents, back/forward + reload restore) and
 * the legacy `#/agents` / `#/c2` adapters at global scope. Project-scope
 * rendering of the legacy routes and the composed feature content keep their
 * own screen tests — this file only pins the routing/composition contract.
 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { resetSharedStores } from '../../state/stores'
import { resetSessionStores } from '../../state/session'
import { go, resetNavStores } from '../../router/navigate'
import { mountServices } from '../../test/helpers'
import { setActiveRouter } from '../../router/active'
import { RouteHost } from '../../router/host'

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  resetNavStores()
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  return mountServices(<RouterProvider router={router} />)
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

beforeEach(() => {
  window.location.hash = ''
  resetSharedStores()
  resetSessionStores()
  resetNavStores()
})

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('global infrastructure route', () => {
  it('opens the Execution agents tab by default and follows URL tab changes', async () => {
    mountApp('#/infrastructure')
    signIn()
    expect(await screen.findByRole('heading', { name: 'Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Execution agents' })).toHaveAttribute('aria-selected', 'true')
    act(() => { go('infrastructure', { tab: 'sessions' }) })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('an unknown tab falls back to the agents tab (plan §3)', async () => {
    mountApp('#/infrastructure?tab=unknown')
    signIn()
    expect(await screen.findByRole('heading', { name: 'Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Execution agents' })).toHaveAttribute('aria-selected', 'true')
  })

  it('legacy #/agents?tab=health lands on Infrastructure/Execution agents at global scope', async () => {
    mountApp('#/agents?tab=health')
    signIn()
    expect(await screen.findByRole('heading', { name: 'Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Execution agents' })).toHaveAttribute('aria-selected', 'true')
  })

  it('legacy #/c2?tab=sessions opens the Sessions monitoring tab without interactive-access CTAs', async () => {
    mountApp('#/c2?tab=sessions')
    signIn()
    expect(await screen.findByRole('heading', { name: 'Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open console' })).not.toBeInTheDocument())
  })

  it('tab switches are written to the URL so reload/back-forward restore them', async () => {
    mountApp('#/infrastructure')
    signIn()
    await screen.findByRole('heading', { name: 'Infrastructure' })
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    await waitFor(() => expect(window.location.hash).toBe('#/infrastructure?tab=sessions'))
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
  })
})
