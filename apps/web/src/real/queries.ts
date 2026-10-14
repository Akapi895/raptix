/**
 * Real-mode React Query reads for the bootstrap/project slice (integration
 * ticket 03). The keys embed the trusted local identity; the console read
 * seam (src/state/console.ts) consumes the mapped list so the header and
 * switcher observe the engagement API through the same hooks as mock mode.
 */
import { useMemo } from 'react'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { engagementToProject, listEngagements } from './api'
import { REAL_IDENTITY } from './identity'
import { useCapabilityReady } from './bootstrap'
import type { Project } from '../domain/entities'

export const projectKeys = {
  list: ['real', 'projects', REAL_IDENTITY.id] as const,
  detail: (id: string) => ['real', 'project', REAL_IDENTITY.id, id] as const,
}

export function invalidateProjects(client: ReturnType<typeof useQueryClient> | null): void {
  void client?.invalidateQueries({ queryKey: ['real', 'projects'] })
  void client?.invalidateQueries({ queryKey: ['real', 'project'] })
}

export function useRealProjects() {
  const { ready, reason } = useCapabilityReady('projects')
  const list = useQuery({
    queryKey: projectKeys.list,
    queryFn: () => listEngagements(),
    enabled: ready,
  })
  return { ready, reason, list }
}

/** Console-seam view: engagement DTOs mapped onto the UI Project entity. */
export function useRealProjectList(): Project[] {
  const { list } = useRealProjects()
  return useMemo(() => (list.data ?? []).map(engagementToProject), [list.data])
}
