/**
 * Operations inventory Query binding (ticket 24, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The key
 * starts with the `operation` entity kind and embeds the auth scope at
 * position 1, so both bridge invalidation paths reach it: any committed
 * operation change (legacy or service) invalidates the `[kind]` prefix, and
 * a persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure, ServiceResult } from '../../domain/service'
import type { OperationDraftInput, OperationDraftOptions, OperationDraftPatch, OperationListQuery, OperationListRead, OperationWriteRead } from './service'

/** Feature-local key namespace: ['operation', scope, 'list', query]. */
export const operationKeys = {
  list: (scope: QueryScope, query: OperationListQuery) => consoleKeys.view('operation', scope, 'list', query),
  draftOptions: (scope: QueryScope, forOperation?: string) => consoleKeys.view('operation', scope, 'draft-options', forOperation ?? ''),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class OperationReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
  }
}

/** Query-backed operations inventory for the current auth/project scope. */
export function useOperationList(query: OperationListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.list(scope, query),
    queryFn: async (): Promise<OperationListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .operations(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'operations-list' }, query)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/* ── Ticket 25: wizard option read + creation/edit/schedule writes. ── */

let corrSeq = 0
const corr = (act: string) => `${act}-${++corrSeq}`

/** Scoped wizard selections (approved playbooks, eligible agents, in-scope assets) for the active project. */
export function useOperationDraftOptions(forOperation?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.draftOptions(scope, forOperation),
    queryFn: async (): Promise<OperationDraftOptions> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .operations(actor, scope.project)
        .draftOptions({ actor, projectId: scope.project, corr: 'operation-draft-options' }, forOperation)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!scope.project && scope.project !== 'all',
  })
}

/**
 * Write mutations: the hook captures the actor/project scope at call time, so
 * a persona/project switch never retargets an in-flight write. The service
 * result — success or typed failure — is surfaced to the caller's onSuccess,
 * so screens render the reason and keep the form on failure.
 */
export function useCreateOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (input: OperationDraftInput): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor)
      return services.operations(actor, scope.project).create({ actor, projectId: scope.project, corr: corr('operation-create') }, input)
    },
  })
}

export function useUpdateOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; patch: OperationDraftPatch }): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor)
      return services.operations(actor, scope.project).update({ actor, projectId: scope.project, corr: corr('operation-update') }, v.id, v.patch)
    },
  })
}

/** `at` is 'now' (manual start) or a datetime-local value normalized at the service boundary. */
export function useScheduleOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; at: 'now' | string }): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor)
      return services.operations(actor, scope.project).schedule({ actor, projectId: scope.project, corr: corr('operation-schedule') }, v.id, v.at)
    },
  })
}
