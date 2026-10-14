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
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { ConversationListRead } from './service'
import type { ActorType, AiHistoryRead, HistoryAuditRow, HistoryQuery } from './history'

/** Feature-local key namespaces: ['conversation', scope, 'list'] / ['conversation', scope, id]. */
export const chatKeys = {
  list: (scope: QueryScope) => consoleKeys.list('conversation', scope),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('conversation', scope, id),
}

/**
 * Feature-local history key namespace: ['ai-history', scope, …filters].
 * The embedded scope keeps a persona/project switch on its own cache entry;
 * every commit that touches the project (a pin, a revision's chat card, a
 * decision's audit row) carries the project id, so the change bridge's
 * project predicate invalidates this view and the archive refetches.
 */
export const historyKeys = {
  view: (scope: QueryScope, q: string, actorType: string, aiOnly: boolean, page: number) =>
    consoleKeys.view('ai-history', scope, q, actorType, aiOnly, page),
  /** Audit detail: under the 'audit' entity kind, so audit commits invalidate it. */
  audit: (scope: QueryScope, id: string) => consoleKeys.entity('audit', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class ChatReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ChatReadError'
  }
}

/** The history read's failure surfaced the same way. */
export class AiHistoryReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AiHistoryReadError'
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

/**
 * Query-backed conversation history for the current auth/project scope
 * (ticket 42): search/actor/scope/page are part of the key, and the read is
 * disabled in the aggregate 'all' view (the screen renders select-a-project).
 */
export function useAiHistory(query: HistoryQuery = {}) {
  const services = useServices()
  const scope = useQueryScope()
  const { q = '', actorType = 'all' as ActorType | 'all', aiOnly = false, page } = query
  return useQuery({
    queryKey: historyKeys.view(scope, q, actorType, aiOnly, page?.page ?? 1),
    queryFn: async (): Promise<AiHistoryRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .aiHistory(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'ai-history' }, query)
      if (!res.ok) throw new AiHistoryReadError(res.failure)
      return res.data
    },
    enabled: !!services && scope.project !== 'all',
  })
}

/**
 * Query-backed audit inspector row (ticket 42): one scope-checked audit
 * event with its same-correlation related events; audit commits refetch it.
 */
export function useAiAudit(id: string | undefined) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: historyKeys.audit(scope, id ?? ''),
    queryFn: async (): Promise<HistoryAuditRow> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .aiHistory(actor, scope.project)
        .getAudit({ actor, projectId: scope.project, corr: 'ai-history-audit' }, id!)
      if (!res.ok) throw new AiHistoryReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id && scope.project !== 'all',
  })
}
