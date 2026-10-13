/**
 * My Tasks Query hooks (ticket 15).
 *
 * One aggregate inbox read per scope: the Query key embeds the shared
 * auth/project scope (ticket 05), so a persona or project switch reads a
 * different cache entry, the ScopeCancelBridge cancels the superseded fetch,
 * and the ChangeSetBridge refetches after every committed mutation that
 * touches the scope's project or the aggregate view — creating or deciding
 * an approval in either UI updates the inbox without reload.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope } from '../../state/keys'
import { tasksForScope } from './service'
import type { TasksData } from './service'

export interface TasksView {
  data?: TasksData
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  /** Absolute factory-clock instant for display-only derivations (countdowns). */
  now: number
}

/** Aggregate inbox read for the active auth/project scope. */
export function useTasks(): TasksView {
  const services = useServices()
  const scope = useQueryScope()
  const projectId = scope.project === 'all' ? '' : scope.project
  const q = useQuery({
    queryKey: consoleKeys.view('tasks', scope),
    queryFn: async ({ signal }) => {
      const res = await tasksForScope(services, actorRef(scope.actor), projectId)
        .read({ actor: actorRef(scope.actor), projectId, corr: 'tasks' }, signal)
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    },
    enabled: !!services,
  })
  return { data: q.data, isPending: q.isPending, isError: q.isError, error: q.error, refetch: () => { void q.refetch() }, now: services.clock.now() }
}
