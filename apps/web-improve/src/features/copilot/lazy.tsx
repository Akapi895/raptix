/**
 * Lazy copilot drawer slot (ticket 70): the drawer and its g-screen card
 * imports load on first mount instead of the initial chunk. The slot contract
 * (ShellSlots.copilotDrawer) is unchanged — the route host and the shell's
 * omitted-slot default both render this wrapper.
 */
import { lazy, Suspense } from 'react'

const Drawer = lazy(() => import('./drawer').then((m) => ({ default: m.CopilotDrawer })))

export function LazyCopilotDrawer() {
  return <Suspense fallback={null}><Drawer /></Suspense>
}
