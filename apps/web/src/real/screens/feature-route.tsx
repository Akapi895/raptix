/** Scoped route composition: resource IDs never substitute for engagement identity. */
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { useRealProjects } from '../queries'
import { Button, Empty, PageHeader, Select } from '../../ui'
import { FEATURE_ROUTE_SURFACES, type PanelGroup } from '../../router/route-table'

type PanelComponent = ComponentType<{ engagementId: string }>

/** Lazy real panel per group; `route-table.ts` decides which groups a route key renders. */
const PANEL_COMPONENTS: Record<PanelGroup, PanelComponent> = {
  operations: lazy(() => import('./operations-panel').then((m) => ({ default: m.RealOperationsPanel }))),
  governance: lazy(() => import('../../features/governance/tab').then((m) => ({ default: m.GovernanceTab }))),
  fleet: lazy(() => import('./fleet-panel').then((m) => ({ default: m.RealFleetPanel }))),
  scope: lazy(() => import('../../features/scope/tab').then((m) => ({ default: m.ScopeTab }))),
  analysis: lazy(() => import('../../features/analysis/observed-tab').then((m) => ({ default: m.ObservedAnalysisTab }))),
  c2: lazy(() => import('./c2-panel').then((m) => ({ default: m.RealC2Panel }))),
  campaigns: lazy(() => import('./campaigns-panel').then((m) => ({ default: m.RealCampaignsPanel }))),
}

export function RealFeatureRoute(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const projects = useRealProjects()
  const engagementId = route.engagementId ?? (pid === 'all' ? '' : pid)
  const surface = FEATURE_ROUTE_SURFACES[route.page]
  // Defensive: route-table.ts is the sole key list host.tsx uses to reach this
  // component, so this should be unreachable; it only guards against a future
  // route-table edit that adds a key without wiring it through host.tsx too.
  if (!surface) return <Empty icon={FolderOpen} title="Unknown surface" action={<Button onClick={() => go('overview')}>Back to Overview</Button>}>No route-table entry for &quot;{route.page}&quot;.</Empty>
  return <div className="space-y-4">
    <PageHeader title={surface.title} sub={route.id ? `Resource: ${route.id}` : 'Scoped to the selected engagement; all reads and writes use the real API.'} />
    <label className="flex items-center gap-3 text-sm">Engagement
      <Select aria-label="Engagement" value={engagementId} onChange={(e) => {
        const selected = e.target.value
        setPid(selected || 'all')
        go(route.page, { engagementId: selected })
      }}>
        <option value="">Select an engagement</option>
        {projects.list.data?.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      </Select>
    </label>
    {projects.list.isError && <p role="alert">{projects.list.error.message}</p>}
    {!engagementId ? <Empty icon={FolderOpen} title="Select an engagement" action={<Button onClick={() => go('projects')}>Open Projects</Button>}>Choose the owning engagement before reading or changing this resource.</Empty>
      : <Suspense fallback={<p role="status">Loading {surface.title}…</p>}>
        <div key={`${engagementId}/${route.page}/${route.id ?? ''}`} className="space-y-4">{surface.panels.map((group) => { const Panel = PANEL_COMPONENTS[group]; return <Panel key={group} engagementId={engagementId} /> })}</div>
      </Suspense>}
  </div>
}
