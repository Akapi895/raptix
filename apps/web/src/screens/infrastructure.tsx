/**
 * Global Infrastructure (plan 2026-10-16, slice S2).
 *
 * The one system-level surface for execution agents, C2 infrastructure and
 * session monitoring across the projects the actor can access. It composes
 * feature-owned content extracted from the agents and C2 screens — never a
 * nested page (no second header, ribbon or project-only CTA wall). Interactive
 * session access stays a project action: at global scope the sessions tab is
 * monitoring only and opens the recorded session detail.
 *
 * Tab contract (plan §3): tab IDs are `agents`, `c2`, `sessions`; a missing or
 * unknown tab opens `agents` because the tab lives in the URL, back/forward
 * and reload restore it. Legacy `#/agents` and `#/c2` URLs keep resolving
 * here at global scope through the thin adapters below — project scope keeps
 * rendering the original project pages, so no deep link changes meaning.
 */
import type { ComponentType } from 'react'
import { go, useRoute } from '../router/navigate'
import { useProjectStore } from '../state/stores'
import { PageHeader, Tabs } from '../ui/index'
import { agentRoutes, AgentsContent } from './d-agents'
import { C2InfraContent, routes as c2Routes, Sessions } from './h'

export type InfraTab = 'agents' | 'c2' | 'sessions'

const INFRA_TABS: { id: InfraTab; label: string }[] = [
  { id: 'agents', label: 'Execution agents' },
  { id: 'c2', label: 'C2 infrastructure' },
  { id: 'sessions', label: 'Sessions' },
]

/** Legacy `#/c2` tab → Infrastructure tab (plan §4.1: keep the meaning, never lose the tab). */
const C2_TAB_MAP: Record<string, InfraTab | undefined> = { infrastructure: 'c2', channels: 'c2', sessions: 'sessions', requests: 'c2', audit: 'c2' }

export function InfrastructurePage({ tab }: { tab: InfraTab }) {
  const route = useRoute()
  return (
    <>
      <PageHeader title="Infrastructure" sub="Execution agents, C2 infrastructure and session monitoring across the projects you can access. Agent here means an executor on managed hosts — not an AI specialist." />
      <Tabs tabs={INFRA_TABS} value={tab} onChange={(t) => go('infrastructure', { tab: t })} />
      <div className="mt-4">
        {tab === 'agents' && <AgentsContent initialTab={route.page === 'agents' ? route.tab : undefined} />}
        {tab === 'c2' && <C2InfraContent />}
        {tab === 'sessions' && <Sessions all monitor />}
      </div>
    </>
  )
}

function InfrastructureRoute() {
  const route = useRoute()
  const tab: InfraTab = route.tab === 'c2' || route.tab === 'sessions' ? route.tab : 'agents'
  return <InfrastructurePage tab={tab} />
}

/** Legacy `#/agents`: global scope opens Infrastructure/Execution agents; project scope keeps the project agents page. */
function AgentsCompat() {
  const pid = useProjectStore((s) => s.pid)
  if (pid === 'all') return <InfrastructurePage tab="agents" />
  const ProjectAgents = agentRoutes.agents
  return <ProjectAgents />
}

/** Legacy `#/c2`: global scope maps the requested tab; project scope keeps the project C2 page. */
function C2Compat() {
  const pid = useProjectStore((s) => s.pid)
  const route = useRoute()
  if (pid !== 'all') {
    const ProjectC2 = c2Routes.c2
    return <ProjectC2 />
  }
  return <InfrastructurePage tab={C2_TAB_MAP[route.tab ?? ''] ?? 'c2'} />
}

// eslint-disable-next-line react-refresh/only-export-components -- registry record co-located with its screen components
export const routes: Record<string, ComponentType> = {
  infrastructure: InfrastructureRoute,
  agents: AgentsCompat,
  c2: C2Compat,
}
