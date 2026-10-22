/** Global resource navigation without pretending scoped APIs are aggregate sources. */
import type { ReactElement } from 'react'
import { useRealC2Rollup, useRealFindingsRollup } from '../query'
import { useRealProjects } from '../../projects'
import { go, useRoute } from '../../../router/navigate'
import { Banner, Button, Card, CardHeader, DescList, PageHeader, Skeleton, Tabs } from '../../../ui'

const SURFACES: Record<string, { title: string; tab: string; gap: string }> = {
  findings: { title: 'Findings', tab: 'findings', gap: 'A cross-project finding list is not integrated. The overview rollup is a count, not a finding inventory.' },
  reports: { title: 'Reports', tab: 'reports', gap: 'A cross-project report catalog is not integrated. Reports remain available in their owning projects.' },
  operations: { title: 'Operations', tab: 'operations', gap: 'A cross-project runtime run list is not integrated. Open a project to inspect its observed runs.' },
  analysis: { title: 'Attack Analysis', tab: 'analysis', gap: 'Cross-project coverage is not integrated. Project analysis uses its own observed graph source.' },
  infrastructure: { title: 'Infrastructure', tab: 'fleet', gap: 'Global execution-agent inventory, C2 infrastructure and live session monitoring are not integrated. Durable command audit counts are available in System Overview.' },
  agents: { title: 'Infrastructure', tab: 'fleet', gap: 'Global execution-agent inventory is not integrated. Project fleet observations are available separately.' },
  c2: { title: 'Infrastructure', tab: 'c2', gap: 'Global live C2 sessions are not integrated. Open the owning project for provider-backed session data.' },
}

/** Counts across the authorized projects, from the same overview reads the System Overview uses. */
function FindingsRollup(): ReactElement {
  const findings = useRealFindingsRollup()
  return (
    <Card>
      <CardHeader title="Findings across your projects" sub="Counts only; open a project for its finding list." />
      <div className="p-4">
        {findings.isPending ? <Skeleton className="h-16" /> : findings.isError ? (
          <Banner tone="warn" title="Findings rollup unavailable">{findings.error instanceof Error ? findings.error.message : 'The rollup could not be read.'} No substitute counts are shown.</Banner>
        ) : (
          <div className="space-y-3">
            {findings.data.truncated && <Banner tone="warn" title="Rollup truncated">The server scanned its row cap; these counts are a lower bound.</Banner>}
            <DescList items={[
              { k: 'Findings', v: String(findings.data.total) },
              { k: 'Projects with findings', v: `${findings.data.engagementsWithFindings} of ${findings.data.engagements}` },
              { k: 'By severity', v: Object.entries(findings.data.bySeverity).map(([k, v]) => `${k} ${v}`).join(' · ') || 'None' },
              { k: 'By status', v: Object.entries(findings.data.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ') || 'None' },
            ]} />
          </div>
        )}
      </div>
    </Card>
  )
}

/** Durable C2 command audit and pending grants across the authorized projects. Live sessions stay per project. */
function C2Rollup(): ReactElement {
  const c2 = useRealC2Rollup()
  return (
    <Card>
      <CardHeader title="C2 command audit across your projects" sub="Durable command records and pending grants; live sessions are read per project." />
      <div className="p-4">
        {c2.isPending ? <Skeleton className="h-16" /> : c2.isError ? (
          <Banner tone="warn" title="C2 rollup unavailable">{c2.error instanceof Error ? c2.error.message : 'The rollup could not be read.'} No substitute counts are shown.</Banner>
        ) : (
          <DescList items={[
            { k: 'Pending grants', v: String(c2.data.pendingGrants) },
            { k: 'Commands by status', v: Object.entries(c2.data.commandsByStatus).map(([k, v]) => `${k} ${v}`).join(' · ') || 'None recorded' },
          ]} />
        )}
      </div>
    </Card>
  )
}

export function RealGlobalResource(): ReactElement {
  const route = useRoute()
  const surface = SURFACES[route.page]
  const projects = useRealProjects()
  const infrastructure = surface.title === 'Infrastructure'
  const tab = route.page === 'c2' ? (route.tab === 'sessions' ? 'sessions' : 'c2') : ['c2', 'sessions'].includes(route.tab ?? '') ? route.tab! : 'agents'
  const projectTab = infrastructure ? (tab === 'agents' ? 'fleet' : 'c2') : surface.tab
  return <div className="space-y-4">
    <PageHeader title={surface.title} sub="Across the projects your account is authorized to access." />
    {infrastructure && <Tabs value={tab} onChange={(next) => go('infrastructure', { tab: next })} tabs={[{ id: 'agents', label: 'Execution agents' }, { id: 'c2', label: 'C2 infrastructure' }, { id: 'sessions', label: 'Sessions' }]} />}
    {route.page === 'findings' && <FindingsRollup />}
    {infrastructure && <C2Rollup />}
    <Card>
      <CardHeader title="Global source unavailable" />
      <p className="p-4 text-sm text-muted" role="status">{surface.gap} No demo records or zero counts are substituted.</p>
    </Card>
    <Card>
      <CardHeader title="Open in a project" sub="Each link opens the owning project rather than changing the meaning of the global view." />
      <div className="space-y-2 p-4">
        {projects.list.isPending ? <p role="status">Loading projects…</p> : projects.list.isError ? <div role="alert">{projects.list.error.message}<Button onClick={() => void projects.list.refetch()}>Retry projects</Button></div>
          : !projects.list.data?.length ? <p className="text-sm text-muted">No accessible projects.</p>
            : projects.list.data.map((project) => <div key={project.id} className="flex items-center justify-between gap-3 border-b border-line py-2">
              <span className="min-w-0 truncate">{project.displayName}</span>
              <Button onClick={() => go('project', { id: project.id, tab: projectTab })}>Open project</Button>
            </div>)}
      </div>
    </Card>
  </div>
}
