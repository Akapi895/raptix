/**
 * Ticket 61a: rendered contract of the semantic system pages. Each error
 * route renders at its existing key (deep link → auth guard → sign-in) with
 * its failure reason and a working recovery path — persona switch and access
 * request (forbidden), path + navigation (not-found), two-phase retry with
 * timer disposal (500/offline), sign-in return (session-expired) — and the
 * route manifest covers every inventoried key (route-coverage closure).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'

vi.useFakeTimers()
const { StoreProvider } = await import('../../store')
const { ConsoleProviders } = await import('../../state/query')
const { useAuthStore } = await import('../../state/stores')
const { setActiveRouter } = await import('../../router/active')
const { RouteHost, RouteErrorBoundary } = await import('../../router/host')
const { hasRoute, routeComponent } = await import('../../router/registry')

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
  if (vi.isFakeTimers()) vi.clearAllTimers()
})

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
}

/** Signs in through the login screen's demo quick pick (immediate, no timer). */
function signInAs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
}

const SYSTEM_PAGES: [string, RegExp, RegExp][] = [
  ['forbidden', /Access denied/i, /Back to Command Center/],
  ['notfound', /Page not found/i, /View projects/],
  ['error', /Something went wrong/i, /Retry/],
  ['offline', /Workspace temporarily unavailable/i, /Check connection again/],
  ['session-expired', /Your session has expired/i, /Sign in again/],
]

describe('system pages render at their route keys with recovery actions', () => {
  for (const [key, title, recovery] of SYSTEM_PAGES) {
    it(`${key} renders its failure frame and recovery actions`, () => {
      mountApp(`#/${key}`)
      signInAs('Alex Morgan')
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: recovery })).toBeEnabled()
      expect(screen.getByText(/Need help\? Contact your organization admin/)).toBeInTheDocument()
    })
  }
})

describe('recovery behavior', () => {
  it('forbidden switches to an eligible persona and navigates home', () => {
    mountApp('#/forbidden')
    signInAs('Taylor Chen')
    const current = screen.getByText('Current role').parentElement!
    expect(current).toHaveTextContent('Operator')
    expect(current).toHaveTextContent('Taylor Chen')
    fireEvent.click(screen.getByRole('button', { name: /Switch to Alex Morgan/ }))
    expect(useAuthStore.getState().meName).toBe('Alex Morgan')
    expect(window.location.hash).toBe('#/command-center')
  })

  it('forbidden records the simulated access request as a toast', () => {
    mountApp('#/forbidden')
    signInAs('Alex Morgan')
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    expect(screen.getByText('Access request sent to the organization admin (simulated).')).toBeInTheDocument()
  })

  it('not-found shows the requested path and recovers to the projects list', () => {
    mountApp('#/notfound/no-such-thing')
    signInAs('Alex Morgan')
    expect(screen.getByText('#/notfound/no-such-thing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View projects' }))
    expect(window.location.hash).toBe('#/projects')
  })

  it('server error retries: first attempt reports the failure, the second recovers and leaves', () => {
    mountApp('#/error')
    signInAs('Alex Morgan')
    expect(screen.getByText('INC-20261013-0427')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.getByText('The server is still not responding. Try again in a few seconds.')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/error')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.getByText('Reloaded successfully.')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/command-center')
  })

  it('offline reconnects on the second check and returns with the saved data', () => {
    mountApp('#/offline')
    signInAs('Alex Morgan')
    fireEvent.click(screen.getByRole('button', { name: 'Check connection again' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Still no connection to the workspace.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check connection again' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Reconnected. Data is in sync.')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/command-center')
  })

  it('session-expired signs the persona out and returns to the login screen', () => {
    mountApp('#/session-expired')
    signInAs('Alex Morgan')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(useAuthStore.getState().authed).toBe(false)
    expect(window.location.hash).toBe('#/login')
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })
})

/* Route-inventory rows 1–53 (.scratch/web-improve-refactor/route-inventory.md):
   the manifest must resolve every inventoried key; unknown keys resolve to
   nothing so the host falls back to the not-found screen. */
const INVENTORY = [
  'login', 'forbidden', 'notfound', 'error', 'offline', 'session-expired', 'states', 'command-center', 'tasks',
  'projects', 'project-new', 'project',
  'operations', 'operation-new', 'preflight', 'operation-schedule', 'operation',
  'agents', 'agent', 'assets', 'asset-new', 'asset-scope', 'asset', 'playbooks', 'playbook', 'technique', 'playbook-review',
  'analysis', 'findings', 'finding-new', 'finding', 'evidence', 'evidence-inspector',
  'reports', 'report-new', 'report', 'report-preview', 'report-review', 'settings',
  'ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history', 'ai-fanout', 'ai-branch',
  'c2', 'c2-channel', 'c2-session', 'c2-console',
  'scenarios', 'workspaces',
]

describe('route-coverage closure', () => {
  it('every inventoried route key resolves to a screen component', () => {
    expect(INVENTORY).toHaveLength(53)
    for (const key of INVENTORY) expect(routeComponent(key), `route key: ${key}`).toBeTruthy()
  })

  it('unknown keys have no manifest entry (the host then resolves them to not-found)', () => {
    expect(hasRoute('not-a-real-page')).toBe(false)
    expect(routeComponent('not-a-real-page')).toBeNull()
  })
})
