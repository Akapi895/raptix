/** Scoped route composition: resource IDs never substitute for engagement identity. */
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { useRealProjects } from '../queries'
import { Button, Empty, PageHeader, Select } from '../../ui'

const Operations = lazy(() => import('./operations-panel').then((m) => ({ default: m.RealOperationsPanel })))
const Governance = lazy(() => import('./governance-panel').then((m) => ({ default: m.RealGovernancePanel })))
const Fleet = lazy(() => import('./fleet-panel').then((m) => ({ default: m.RealFleetPanel })))
const Scope = lazy(() => import('./scope-panel').then((m) => ({ default: m.RealScopePanel })))
const Findings = lazy(() => import('./findings-panel').then((m) => ({ default: m.RealFindingsPanel })))
const Curation = lazy(() => import('./curation-panel').then((m) => ({ default: m.RealCurationPanel })))
const Reports = lazy(() => import('./reports-panel').then((m) => ({ default: m.RealReportsPanel })))
const Analysis = lazy(() => import('./analysis-panel').then((m) => ({ default: m.RealAnalysisPanel })))
const C2 = lazy(() => import('./c2-panel').then((m) => ({ default: m.RealC2Panel })))
const Campaigns = lazy(() => import('./campaigns-panel').then((m) => ({ default: m.RealCampaignsPanel })))
const Assets = lazy(() => import('./inventory-panel').then((m) => ({ default: m.RealInventoryPanel })))
const LibraryReview = lazy(() => import('./library-review-panel').then((m) => ({ default: m.RealLibraryReviewPanel })))

const SURFACES: Record<string, { title: string; panels: ComponentType<{ engagementId: string }>[] }> = {
  operations: { title: 'Operations', panels: [Operations] },
  operation: { title: 'Operation', panels: [Operations] },
  'operation-new': { title: 'New operation', panels: [Governance, Operations] },
  preflight: { title: 'Preflight', panels: [Governance] },
  'operation-schedule': { title: 'Operation scheduling', panels: [Governance, Operations] },
  agents: { title: 'Agent fleet', panels: [Fleet] },
  agent: { title: 'Agent detail', panels: [Fleet] },
  'ai-fanout': { title: 'Observed fanout', panels: [Fleet] },
  'ai-branch': { title: 'Observed branch', panels: [Fleet] },
  asset: { title: 'Asset detail', panels: [Assets] },
  'asset-new': { title: 'Import assets', panels: [Assets] },
  'asset-scope': { title: 'Asset scope', panels: [Assets, Scope] },
  findings: { title: 'Findings', panels: [Findings, Curation] },
  finding: { title: 'Finding detail', panels: [Findings, Curation] },
  'finding-new': { title: 'New finding', panels: [Curation] },
  evidence: { title: 'Evidence', panels: [Findings] },
  'evidence-inspector': { title: 'Evidence inspector', panels: [Findings] },
  analysis: { title: 'Observed analysis', panels: [Analysis] },
  reports: { title: 'Reports', panels: [Reports] },
  'report-new': { title: 'New report', panels: [Reports] },
  report: { title: 'Report editor', panels: [Reports] },
  'report-preview': { title: 'Report preview', panels: [Reports] },
  'report-review': { title: 'Report review', panels: [Reports] },
  'ai-plan': { title: 'Business plan', panels: [Governance] },
  'ai-plan-review': { title: 'Plan review', panels: [Governance] },
  'ai-plan-compare': { title: 'Plan revisions', panels: [Governance] },
  c2: { title: 'C2 access and console', panels: [C2, Campaigns] },
  'c2-channel': { title: 'C2 channel', panels: [C2, Campaigns] },
  'c2-session': { title: 'C2 session', panels: [C2, Campaigns] },
  'c2-console': { title: 'C2 console', panels: [C2] },
  'playbook-review': { title: 'Library review proposals', panels: [LibraryReview] },
}

export function RealFeatureRoute(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const projects = useRealProjects()
  const engagementId = route.engagementId ?? (pid === 'all' ? '' : pid)
  const surface = SURFACES[route.page]
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
        <div key={`${engagementId}/${route.page}/${route.id ?? ''}`} className="space-y-4">{surface.panels.map((Panel, i) => <Panel key={i} engagementId={engagementId} />)}</div>
      </Suspense>}
  </div>
}
