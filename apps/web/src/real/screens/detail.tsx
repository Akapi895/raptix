/**
 * Real project detail (integration ticket 03). The engagement contract's
 * identity fields (server id vs display name vs workspace slug) render
 * explicitly; feature tabs without a real integration render the honest
 * unavailable panel instead of demo data (D4). Planning readiness arrives
 * with ticket 04.
 */
import { useEffect, useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, ServerCrash } from 'lucide-react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { getEngagement } from '../api'
import { utcMinuteOr } from '../format'
import { projectKeys } from '../queries'
import { RealFindingsPanel } from './findings-panel'
import { RealOperationsPanel } from './operations-panel'
import { RealPlanningPanel } from './planning-panel'
import { RealTeamPanel } from './team'
import { RealScopePanel } from './scope-panel'
import { RealGovernancePanel } from './governance-panel'
import { RealCurationPanel } from './curation-panel'
import { RealReportsPanel } from './reports-panel'
import { RealC2Panel } from './c2-panel'
import { RealFleetPanel } from './fleet-panel'
import { RealAnalysisPanel } from './analysis-panel'
import { RealVaultPanel } from './vault-panel'
import { RealAuditPanel } from './audit-panel'
import { RealClosurePanel } from './closure-panel'
import { ProjectSettingsPanel } from './project-settings-panel'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, DescList, Empty, PageHeader, Skeleton, Status, Tabs } from '../../ui'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'planning', label: 'Planning' },
  { id: 'operations', label: 'Operations' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'c2', label: 'C2 Access' },
  { id: 'findings', label: 'Findings' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'reports', label: 'Reports' },
  { id: 'team', label: 'Team' },
  { id: 'scope', label: 'Scope & ROE' },
  { id: 'governance', label: 'Governance' },
  { id: 'vault', label: 'Vault' },
  { id: 'audit', label: 'Audit' },
  { id: 'settings', label: 'Settings' },
  { id: 'close', label: 'Close' },
]

export function RealProjectDetail(): ReactElement {
  const route = useRoute()
  const id = route.id ?? ''
  const setPid = useProjectStore((s) => s.setPid)
  useEffect(() => { if (id) setPid(id) }, [id, setPid])

  const tab = TABS.some((t) => t.id === route.tab) ? route.tab! : 'overview'
  const detail = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getEngagement(id),
    enabled: !!id,
  })

  const data = useMemo(() => detail.data, [detail.data])

  if (!id) {
    return <Empty icon={ServerCrash} title="No engagement selected" action={<Button variant="primary" onClick={() => go('projects')}>Go to Projects</Button>}>
      Open a project from the portfolio.
    </Empty>
  }
  if (detail.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" role="status">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (detail.isError || !data) {
    const message = detail.error instanceof Error ? detail.error.message : 'The engagement could not be loaded.'
    return (
      <div className="mx-auto max-w-xl pt-10 text-center" role="alert">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel text-bad"><ServerCrash size={22} aria-hidden /></div>
        <h2 className="text-base font-semibold">Could not load engagement {id}</h2>
        <p className="mt-2 break-words text-sm text-muted">{message}</p>
        <Button variant="primary" className="mt-4" icon={RefreshCw} onClick={() => void detail.refetch()}>Try again</Button>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title={data.displayName}
        sub={<span><span className="font-mono">{data.id}</span> · workspace slug <span className="font-mono">{data.workspaceSlug}</span></span>}
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: data.displayName }]}
        meta={<Status kind="project" value={data.lifecycleStatus} size="sm" />}
      />
      <Tabs
        value={tab}
        onChange={(next) => go('project', { id, tab: next })}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
      />
      <div className="mt-5">
        {tab === 'overview' ? <Overview d={data} /> : tab === 'planning' ? <RealPlanningPanel engagementId={data.id} handoffConfirmedAt={data.handoffConfirmedAt} /> : tab === 'operations' ? <RealOperationsPanel engagementId={data.id} /> : tab === 'fleet' ? <RealFleetPanel engagementId={data.id} /> : tab === 'c2' ? <RealC2Panel engagementId={data.id} /> : tab === 'findings' ? <div className="space-y-4"><RealFindingsPanel engagementId={data.id} /><RealCurationPanel engagementId={data.id} /></div> : tab === 'analysis' ? <RealAnalysisPanel engagementId={data.id} /> : tab === 'team' ? <RealTeamPanel engagementId={data.id} /> : tab === 'scope' ? <RealScopePanel engagementId={data.id} /> : tab === 'governance' ? <RealGovernancePanel engagementId={data.id} /> : tab === 'reports' ? <RealReportsPanel engagementId={data.id} /> : tab === 'vault' ? <RealVaultPanel engagementId={data.id} /> : tab === 'audit' ? <RealAuditPanel engagementId={data.id} /> : tab === 'settings' ? <ProjectSettingsPanel project={data} /> : tab === 'close' ? <RealClosurePanel engagementId={data.id} /> : <NotYetIntegrated label={TABS.find((t) => t.id === tab)?.label ?? tab} />}
      </div>
    </>
  )
}

function Overview({ d }: { d: ProjectViewModel }): ReactElement {
  const ready = d.metadataState === 'verified'
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        {!ready && (
          <Banner tone="warn" title="Engagement metadata needs review">
            The stored target is not policy-verified yet. Fix the target or confirm authorization before planning starts.
          </Banner>
        )}
        {d.brief && (
          <Card>
            <CardHeader title="Operator brief" />
            <p className="whitespace-pre-wrap text-sm">{d.brief}</p>
          </Card>
        )}
        <Card>
          <CardHeader title="Engagement identity" sub="Server id, display name and workspace slug are distinct fields; the slug names the engagement workspace." />
          <DescList
            items={[
              { k: 'Server id', v: <span className="font-mono">{d.id}</span> },
              { k: 'Display name', v: d.displayName },
              { k: 'Workspace slug', v: <span className="font-mono">{d.workspaceSlug}</span> },
              { k: 'Target', v: <span className="font-mono">{d.targetValue}</span> },
              { k: 'Target type', v: d.targetType },
              { k: 'Metadata', v: <Status kind="check" value={ready ? 'pass' : 'review'} size="sm" label={ready ? 'Verified' : 'Needs review'} /> },
              { k: 'Lifecycle', v: <Status kind="project" value={d.lifecycleStatus} size="sm" /> },
              { k: 'Authorization confirmed', v: d.authorizationConfirmed ? 'Yes' : 'No' },
              { k: 'Created', v: utcMinuteOr(d.createdAt) },
              { k: 'Updated', v: utcMinuteOr(d.updatedAt) },
            ]}
          />
        </Card>
      </div>
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Planning handoff" />
          <p className="text-sm text-muted">{d.handoffConfirmedAt ? `Confirmed at ${utcMinuteOr(d.handoffConfirmedAt)}` : 'Planning handoff has not been confirmed yet.'}</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => go('project', { id: d.id, tab: 'planning' })}>Open planning</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Counts" sub="Counters exist only when a projection source confirms them." />
          <DescList
            items={[
              { k: 'Findings', v: d.findingCount === null ? 'No source' : String(d.findingCount) },
              { k: 'Assets', v: d.assetCount === null ? 'No source' : String(d.assetCount) },
              { k: 'Active agents', v: d.activeAgentCount === null ? 'No source' : String(d.activeAgentCount) },
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

function NotYetIntegrated({ label }: { label: string }): ReactElement {
  return (
    <Empty icon={ServerCrash} title={`${label} is not integrated yet`}>
      This tab has no real backend integration in the current milestone. Demo data is intentionally not shown in real mode.
    </Empty>
  )
}
