/**
 * Tradecraft library Query binding (ticket 52, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `playbook`/`technique` entity kinds and embed the auth
 * scope at position 1, so both bridge invalidation paths reach them: any
 * committed tradecraft change (legacy review action or a later service
 * write — status, revision decision) invalidates the `[kind]` prefix — a
 * legacy playbook-state change updates these views without a reload — and a
 * persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { PlaybookDetailRead, PlaybookListQuery, PlaybookListRead, TechniqueDetailRead } from './service'

/** Feature-local key namespaces: ['playbook', scope, 'list', query] / ['playbook', scope, id] / ['technique', scope, id]. */
export const libraryKeys = {
  list: (scope: QueryScope, query: PlaybookListQuery) => consoleKeys.view('playbook', scope, 'list', query),
  playbook: (scope: QueryScope, id: string) => consoleKeys.entity('playbook', scope, id),
  technique: (scope: QueryScope, id: string) => consoleKeys.entity('technique', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class LibraryReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'LibraryReadError'
  }
}

/** Query-backed playbook library for the current auth/project scope. */
export function usePlaybookList(query: PlaybookListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.list(scope, query),
    queryFn: async (): Promise<PlaybookListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .library(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'playbooks-list' }, query)
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed playbook detail (active version, pending revision, scoped usage). */
export function usePlaybookDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.playbook(scope, id || ''),
    queryFn: async (): Promise<PlaybookDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .library(actor, scope.project)
        .getPlaybook({ actor, projectId: scope.project, corr: 'playbook-detail' }, id || '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/** Query-backed technique detail (catalog entry + scoped projections). */
export function useTechniqueDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.technique(scope, id || ''),
    queryFn: async (): Promise<TechniqueDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .library(actor, scope.project)
        .getTechnique({ actor, projectId: scope.project, corr: 'technique-detail' }, id || '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}
