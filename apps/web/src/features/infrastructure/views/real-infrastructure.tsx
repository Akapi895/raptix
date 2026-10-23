/**
 * Infrastructure, real mode (plan 2026-10-16, slice S2 — the real counterpart of the mock tabs). One engagement at a time:
 * runtime agents, C2 listeners and profiles, sessions, grant decisions and campaigns each read and write the real API through
 * the panels the project workspace already uses. A missing provider is shown as its refusal, and no panel fills in demo data.
 */
import type { ComponentType, ReactElement } from 'react'
import { Bot, FolderOpen, KeyRound, Network, Send, TerminalSquare, type LucideIcon } from 'lucide-react'
import { go, useRoute } from '../../../router/navigate'
import { useProjectStore } from '../../../state/stores'
import { Banner, Empty, Kpi, PageHeader, Select, Tabs } from '../../../ui/index'
import { useRealProjects } from '../../projects'
import { RuntimeFleetTab, useRuntimeFleet } from '../../operations'
import { ConsoleCard, GrantsCard, InfrastructureCard, RealCampaignsPanel, useProviderGrants, useProviderSurface, useRealCampaigns } from '../../c2'

export type InfrastructureTab = 'agents' | 'c2' | 'sessions' | 'grants' | 'campaigns'

const TABS: { id: InfrastructureTab; label: string; icon: LucideIcon }[] = [
  { id: 'agents', label: 'Runtime agents', icon: Bot },
  { id: 'c2', label: 'C2 infrastructure', icon: Network },
  { id: 'sessions', label: 'Sessions', icon: TerminalSquare },
  { id: 'grants', label: 'Grants', icon: KeyRound },
  { id: 'campaigns', label: 'Campaigns', icon: Send },
]

const PANELS: Record<InfrastructureTab, ComponentType<{ engagementId: string }>> = {
  agents: RuntimeFleetTab,
  c2: InfrastructureCard,
  sessions: ConsoleCard,
  grants: GrantsCard,
  campaigns: RealCampaignsPanel,
}

/** The failure text a read or write shows: the server's message when it has one. */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** The engagement the console is scoped to; the all-projects view names none, so no engagement-scoped read starts. */
function hasEngagement(project: string): boolean {
  return project !== '' && project !== 'all'
}

/** Counts for the selected engagement. Each read is the same query the panels use, so no request is repeated. */
function Summary({ engagementId }: { engagementId: string }): ReactElement {
  const fleet = useRuntimeFleet(engagementId)
  const grants = useProviderGrants(engagementId)
  const surface = useProviderSurface(engagementId)
  const campaigns = useRealCampaigns(engagementId)
  const pending = grants.data?.grants.filter((grant) => grant.status === 'requested').length
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Kpi label="Active runs" value={fleet.data ? fleet.data.counts.activeRuns : '—'} sub={fleet.isError ? errorText(fleet.error, 'Fleet unavailable') : `${fleet.data?.counts.threads ?? 0} runtime threads`} />
      <Kpi label="Grants awaiting decision" value={pending ?? '—'} sub={grants.isError ? errorText(grants.error, 'Grants unavailable') : 'Requested, not yet decided'} />
      <Kpi label="C2 sessions" value={surface.data ? surface.data.sessions.length : '—'} sub={surface.isError ? errorText(surface.error, 'C2 provider not configured') : 'Reported by the provider'} />
      <Kpi label="Campaigns" value={campaigns.data ? campaigns.data.campaigns.length : '—'} sub={campaigns.isError ? errorText(campaigns.error, 'Campaigns unavailable') : 'Drafts and deployed campaigns'} />
    </div>
  )
}

export function RealInfrastructureRoute(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const projects = useRealProjects()
  const engagementId = route.engagementId ?? (pid === 'all' ? '' : pid)
  const tab: InfrastructureTab = TABS.find((t) => t.id === route.tab)?.id ?? 'agents'
  const Panel = PANELS[tab]
  return (
    <div className="space-y-4">
      <PageHeader title="Infrastructure" sub="Runtime agents, C2 listeners and sessions, grant decisions and campaigns for one engagement. Every read and write goes to the real API." />
      <label className="flex flex-wrap items-center gap-3 text-sm">Engagement
        <Select aria-label="Engagement" value={engagementId} onChange={(e) => {
          const selected = e.target.value
          setPid(selected || 'all')
          go('infrastructure', { engagementId: selected, tab })
        }}>
          <option value="">Select an engagement</option>
          {projects.list.data?.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </Select>
      </label>
      {projects.list.isError && <Banner tone="bad" title="Engagements unavailable">{errorText(projects.list.error, 'The engagement list could not be read.')}</Banner>}
      {!hasEngagement(engagementId) ? (
        <Empty icon={FolderOpen} title="Select an engagement">Choose the engagement whose runtime agents, C2 infrastructure and campaigns you want to see.</Empty>
      ) : (
        <>
          <Summary engagementId={engagementId} />
          <Tabs tabs={TABS} value={tab} onChange={(next) => go('infrastructure', { engagementId, tab: next })} />
          <div key={`${engagementId}/${tab}`}>
            <Panel engagementId={engagementId} />
          </div>
        </>
      )}
    </div>
  )
}
