/**
 * AI chat Query binding (ticket 38, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `conversation` entity kind and embed the auth scope at
 * position 1, so both bridge invalidation paths reach them: any committed
 * conversation change (legacy action or service write) invalidates the
 * `[kind]` prefix — a chat message lands in the workspace without a reload —
 * and a persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { ConversationListRead } from './service'

/** Feature-local key namespaces: ['conversation', scope, 'list'] / ['conversation', scope, id]. */
export const chatKeys = {
  list: (scope: QueryScope) => consoleKeys.list('conversation', scope),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('conversation', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class ChatReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ChatReadError'
  }
}

/**
 * Query-backed conversation workspace for the current auth/project scope.
 * `opts.enabled` (ticket 60): the copilot drawer fetches only while open —
 * a closed drawer neither fetches nor keeps an active subscription, and the
 * ChangeSet bridge still marks the entry stale so opening refetches.
 */
export function useConversationList(opts?: { enabled?: boolean }) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: chatKeys.list(scope),
    queryFn: async (): Promise<ConversationListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .chat(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'chat-list' })
      if (!res.ok) throw new ChatReadError(res.failure)
      return res.data
    },
    enabled: (opts?.enabled ?? true) && !!services,
  })
}
