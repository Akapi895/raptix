/** Global resource navigation without pretending scoped APIs are aggregate sources. */
import type { ReactElement } from 'react'
import { useRealProjects } from '../queries'
import { go, useRoute } from '../../router/navigate'
import { Button, Card, CardHeader, PageHeader, Tabs } from '../../ui'

const SURFACES: Record<string, { title: string; tab: string; gap: string }> = {
  findings: { title: 'Findings', tab: 'findings', gap: 'A cross-project finding list is not integrated. The overview rollup is a count, not a finding inventory.' },
  reports: { title: 'Reports', tab: 'reports', gap: 'A cross-project report catalog is not integrated. Reports remain available in their owning projects.' },
  operations: { title: 'Operations', tab: 'operations', gap: 'A cross-project runtime run list is not integrated. Open a project to inspect its observed runs.' },
  analysis: { title: 'Attack Analysis', tab: 'analysis', gap: 'Cross-project coverage is not integrated. Project analysis uses its own observed graph source.' },
  infrastructure: { title: 'Infrastructure', tab: 'fleet', gap: 'Global execution-agent inventory, C2 infrastructure and live session monitoring are not integrated. Durable command audit counts are available in System Overview.' },
  agents: { title: 'Infrastructure', tab: 'fleet', gap: 'Global execution-agent inventory is not integrated. Project fleet observations are available separately.' },
  c2: { title: 'Infrastructure', tab: 'c2', gap: 'Global live C2 sessions are not integrated. Open the owning project for provider-backed session data.' },
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
