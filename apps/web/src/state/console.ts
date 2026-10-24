/**
 * Canonical console read seam (ticket 67 enabler D — ADR-0067).
 *
 * The component-facing identity, project, scope and permission derivations
 * that screens need synchronously alongside the feature Query hooks. Feature
 * data (lists, details, aggregate views) flows through the feature-local Query
 * read models (ADR-0067); components never read the server through this module.
 */
import { useCallback, useMemo } from 'react'
import { type Project } from '../domain/entities'
import type { Persona } from '../domain/persona'
import { can as policyCan, readOnlyContext } from '../domain/policy'
import type { CanAction } from '../domain/permissions'
import { useSession } from '../platform/session'
import { useRealMembershipRole, useRealProjectList } from '../features/projects/query'
import { REAL_CONTROL_GAPS } from '../platform/control-gaps'
import { REAL_PERSONA } from './real-identity'
import { useProjectStore } from './stores'

/** Why a control is absent in real mode (ADR-0084 control-gap registry); screens render the reason in place of the control. */
export function realControlGap(id: string): string | null {
  return REAL_CONTROL_GAPS[id] ?? null
}

export type { Persona } from '../domain/persona'

/**
 * The signed-in actor's persona, or the trusted local operator until a session resolves (D1). The persona only feeds the
 * shared policy helpers for UI hints — the server enforces every real authorization.
 */
export function useMe(): Persona {
  const { session } = useSession()
  const pid = useProjectStore((s) => s.pid)
  const membershipRole = useRealMembershipRole(pid === 'all' ? '' : pid, session?.actor?.id)
  if (!session?.actor) return REAL_PERSONA
  return { name: session.actor.displayName, email: session.actor.username, role: membershipRole ?? 'viewer' }
}

/** The projects the signed-in actor can access; the server returns only those (the one membership rule, ticket 06). */
export function usePolicyProjects(): Project[] {
  return useRealProjectList()
}

/** Every project the persona can access. */
export function useAccessible(): Project[] {
  return usePolicyProjects()
}

/** The active project object for the selected pid ('all' selects none). */
export function useActiveProject(): Project | null {
  const projects = usePolicyProjects()
  const pid = useProjectStore((s) => s.pid)
  return useMemo(() => (pid !== 'all' ? projects.find((p) => p.id === pid) || null : null), [projects, pid])
}

/**
 * The G-12 scope filter: in specific-project mode a non-member read is
 * denied wholesale; 'all' aggregates only accessible projects.
 */
export function useScoped<T extends { projectId: string }>(): (arr: T[]) => T[] {
  const accessible = useAccessible()
  const pid = useProjectStore((s) => s.pid)
  return useMemo(() => {
    const ids = new Set(accessible.map((p) => p.id))
    return (arr: T[]) => {
      if (pid !== 'all' && !ids.has(pid)) return [] as T[]
      return arr.filter((x) => (pid === 'all' ? ids.has(x.projectId) || x.projectId === '' : x.projectId === pid))
    }
  }, [accessible, pid])
}

/** The role/context permission decision for the current persona + project. */
export function useCan(): (a: CanAction, projectId?: string) => boolean {
  const projects = usePolicyProjects()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  return useCallback(
    (a: CanAction, projectId?: string) =>
      policyCan({ id: me.name, role: me.role }, a, projects.find((x) => x.id === (projectId || pid))),
    [projects, me, pid],
  )
}

/** The read-only context decision (closed/cancelled projects) for the current persona. */
export function useReadOnly(): (projectId?: string) => boolean {
  const projects = usePolicyProjects()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  return useCallback(
    (projectId?: string) =>
      readOnlyContext(projects.find((x) => x.id === (projectId || pid)), { id: me.name, role: me.role }),
    [projects, me, pid],
  )
}
