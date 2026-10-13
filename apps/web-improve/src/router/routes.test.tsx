/**
 * Route smoke tests (ticket 07). Rendered checks for the router contract:
 * direct deep links (legacy `#/page/id?tab=` format), unauthenticated access
 * with a preserved return destination, not-found, browser back/forward,
 * dirty-navigation blocking, the setPid single-write redirect (execution
 * ledger G-note), crash containment, and the single-writer closure grep
 * (ticket 61e — no location writes outside the router seam).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StoreProvider, useStore, type Store } from '../store'
import { ConsoleProviders } from '../state/query'
import { setActiveRouter } from './active'
import { PageBoundary, RouteErrorBoundary, RouteHost } from './host'

function Probe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  let store!: Store
  const router = createHashRouter([
    { path: '*', element: <><Probe ready={(s) => (store = s)} /><RouteHost /></>, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  return { view, store: () => store }
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('deep links and the auth guard', () => {
  it('direct navigation to a protected deep link renders login in place and returns there after sign-in', async () => {
    window.location.hash = '#/project/RT-2026-014?tab=scope'
    const { store } = mountApp()
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=scope')
    signIn()
    expect(store().authed).toBe(true)
    const tab = await screen.findByRole('tab', { selected: true })
    expect(tab.textContent).toContain('Scope')
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
    const { store } = mountApp('#/command-center')
    signIn()
    await waitFor(() => expect(store().authed).toBe(true))
    act(() => { store().go('not-a-real-page') })
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/not-a-real-page')
  })

  it('an unknown destination falls back to the command center after sign-in', async () => {
    window.location.hash = '#/not-a-real-page'
    const { store } = mountApp()
    signIn()
    await waitFor(() => expect(store().route.page).toBe('command-center'))
    expect(window.location.hash).toBe('#/command-center')
  })
})

describe('history traversal', () => {
  it('in-app navigation pushes history entries and browser back/forward traverse them', async () => {
    const { store } = mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { store().go('playbooks') })
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    expect(store().route.page).toBe('playbooks')
    act(() => { window.history.back() })
    await waitFor(() => expect(store().route.page).toBe('projects'))
    expect(window.location.hash).toBe('#/projects')
    act(() => { window.history.forward() })
    await waitFor(() => expect(store().route.page).toBe('playbooks'))
    expect(window.location.hash).toBe('#/playbooks')
  })
})

describe('dirty-navigation blocking', () => {
  it('an in-app navigation while dirty opens the unsaved-changes modal and can be discarded', async () => {
    const { store } = mountApp('#/command-center')
    signIn()
    await waitFor(() => expect(store().authed).toBe(true))
    act(() => { store().setDirty(true) })
    act(() => { store().go('projects') })
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/command-center')
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
    expect(window.location.hash).toBe('#/command-center')
    act(() => { store().go('projects') })
    fireEvent.click(await screen.findByRole('button', { name: /Discard & Leave/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/projects'))
    expect(store().dirty).toBe(false)
  })

  it('a browser back traversal while dirty is held by the modal, then proceeds on discard', async () => {
    const { store } = mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { store().go('playbooks') })
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    act(() => { store().setDirty(true) })
    act(() => { window.history.back() })
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe('#/playbooks'))
    fireEvent.click(screen.getByRole('button', { name: /Discard & Leave/ }))
    await waitFor(() => expect(store().route.page).toBe('projects'))
    expect(window.location.hash).toBe('#/projects')
    expect(store().dirty).toBe(false)
  })
})

describe('project detail transitions (execution ledger: setPid single write)', () => {
  it('switching project on a detail route redirects once and no delayed write clobbers it', async () => {
    const { store } = mountApp('#/c2')
    signIn()
    await screen.findAllByText(/C2 & Sessions/)
    act(() => { store().go('c2-console', { id: 'SS-041' }) })
    await waitFor(() => expect(window.location.hash).toBe('#/c2-console/SS-041'))
    act(() => { store().setPid('RT-2026-014') })
    await waitFor(() => expect(window.location.hash).toBe('#/c2'))
    expect(store().pid).toBe('RT-2026-014')
    expect(store().route).toEqual({ page: 'c2' })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(window.location.hash).toBe('#/c2')
    expect(store().route).toEqual({ page: 'c2' })
  })
})

describe('single-writer closure (ticket 61e)', () => {
  it('no module outside the router seam writes the location', () => {
    /* The route inventory's raw-reads list is empty: the router (via the
       store's navRaw) is the only location writer. store.tsx is the seam's
       own router-less fallback; test files stage deep links by design. */
    const rawWriter = /(?:\bwindow\.location\.hash\s*=|\blocation\.hash\s*=|\blocation\.assign\(|\bhistory\.(?:replaceState|pushState)\()/
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name !== 'router') walk(join(dir, e.name)); continue }
        if (!/\.(tsx?|jsx?)$/.test(e.name) || e.name.includes('.test.')) continue
        const file = join(dir, e.name).replace(/\\/g, '/')
        if (file.endsWith('/src/store.tsx')) continue
        if (rawWriter.test(readFileSync(join(dir, e.name), 'utf8'))) offenders.push(file)
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(offenders).toEqual([])
  })
})

describe('crash containment', () => {
  it('a page crash is contained by the per-page boundary with a retry', () => {
    function Bomb(): null { throw new Error('page boom') }
    render(
      <StoreProvider>
        <PageBoundary><Bomb /></PageBoundary>
      </StoreProvider>,
    )
    expect(screen.getByText('This screen failed to render')).toBeInTheDocument()
    expect(screen.getByText('page boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back to Command Center' })).toBeEnabled()
  })

  it('a crash inside the route tree resolves to the router error boundary', () => {
    function Bomb(): null { throw new Error('router boom') }
    const router = createHashRouter([{ path: '*', element: <Bomb />, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null }])
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('router boom')).toBeInTheDocument()
  })
})
