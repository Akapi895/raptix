/**
 * Governance query binding (plan P09, Governance slice). Reads and writes go
 * through GovernanceService for the engagement the caller names, so a route that
 * names one engagement never reads another's plans. Every committed write changes
 * plan, preflight, stop or schedule state, so it invalidates the governance key
 * family. Stops and schedules are polled: a due start or a new stop can arrive
 * without a write from this console.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { GovernancePlan, GovernanceService, PlanInput, ScheduleInput, StopScope } from './service'

export class GovernanceError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'GovernanceError'
  }
}

/** The message a failed call shows: the server's own words when it gave them. */
export const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

const POLL_MS = 30_000

async function unwrap<T>(result: Promise<ServiceResult<T>>): Promise<T> {
  const res = await result
  if (!res.ok) throw new GovernanceError(res.failure)
  return res.data
}

const ctxOf = (scope: QueryScope, engagementId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: engagementId, corr })

function useGovernanceClient(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const service = (): GovernanceService => services.governance(actorRef(scope.actor, scope.role), engagementId)
  return { services, scope, service }
}

export function useGovernancePlans(engagementId: string) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'plans'),
    queryFn: () => unwrap(service().plans(ctxOf(scope, engagementId, 'governance-plans'))),
    enabled: !!services,
  })
}

/** The live preflight, scoped to the execution thread the operator selected for binding. */
export function useGovernancePreflight(engagementId: string, threadId: string | null) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'preflight', threadId),
    queryFn: () => unwrap(service().preflight(ctxOf(scope, engagementId, 'governance-preflight'), threadId)),
    enabled: !!services,
    refetchInterval: POLL_MS,
  })
}

export function useGovernanceStops(engagementId: string) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'stops'),
    queryFn: () => unwrap(service().stops(ctxOf(scope, engagementId, 'governance-stops'))),
    enabled: !!services,
    refetchInterval: POLL_MS,
  })
}

export function useGovernanceSchedules(engagementId: string) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'schedules'),
    queryFn: () => unwrap(service().schedules(ctxOf(scope, engagementId, 'governance-schedules'))),
    enabled: !!services,
    refetchInterval: POLL_MS,
  })
}

export function useExecutionThreads(engagementId: string) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'threads'),
    queryFn: () => unwrap(service().executionThreads(ctxOf(scope, engagementId, 'governance-threads'))),
    enabled: !!services,
  })
}

/** A persisted comparison of two versions; both sides come from the server, never from local edits. */
export function usePlanComparison(engagementId: string, planId: string, baseId: string) {
  const { services, scope, service } = useGovernanceClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('governance', scope, engagementId, 'compare', planId, baseId),
    queryFn: () => unwrap(service().comparePlans(ctxOf(scope, engagementId, 'governance-compare'), planId, baseId)),
    enabled: !!services,
    retry: false,
  })
}

/**
 * Writes resolve to the committed record or throw a GovernanceError carrying the
 * server's refusal. Each committed write refreshes the governance keys.
 */
export function useGovernanceWrites(engagementId: string) {
  const { scope, service } = useGovernanceClient(engagementId)
  const client = useQueryClient()
  const run = async <T>(corr: string, call: (svc: GovernanceService, ctx: RequestContext) => Promise<ServiceResult<T>>): Promise<T> => {
    const data = await unwrap(call(service(), ctxOf(scope, engagementId, corr)))
    await client.invalidateQueries({ queryKey: ['governance'] })
    return data
  }
  return {
    draftPlan: (input: PlanInput): Promise<GovernancePlan> => run('governance-draft', (s, c) => s.draftPlan(c, input)),
    proposePlan: (planId: string): Promise<GovernancePlan> => run('governance-propose', (s, c) => s.proposePlan(c, planId)),
    decidePlan: (planId: string, decision: 'approved' | 'rejected', expectedVersion: number): Promise<GovernancePlan> =>
      run('governance-decide', (s, c) => s.decidePlan(c, planId, decision, expectedVersion)),
    revisePlan: (planId: string, input: PlanInput): Promise<GovernancePlan> => run('governance-revise', (s, c) => s.revisePlan(c, planId, input)),
    bindPlan: (planId: string, threadId: string) => run('governance-bind', (s, c) => s.bindPlan(c, planId, threadId)),
    requestStop: (input: { scope: StopScope; reason: string }) => run('governance-stop', (s, c) => s.requestStop(c, input)),
    resolveStop: (stopId: string, reason: string, concurrencyVersion: number) => run('governance-resolve', (s, c) => s.resolveStop(c, stopId, reason, concurrencyVersion)),
    createSchedule: (input: ScheduleInput) => run('governance-schedule', (s, c) => s.createSchedule(c, input)),
    cancelSchedule: (scheduleId: string, expectedVersion: number) => run('governance-cancel', (s, c) => s.cancelSchedule(c, scheduleId, expectedVersion)),
    rescheduleSchedule: (scheduleId: string, input: { executeAt: string; timezone: string; expectedVersion: number }) =>
      run('governance-reschedule', (s, c) => s.rescheduleSchedule(c, scheduleId, input)),
  }
}
