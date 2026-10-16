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

/* Captured before the fake timers are installed: settling a lazy route chunk
   needs a real event-loop turn (module I/O), which fake timers never flush. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis)
vi.useFakeTimers()
const realYield = () => new Promise<void>((r) => { realSetTimeout(r, 0) })
const { ServicesProvider } = await import('../../state/services')
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
    <ServicesProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </ServicesProvider>,
  )
}

/** Signs in through the login screen's demo quick pick (immediate, no timer). */
function signInAs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
}

const SYSTEM_PAGES: [string, RegExp, RegExp][] = [
  ['forbidden', /Access denied/i, /Back to System Overview/],
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
    expect(window.location.hash).toBe('#/overview')
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
    expect(window.location.hash).toBe('#/overview')
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
    expect(window.location.hash).toBe('#/overview')
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

describe('states gallery (ticket 61b)', () => {
  /** Settles the lazy gallery chunk under fake timers (findBy's polling timer is faked). */
  async function until(probe: () => boolean, what: string) {
    for (let i = 0; i < 80 && !probe(); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(25); await realYield() })
    }
    if (!probe()) throw new Error(`condition not reached: ${what}`)
  }

  it('renders at its key with every state sample and the status legend', async () => {
    mountApp('#/states')
    signInAs('Alex Morgan')
    await until(() => screen.queryByRole('heading', { name: 'Universal state set' }) !== null, 'gallery heading')
    expect(screen.getByRole('heading', { name: 'Universal state set' })).toBeInTheDocument()
    for (const sample of ['1. Loading', '2. Empty (natural / filtered)', '3. Network error / failed to load', '4. Insufficient permission', '5. Read-only', '6. Stale data', '7. Partial data', '8. No data from integration', '9. Status legend']) {
      expect(screen.getByText(sample)).toBeInTheDocument()
    }
    expect(screen.getByText('Project', { selector: 'div' })).toBeInTheDocument()
  })

  it('simulate reload shows the skeleton and recovers without a stale timer', async () => {
    mountApp('#/states')
    signInAs('Alex Morgan')
    await until(() => screen.queryByRole('table') !== null, 'gallery table')
    expect(screen.getByRole('table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Simulate reload' }))
    expect(screen.getByLabelText('Loading data')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1200) })
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('sample actions navigate through the router seam', async () => {
    mountApp('#/states')
    signInAs('Alex Morgan')
    await until(() => screen.queryAllByRole('button', { name: 'Create operation' }).length > 0, 'gallery actions')
    fireEvent.click(screen.getAllByRole('button', { name: 'Create operation' })[0])
    expect(window.location.hash).toBe('#/operation-new')
  })
})

/* Route-inventory rows 1–55 (.scratch/web-improve-refactor/route-inventory.md):
   the manifest must resolve every inventoried key; unknown keys resolve to
   nothing so the host falls back to the not-found screen. */const INVENTORY = [
  'login', 'forbidden', 'notfound', 'error', 'offline', 'session-expired', 'states', 'overview', 'command-center', 'tasks',
  'projects', 'project-new', 'project',
  'operations', 'operation-new', 'preflight', 'operation-schedule', 'operation',
  'infrastructure', 'agents', 'agent', 'assets', 'asset-new', 'asset-scope', 'asset', 'playbooks', 'playbook', 'technique', 'playbook-review',
  'analysis', 'findings', 'finding-new', 'finding', 'evidence', 'evidence-inspector',
  'reports', 'report-new', 'report', 'report-preview', 'report-review', 'settings',
  'ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history', 'ai-fanout', 'ai-branch',
  'c2', 'c2-channel', 'c2-session', 'c2-console',
  'scenarios', 'workspaces',
]

describe('route-coverage closure', () => {
  it('every inventoried route key resolves to a screen component', () => {
    expect(INVENTORY).toHaveLength(55)
    for (const key of INVENTORY) expect(routeComponent(key), `route key: ${key}`).toBeTruthy()
  })

  it('unknown keys have no manifest entry (the host then resolves them to not-found)', () => {
    expect(hasRoute('not-a-real-page')).toBe(false)
    expect(routeComponent('not-a-real-page')).toBeNull()
  })
})
