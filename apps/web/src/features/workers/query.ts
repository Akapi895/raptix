/**
 * AI worker Query binding (ticket 44, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The
 * worker graph keys start with the `ai-worker` entity kind (registered in the
 * bridge's collection mapping) and embed the auth scope at position 1, so a
 * runtime commit touching `aiWorkers` invalidates the mounted graph without a
 * reload, and a persona/project switch cancels the superseded scope's reads
 * before a delayed response can restore old visibility. Read-only feature —
 * there are no worker mutations in this ticket.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { WorkerListRead } from './service'

/** Feature-local key namespace: ['ai-worker', scope, 'list']. */
export const workerKeys = {
  list: (scope: QueryScope, project: string) => consoleKeys.view('ai-worker', { ...scope, project }, 'list'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class WorkerReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'WorkerReadError'
  }
}

/** Query-backed worker dependency graph for the given project in the current auth scope. */
export function useWorkers(projectId: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: workerKeys.list(scope, projectId),
    queryFn: async (): Promise<WorkerListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .workers(actor, projectId)
        .list({ actor, projectId, corr: 'worker-graph' })
      if (!res.ok) throw new WorkerReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!projectId,
  })
}
