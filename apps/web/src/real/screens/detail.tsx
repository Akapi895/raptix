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
import { RealConversation } from './workspace'
import { RealOperationsPanel } from './operations-panel'
import { RealPlanningPanel } from './planning-panel'
import { RealTeamPanel } from './team'
import { RealScopePanel } from './scope-panel'
import { RealGovernancePanel } from './governance-panel'
import { FindingList } from '../../screens/e-findings'
import { RealReportsPanel } from './reports-panel'
import { RealC2Panel } from './c2-panel'
import { RealFleetPanel } from './fleet-panel'
import { RealAnalysisPanel } from './analysis-panel'
import { RealVaultPanel } from './vault-panel'
import { RealAuditPanel } from './audit-panel'
import { RealClosurePanel } from './closure-panel'
import { ProjectSettingsPanel } from './project-settings-panel'
import { go, useRoute } from '../../router/navigate'
import { REAL_PROJECT_NAV } from '../../shell/nav'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, DescList, Empty, PageHeader, Skeleton, Status } from '../../ui'

/**
 * The sidebar's grouped model is the project nav (plan 2026-10-16 §3.1 — no
 * in-page project tab strip). The engagement tab IDs stay the URL authority.
 */
const TABS = REAL_PROJECT_NAV.flatMap((g) => g.items.map(({ to, label }) => ({ id: to, label })))
const sectionTitle = (tab: string) => TABS.find((t) => t.id === tab)?.label ?? 'Overview'

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
        title={sectionTitle(tab)}
        sub={<span><span className="font-mono">{data.id}</span> · {data.displayName}</span>}
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: data.displayName }]}
        meta={<Status kind="project" value={data.lifecycleStatus} size="sm" />}
      />
      <div className="mt-5">
        {tab === 'overview' ? <Overview d={data} /> : tab === 'planning' ? <RealPlanningPanel engagementId={data.id} handoffConfirmedAt={data.handoffConfirmedAt} /> : tab === 'ai-workspace' ? <RealConversation key={data.id} engagementId={data.id} embedded /> : tab === 'operations' ? <RealOperationsPanel engagementId={data.id} /> : tab === 'fleet' ? <RealFleetPanel engagementId={data.id} /> : tab === 'c2' ? <RealC2Panel engagementId={data.id} /> : tab === 'findings' ? <div className="space-y-4"><FindingList /><RealFindingsPanel engagementId={data.id} /></div> : tab === 'analysis' ? <RealAnalysisPanel engagementId={data.id} /> : tab === 'team' ? <RealTeamPanel engagementId={data.id} /> : tab === 'scope' ? <RealScopePanel engagementId={data.id} /> : tab === 'governance' ? <RealGovernancePanel engagementId={data.id} /> : tab === 'reports' ? <RealReportsPanel engagementId={data.id} /> : tab === 'vault' ? <RealVaultPanel key={data.id} engagementId={data.id} /> : tab === 'audit' ? <RealAuditPanel engagementId={data.id} /> : tab === 'settings' ? <ProjectSettingsPanel project={data} /> : tab === 'close' ? <RealClosurePanel engagementId={data.id} /> : <NotYetIntegrated label={sectionTitle(tab)} />}
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
        <Onboarding d={d} />
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

/**
 * W22 onboarding: composes the real workflows in the order the governance
 * lifecycle expects. No wizard state is persisted — each step opens the tab
 * that owns the real workflow, and only server-known state (the planning
 * handoff) renders a truthful status.
 */
function Onboarding({ d }: { d: ProjectViewModel }): ReactElement {
  const steps: { label: string; why: string; tab: string }[] = [
    { label: 'Team', why: 'invite the independent reviewer who decides approvals (four-eyes)', tab: 'team' },
    { label: 'Scope & ROE', why: 'submit the scope revision and ROE that approvals pin', tab: 'scope' },
    { label: 'Planning', why: 'confirm the planning handoff, then draft the business plan', tab: 'planning' },
  ]
  return (
    <Card>
      <CardHeader title="Onboarding" sub="Compose the real workflows in order — there is no separate wizard and nothing is persisted outside each workflow's own contract" />
      <ol className="space-y-2 p-4 text-sm">
        {steps.map((s, i) => (
          <li key={s.tab} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0">
            <span>{i + 1}. <span className="font-medium">{s.label}</span> — <span className="text-muted">{s.why}</span></span>
            <Button variant="secondary" onClick={() => go('project', { id: d.id, tab: s.tab })}>Open {s.label}</Button>
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-4 py-3">
        <p className="text-xs text-muted" role="status">
          Planning handoff: {d.handoffConfirmedAt === null ? 'not confirmed yet — step 3 completes it' : `confirmed at ${utcMinuteOr(d.handoffConfirmedAt)}`}
        </p>
      </div>
    </Card>
  )
}

function NotYetIntegrated({ label }: { label: string }): ReactElement {
  return (
    <Empty icon={ServerCrash} title={`${label} is not integrated yet`}>
      This tab has no real backend integration in the current milestone. Demo data is intentionally not shown in real mode.
    </Empty>
  )
}
