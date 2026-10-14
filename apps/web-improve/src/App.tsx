import { useEffect, useRef, type ReactElement } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { ServicesProvider } from './state/services'
import { ConsoleProviders } from './state/query'
import { getActiveRouter, setActiveRouter } from './router/active'
import { RouteErrorBoundary, RouteHost } from './router/host'

/**
 * One router instance per mount (fresh mounts re-read window.location.hash).
 * The instance is published for the canonical navigation adapter so the
 * React Router history stays the single location writer (ticket 07, ADR-0067).
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
  useEffect(() => () => { if (getActiveRouter() === router) setActiveRouter(null) }, [router])
  return (
    <ServicesProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </ServicesProvider>
  )
}
