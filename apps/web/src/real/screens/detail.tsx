/**
 * Real project detail (integration ticket 03). The engagement contract's
 * identity fields (server id vs display name vs workspace slug) render
 * explicitly; feature tabs without a real integration render the honest
 * unavailable panel instead of demo data (D4). Planning readiness arrives
 * with ticket 04.
 */
import { Suspense, useEffect, useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, ServerCrash } from 'lucide-react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { fetchAssetInventory, fetchFindings, fetchFleet, fetchPlanning, fetchScopeRevisions, getEngagement } from '../api'
import { utcMinuteOr } from '../format'
import { projectKeys } from '../queries'
import { RealConversation } from './workspace'
import { RuntimeOperationsTab } from '../../features/operations/runtime-tab'
import { PlanningTab } from '../../features/planning/tab'
import { TeamMembers } from '../../features/team/members'
import { ScopeTab } from '../../features/scope/tab'
import { GovernanceTab } from '../../features/governance/tab'
import { EvidenceList, FindingList } from '../../screens/e-findings'
import { ApprovalInbox } from '../../features/team/approval-inbox'
import { routeComponent } from '../../router/registry'
import { C2ProviderTab } from '../../features/c2/provider-tab'
import { RuntimeFleetTab } from '../../features/operations/fleet-tab'
import { ObservedAnalysisTab } from '../../features/analysis/observed-tab'
import { VaultTab } from '../../features/vault/tab'
import { AuditPanel } from '../../features/audit/panel'
import { ClosureTab } from '../../features/closure/tab'
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

const ProjectReports = routeComponent('reports')

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
      {/* The planning-mode AI workspace draws its own header (with the thread actions) inside the page. */}
      {!(tab === 'ai-workspace' && data.handoffConfirmedAt === null) && <PageHeader
        title={sectionTitle(tab)}
        sub={<span><span className="font-mono">{data.id}</span> · {data.displayName}</span>}
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: data.displayName }]}
        meta={<Status kind="project" value={data.lifecycleStatus} size="sm" />}
      />}
      <div className="mt-5">
        {tab === 'overview' ? <Overview d={data} /> : tab === 'planning' ? <PlanningTab engagementId={data.id} handoffConfirmedAt={data.handoffConfirmedAt} /> : tab === 'ai-workspace' ? <RealConversation key={`${data.id}:${data.handoffConfirmedAt ? 'execution' : 'planning'}`} engagementId={data.id} embedded={data.handoffConfirmedAt !== null} /> : tab === 'operations' ? <RuntimeOperationsTab engagementId={data.id} /> : tab === 'fleet' ? <RuntimeFleetTab engagementId={data.id} /> : tab === 'c2' ? <C2ProviderTab engagementId={data.id} /> : tab === 'evidence' ? <EvidenceList /> : tab === 'findings' ? <div className="space-y-4"><FindingList /><div className="flex justify-end"><Button variant="secondary" onClick={() => go('evidence')}>Open evidence inventory</Button></div></div> : tab === 'analysis' ? <ObservedAnalysisTab engagementId={data.id} /> : tab === 'team' ? <div className="space-y-4"><ApprovalInbox engagementId={data.id} /><TeamMembers engagementId={data.id} /></div> : tab === 'scope' ? <ScopeTab engagementId={data.id} /> : tab === 'governance' ? <GovernanceTab engagementId={data.id} /> : tab === 'reports' ? <Suspense fallback={<Skeleton className="h-40" />}>{ProjectReports ? <ProjectReports /> : null}</Suspense> : tab === 'vault' ? <VaultTab key={data.id} engagementId={data.id} /> : tab === 'audit' ? <AuditPanel engagementId={data.id} /> : tab === 'settings' ? <ProjectSettingsPanel project={data} /> : tab === 'close' ? <ClosureTab engagementId={data.id} /> : <NotYetIntegrated label={sectionTitle(tab)} />}
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
          <ProjectCounts engagementId={d.id} />
        </Card>
      </div>
    </div>
  )
}

/**
 * Counts come from the sources that own them (the findings list, the scope
 * inventory, the fleet's live runs), read through the same cache keys as those
 * panels. Each count falls back to "No source" on its own read error, so one
 * outage never blanks the others.
 */
export function ProjectCounts({ engagementId }: { engagementId: string }): ReactElement {
  const findings = useQuery({ queryKey: ['real', 'findings', engagementId], queryFn: () => fetchFindings(engagementId) })
  const assets = useQuery({ queryKey: ['real', 'asset-inventory', engagementId], queryFn: () => fetchAssetInventory(engagementId) })
  const fleet = useQuery({ queryKey: ['real', 'fleet', engagementId], queryFn: () => fetchFleet(engagementId) })
  const show = (read: { isPending: boolean; isError: boolean }, value: number | undefined): string =>
    read.isPending ? '…' : read.isError || value === undefined ? 'No source' : String(value)
  return (
    <DescList
      items={[
        { k: 'Findings', v: show(findings, findings.data?.findings.length) },
        { k: 'Assets', v: show(assets, assets.data?.assets.length) },
        { k: 'Active runs', v: show(fleet, fleet.data?.counts.activeRuns) },
      ]}
    />
  )
}

/**
 * W22 onboarding: composes the real workflows in the order the governance
 * lifecycle expects. No wizard state is persisted — each step opens the tab
 * that owns the real workflow, and only server-known state (the planning
 * handoff) renders a truthful status.
 */
function Onboarding({ d }: { d: ProjectViewModel }): ReactElement {
  // Same keys as the Scope and Planning panels, so the overview reuses their reads.
  const scope = useQuery({ queryKey: ['real', 'scope-revisions', d.id], queryFn: () => fetchScopeRevisions(d.id) })
  const planning = useQuery({ queryKey: ['real', 'planning', d.id], queryFn: () => fetchPlanning(d.id) })
  const scopeStatus = scope.data === undefined ? '…' : scope.data.latestApprovedVersion === null ? 'No approved revision yet' : `Approved v${scope.data.latestApprovedVersion}`
  const planningStatus = planning.data === undefined ? '…'
    : d.handoffConfirmedAt !== null ? 'Handoff confirmed'
    : planning.data.readiness.state === 'ready' ? 'Documents ready — review, then confirm'
    : `${planning.data.readiness.reasons.length} item(s) to resolve`
  const steps: { label: string; why: string; tab: string; status?: string }[] = [
    { label: 'Team', why: 'invite the independent reviewer who decides approvals (four-eyes)', tab: 'team' },
    { label: 'Scope & ROE', why: 'submit the scope revision and ROE that approvals pin', tab: 'scope', status: scopeStatus },
    { label: 'Planning', why: 'confirm the planning handoff, then draft the business plan', tab: 'planning', status: planningStatus },
  ]
  return (
    <Card>
      <CardHeader title="Onboarding" sub="Compose the real workflows in order — there is no separate wizard and nothing is persisted outside each workflow's own contract" />
      <ol className="space-y-2 p-4 text-sm">
        {steps.map((s, i) => (
          <li key={s.tab} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0">
            <span>{i + 1}. <span className="font-medium">{s.label}</span> — <span className="text-muted">{s.why}</span>{s.status && <span className="ml-2 text-xs text-fg">· {s.status}</span>}</span>
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
