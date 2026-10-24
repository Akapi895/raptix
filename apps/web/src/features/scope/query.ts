/**
 * Scope and ROE query binding (plan P09, Scope slice). Reads and writes go
 * through ScopeService. A committed revision or decision changes what the
 * effective scope is, so it invalidates the scope keys and the asset keys that
 * classify assets against the approved scope.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../domain/actor'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { ScopeRead, ScopeRevision, ScopeSubmitInput } from './service'

export class ScopeError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ScopeError'
  }
}

const ctxOf = (scope: QueryScope, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })

export function useScopeRead() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('scope', scope, 'read'),
    queryFn: async (): Promise<ScopeRead> => {
      const res = await services.scope(actorRef(scope.actor, scope.role), scope.project).read(ctxOf(scope, 'scope-read'))
      if (!res.ok) throw new ScopeError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Writes resolve to the committed revision or throw a ScopeError carrying the handler's reason. */
export function useScopeWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  const svc = () => services.scope(actorRef(scope.actor, scope.role), scope.project)
  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['scope'] })
    await client.invalidateQueries({ queryKey: ['asset'] })
  }
  return {
    submit: async (input: ScopeSubmitInput): Promise<ScopeRevision> => {
      const res = await svc().submit(ctxOf(scope, 'scope-submit'), input)
      if (!res.ok) throw new ScopeError(res.failure)
      await refresh()
      return res.data
    },
    decide: async (revisionId: string, decision: 'approved' | 'rejected', comment?: string): Promise<ScopeRevision> => {
      const res = await svc().decide(ctxOf(scope, 'scope-decide'), revisionId, decision, comment)
      if (!res.ok) throw new ScopeError(res.failure)
      await refresh()
      return res.data
    },
  }
}
