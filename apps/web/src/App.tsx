import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { ServicesProvider } from './state/services'
import { ConsoleProviders } from './state/query'
import { DATA_MODE } from './state/mode'
import { RealModeProvider } from './shell/real-bootstrap'
import { getActiveRouter, setActiveRouter } from './router/active'
import { RouteErrorBoundary, RouteHost } from './router/host'

/**
 * One router instance per mount (fresh mounts re-read window.location.hash).
 * The instance is published for the canonical navigation adapter so the
 * React Router history stays the single location writer (ticket 07, ADR-0067).
 *
 * The data mode selects the composition root BEFORE anything mounts
 * (integration ticket 03, ADR-0068): mock keeps the demo authority and its
 * demo lifecycle; real mounts the API bootstrap and never creates the mock
 * authority, demo timers or seed data.
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
  const shell = (
    <>
      <RouterProvider router={router} />
    </>
  )
  return DATA_MODE === 'real' ? (
    <RealModeProvider>
      <ConsoleProviders>
        {shell}
      </ConsoleProviders>
    </RealModeProvider>
  ) : (
    <ServicesProvider>
      <ConsoleProviders>
        {shell}
      </ConsoleProviders>
    </ServicesProvider>
  )
}
