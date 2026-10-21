/**
 * Runtime operations query binding (plan P12, Operations slice). Reads go through
 * RuntimeOperationsService for the engagement the caller names. A run list polls
 * only while a run is still in flight, and a committed cancel refreshes that
 * thread's runs and the timeline.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
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
const FLEET_POLL_MS = 15_000
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

/** The agent fleet: catalog graphs, bound threads and checkpoint branches. Read-only, re-read on an interval. */
export function useRuntimeFleet(engagementId: string) {
  const { services, scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('runtime-operations', scope, engagementId, 'fleet'),
    queryFn: () => unwrap(service().fleet(ctxOf(scope, engagementId, 'runtime-fleet'))),
    enabled: !!services,
    refetchInterval: FLEET_POLL_MS,
  })
}

/** P11: the lifecycle the runtime reports for one execution thread; polled so a pause or a finished run shows without a reload. */
export function useRuntimeOperation(engagementId: string, threadId: string) {
  const { scope, service } = useRuntimeClient(engagementId)
  return useQuery({
    queryKey: ['runtime-operations', 'operation', engagementId, threadId],
    queryFn: () => unwrap(service().operation(ctxOf(scope, engagementId, 'runtime-operation'), threadId)),
    refetchInterval: 4_000,
    retry: false,
  })
}

/** P11 controls. Each one settles the operation and the runs it can change. */
export function useRuntimeOperationControls(engagementId: string) {
  const { scope, service } = useRuntimeClient(engagementId)
  const client = useQueryClient()
  const settle = () => client.invalidateQueries({ queryKey: ['runtime-operations'] })
  return {
    pause: async (threadId: string, runId: string) => {
      const view = await unwrap(service().pauseRun(ctxOf(scope, engagementId, 'runtime-pause'), threadId, runId))
      await settle()
      return view
    },
    resume: async (threadId: string, requestId: string) => {
      const recovery = await unwrap(service().resumeOperation(ctxOf(scope, engagementId, 'runtime-resume'), threadId, requestId))
      await settle()
      return recovery
    },
    complete: async (threadId: string) => {
      const view = await unwrap(service().completeOperation(ctxOf(scope, engagementId, 'runtime-complete'), threadId))
      await settle()
      return view
    },
  }
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
