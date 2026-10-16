/**
 * Route host (ticket 07): resolves the store route to a page inside the React
 * Router data router. Owns the auth guard (login rendered in place so the
 * requested protected URL survives sign-in as the safe return destination),
 * not-found resolution, the per-page error boundary, the loading fallback for
 * lazy slices, and the dirty-navigation blocker for popstate/URL-edit
 * traversals (in-app navigation is pre-guarded by the store's `go`).
 *
 * Ticket 59 (append): the header `notifications` slot is filled with the
 * migrated notice center through the ticket-08 typed `ShellSlots` contract.
 * Ticket 60 (append): the `copilotDrawer` slot is filled with the migrated
 * copilot drawer the same way; the `askAi` trigger keeps the legacy default.
 */
import { Component, lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { useBlocker, useRouteError } from 'react-router'
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react'
import { useSessionStore } from '../state/session'
import { useAuthStore, useProjectStore } from '../state/stores'
import { go, useRoute } from './navigate'
import { DATA_MODE } from '../real/mode'
import { REAL_INTEGRATED_ROUTES, RealNotIntegrated } from '../real/not-integrated'
import { FEATURE_ROUTE_SURFACES, MIGRATED_ROUTES } from './route-table'
import { RealPortfolio } from '../real/screens/portfolio'
import { RealProjectCreate } from '../real/screens/create'
import { RealProjectDetail } from '../real/screens/detail'
import { RealWorkspace } from '../real/screens/workspace'
import { RealAssets } from '../real/screens/assets-panel'
import { RealLibrary } from '../real/screens/library'
import { RealOverview } from '../real/screens/overview'
import { RealGlobalResource } from '../real/screens/global-resource'
import { RealCommandCenter } from '../real/screens/command-center'
import { RealSettings } from '../real/screens/settings'
import { RealHeaderNotices } from '../real/screens/notices-bell'
import { RealLogin } from '../real/screens/login'
import { Button } from '../ui'
import { Shell } from '../shell'
import { HeaderNotices } from '../features/notices/header-notices'
import { LazyCopilotDrawer } from '../features/copilot/lazy'
import { OUTSIDE_SHELL, type Route } from './history'
import { routeComponent } from './registry'

const pageKey = (r: Route) => r.page + (r.id ? '/' + r.id : '')
const RealFeatureRoute = lazy(() => import('../real/screens/feature-route').then((m) => ({ default: m.RealFeatureRoute })))

/**
 * Route keys with a real implementation mounted directly (integration tickets
 * 03-06). Keys routed through `RealFeatureRoute` come from `route-table.ts`
 * (the one list that file and `feature-route.tsx`'s panel composition both
 * read) instead of a second hand-written array — see route-table.ts for why.
 */
const REAL_PAGES: Record<string, ComponentType | undefined> = {
  overview: RealOverview,
  projects: RealPortfolio,
  'project-new': RealProjectCreate,
  project: RealProjectDetail,
  'ai-operator': RealWorkspace,
  assets: RealAssets,
  playbooks: RealLibrary,
  'command-center': RealOverview,
  tasks: RealCommandCenter,
  ...Object.fromEntries(Object.keys(FEATURE_ROUTE_SURFACES).map((key) => [key, RealFeatureRoute])),
  'ai-history': RealWorkspace,
  'ai-trace': RealWorkspace,
  playbook: RealLibrary,
  technique: RealLibrary,
  settings: RealSettings,
  login: RealLogin,
}

/** Holds popstate/URL-edit traversals while a form is dirty and routes the held navigation through the same unsaved-changes modal as in-app navigation. */
function DirtyNavBlocker() {
  const dirty = useSessionStore((s) => s.dirty)
  const guarded = useSessionStore((s) => s.guarded)
  const setDirty = useSessionStore((s) => s.setDirty)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search)
  const blocked = blocker.state === 'blocked' ? blocker : null
  useEffect(() => {
    if (!blocked) return
    guarded(() => { setDirty(false); blocked.proceed() })
  }, [blocked, guarded, setDirty])
  return null
}

