/**
 * Real-mode React Query reads for the bootstrap/project slice (integration
 * ticket 03). The keys embed the trusted local identity; the console read
 * seam (src/state/console.ts) consumes the mapped list so the header and
 * switcher observe the engagement API through the same hooks as mock mode.
 */
import { useMemo } from 'react'
import { useQuery, type useQueryClient } from '@tanstack/react-query'
import { engagementToProject, fetchMembers, listEngagements } from './api'
import { REAL_IDENTITY } from './identity'
import { useCapabilityReady } from './bootstrap'
import type { Project, Role } from '../domain/entities'

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

const MEMBERSHIP_ROLE: Readonly<Record<string, Role>> = { owner: 'manager', operator: 'operator', reviewer: 'reviewer', viewer: 'viewer' }

/**
 * The actor's role in one engagement from its persisted membership. Null while
 * unknown; callers treat unknown as the least-privileged role so the console
 * never shows a write control the server would refuse.
 */
export function useRealMembershipRole(engagementId: string, actorId: string | undefined): Role | null {
  const { ready } = useCapabilityReady('members')
  const members = useQuery({
    queryKey: ['real', 'members', REAL_IDENTITY.id, engagementId],
    queryFn: () => fetchMembers(engagementId),
    enabled: ready && engagementId !== '' && !!actorId,
    staleTime: 30_000,
  })
  const row = members.data?.members.find((m) => m.id === actorId)
  return row ? (MEMBERSHIP_ROLE[row.role] ?? 'viewer') : null
}
