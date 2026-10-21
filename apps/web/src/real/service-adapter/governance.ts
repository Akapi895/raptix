import type { RequestContext } from '../../domain/service'
import type { EmergencyStop, GovernanceBinding, GovernancePlan, GovernanceSchedule, GovernanceService, PlanInput, StopOutcome } from '../../features/governance/service'
import { bindPlan, cancelSchedule, comparePlans, createSchedule, decidePlan, fetchEmergencyStops, fetchPlans, fetchPreflight, fetchSchedules, proposePlan, requestEmergencyStop, rescheduleSchedule, resolveEmergencyStop, revisePlan, savePlan, type EmergencyStopView, type PlanView, type ScheduleView } from '../../features/governance/remote';
import { listThreads } from '../../features/aichat/remote';
import { guarded } from './shared'

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its governance.' }

function planOf(view: PlanView): GovernancePlan {
  return {
    id: view.id,
    version: view.version,
    status: view.status,
    objective: view.objective,
    methods: view.methods,
    requestedBy: view.requestedBy,
    decidedBy: view.decidedBy,
    decisionComment: view.decisionComment,
    expiresAt: view.expiresAt,
    roeVersion: view.roeVersion,
  }
}

function stopOf(view: EmergencyStopView): EmergencyStop {
  return {
    id: view.id,
    engagementId: view.engagementId,
    scope: view.scope,
    outcome: view.outcome as StopOutcome,
    reason: view.reason,
    concurrencyVersion: view.concurrencyVersion,
    updatedAt: view.updatedAt,
    related: (view.related ?? []).map(stopOf),
  }
}

function scheduleOf(view: ScheduleView): GovernanceSchedule {
  return {
    id: view.id,
    version: view.version,
    planId: view.planId,
    threadId: view.threadId,
    status: view.status,
    executeAt: view.executeAt,
    timezone: view.timezone,
    reason: view.reason,
    runId: view.runId,
    outcomeDetail: view.outcomeDetail,
  }
}

function bindingOf(view: { id: string; planVersion: number; threadId: string | null; status: string }): GovernanceBinding {
  return { id: view.id, planVersion: view.planVersion, threadId: view.threadId, status: view.status }
}

/** Every write goes to the server, which decides; the console shows the refusal it returns. */
export function createRealGovernanceService(): GovernanceService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  return {
    plans: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await fetchPlans(engagementId)
      return { ok: true, data: { plans: view.plans.map(planOf), deadlineHours: view.deadlineHours } }
    }),
    draftPlan: (ctx, input: PlanInput) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: planOf(await savePlan(engagementId, input)) }
    }),
    proposePlan: (ctx, planId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: planOf(await proposePlan(engagementId, planId)) }
    }),
    decidePlan: (ctx, planId, decision, expectedVersion) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: planOf(await decidePlan(engagementId, planId, decision, expectedVersion)) }
    }),
    revisePlan: (ctx, planId, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: planOf(await revisePlan(engagementId, planId, input)) }
    }),
    comparePlans: (ctx, planId, baseId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await comparePlans(engagementId, planId, baseId)
      return { ok: true, data: { base: planOf(view.base), revision: planOf(view.revision) } }
    }),
    preflight: (ctx, threadId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await fetchPreflight(engagementId, threadId ?? undefined)
      return { ok: true, data: { ok: view.ok, checks: view.checks } }
    }),
    bindPlan: (ctx, planId, threadId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: bindingOf(await bindPlan(engagementId, planId, threadId)) }
    }),
    executionThreads: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const list = await listThreads(engagementId)
      return { ok: true, data: list.threads.filter((t) => t.kind === 'execution').map((t) => ({ threadId: t.threadId })) }
    }),
    stops: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: (await fetchEmergencyStops(engagementId)).stops.map(stopOf) }
    }),
    requestStop: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: stopOf(await requestEmergencyStop(engagementId, input)) }
    }),
    resolveStop: (ctx, stopId, reason, concurrencyVersion) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: stopOf(await resolveEmergencyStop(engagementId, stopId, reason, concurrencyVersion)) }
    }),
    schedules: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: (await fetchSchedules(engagementId)).schedules.map(scheduleOf) }
    }),
    createSchedule: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: scheduleOf(await createSchedule(engagementId, input)) }
    }),
    cancelSchedule: (ctx, scheduleId, expectedVersion) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: scheduleOf(await cancelSchedule(engagementId, scheduleId, expectedVersion)) }
    }),
    rescheduleSchedule: (ctx, scheduleId, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: scheduleOf(await rescheduleSchedule(engagementId, scheduleId, input)) }
    }),
  }
}
