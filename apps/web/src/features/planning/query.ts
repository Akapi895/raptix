/**
 * Planning documents query binding (plan P09, Planning slice). Reads and writes
 * go through PlanningService. A confirmed handoff changes the project detail the
 * page and the conversation read, so it invalidates that detail as well.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { projectKeys } from '../projects'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { PlanningDraftInput, PlanningDocumentSource, PlanningRead } from './service'

export class PlanningError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'PlanningError'
  }
}

const ctxOf = (scope: QueryScope, engagementId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: engagementId, corr })

export function usePlanningRead(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('planning', scope, engagementId, 'read'),
    queryFn: async (): Promise<PlanningRead> => {
      const res = await services.planning(actorRef(scope.actor, scope.role), engagementId).read(ctxOf(scope, engagementId, 'planning-read'))
      if (!res.ok) throw new PlanningError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** One document's source with its validation and the actor's draft; disabled until a document is opened. */
export function usePlanningSource(engagementId: string, name: string | null) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('planning', scope, engagementId, 'source', name),
    queryFn: async (): Promise<PlanningDocumentSource> => {
      const res = await services.planning(actorRef(scope.actor, scope.role), engagementId).source(ctxOf(scope, engagementId, 'planning-source'), name ?? '')
      if (!res.ok) throw new PlanningError(res.failure)
      return res.data
    },
    enabled: !!services && name !== null,
  })
}

/** Writes resolve to their result or throw a PlanningError carrying the handler's reason. */
export function usePlanningWrites(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  const svc = () => services.planning(actorRef(scope.actor, scope.role), engagementId)
  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['planning'] })
  }
  return {
    confirm: async (): Promise<void> => {
      const res = await svc().confirmHandoff(ctxOf(scope, engagementId, 'planning-confirm'))
      if (!res.ok) throw new PlanningError(res.failure)
      await refresh()
      await client.invalidateQueries({ queryKey: projectKeys.detail(engagementId) })
      await client.invalidateQueries({ queryKey: ['real', 'projects'] })
    },
    save: async (name: string, input: PlanningDraftInput): Promise<PlanningDocumentSource> => {
      const res = await svc().saveDraft(ctxOf(scope, engagementId, 'planning-draft'), name, input)
      if (!res.ok) throw new PlanningError(res.failure)
      await refresh()
      return res.data
    },
    publish: async (name: string, input: PlanningDraftInput): Promise<void> => {
      const res = await svc().publish(ctxOf(scope, engagementId, 'planning-publish'), name, input)
      if (!res.ok) throw new PlanningError(res.failure)
      await refresh()
    },
    discard: async (name: string): Promise<void> => {
      const res = await svc().discardDraft(ctxOf(scope, engagementId, 'planning-discard'), name)
      if (!res.ok) throw new PlanningError(res.failure)
      await refresh()
    },
  }
}
