/**
 * Real project detail (integration ticket 03). The engagement contract's
 * identity fields (server id vs display name vs workspace slug) render
 * explicitly; feature tabs without a real integration render the honest
 * unavailable panel instead of demo data (D4). Planning readiness arrives
 * with ticket 04.
 */
import { AiRunControls } from '../../operations';
import { isAssetMapEnabled } from '../../asset-map';
import { Suspense, lazy, useEffect, useMemo, type ReactElement } from 'react'
import { RefreshCw, ServerCrash } from 'lucide-react'
import { useEngagementDetail } from '../detail-query';
import { projectStage, STAGE_LABEL } from '../workspace';
import { RealConversation } from '../../aichat';
import { RuntimeOperationsTab } from '../../operations';
import { PlanningTab } from '../../planning';
import { TeamMembers } from '../../team';
import { ScopeTab } from '../../scope';
import { ProjectAssets } from '../../assets';
import { GovernanceTab } from '../../governance';
import { EvidenceList, FindingList } from '../../findings';
import { ApprovalInbox } from '../../team';
import { C2ProviderTab } from '../../c2';
import { RuntimeFleetTab } from '../../operations';
import { ObservedAnalysisTab } from '../../analysis';
import { VaultTab } from '../../vault';
import { AuditPanel } from '../../audit';
import { ClosureTab } from '../../closure';
import { ReportsPage } from '../../reports';
import { ProjectSettingsPanel } from './project-settings-panel'
import { ProjectOverview } from './project-overview'
import { go, useRoute } from '../../../router/navigate'
import { PROJECT_NAV } from '../../../shell/nav'
import { useProjectStore } from '../../../state/stores'
import { Button, Empty, PageHeader, Skeleton, Status } from '../../../ui/index'

/**
 * The sidebar's grouped model is the project nav (plan 2026-10-16 §3.1 — no
 * in-page project tab strip). The engagement tab IDs stay the URL authority.
 */
/* The nav is read when the page renders, not at import: the nav module can be mid-load when this module first evaluates. */
const navTabs = () => PROJECT_NAV.flatMap((g) => g.items.map(({ to, label }) => ({ id: to, label })))
const sectionTitle = (tab: string) => navTabs().find((t) => t.id === tab)?.label ?? 'Overview'

/** The Asset Map inside the project it belongs to, so the project sidebar and its selection stay in place. */
const ProjectAssetMap = lazy(() => import('../../asset-map').then((m) => ({ default: m.AssetMapPage })))

export function RealProjectDetail(): ReactElement {
  const route = useRoute()
  const id = route.id ?? ''
  const setPid = useProjectStore((s) => s.setPid)
  useEffect(() => { if (id) setPid(id) }, [id, setPid])

  const tab = navTabs().some((t) => t.id === route.tab) ? route.tab! : 'overview'
  const detail = useEngagementDetail(id)

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
        meta={<span className="flex flex-wrap items-center gap-2"><Status kind="project" value={data.lifecycleStatus} size="sm" /><span className="text-xs text-muted">{STAGE_LABEL[projectStage(data.lifecycleStatus)]}</span></span>}
      />}
      <div className="mt-5">
        {tab === 'overview' ? <ProjectOverview d={data} /> : tab === 'assets' ? <ProjectAssets engagementId={data.id} mapEnabled={isAssetMapEnabled()} />
        : tab === 'planning' ? <PlanningTab engagementId={data.id} handoffConfirmedAt={data.handoffConfirmedAt} brief={data.brief} updatedAt={data.updatedAt} /> : tab === 'ai-workspace' ? <div className="space-y-4"><RealConversation key={`${data.id}:${data.handoffConfirmedAt ? 'execution' : 'planning'}`} engagementId={data.id} embedded={data.handoffConfirmedAt !== null} />{isAssetMapEnabled() ? <AiRunControls engagementId={data.id} /> : null}</div> : tab === 'operations' ? <RuntimeOperationsTab engagementId={data.id} /> : tab === 'fleet' ? <RuntimeFleetTab engagementId={data.id} /> : tab === 'c2' ? <C2ProviderTab engagementId={data.id} /> : tab === 'evidence' ? <EvidenceList /> : tab === 'findings' ? <div className="space-y-4"><FindingList /><div className="flex justify-end"><Button variant="secondary" onClick={() => go('evidence')}>Open evidence inventory</Button></div></div> : tab === 'analysis' ? <ObservedAnalysisTab engagementId={data.id} /> : tab === 'team' ? <div className="space-y-4"><ApprovalInbox engagementId={data.id} /><TeamMembers engagementId={data.id} /></div> : tab === 'scope' ? <ScopeTab engagementId={data.id} /> : tab === 'governance' ? <GovernanceTab engagementId={data.id} /> : tab === 'reports' ? <Suspense fallback={<Skeleton className="h-40" />}><ReportsPage /></Suspense> : tab === 'vault' ? <VaultTab key={data.id} engagementId={data.id} /> : tab === 'audit' ? <AuditPanel engagementId={data.id} /> : tab === 'settings' ? <ProjectSettingsPanel project={data} /> : tab === 'close' ? <ClosureTab engagementId={data.id} /> : tab === 'asset-map' && isAssetMapEnabled() ? <Suspense fallback={<Skeleton className="h-40" />}><ProjectAssetMap /></Suspense> : <NotYetIntegrated label={sectionTitle(tab)} />}
      </div>
    </>
  )
}

function NotYetIntegrated({ label }: { label: string }): ReactElement {
  return (
    <Empty icon={ServerCrash} title={`${label} is not integrated yet`}>
      This tab has no real backend integration in the current milestone. Demo data is intentionally not shown in real mode.
    </Empty>
  )
}
