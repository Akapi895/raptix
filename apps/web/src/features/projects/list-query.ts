/**
 * The project list's query hook (migration Mốc 2): one read through the projects port, keyed by the auth scope so a persona
 * switch reads again. A failed read surfaces as the typed failure the port returned, never as an empty list.
 */
import { useQuery } from '@tanstack/react-query'
import type { ServiceFailure } from '../../domain/service'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope } from '../../state/keys'
import type { ProjectRow } from './service'

export class ProjectListError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ProjectListError'
  }
}

export function useProjectRows() {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('projects', scope, 'list'),
    queryFn: async (): Promise<ProjectRow[]> => {
      const res = await services.projects({ id: scope.actor, role: scope.role }).list()
      if (!res.ok) throw new ProjectListError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}
