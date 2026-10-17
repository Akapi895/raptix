/**
 * Notice center Query binding (ticket 59, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The list
 * view starts with the `notice` entity kind and embeds the auth scope at
 * position 1, so every committed notice change — this service's writes and
 * every legacy `A.notify`/submission that produces a notice — invalidates the
 * `['notice']` prefix through the ChangeSet bridge and the header badge and
 * popover refetch without a reload. Keys embed the full scope, so a persona
 * switch reads a different cache entry while the ScopeCancelBridge cancels
 * the superseded scope's reads before a late response can restore its
 * visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { NoticeListRead } from './service'

/** Feature-local key namespaces: ['notice', scope, 'list']. */
export const noticeKeys = {
  list: (scope: QueryScope) => consoleKeys.view('notice', scope, 'list'),
}

/** A service failure rethrown as the query error, so the popover renders the kind and message. */
export class NoticeReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'NoticeReadError'
  }
}

/**
 * Query-backed persona-scoped notification list for the header badge and
 * popover. The actor comes from the canonical persona projection, so a role
 * override committed in settings applies to the notice gate immediately.
 */
export function useNotices() {
  const services = useServices()
  const scope = useQueryScope()
  const me = useMe()
  return useQuery({
    queryKey: noticeKeys.list(scope),
    queryFn: async (): Promise<NoticeListRead> => {
      const actor = { id: me.name, role: me.role }
      const res = await services
        .notices(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'notice-list' })
      if (!res.ok) throw new NoticeReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
