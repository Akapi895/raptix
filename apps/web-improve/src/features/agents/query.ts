/**
 * Agent fleet Query binding (ticket 48, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `agent` entity kind and embed the auth scope at position 1,
 * so both bridge invalidation paths reach them: any committed agent change
 * (legacy action or service write — status, reservation, assignment)
 * invalidates the `[kind]` prefix — a legacy agent-state change updates
 * these views without a reload — and a persona/project switch cancels the
 * superseded scope's reads before a delayed response can restore old
 * visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { AgentDetailRead, AgentListQuery, AgentListRead } from './service'

/** Feature-local key namespaces: ['agent', scope, 'list', query] / ['agent', scope, id]. */
export const agentKeys = {
  list: (scope: QueryScope, query: AgentListQuery) => consoleKeys.view('agent', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('agent', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class AgentReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AgentReadError'
  }
}

/** Query-backed agent fleet for the current auth/project scope. */
export function useAgentList(query: AgentListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: agentKeys.list(scope, query),
    queryFn: async (): Promise<AgentListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .agents(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'agents-list' }, query)
      if (!res.ok) throw new AgentReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed agent detail (observed health, capabilities, history). */
export function useAgentDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: agentKeys.detail(scope, id || ''),
    queryFn: async (): Promise<AgentDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .agents(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'agent-detail' }, id || '')
      if (!res.ok) throw new AgentReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}
