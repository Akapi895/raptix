/**
 * ATT&CK coverage Query binding (ticket 54, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The key
 * starts with the `operation` entity kind — the coverage read model derives
 * from recorded canonical operations — so any committed operation change
 * (legacy action or service write) invalidates the `[kind]` prefix and
 * refetches the matrix without a reload; finding changes reach it through
 * the bridge's project-scope invalidation. The key embeds the auth scope at
 * position 1, so a persona/project switch reads a different cache entry and
 * the ScopeCancelBridge cancels the superseded scope's in-flight reads
 * before a delayed response can restore old visibility.
 *
 * Ticket 55 appends the attack-path graph hook (`useAttackPath`) with the
 * same key shape: operation/step commits invalidate the shared `[kind]`
 * prefix, so a legacy step review updates the graph without a reload.
 */
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { AnalysisCoverageQuery, AnalysisCoverageRead } from './service'
import type { AttackPathQuery, AttackPathRead } from './path'

/** Feature-local key namespace: ['operation', scope, 'coverage', query]. */
export const analysisKeys = {
  coverage: (scope: QueryScope, query: AnalysisCoverageQuery) => consoleKeys.view('operation', scope, 'coverage', query),
  /** Ticket 55: ['operation', scope, 'path', query] — operation-kind commits invalidate the shared prefix. */
  path: (scope: QueryScope, query: AttackPathQuery) => consoleKeys.view('operation', scope, 'path', query),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class AnalysisReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AnalysisReadError'
  }
}

/** Query-backed ATT&CK coverage + detection heatmap for the current auth/project scope. */
export function useAnalysisCoverage(query: AnalysisCoverageQuery) {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  const { opId, agent, os } = query
  /* The coverage read also derives from the detection-source state. Legacy
   * integration commits publish the `integration` kind without a project
   * identity, which the shared bridge's kind/project invalidation cannot
   * match to this feature's `operation`-prefixed key, so this hook observes
   * those commits locally. A stale detected/undetected heat after the source
   * disconnects would misstate observed outcomes, so the refetch is required
   * for correctness, not cosmetics. */
  useEffect(() => {
    if (!services) return
    return services.subscribe((cs) => {
      if (cs.corr !== 'reset' && cs.entities.some((e) => e.kind === 'integration')) {
        client.invalidateQueries({ queryKey: analysisKeys.coverage(scope, { opId, agent, os }) })
      }
    })
  }, [services, client, scope, opId, agent, os])
  return useQuery({
    queryKey: analysisKeys.coverage(scope, { opId, agent, os }),
    queryFn: async (): Promise<AnalysisCoverageRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .analysis(actor, scope.project)
        .coverage({ actor, projectId: scope.project, corr: 'analysis-coverage' }, { opId, agent, os })
      if (!res.ok) throw new AnalysisReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Query-backed attack-path graph for the current auth/project scope
 * (ticket 55). Same key shape as the coverage read — the `operation` kind
 * prefix means any committed operation/step change (legacy review actions
 * included) invalidates the graph, and finding changes arrive through the
 * bridge's project-scope invalidation; scope sits at key position 1 so the
 * ScopeCancelBridge cancels superseded in-flight reads.
 */
export function useAttackPath(query: AttackPathQuery) {
  const services = useServices()
  const scope = useQueryScope()
  const { opId, agent, os } = query
  return useQuery({
    queryKey: analysisKeys.path(scope, { opId, agent, os }),
    queryFn: async (): Promise<AttackPathRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .analysis(actor, scope.project)
        .path({ actor, projectId: scope.project, corr: 'analysis-path' }, { opId, agent, os })
      if (!res.ok) throw new AnalysisReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
