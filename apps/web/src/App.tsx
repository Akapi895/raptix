import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { ConsoleProviders } from './state/query'
import { RealModeProvider } from './shell/real-bootstrap'
import { getActiveRouter, setActiveRouter } from './router/active'
import { RouteErrorBoundary, RouteHost } from './router/host'

/**
 * One router instance per mount (fresh mounts re-read window.location.hash).
 * The instance is published for the canonical navigation adapter so the
 * React Router history stays the single location writer (ticket 07, ADR-0067).
 *
 * The console runs against the real API only (ADR-0068, ADR-0101): the
 * bootstrap resolves the session and the capability document before any
 * surface mounts.
 */
export default function App(): ReactElement {
  const routerRef = useRef<ReturnType<typeof createHashRouter> | null>(null)
  if (!routerRef.current) {
    routerRef.current = createHashRouter([
      { path: '*', element: <RouteHost />, errorElement: <RouteErrorBoundary />, hydrateFallbackElement: null },
    ])
  }
  const router = routerRef.current
  setActiveRouter(router)
  useLayoutEffect(() => {
    // StrictMode replays effect cleanup/setup. Republish before route hooks'
    // passive subscriptions, otherwise cleanup leaves the live router null.
    setActiveRouter(router)
    return () => { if (getActiveRouter() === router) setActiveRouter(null) }
  }, [router])
  return (
    <RealModeProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </RealModeProvider>
  )
}
