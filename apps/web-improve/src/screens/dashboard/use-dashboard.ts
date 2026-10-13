/**
 * Command Center Query hooks (ticket 14).
 *
 * One aggregate read per scope: the Query key embeds the shared auth/project
 * scope (ticket 05), so a persona or project switch reads a different cache
 * entry, the ScopeCancelBridge cancels the superseded fetch, and the
 * ChangeSetBridge refetches after every committed mutation that touches the
 * scope's project or the aggregate view. Navigation goes through the active
 * data router (ticket 07) — the single location writer.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope } from '../../state/keys'
import { toHref } from '../../router/history'
import { dashboardForScope } from './service'
import type { DashboardAggregate } from './domain'

export interface DashboardView {
  data?: DashboardAggregate
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  /** Absolute factory-clock instant for display-only derivations. */
  now: number
}

/** Aggregate dashboard read for the active auth/project scope. */
export function useDashboard(): DashboardView {
  const services = useServices()
  const scope = useQueryScope()
  const projectId = scope.project === 'all' ? '' : scope.project
  const q = useQuery({
    queryKey: consoleKeys.view('dashboard', scope),
    queryFn: async ({ signal }) => {
      const res = await dashboardForScope(services, actorRef(scope.actor), projectId)
        .read({ actor: actorRef(scope.actor), projectId, corr: 'dashboard' }, signal)
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    },
    enabled: !!services,
  })
  return { data: q.data, isPending: q.isPending, isError: q.isError, error: q.error, refetch: () => { void q.refetch() }, now: services.clock.now() }
}

export type ConsoleGo = (page: string, opts?: { id?: string; tab?: string }) => void

/** Navigates through the active data router and scrolls the shell pane to the top. */
export function useConsoleGo(): ConsoleGo {
  const navigate = useNavigate()
  return (page, opts) => {
    navigate(toHref({ page, id: opts?.id, tab: opts?.tab }))
    document.querySelector('main')?.scrollTo?.(0, 0)
  }
}
