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
import { useMemo } from 'react'
import { actorRef } from '../../domain/actor'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { ToolDecision, ToolDecisionOutcome } from './writes'
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
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .trace(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'trace-list' })
      if (!res.ok) throw new TraceReadError(res.failure)
      return res.data
    },
    enabled: !!services && scope.project !== 'all',
  })
}

/**
 * Write-side binding (ticket 42): the typed HITL decision for the current
 * scope. The call captures actor/project at call time — a persona or
 * project switch never retargets an in-flight write — and a committed
 * decision publishes one `tool-event` ChangeSet the bridge turns into
 * trace/facet refetches (and the legacy store observes the same commit).
 * Callers resolve the explicit ServiceResult: a refused decision never
 * commits, and the message is safe to render.
 */
export function useTraceWrites() {
  const services = useServices()
  const scope = useQueryScope()
  return useMemo(() => {
    const actor = actorRef(scope.actor, scope.role)
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    return {
      decide: (id: string, decision: ToolDecision, reason: string): Promise<ServiceResult<ToolDecisionOutcome>> =>
        services.trace(actor, scope.project).decide(ctx('tool-decision'), id, decision, reason),
    }
  }, [services, scope.actor, scope.role, scope.project])
}
