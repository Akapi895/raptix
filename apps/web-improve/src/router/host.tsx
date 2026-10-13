/**
 * Route host (ticket 07): resolves the store route to a page inside the React
 * Router data router. Owns the auth guard (login rendered in place so the
 * requested protected URL survives sign-in as the safe return destination),
 * not-found resolution, the per-page error boundary, the loading fallback for
 * lazy slices, and the dirty-navigation blocker for popstate/URL-edit
 * traversals (in-app navigation is pre-guarded by the store's `go`).
 */
import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useBlocker, useRouteError } from 'react-router'
import { Loader2, RefreshCw, ServerCrash } from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../ui'
import { Shell } from '../shell'
import { OUTSIDE_SHELL, type Route } from './history'
import { routeComponent } from './registry'

const pageKey = (r: Route) => r.page + (r.id ? '/' + r.id : '')

/** Holds popstate/URL-edit traversals while a form is dirty and routes the held navigation through the same unsaved-changes modal as in-app navigation. */
function DirtyNavBlocker() {
  const { dirty, guarded, setDirty } = useStore()
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
  const { go } = useStore()
  return (
    <div className="mx-auto max-w-xl pt-16 text-center" role="alert">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel text-bad"><ServerCrash size={26} aria-hidden /></div>
      <h1 className="text-xl font-semibold tracking-tight">This screen failed to render</h1>
      <p className="mt-2 text-sm text-muted">The error was contained to this page; the rest of the console keeps working.</p>
      <p className="mt-3 break-all font-mono text-xs text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Try again</Button>
        <Button onClick={() => go('command-center')}>Back to Command Center</Button>
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
    <Shell>
      <Suspense fallback={<PageFallback />}>
        <PageBoundary key={key}>
          {Page ? <Page /> : null}
        </PageBoundary>
      </Suspense>
    </Shell>
  )
}

export function RouteHost() {
  const { route, authed } = useStore()
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
