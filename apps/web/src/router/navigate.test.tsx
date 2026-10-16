/**
 * Canonical guarded navigation, router subscriptions and mount-epoch isolation.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../test/helpers'
import { resetSessionStores, useSessionStore } from '../state/session'
import { resetSharedStores, useProjectStore, useUiStore } from '../state/stores'
import { setActiveRouter } from './active'
import { RouteHost, RouteErrorBoundary } from './host'
import { currentRoute, go, goGlobal, navigationEpoch, navRawRoute, resetNavStores, selectProject, useRoute } from './navigate'
import { parseHash, type Route } from './history'

let latest: Route
function RouteProbe() {
  latest = useRoute()
  return null
}

beforeEach(() => {
  window.location.hash = ''
  resetSharedStores()
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
  it('a dirty navigation is held behind the unsaved guard and proceeds through its next()', async () => {
    let saved = 0
    const save = () => { saved += 1 }
    act(() => { useSessionStore.getState().setDirty(true, save) })
    act(() => { go('projects') })
    expect(currentRoute().page).toBe('login')
    expect(window.location.hash).toBe('')
    const unsaved = useSessionStore.getState().unsaved
    expect(unsaved).not.toBeNull()
    expect(typeof unsaved?.save).toBe('function')
    await act(async () => { await unsaved!.save!() })
    expect(saved).toBe(1)
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

  it('W22: parses malformed percent-encoding safely instead of throwing (W22 history safety)', () => {
    window.location.hash = '#/asset/%zz-broken?engagement=eng-1'
    expect(parseHash()).toEqual({ page: 'asset', id: '%zz-broken', engagementId: 'eng-1' })
    window.location.hash = '#/report/Report%20One?engagement=eng-1'
    expect(parseHash()).toEqual({ page: 'report', id: 'Report One', engagementId: 'eng-1' })
    resetNavStores()
    expect(currentRoute()).toEqual({ page: 'report', id: 'Report One', engagementId: 'eng-1' })
  })
})

describe('non-component callers', () => {
  it('go navigates from non-component code with no provider or component mounted', () => {
    go('projects')
    expect(currentRoute().page).toBe('projects')
    expect(window.location.hash).toBe('#/projects')
  })
})

describe('selectProject (guarded project switch)', () => {
  it('guards a dirty switch behind the unsaved modal, then proceeds with the loading gate and the switcher closed', () => {
    useProjectStore.getState().setPid('RT-2026-014')
    act(() => { useSessionStore.getState().setDirty(true, () => {}) })
    act(() => { selectProject('RT-2026-017') })
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    expect(useSessionStore.getState().unsaved).not.toBeNull()
    act(() => { useSessionStore.getState().unsaved!.next() })
    expect(useProjectStore.getState().pid).toBe('RT-2026-017')
    expect(useSessionStore.getState().loading).toBe(true)
    expect(useUiStore.getState().switcherOpen).toBe(false)
  })

  it('redirects a detail route to the selected id and falls back to the section page for "all"', () => {
    window.location.hash = '#/finding/FD-014-01'
    resetNavStores()
    act(() => { selectProject('RT-2026-017') })
    expect(useProjectStore.getState().pid).toBe('RT-2026-017')
    expect(currentRoute()).toEqual({ page: 'findings' })
    window.location.hash = '#/project/RT-2026-014'
    resetNavStores()
    act(() => { selectProject('RT-2026-021') })
    expect(currentRoute()).toEqual({ page: 'project', id: 'RT-2026-021' })
    act(() => { selectProject('all') })
    expect(currentRoute()).toEqual({ page: 'projects' })
    expect(useProjectStore.getState().pid).toBe('all')
  })

  it('re-selecting the active project only closes the switcher', () => {
    useProjectStore.getState().setPid('RT-2026-014')
    useUiStore.getState().setSwitcherOpen(true)
    act(() => { selectProject('RT-2026-014') })
    expect(useUiStore.getState().switcherOpen).toBe(false)
    expect(useSessionStore.getState().unsaved).toBeNull()
  })
})

describe('goGlobal (global-scope sidebar navigation)', () => {
  it('commits an open project back to All Projects before navigating to a global page (plan §4.2)', () => {
    useProjectStore.getState().setPid('RT-2026-014')
    useUiStore.getState().setSwitcherOpen(true)
    act(() => { goGlobal('findings') })
    expect(useProjectStore.getState().pid).toBe('all')
    expect(useUiStore.getState().switcherOpen).toBe(false)
    expect(currentRoute()).toEqual({ page: 'findings' })
    expect(window.location.hash).toBe('#/findings')
  })

  it('holds a dirty global navigation behind the unsaved modal like selectProject', () => {
    useProjectStore.getState().setPid('RT-2026-014')
    act(() => { useSessionStore.getState().setDirty(true, () => {}) })
    act(() => { goGlobal('findings') })
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    expect(useSessionStore.getState().unsaved).not.toBeNull()
    act(() => { useSessionStore.getState().unsaved!.next() })
    expect(useProjectStore.getState().pid).toBe('all')
    expect(currentRoute()).toEqual({ page: 'findings' })
  })

  it('is a plain guarded go when the scope is already global', () => {
    act(() => { goGlobal('playbooks', { id: 'PB-1' }) })
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(currentRoute()).toEqual({ page: 'playbooks', id: 'PB-1' })
    expect(window.location.hash).toBe('#/playbooks/PB-1')
  })
})

describe('mounted navigation integration', () => {
  it('rendered route subscriptions observe guarded and raw router navigation', () => {
    window.location.hash = '#/projects'
    const router = createHashRouter([
      { path: '*', element: <><RouteProbe /><RouteHost /></>, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
    ])
    setActiveRouter(router)
    mountServices(<RouterProvider router={router} />)
    expect(latest).toEqual({ page: 'projects' })
    act(() => { go('playbooks') })
    expect(latest.page).toBe('playbooks')
    expect(window.location.hash).toBe('#/playbooks')
    act(() => { navRawRoute({ page: 'settings' }) })
    expect(currentRoute().page).toBe('settings')
    expect(latest.page).toBe('settings')
    expect(window.location.hash).toBe('#/settings')
  })

  it("a captured go from an unmounted provider does not move a later mount's route", () => {
    const mount = (hash: string) => {
      window.location.hash = hash
      const view = mountServices(<RouteProbe />)
      const epoch = navigationEpoch()
      return { go: (page: string, opts?: { id?: string }) => go(page, opts, epoch), unmount: view.unmount }
    }
    const stale = mount('#/evidence/EV-014-02')
    stale.unmount()
    const fresh = mount('#/evidence-inspector/EV-014-01')
    act(() => { stale.go('evidence', { id: 'EV-014-02' }) })
    expect(latest).toEqual({ page: 'evidence-inspector', id: 'EV-014-01' })
    expect(window.location.hash).toBe('#/evidence/EV-014-02')
    act(() => { fresh.go('projects') })
    expect(latest.page).toBe('projects')
    fresh.unmount()
  })
})
