import { useEffect, useRef } from 'react'

/**
 * Delayed navigation scoped to the component's mount: a captured redirect
 * that outlives the provider must not move a later mount's projected route —
 * sequential provider mounts (the test suites) rely on that isolation, which
 * the store's epoch-scoped `go` used to give (router enabler B). A screen
 * taking the module `go` recovers it with this liveness guard.
 */
export function useDelayedNav() {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return (fn: () => void, ms: number) => window.setTimeout(() => { if (alive.current) fn() }, ms)
}

