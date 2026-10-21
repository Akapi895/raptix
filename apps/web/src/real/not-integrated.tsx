/**
 * Honest unavailability for real mode (integration ticket 03, decision D4).
 *
 * Surfaces whose real integration has not landed yet (their owning tickets
 * are indexed in .scratch/frontend-backend-integration/coverage.md) render
 * this panel in real mode instead of the demo screen. Nothing here simulates
 * data, approvals or execution under a real label (R02).
 */
import type { ReactElement } from 'react'
import { ArrowLeft, PlugZap } from 'lucide-react'
import { go } from '../router/navigate'
import { switchDataMode } from '../state/mode'
import { Button } from '../ui/index'

/**
 * Route keys reachable via the mock-mode `routeComponent` lookup while still
 * honest in real mode: the bootstrap/project surfaces and the system pages
 * that read no console data. `router/host.tsx` checks `REAL_PAGES` (direct
 * components plus everything in `route-table.ts`) first, so a key only ever
 * reaches this set if it has no real-mode implementation there yet.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const REAL_INTEGRATED_ROUTES: ReadonlySet<string> = new Set([
  'projects',
  'project',
  'project-new',
  // System pages that do not read console data render themselves.
  'notfound', 'error', 'offline', 'forbidden', 'session-expired',
])

export function RealNotIntegrated({ page }: { page: string }): ReactElement {
  return (
    <div className="mx-auto max-w-xl pt-12" role="status">
      <div className="rounded-2xl border border-line bg-panel p-6">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-subtle text-cyan"><PlugZap size={20} aria-hidden /></div>
        <h1 className="text-lg font-semibold tracking-tight">Not connected in real mode</h1>
        <p className="mt-2 text-sm text-muted">
          The <span className="font-mono text-[13px]">{page}</span> surface is not integrated with the real backend yet.
          Its demo data and simulated actions are intentionally unavailable here — real mode never falls back to
          mock content (integration ticket 03, decision D4).
        </p>
        <p className="mt-2 text-xs text-neutral">Projects are the first integrated surface; planning, execution and results follow in the approved integration tickets.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" icon={ArrowLeft} onClick={() => go('projects')}>Go to Projects</Button>
          <Button variant="secondary" icon={PlugZap} onClick={() => switchDataMode('mock')}>Switch to demo mode</Button>
        </div>
      </div>
    </div>
  )
}
