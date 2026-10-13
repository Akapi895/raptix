/**
 * Operation results/graph Query binding (ticket 30, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The key
 * starts with the `operation` entity kind and embeds the auth scope at
 * position 1, so a committed operation change — a legacy execution event as
 * well as a service write — invalidates the mounted results/graph read
 * through the bridge, a persona/project switch reads a different entry and
 * the superseded scope's in-flight read is cancelled before a delayed
 * response can restore old visibility. Project-scoped changes that do not
 * touch operations (evidence, sessions, branches) reach the key through the
 * bridge's project predicate.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { OperationResultsRead } from './service'

/** Feature-local key namespace: ['operation', scope, 'results', id]. */
export const resultKeys = {
  detail: (scope: QueryScope, id: string) => consoleKeys.view('operation', scope, 'results', id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class ResultsReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ResultsReadError'
  }
}

/** Query-backed results/graph read for one operation in the current auth/project scope. */
export function useOperationResults(id: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: resultKeys.detail(scope, id),
    queryFn: async (): Promise<OperationResultsRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .results(actor, scope.project)
        .detail({ actor, projectId: scope.project, corr: 'operation-results' }, id)
      if (!res.ok) throw new ResultsReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}
