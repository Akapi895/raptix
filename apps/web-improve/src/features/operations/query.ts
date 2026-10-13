/**
 * Operations inventory Query binding (ticket 24, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The key
 * starts with the `operation` entity kind and embeds the auth scope at
 * position 1, so both bridge invalidation paths reach it: any committed
 * operation change (legacy or service) invalidates the `[kind]` prefix, and
 * a persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { OperationListQuery, OperationListRead } from './service'

/** Feature-local key namespace: ['operation', scope, 'list', query]. */
export const operationKeys = {
  list: (scope: QueryScope, query: OperationListQuery) => consoleKeys.view('operation', scope, 'list', query),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class OperationReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
  }
}

/** Query-backed operations inventory for the current auth/project scope. */
export function useOperationList(query: OperationListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.list(scope, query),
    queryFn: async (): Promise<OperationListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .operations(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'operations-list' }, query)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
