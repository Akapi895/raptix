/**
 * Canonical console read seam (ticket 67 enabler D — ADR-0067).
 *
 * The legacy store context (src/store.tsx) derives its data surface from the
 * one database authority: the db projection, the override-aware persona, the
 * accessible projects, the G-12 scope filter and the policy decisions. Those
 * derivations live here as the one component-facing read seam, so consumers
 * can leave the store context without changing what they observe — same
 * authority, same derivations, same synchronous render behavior.
 *
 * Feature data (lists, details, aggregate views) keeps flowing through the
 * feature-local Query read models (ADR-0067); this seam covers only the
 * identity/project/scope/permission derivations that screens need
 * synchronously alongside them. Components never touch the authority
 * directly — this module and the feature Query hooks are the two read paths.
 *
 * Integration ticket 03 (ADR-0068): DATA_MODE is a module constant resolved
 * once per page load, so every mode branch below has a stable hook order for
 * the lifetime of the page — the rules-of-hooks suppression is keyed on that
 * invariant, not on runtime state.
 */
/* eslint-disable react-hooks/rules-of-hooks -- mode branches are keyed on the module-constant DATA_MODE */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Db } from '../demo/seed';
import { type Project } from '../domain/entities'
import { readPersona, readPolicyProjects, type Persona } from '../auth/identity'
import { can as policyCan, projectAccessible, readOnlyContext } from '../domain/policy'
import type { CanAction } from '../domain/permissions'
import { DATA_MODE } from './mode'
import { REAL_PERSONA } from '../real/identity'
import { useSession } from '../platform/session'
import { useRealMembershipRole, useRealProjectList } from '../features/projects/query'
import { REAL_CONTROL_GAPS } from '../real/service-adapter/control-gaps'
import { useServices, useServicesOrNull } from './services'
import { useAuthStore, useProjectStore } from './stores'

/**
 * Why a control is absent in real mode (ADR-0084 control-gap registry). Null in
 * mock mode and for every control the real backend supports; screens render
 * the reason in place of the control instead of simulating it.
 */
export function realControlGap(id: string): string | null {
  return DATA_MODE === 'real' ? REAL_CONTROL_GAPS[id] ?? null : null
}

/** A seeded console persona (the org settings can override the role). */
export type { Persona } from '../auth/identity'

function useSubscribe(): (cb: () => void) => () => void {
  if (DATA_MODE === 'real') return useCallback(() => () => {}, [])
  const services = useServicesOrNull()
  return useCallback((cb: () => void) => (services ? services.authority.subscribe(cb) : () => {}), [services])
}

/**
 * The one database authority snapshot (replaced atomically per commit).
 * Real mode has no demo database projection — surfaces that need one are not
 * integrated yet and fail fast instead of observing demo data (ADR-0068).
 */
export function useDb(): Db {
  if (DATA_MODE === 'real') {
    throw new Error('The demo database projection is unavailable in real mode — this surface is not integrated with the real backend yet.')
  }
  const services = useServices()
  const subscribe = useSubscribe()
  return useSyncExternalStore(subscribe, () => services.authority.snapshot())
}

/**
 * The override-aware persona in mock mode; the trusted local operator in
 * real mode (D1). The real persona only feeds the shared policy helpers for
 * UI hints — the server enforces every real authorization.
 */
export function useMe(): Persona {
  if (DATA_MODE === 'real') {
    const { session } = useSession()
    const pid = useProjectStore((s) => s.pid)
    const membershipRole = useRealMembershipRole(pid === 'all' ? '' : pid, session?.actor?.id)
    if (!session?.actor) return REAL_PERSONA
    return { name: session.actor.displayName, email: session.actor.username, role: membershipRole ?? 'viewer' }
  }
  const meName = useAuthStore((s) => s.meName)
  const services = useServices()
  const subscribe = useSubscribe()
  return useSyncExternalStore(subscribe, () => readPersona(services, meName))
}

export function usePolicyProjects(): Project[] {
  if (DATA_MODE === 'real') return useRealProjectList()
  const services = useServices()
  const subscribe = useSubscribe()
  return useSyncExternalStore(subscribe, () => readPolicyProjects(services))
}

/** Every project the persona can access (the one membership rule, ticket 06). */
export function useAccessible(): Project[] {
  const projects = usePolicyProjects()
  const me = useMe()
  return useMemo(
    () => DATA_MODE === 'real' ? projects : projects.filter((p) => projectAccessible(p, { id: me.name, role: me.role })),
    [projects, me],
  )
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
