/**
 * Tool trace Query binding (ticket 41, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `tool-event` entity kind and embed the auth scope at
 * position 1, so both bridge invalidation paths reach them: any committed
 * tool-event change (legacy action or service write) invalidates the
 * `[kind]` prefix — a reviewer decision lands in the trace without a reload
 * — and a persona/project switch cancels the superseded scope's reads
 * before a delayed response can restore old visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { TraceListRead } from './service'

/** Feature-local key namespace: ['tool-event', scope, 'list']. */
export const traceKeys = {
  list: (scope: QueryScope) => consoleKeys.list('tool-event', scope),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class TraceReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'TraceReadError'
  }
}

/**
 * Query-backed trace rows for the current auth/project scope. Disabled in
 * the aggregate 'all' view: the trace screen renders the select-a-project
 * state there and no aggregate fetch is needed.
 */
export function useTraceEvents() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: traceKeys.list(scope),
    queryFn: async (): Promise<TraceListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .trace(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'trace-list' })
      if (!res.ok) throw new TraceReadError(res.failure)
      return res.data
    },
    enabled: !!services && scope.project !== 'all',
  })
}
