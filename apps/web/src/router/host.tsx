/**
 * Route host (ticket 07): resolves the store route to a page inside the React
 * Router data router. Owns not-found resolution, the per-page error boundary,
 * the loading fallback for lazy slices, and the dirty-navigation blocker for
 * popstate/URL-edit traversals (in-app navigation is pre-guarded by the
 * store's `go`).
 *
 * The console runs against the real API only (ADR-0068, ADR-0101): there is no
 * sign-in gate here, because the connected API document is the trust boundary
 * (D1). Each route renders the surface its declaration in routes.ts names.
 */
import { Component, lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { Navigate, useBlocker, useRouteError } from 'react-router'
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react'
import { useSessionStore } from '../state/session'
import { useProjectStore } from '../state/stores'
import { go, useRoute } from './navigate'
import { GLOBAL_RESOURCE_PAGES, ROUTES } from './routes'
import { RealGlobalResource } from '../features/overview'
import { Button } from '../ui/index'
import { Shell } from '../shell/index'
import { toHref, type Route } from './history'
import { canonicalRoute } from './aliases'
import { routeComponent } from './registry'

const pageKey = (r: Route) => r.page + (r.id ? '/' + r.id : '')
const RealFeatureRoute = lazy(() => import('./feature-route').then((m) => ({ default: m.RealFeatureRoute })))

/** One lazy wrapper per real component, memoised by route key so a re-render never remounts it. */
const realComponents = new Map<string, ComponentType>()
function realComponent(key: string, load: () => Promise<ComponentType>): ComponentType {
  let component = realComponents.get(key)
  if (!component) {
    component = lazy(async () => ({ default: await load() }))
    realComponents.set(key, component)
  }
  return component
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

/** Resolves the current store route to a page element. */
function ResolvedRoute({ route }: { route: Route }) {
  const key = pageKey(route)
  const pid = useProjectStore((s) => s.pid)
  const globalResource = !route.id && !route.engagementId && (route.page === 'infrastructure' || pid === 'all' && GLOBAL_RESOURCE_PAGES.has(route.page))
  if (globalResource) {
    return (
      <Shell>
        <PageBoundary key={key}>
          <Suspense fallback={<PageFallback />}><RealGlobalResource /></Suspense>
        </PageBoundary>
      </Shell>
    )
  }
  const surface = ROUTES[route.page]?.real
  if (surface?.kind === 'shared') {
    const Migrated = routeComponent(route.page)
    return (
      <Shell>
        <PageBoundary key={key}>
          <Suspense fallback={<PageFallback />}>{Migrated ? <Migrated /> : null}</Suspense>
        </PageBoundary>
      </Shell>
    )
  }
  if (surface?.kind === 'feature') {
    return (
      <Shell>
        <PageBoundary key={key}>
          <Suspense fallback={<PageFallback />}><RealFeatureRoute /></Suspense>
        </PageBoundary>
      </Shell>
    )
  }
  if (surface?.kind === 'component') {
    const Real = realComponent(route.page, surface.load)
    return (
      <Shell>
        <PageBoundary key={key}>
          <Suspense fallback={<PageFallback />}><Real /></Suspense>
        </PageBoundary>
      </Shell>
    )
  }
  if (surface?.kind === 'system') {
    const Page = routeComponent(route.page)
    return (
      <Shell>
        <Suspense fallback={<PageFallback />}>
          <PageBoundary key={key}>
            {Page ? <Page /> : null}
          </PageBoundary>
        </Suspense>
      </Shell>
    )
  }
  // Not a route of this build (an unknown address, or a flagged page whose flag is off): the unknown-route page.
  const NotFound = routeComponent('notfound')
  return <Shell>{NotFound ? <NotFound /> : null}</Shell>
}

export function RouteHost() {
  const route = useRoute()
  const canonical = canonicalRoute(route)
  // Legacy addresses (aliases.ts) are replaced once with the canonical route, so old links keep working.
  if (canonical !== route) return <Navigate to={toHref(canonical)} replace />
  return (
    <>
      <DirtyNavBlocker />
      <ResolvedRoute route={route} />
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
