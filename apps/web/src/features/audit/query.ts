/**
 * Engagement audit query binding (plan P09, Vault/Audit slice). The read goes
 * through AuditService and is keyed by the auth scope, so a persona or project
 * switch reads its own entries.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { AuditQuery, AuditRead } from './service'

export class AuditError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AuditError'
  }
}

const ctxOf = (scope: QueryScope, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })

export function useAuditRead(query: AuditQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('audit', scope, 'read', query),
    queryFn: async (): Promise<AuditRead> => {
      const res = await services.audit(actorRef(scope.actor, scope.role), scope.project).read(ctxOf(scope, 'audit-read'), query)
      if (!res.ok) throw new AuditError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
