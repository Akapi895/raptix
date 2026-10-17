/**
 * Runtime operations query binding (plan P12, Operations slice). Reads go through
 * RuntimeOperationsService for the engagement the caller names. A run list polls
 * only while a run is still in flight, and a committed cancel refreshes that
 * thread's runs and the timeline.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { RuntimeOperationsService, RuntimeRun } from './runtime'

export class RuntimeOperationsError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'RuntimeOperationsError'
  }
}

/** The message a failed call shows: the server's own words when it gave them. */
export const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

const ACTIVE_POLL_MS = 5_000
const IN_FLIGHT = ['pending', 'running', 'submitting']

async function unwrap<T>(result: Promise<ServiceResult<T>>): Promise<T> {
  const res = await result
  if (!res.ok) throw new RuntimeOperationsError(res.failure)
  return res.data
}

const ctxOf = (scope: QueryScope, engagementId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: engagementId, corr })

function useRuntimeClient(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const service = (): RuntimeOperationsService => services.runtimeOperations(actorRef(scope.actor, scope.role), engagementId)
  return { services, scope, service }
}

export function useRuntimeThreads(engagementId: string) {
  const { services, scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('runtime-operations', scope, engagementId, 'threads'),
    queryFn: () => unwrap(service().threads(ctxOf(scope, engagementId, 'runtime-threads'))),
    enabled: !!services,
  })
}

/** The runs of one thread; polls while any of them is still in flight. */
export function useRuntimeRuns(engagementId: string, threadId: string) {
  const { services, scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('runtime-operations', scope, engagementId, 'runs', threadId),
    queryFn: () => unwrap(service().runs(ctxOf(scope, engagementId, 'runtime-runs'), threadId)),
    enabled: !!services,
    refetchInterval: (query) => (query.state.data?.some((r: RuntimeRun) => IN_FLIGHT.includes(r.rawStatus)) ? ACTIVE_POLL_MS : false),
  })
}

export function useRuntimeSnapshot(engagementId: string, threadId: string) {
  const { services, scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('runtime-operations', scope, engagementId, 'snapshot', threadId),
    queryFn: () => unwrap(service().snapshot(ctxOf(scope, engagementId, 'runtime-snapshot'), threadId)),
    enabled: !!services,
    refetchInterval: ACTIVE_POLL_MS,
    retry: false,
  })
}

export function useRuntimeTimeline(engagementId: string) {
  const { services, scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('runtime-operations', scope, engagementId, 'timeline'),
    queryFn: () => unwrap(service().timeline(ctxOf(scope, engagementId, 'runtime-timeline'))),
    enabled: !!services,
    refetchInterval: 5_000,
    retry: false,
  })
}

export function useRuntimeCancel(engagementId: string) {
  const { scope, service } = useRuntimeClient(engagementId)
  const client = useQueryClient()
  return async (threadId: string, runId: string): Promise<RuntimeRun> => {
    const run = await unwrap(service().cancelRun(ctxOf(scope, engagementId, 'runtime-cancel'), threadId, runId))
    await client.invalidateQueries({ queryKey: ['runtime-operations'] })
    return run
  }
}
