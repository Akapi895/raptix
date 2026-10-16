/**
 * Route smoke tests (ticket 07). Rendered checks for the router contract:
 * direct deep links (legacy `#/page/id?tab=` format), unauthenticated access
 * with a preserved return destination, not-found, browser back/forward,
 * dirty-navigation blocking, the setPid single-write redirect (execution
 * ledger G-note), crash containment, and the single-writer closure grep
 * (ticket 61e — no location writes outside the router seam).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetSharedStores, useAuthStore, useProjectStore } from '../state/stores'
import { resetSessionStores, useSessionStore } from '../state/session'
import { currentRoute, go, resetNavStores, selectProject } from './navigate'
import { mountServices } from '../test/helpers'
import { setActiveRouter } from './active'
import { PageBoundary, RouteErrorBoundary, RouteHost } from './host'

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  resetNavStores()
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  return mountServices(<RouterProvider router={router} />)
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

// Resolve the actual lazy bundles before timed DOM assertions (WSL /mnt/d I/O).
beforeAll(async () => { await Promise.all([import('../screens/b'), import('../screens/d'), import('../screens/f'), import('../screens/infrastructure')]) }, 30_000)

beforeEach(() => {
  window.location.hash = ''
  resetSharedStores()
  resetSessionStores()
  setActiveRouter(null)
})

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('deep links and the auth guard', () => {
  it('direct navigation to a protected deep link renders login in place and returns there after sign-in', async () => {
    window.location.hash = '#/project/RT-2026-014?tab=scope'
    mountApp()
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=scope')
    signIn()
    expect(useAuthStore.getState().authed).toBe(true)
    const section = await screen.findByRole('button', { name: 'Scope & ROE', current: 'page' })
    expect(section).toBeInTheDocument()
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=scope')
  })

  it('an old-format hash link with an entity id resolves its page', async () => {
    window.location.hash = '#/agent/AG-009'
    mountApp()
    signIn()
    expect((await screen.findAllByText('AG-009')).length).toBeGreaterThan(0)
  })

  it('an old-format tab deep link (?tab=) selects the tab', async () => {
    window.location.hash = '#/settings?tab=policies'
    mountApp()
    signIn()
    expect(await screen.findByRole('tab', { selected: true })).toHaveTextContent('Policies')
  })

  it('an unknown route key resolves to the not-found screen inside the shell', async () => {
    mountApp('#/command-center')
    signIn()
    await waitFor(() => expect(useAuthStore.getState().authed).toBe(true))
    act(() => { go('not-a-real-page') })
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/not-a-real-page')
  })

  it('an unknown destination falls back to the system overview after sign-in', async () => {
    window.location.hash = '#/not-a-real-page'
    mountApp()
    signIn()
    await waitFor(() => expect(currentRoute().page).toBe('overview'))
    expect(window.location.hash).toBe('#/overview')
  })
})

describe('history traversal', () => {
  it('in-app navigation pushes history entries and browser back/forward traverse them', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { go('playbooks') })
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    expect(currentRoute().page).toBe('playbooks')
    act(() => { window.history.back() })
    await waitFor(() => expect(currentRoute().page).toBe('projects'))
    expect(window.location.hash).toBe('#/projects')
    act(() => { window.history.forward() })
    await waitFor(() => expect(currentRoute().page).toBe('playbooks'))
    expect(window.location.hash).toBe('#/playbooks')
  })
})

describe('dirty-navigation blocking', () => {
  it('an in-app navigation while dirty opens the unsaved-changes modal and can be discarded', async () => {
    mountApp('#/command-center')
    signIn()
    await waitFor(() => expect(useAuthStore.getState().authed).toBe(true))
    act(() => { useSessionStore.getState().setDirty(true) })
    act(() => { go('projects') })
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/command-center')
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
    expect(window.location.hash).toBe('#/command-center')
    act(() => { go('projects') })
    fireEvent.click(await screen.findByRole('button', { name: /Discard & Leave/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/projects'))
    expect(useSessionStore.getState().dirty).toBe(false)
  })

  it('a browser back traversal while dirty is held by the modal, then proceeds on discard', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { go('playbooks') })
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    act(() => { useSessionStore.getState().setDirty(true) })
    act(() => { window.history.back() })
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    fireEvent.click(screen.getByRole('button', { name: /Discard & Leave/ }))
    await waitFor(() => expect(currentRoute().page).toBe('projects'))
    expect(window.location.hash).toBe('#/projects')
    expect(useSessionStore.getState().dirty).toBe(false)
  })
})

describe('project detail transitions (execution ledger: setPid single write)', () => {
  it('switching project on a detail route redirects once and no delayed write clobbers it', async () => {
    mountApp('#/c2')
    signIn()
    await screen.findByRole('heading', { name: 'Infrastructure' })
    act(() => { go('c2-console', { id: 'SS-041' }) })
    await waitFor(() => expect(window.location.hash).toBe('#/c2-console/SS-041'))
    act(() => { selectProject('RT-2026-014') })
    await waitFor(() => expect(window.location.hash).toBe('#/c2'))
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    expect(currentRoute()).toEqual({ page: 'c2' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(window.location.hash).toBe('#/c2')
    expect(currentRoute()).toEqual({ page: 'c2' })
  })
})

describe('single-writer closure (ticket 61e)', () => {
  it('no module outside the router seam writes the location', () => {
    /* The route inventory's raw-reads list is empty: the router (via
       navigate.ts) is the only location writer. Test files stage deep links
       by design and are excluded. src/real/mode.ts assigns the location for
       a full application reload when switching data modes (integration
       ticket 03, ADR-0068) — an app reload, not an in-app route write. */
    const rawWriter = /(?:\bwindow\.location\.hash\s*=|\blocation\.hash\s*=|\blocation\.assign\(|\bhistory\.(?:replaceState|pushState)\()/
    const reloadOnModeSwitch = /src[\\/]real[\\/]mode\.ts$/
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name !== 'router') walk(join(dir, e.name)); continue }
        if (!/\.(tsx?|jsx?)$/.test(e.name) || e.name.includes('.test.')) continue
        const file = join(dir, e.name).replace(/\\/g, '/')
        if (rawWriter.test(readFileSync(join(dir, e.name), 'utf8')) && !reloadOnModeSwitch.test(file)) offenders.push(file)
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(offenders).toEqual([])
  })
})

describe('crash containment', () => {
  it('a page crash is contained by the per-page boundary with a retry', () => {
    function Bomb(): null { throw new Error('page boom') }
    render(<PageBoundary><Bomb /></PageBoundary>)
    expect(screen.getByText('This screen failed to render')).toBeInTheDocument()
    expect(screen.getByText('page boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back to System Overview' })).toBeEnabled()
  })

  it('a crash inside the route tree resolves to the router error boundary', () => {
    function Bomb(): null { throw new Error('router boom') }
    const router = createHashRouter([{ path: '*', element: <Bomb />, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null }])
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('router boom')).toBeInTheDocument()
  })
})
