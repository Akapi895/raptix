/**
 * Findings inventory Query binding (ticket 31, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `finding` entity kind and embed the auth scope at position
 * 1, so both bridge invalidation paths reach them: any committed finding
 * change (legacy action or service write) invalidates the `[kind]` prefix —
 * a legacy status change updates these views without a reload — and a
 * persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { FindingDetailRead, FindingListQuery, FindingListRead } from './service'

/** Feature-local key namespaces: ['finding', scope, 'list', query] / ['finding', scope, id]. */
export const findingKeys = {
  list: (scope: QueryScope, query: FindingListQuery) => consoleKeys.view('finding', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('finding', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class FindingReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'FindingReadError'
  }
}

/** Query-backed findings inventory for the current auth/project scope. */
export function useFindingList(query: FindingListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: findingKeys.list(scope, query),
    queryFn: async (): Promise<FindingListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .findings(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'findings-list' }, query)
      if (!res.ok) throw new FindingReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed finding detail (history, metadata and masked linked evidence). */
export function useFindingDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: findingKeys.detail(scope, id || ''),
    queryFn: async (): Promise<FindingDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .findings(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'finding-detail' }, id || '')
      if (!res.ok) throw new FindingReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}
