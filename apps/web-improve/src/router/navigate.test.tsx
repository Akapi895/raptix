/**
 * Ticket 67 enabler B: the canonical navigation module (src/router/navigate.ts)
 * hosts what the legacy store context used to own — the guarded `go`, the raw
 * router forward (with the router-less fallback for test mounts) and the route
 * projection. The dirty guard keeps the session authority as its only state,
 * the router stays the single location writer, and the store context forwards
 * to the module with an unchanged Store surface.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { StoreProvider, useStore, type Store } from '../store'
import { ConsoleProviders } from '../state/query'
import { resetSessionStores, useSessionStore } from '../state/session'
import { setActiveRouter } from './active'
import { RouteHost, RouteErrorBoundary } from './host'
import { currentRoute, go, navRawRoute, resetNavStores, useRoute } from './navigate'
import type { Route } from './history'

let latest: Route
function RouteProbe() {
  latest = useRoute()
  return null
}

function StoreProbe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}

beforeEach(() => {
  window.location.hash = ''
  resetSessionStores()
  resetNavStores()
  setActiveRouter(null)
})

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('guarded go (session dirty guard)', () => {
  it('a dirty navigation is held behind the unsaved guard and proceeds through its next()', () => {
    const save = () => {}
    act(() => { useSessionStore.getState().setDirty(true, save) })
    act(() => { go('projects') })
    expect(currentRoute().page).toBe('login')
    expect(window.location.hash).toBe('')
    const unsaved = useSessionStore.getState().unsaved
    expect(unsaved).not.toBeNull()
    expect(unsaved?.save).toBe(save)
    act(() => { unsaved!.next() })
    expect(currentRoute().page).toBe('projects')
    expect(useSessionStore.getState().dirty).toBe(false)
  })

  it('a clear-then-navigate in one tick is not held by the guard', () => {
    act(() => {
      useSessionStore.getState().setDirty(true, () => {})
      useSessionStore.getState().setDirty(false)
      go('projects')
    })
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(currentRoute().page).toBe('projects')
    expect(window.location.hash).toBe('#/projects')
  })
})

describe('route projection (useRoute)', () => {
  it('reflects router navigation through the module subscription', () => {
    window.location.hash = '#/projects'
    resetNavStores()
    const router = createHashRouter([{ path: '*', element: <RouteProbe /> }])
    setActiveRouter(router)
    render(<RouterProvider router={router} />)
    expect(latest).toEqual({ page: 'projects' })
    act(() => { go('playbooks', { id: 'PB-1', tab: 'steps' }) })
    expect(window.location.hash).toBe('#/playbooks/PB-1?tab=steps')
    expect(latest).toEqual({ page: 'playbooks', id: 'PB-1', tab: 'steps' })
    expect(currentRoute()).toEqual({ page: 'playbooks', id: 'PB-1', tab: 'steps' })
  })

  it('the router-less fallback writes the projected route and the legacy hash', () => {
    render(<RouteProbe />)
    expect(latest).toEqual({ page: 'login' })
    act(() => { navRawRoute({ page: 'settings', tab: 'policies' }) })
    expect(window.location.hash).toBe('#/settings?tab=policies')
    expect(latest).toEqual({ page: 'settings', tab: 'policies' })
  })
})

describe('non-component callers', () => {
  it('go navigates from non-component code with no provider or component mounted', () => {
    go('projects')
    expect(currentRoute().page).toBe('projects')
    expect(window.location.hash).toBe('#/projects')
  })
})

describe('store forwarding (Store surface unchanged)', () => {
  it("the store's route/go forward to the module in both directions", () => {
    window.location.hash = '#/projects'
    let store!: Store
    const router = createHashRouter([
      { path: '*', element: <><StoreProbe ready={(s) => (store = s)} /><RouteHost /></>, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
    ])
    setActiveRouter(router)
    render(
      <StoreProvider>
        <ConsoleProviders>
          <RouterProvider router={router} />
        </ConsoleProviders>
      </StoreProvider>,
    )
    expect(store.route).toEqual({ page: 'projects' })
    act(() => { go('playbooks') })
    expect(store.route.page).toBe('playbooks')
    expect(window.location.hash).toBe('#/playbooks')
    act(() => { store.go('settings') })
    expect(currentRoute().page).toBe('settings')
    expect(window.location.hash).toBe('#/settings')
  })

  it("a captured go from an unmounted provider does not move a later mount's route", () => {
    const mount = (hash: string) => {
      window.location.hash = hash
      let store!: Store
      const view = render(
        <StoreProvider>
          <StoreProbe ready={(s) => { store = s }} />
        </StoreProvider>,
      )
      return { store: () => store, unmount: view.unmount }
    }
    const stale = mount('#/evidence/EV-014-02')
    stale.unmount()
    const fresh = mount('#/evidence-inspector/EV-014-01')
    act(() => { stale.store().go('evidence', { id: 'EV-014-02' }) })
    expect(fresh.store().route).toEqual({ page: 'evidence-inspector', id: 'EV-014-01' })
    expect(window.location.hash).toBe('#/evidence/EV-014-02')
    act(() => { fresh.store().go('projects') })
    expect(fresh.store().route.page).toBe('projects')
    fresh.unmount()
  })
})