function BoundaryFallback({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-xl pt-16 text-center" role="alert">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel text-bad"><ServerCrash size={26} aria-hidden /></div>
      <h1 className="text-xl font-semibold tracking-tight">This screen failed to render</h1>
      <p className="mt-2 text-sm text-muted">The error was contained to this page; the rest of the console keeps working.</p>
      <p className="mt-3 break-all font-mono text-xs text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Try again</Button>
        <Button onClick={() => go('overview')}>Back to System Overview</Button>
      </div>
    </div>
  )
}

/** Contains a page render crash so the shell and the rest of the console survive. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { error } }
  render() {
    if (this.state.error !== null) return <BoundaryFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading screen">
      <Loader2 size={22} className="animate-spin text-muted" aria-hidden />
    </div>
  )
}

/** Resolves the current store route to a page element (legacy App Router order preserved). */
function ResolvedRoute({ route, authed }: { route: Route; authed: boolean }) {
  const key = pageKey(route)
  const pid = useProjectStore((s) => s.pid)
  if (DATA_MODE === 'real') {
    // Real mode (integration ticket 03, ADR-0068): there is no sign-in and no
    // demo identity — every route either has a real implementation, renders
    // itself (system pages that read no console data), or renders the honest
    // unavailable panel (D4). Mock screens are never reached.
    const globalResource = !route.id && !route.engagementId && (route.page === 'infrastructure' || pid === 'all' && ['findings', 'reports', 'operations', 'analysis', 'agents', 'c2'].includes(route.page))
    if (!globalResource && MIGRATED_ROUTES.has(route.page)) {
      const Migrated = routeComponent(route.page)
      return (
        <Shell slots={{ notifications: RealHeaderNotices }}>
          <PageBoundary key={key}>
            <Suspense fallback={<PageFallback />}>{Migrated ? <Migrated /> : null}</Suspense>
          </PageBoundary>
        </Shell>
      )
    }
    const Real = globalResource ? RealGlobalResource : REAL_PAGES[route.page]
    if (Real) {
      return (
        <Shell slots={{ notifications: RealHeaderNotices }}>
          <PageBoundary key={key}>
            <Suspense fallback={<PageFallback />}><Real /></Suspense>
          </PageBoundary>
        </Shell>
      )
    }
    if (REAL_INTEGRATED_ROUTES.has(route.page)) {
      const Page = routeComponent(route.page)
      return (
        <Shell slots={{ notifications: RealHeaderNotices }}>
          <Suspense fallback={<PageFallback />}>
            <PageBoundary key={key}>
              {Page ? <Page /> : null}
            </PageBoundary>
          </Suspense>
        </Shell>
      )
    }
    return (
      <Shell slots={{}}>
        <RealNotIntegrated page={route.page} />
      </Shell>
    )
  }
  if (OUTSIDE_SHELL.has(route.page)) {
    const Outside = routeComponent(route.page)
    return <Suspense fallback={null}>{Outside ? <Outside /> : null}</Suspense>
  }
  if (!authed || route.page === 'login') {
    const Login = routeComponent('login')
    return <Suspense fallback={null}>{Login ? <Login /> : null}</Suspense>
  }
  const Page = routeComponent(route.page) ?? routeComponent('notfound')
  return (
    <Shell slots={{ notifications: HeaderNotices, copilotDrawer: LazyCopilotDrawer }}>
      <Suspense fallback={<PageFallback />}>
        <PageBoundary key={key}>
          {Page ? <Page /> : null}
        </PageBoundary>
      </Suspense>
    </Shell>
  )
}

export function RouteHost() {
  const route = useRoute()
  const storeAuthed = useAuthStore((s) => s.authed)
  // Real mode has no sign-in gate: the connected API document is the trust
  // boundary (D1), and the auth store stays untouched by real mode.
  const authed = DATA_MODE === 'real' ? true : storeAuthed
  return (
    <>
      <DirtyNavBlocker />
      <ResolvedRoute route={route} authed={authed} />
    </>
  )
}

/** Last-resort router error boundary: catches errors RouteHost itself cannot contain. */
export function RouteErrorBoundary() {
  const error = useRouteError()
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-fg" role="alert">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">The console hit an unexpected error while routing. Saved data is not affected.</p>
        <p className="mt-3 break-all font-mono text-xs text-muted">{error instanceof Error ? error.message : String(error)}</p>
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>Reload the console</Button>
      </div>
    </div>
  )
}
