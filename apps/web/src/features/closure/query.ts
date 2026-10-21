/**
 * Closure query binding (plan P09, Closure slice). The checklist and record are
 * read through ClosureService for the engagement the tab is bound to; a request
 * or a decision refreshes them. The closure checklist is the source's own read,
 * so a condition the source cannot read stays blocked.
 */
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { ClosureRead, ClosureRecordView, ClosureRequestInput } from './service'

export class ClosureError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ClosureError'
  }
}

const ctxOf = (scope: QueryScope, projectId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId, corr })

export function useClosureRead(projectId: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('closure', scope, projectId, 'read'),
    queryFn: async (): Promise<ClosureRead> => {
      const res = await services.closure(actorRef(scope.actor, scope.role), projectId).read(ctxOf(scope, projectId, 'closure-read'))
      if (!res.ok) throw new ClosureError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

export function useClosureWrites(projectId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  return useMemo(() => {
    const svc = () => services.closure(actorRef(scope.actor, scope.role), projectId)
    const refresh = async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['closure'] })
      await client.invalidateQueries({ queryKey: ['approvals'] })
    }
    return {
      request: async (input: ClosureRequestInput): Promise<ClosureRecordView> => {
        const res = await svc().request(ctxOf(scope, projectId, 'closure-request'), input)
        if (!res.ok) throw new ClosureError(res.failure)
        await refresh()
        return res.data
      },
      decide: async (decision: 'confirmed' | 'rejected' | 'cancelled', reason: string): Promise<ClosureRecordView | null> => {
        const res = await svc().decide(ctxOf(scope, projectId, 'closure-decide'), decision, reason)
        if (!res.ok) throw new ClosureError(res.failure)
        await refresh()
        return res.data
      },
    }
  }, [services, scope, client, projectId])
}
