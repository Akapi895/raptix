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
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { USERS, type Db, type Project } from '../data'
import { can as policyCan, projectAccessible, readOnlyContext } from '../auth/policy'
import type { CanAction } from '../domain/permissions'
import { useServices } from './services'
import { useAuthStore, useProjectStore } from './stores'

/** A seeded console persona (the org settings can override the role). */
export type Persona = (typeof USERS)[number]

function useSubscribe(): (cb: () => void) => () => void {
  const services = useServices()
  return useCallback((cb: () => void) => (services ? services.authority.subscribe(cb) : () => {}), [services])
}

/** The one database authority snapshot (replaced atomically per commit). */
export function useDb(): Db {
  const services = useServices()
  const subscribe = useSubscribe()
  return useSyncExternalStore(subscribe, () => services.authority.snapshot())
}

/** The override-aware persona: the seeded identity with the settings-committed org role (ticket 56). */
export function useMe(): Persona {
  const meName = useAuthStore((s) => s.meName)
  const db = useDb()
  return useMemo(() => {
    const base = USERS.find((u) => u.name === meName)!
    const ov = db.org.members[meName]?.role
    return ov ? { ...base, role: ov } : base
  }, [db, meName])
}

/** Every project the persona can access (the one membership rule, ticket 06). */
export function useAccessible(): Project[] {
  const db = useDb()
  const me = useMe()
  return useMemo(
    () => db.projects.filter((p) => projectAccessible(p, { id: me.name, role: me.role })),
    [db, me],
  )
}

/** The active project object for the selected pid ('all' selects none). */
export function useActiveProject(): Project | null {
  const db = useDb()
  const pid = useProjectStore((s) => s.pid)
  return useMemo(() => (pid !== 'all' ? db.projects.find((p) => p.id === pid) || null : null), [db, pid])
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
  const db = useDb()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  return useCallback(
    (a: CanAction, projectId?: string) =>
      policyCan({ id: me.name, role: me.role }, a, db.projects.find((x) => x.id === (projectId || pid))),
    [db, me, pid],
  )
}

/** The read-only context decision (closed/cancelled projects) for the current persona. */
export function useReadOnly(): (projectId?: string) => boolean {
  const db = useDb()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  return useCallback(
    (projectId?: string) =>
      readOnlyContext(db.projects.find((x) => x.id === (projectId || pid)), { id: me.name, role: me.role }),
    [db, me, pid],
  )
}
