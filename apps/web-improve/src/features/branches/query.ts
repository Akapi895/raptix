/**
 * Branch fanout Query binding (ticket 43, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The
 * group/branch views start with the `branch` entity kind and embed the auth
 * scope at position 1, so both bridge invalidation paths reach them: any
 * committed branch change (legacy action or service write) invalidates the
 * `[kind]` prefix — a retry/cancel request updates the overview and inspector
 * without a reload — and a persona/project switch cancels the superseded
 * scope's reads before a delayed response can restore old visibility.
 * Mutations capture the actor/project scope at call time, so a switch never
 * retargets an in-flight branch action; the service additionally binds every
 * write to the addressed branch's own project.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure, ServiceResult } from '../../domain/service'
import type { Branch } from '../../domain/entities'
import type { BranchDetailRead, BranchGroupDetailRead, BranchGroupListRead } from './service'

/** Feature-local key namespaces: ['branch', scope, 'group'|id] — the list overview keys under 'branch-group'. */
export const branchKeys = {
  groups: (scope: QueryScope) => consoleKeys.list('branch-group', scope),
  group: (scope: QueryScope, id: string) => consoleKeys.view('branch', scope, 'group', id),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('branch', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class BranchReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'BranchReadError'
  }
}

/** Query-backed branch group overview for the current auth/project scope. */
export function useBranchGroups() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: branchKeys.groups(scope),
    queryFn: async (): Promise<BranchGroupListRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .branches(actor, scope.project)
        .listGroups({ actor, projectId: scope.project, corr: 'branch-groups' })
      if (!res.ok) throw new BranchReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed execution graph for one branch group (rows carry observed agent state). */
export function useBranchGroup(id: string | undefined) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: branchKeys.group(scope, id ?? ''),
    queryFn: async (): Promise<BranchGroupDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .branches(actor, scope.project)
        .getGroup({ actor, projectId: scope.project, corr: 'branch-group' }, id!)
      if (!res.ok) throw new BranchReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/** Query-backed branch inspector read (joins included). */
export function useBranch(id: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: branchKeys.detail(scope, id),
    queryFn: async (): Promise<BranchDetailRead> => {
      const actor = actorRef(scope.actor)
      const res = await services
        .branches(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'branch-detail' }, id)
      if (!res.ok) throw new BranchReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

let corrSeq = 0
const corr = (act: string) => `${act}-${++corrSeq}`

/** Requests a retry through the typed service; the result (success or typed failure) is returned to onSuccess. */
export function useRetryBranch() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }): Promise<ServiceResult<Branch>> => {
      const actor = actorRef(scope.actor)
      return services.branches(actor, scope.project).retry({ actor, projectId: scope.project, corr: corr('branch-retry') }, v.id, v.reason)
    },
  })
}

export function useReassignBranch() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; agentId: string; reason: string }): Promise<ServiceResult<Branch>> => {
      const actor = actorRef(scope.actor)
      return services.branches(actor, scope.project).reassign({ actor, projectId: scope.project, corr: corr('branch-reassign') }, v.id, v.agentId, v.reason)
    },
  })
}

export function useCancelBranch() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }): Promise<ServiceResult<Branch>> => {
      const actor = actorRef(scope.actor)
      return services.branches(actor, scope.project).cancel({ actor, projectId: scope.project, corr: corr('branch-cancel') }, v.id, v.reason)
    },
  })
}
