/**
 * Global overview reads (migration Mốc 2). One query per section, keyed by the auth scope so a persona or
 * scope change reads again. A section's error stays inside that section.
 */
import { useQuery } from '@tanstack/react-query'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope } from '../../state/keys'
import type { ServiceFailure, ServiceResult } from '../../domain/service'
import type { OverviewService } from './service'

/** A failed overview section, carrying the typed failure the port returned. */
export class OverviewReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'OverviewReadError'
  }
}

const unwrap = <T>(result: ServiceResult<T>): T => {
  if (!result.ok) throw new OverviewReadError(result.failure)
  return result.data
}

/** One section read: `read` picks the port call, the key keeps the section apart in the cache. */
function useOverviewSection<T>(section: string, read: (port: OverviewService) => Promise<ServiceResult<T>>, refetchInterval?: number) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('overview', scope, section),
    queryFn: async () => unwrap(await read(services.overview({ id: scope.actor, role: scope.role }))),
    enabled: !!services,
    refetchInterval,
  })
}

export const useOverviewProjects = () => useOverviewSection('projects', (port) => port.projects(), 60_000)
export const useOverviewFindings = () => useOverviewSection('findings', (port) => port.findings(), 60_000)
export const useOverviewC2 = () => useOverviewSection('c2', (port) => port.c2(), 60_000)
export const useOverviewTasks = () => useOverviewSection('tasks', (port) => port.tasks(), 30_000)
