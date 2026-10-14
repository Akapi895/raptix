/**
 * Canonical navigation (ticket 67 enabler B).
 *
 * The legacy store context (src/store.tsx) used to own navigation: the raw
 * navigate (router forward + router-less fallback), the guarded `go` wrapper,
 * the route projection (the one router subscription) and the auth navigation.
 * They live here so screens can leave the store context in later batches
 * without touching the provider. The router stays the single location writer
 * (ticket 07/61e): `navRawRoute` forwards to the active data router and its
 * fallback branch only serves router-less mounts (tests).
 *
 * The dirty/unsaved guard keeps the session authority (src/state/session.ts)
 * as its only state: the guard reads synchronous store state, so a
 * clear-then-navigate in one tick is never held.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { getActiveRouter } from './active'
import { parseHash, parseLocation, sameRoute, toHash, toHref, type Route } from './history'
import { useSessionStore } from '../state/session'

/* The projected route: a module store so the router-less fallback can write
   it from non-component code and `useRoute` observes the one state. */
interface NavState { route: Route; setRoute(r: Route): void }
const useNavStore = create<NavState>()((set) => ({
  route: parseHash(),
  setRoute: (route) => set({ route }),
}))

/* Navigation writes from a provider are scoped to their mount epoch: a
   captured closure that outlives the provider (a screen's delayed redirect)
   must not move the route of a later mount — the legacy provider's local
   route state used to no-op after unmount, and sequential provider mounts
   (test suites) rely on that isolation. Module-level callers pass no epoch
   and always write. */
let mountEpoch = 0

/** Restores the route projection to the current hash and starts a fresh mount epoch. */
export function resetNavStores(): number {
  useNavStore.setState({ route: parseHash() })
  return ++mountEpoch
}

/** Synchronous route read for non-component callers (the store's login/setPid). */
export function currentRoute(): Route {
  return useNavStore.getState().route
}

/**
 * Unguarded navigation: clears the dirty state, forwards to the active data
 * router (the single location writer) and resets the main scroll. The
 * fallback branch only serves router-less mounts (tests): it writes the
 * projected route state and the legacy hash — the state write scoped to the
 * caller's mount epoch when one is given, the hash always (the old provider
 * behaved the same way). The redirect is written once here — never inside a
 * state updater (execution ledger, ticket 02).
 */
export function navRawRoute(r: Route, epoch?: number) {
  useSessionStore.getState().clearDirty()
  const router = getActiveRouter()
  if (router) router.navigate(toHref(r))
  else {
    if (epoch === undefined || epoch === mountEpoch) useNavStore.getState().setRoute(r)
    window.location.hash = toHash(r)
  }
  document.querySelector('main')?.scrollTo?.(0, 0)
}

/** The guarded navigate: holds the redirect behind the unsaved-changes modal while a form is dirty. */
export function go(page: string, opts?: { id?: string; tab?: string }, epoch?: number) {
  useSessionStore.getState().guarded(() => navRawRoute({ page, id: opts?.id, tab: opts?.tab }, epoch))
}

/**
 * The route projection: the one router subscription (there is deliberately no
 * window hashchange listener — one listener, owned by the router), deduped
 * through the same sameRoute comparison. Router-less mounts keep serving the
 * fallback route state written by navRawRoute.
 */
export function useRoute(): Route {
  const route = useNavStore((s) => s.route)
  useEffect(() => {
    const router = getActiveRouter()
    if (!router) return
    return router.subscribe(() => {
      const next = parseLocation(router.state.location)
      if (!sameRoute(useNavStore.getState().route, next)) useNavStore.getState().setRoute(next)
    })
  }, [])
  return route
}
