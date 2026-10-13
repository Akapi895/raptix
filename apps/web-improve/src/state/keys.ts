/**
 * Query keys and scope helpers for the console Query layer (ticket 05,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Every console Query key embeds the request scope — actor id, authorization
 * role and active project — at position 1, so a persona or project switch
 * reads a different cache entry and can never observe another scope's data.
 * The change bridge (query.tsx) predicates invalidation and cancellation on
 * that scope object.
 */
import { useMemo } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { USERS, type Role } from '../data'
import type { EntityKind } from '../domain/service'
import { useAuthStore, useProjectStore } from './stores'

/** Actor/authorization/project scope embedded in every console Query key. */
export interface QueryScope {
  actor: string
  role: Role
  /** Active project id; 'all' is the aggregate all-projects view. */
  project: string
}

/** Reads the scope Query keys are built from; updates with persona/project. */
export function useQueryScope(): QueryScope {
  const meName = useAuthStore((s) => s.meName)
  const pid = useProjectStore((s) => s.pid)
  const role = USERS.find((u) => u.name === meName)?.role ?? 'viewer'
  return useMemo(() => ({ actor: meName, role, project: pid }), [meName, role, pid])
}

/** Key builders — the scope object sits at position 1 for the bridge. */
export const consoleKeys = {
  entity: (kind: EntityKind, scope: QueryScope, id: string) => [kind, scope, id] as const,
  list: (kind: EntityKind, scope: QueryScope) => [kind, scope, 'list'] as const,
  view: (name: string, scope: QueryScope, ...parts: unknown[]) => [name, scope, ...parts] as const,
}

/** Extracts the embedded scope from a Query key, or undefined for foreign keys. */
export function scopeOf(query: { queryKey: readonly unknown[] }): QueryScope | undefined {
  const at = query.queryKey[1]
  if (at && typeof at === 'object' && 'actor' in at && 'project' in at) return at as QueryScope
  return undefined
}

/** Query client tuned for the demo: no retries/refocus, cache drops when unobserved. */
export function createConsoleQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}
