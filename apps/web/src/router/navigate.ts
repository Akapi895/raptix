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
import { useProjectStore, useUiStore } from '../state/stores'

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

/** Captures the current provider epoch for transitional navigation closures. */
export function navigationEpoch(): number {
  return mountEpoch
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
/**
 * Resource pages that belong to one engagement. Their route carries the
 * engagement while a project is selected, so a reload restores the project
 * scope from the URL instead of falling back to All Projects.
 */
const ENGAGEMENT_RESOURCE_PAGES = new Set(['finding', 'finding-new', 'evidence', 'evidence-inspector', 'report', 'report-new', 'report-preview', 'report-review', 'asset', 'asset-new', 'asset-scope'])

export function go(page: string, opts?: { id?: string; tab?: string; engagementId?: string }, epoch?: number) {
  const pid = useProjectStore.getState().pid
  const engagementId = opts?.engagementId ?? (pid !== 'all' && ENGAGEMENT_RESOURCE_PAGES.has(page) ? pid : undefined)
  useSessionStore.getState().guarded(() => navRawRoute({ page, id: opts?.id, tab: opts?.tab, ...(engagementId ? { engagementId } : {}) }, epoch))
}

/* Project-switch redirect: a detail route of another entity kind falls back
   to its section page; the project route re-targets its id ("all" leaves the
   project route for the portfolio). */
const DETAIL_MAP: Record<string, string> = {
  operation: 'operations', preflight: 'operations', 'operation-schedule': 'operations', finding: 'findings', report: 'reports', 'report-preview': 'reports', 'report-review': 'reports',
  agent: 'agents', asset: 'assets', 'asset-scope': 'assets', playbook: 'playbooks', 'playbook-review': 'playbooks', technique: 'playbooks',
  'ai-plan': 'ai-operator', 'ai-plan-review': 'ai-operator', 'ai-plan-compare': 'ai-operator', 'ai-trace': 'ai-operator', 'ai-history': 'ai-operator',
  'c2-session': 'c2', 'c2-console': 'c2', 'c2-channel': 'c2',
}

/**
 * The guarded project selection (the switcher's and the detail screens'
 * `setPid`): guards the switch behind the unsaved-changes modal, syncs the
 * active project, closes the switcher and flashes the shell loading gate
 * (450 ms) while the detail views refetch. The redirect is computed from the
 * committed route and written once through navRawRoute — never inside a state
 * updater (execution ledger, ticket 02).
 */
export function selectProject(id: string, epoch?: number) {
  const project = useProjectStore.getState()
  if (id === project.pid) { useUiStore.getState().setSwitcherOpen(false); return }
  useSessionStore.getState().guarded(() => {
    useSessionStore.getState().clearDirty()
    project.setPid(id)
    useUiStore.getState().setSwitcherOpen(false)
    useSessionStore.getState().setLoading(true)
    setTimeout(() => useSessionStore.getState().setLoading(false), 450)
    const r = currentRoute()
    if (r.page === 'project' && id === 'all') navRawRoute({ page: 'projects' }, epoch)
    else if (r.page === 'project') navRawRoute({ ...r, id }, epoch)
    else if (DETAIL_MAP[r.page]) navRawRoute({ page: DETAIL_MAP[r.page] }, epoch)
    else if (id !== 'all') navRawRoute({ page: 'project', id }, epoch)
  })
}

/**
 * Navigation to a global-scope page (the sidebar's global items): when a
 * project is open, the scope is committed back to All Projects first — a
 * global page must never render through a stale project filter. Resource
 * deep links and in-project links keep using `go`, which never changes scope
 * implicitly. Same guarded flow as selectProject (unsaved-changes modal,
 * loading gate, single navRawRoute write).
 */
export function goGlobal(page: string, opts?: { id?: string; tab?: string; engagementId?: string }, epoch?: number) {
  if (useProjectStore.getState().pid === 'all') { go(page, opts, epoch); return }
  useSessionStore.getState().guarded(() => {
    useSessionStore.getState().clearDirty()
    useProjectStore.getState().setPid('all')
    useUiStore.getState().setSwitcherOpen(false)
    useSessionStore.getState().setLoading(true)
    setTimeout(() => useSessionStore.getState().setLoading(false), 450)
    navRawRoute({ page, id: opts?.id, tab: opts?.tab, ...(opts?.engagementId ? { engagementId: opts.engagementId } : {}) }, epoch)
  })
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
    const sync = (): void => {
      const next = parseLocation(router.state.location)
      const projectId = next.page === 'project' ? next.id : next.engagementId ?? (['overview', 'projects', 'infrastructure'].includes(next.page) ? 'all' : undefined)
      if (projectId && useProjectStore.getState().pid !== projectId) useProjectStore.getState().setPid(projectId)
      if (!sameRoute(useNavStore.getState().route, next)) useNavStore.getState().setRoute(next)
    }
    // Real bootstrap can finish after a hash traversal; catch changes made
    // before this subscriber mounted instead of retaining a stale projection.
    sync()
    return router.subscribe(sync)
  }, [])
  return route
}
