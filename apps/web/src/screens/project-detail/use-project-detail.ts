/**
 * Project detail Query hook (ticket 20).
 *
 * One canonical detail read per URL: the Query key embeds the request scope
 * (actor, role, the route's project — the scope the read was made under), so
 * a persona switch reads a different cache entry, the ChangeSet bridge
 * refetches after committed mutations to that project, and the
 * ScopeCancelBridge supersedes the stale read before it can restore previous
 * visibility. Keying on the route project (not the switcher selection) keeps
 * the switcher sync from refetching an identical view.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope } from '../../state/keys'
import { projectDetailForScope } from './service'
import type { ProjectDetail } from './service'
import { ServiceReadError } from '../portfolio-handlers'

export interface ProjectDetailView {
  data?: ProjectDetail
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

/** Canonical detail read for the detail URL's project. */
export function useProjectDetail(id: string | undefined): ProjectDetailView {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useMemo(() => actorRef(scope.actor, scope.role), [scope.actor, scope.role])
  const requestScope = useMemo(() => ({ ...scope, project: id ?? '' }), [scope, id])
  const q = useQuery({
    queryKey: consoleKeys.view('project-detail', requestScope, id ?? ''),
    queryFn: async ({ signal }) => {
      const res = await projectDetailForScope(services, actor, id ?? '')
        .read({ actor, projectId: id ?? '', corr: 'project-detail' }, signal)
      if (!res.ok) throw new ServiceReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
  return { data: q.data, isPending: q.isPending, isError: q.isError, error: q.error, refetch: () => { void q.refetch() } }
}
