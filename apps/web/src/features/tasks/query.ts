/**
 * Real task inbox read shared by the command center and the global search. Both screens use one cache entry, so a read
 * made by either one answers the other; each caller sets its own polling or enablement.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchTasks } from '../overview/remote'

export function useRealTaskInbox(options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ['real', 'tasks'], queryFn: () => fetchTasks(), ...options })
}
