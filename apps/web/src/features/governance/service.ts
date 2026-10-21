/**
 * Governance port (plan P09, Governance slice): the business plan lifecycle with
 * independent decisions and the absolute approval deadline, the live preflight,
 * the binding of an approved plan to an execution thread, emergency stops and
 * durable scheduled starts. An OPPLAN (planning artifact) and a tool HITL
 * decision are separate records; this port only manages the business plan.
 *
 * Only the real backend keeps this model. The mock console runs its own plan
 * review and operation lifecycle, which has different states, so this port has
 * no mock adapter.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export type GovernancePlanStatus = 'draft' | 'proposed' | 'approved' | 'rejected' | 'superseded'

export interface GovernancePlan {
  id: string
  version: number
  status: GovernancePlanStatus
  objective: string
  methods: string[]
  requestedBy: string
  decidedBy: string | null
  decisionComment: string | null
  expiresAt: string | null
  roeVersion: number | null
}

export interface GovernancePlans {
  plans: GovernancePlan[]
  deadlineHours: number
}

export interface PlanInput { objective: string; methods: string[] }

export interface PreflightCheck { id: string; state: 'pass' | 'fail' | 'unavailable'; detail: string | null }

export interface PreflightRead { ok: boolean; checks: PreflightCheck[] }

export interface GovernanceBinding {
  id: string
  planVersion: number
  threadId: string | null
  status: string
}

export type StopScope = 'operation' | 'project' | 'workspace'

export type StopOutcome = 'requested' | 'acknowledged' | 'stopped' | 'failed' | 'unknown' | 'resolved'

/** Outcomes that block work start until an explicit resolution. */
export const ACTIVE_STOP_OUTCOMES: readonly StopOutcome[] = ['requested', 'acknowledged', 'stopped', 'failed', 'unknown']

export interface EmergencyStop {
  id: string
  engagementId: string
  scope: StopScope
  outcome: StopOutcome
  reason: string
  concurrencyVersion: number
  updatedAt: string
  /** Sibling latches a workspace stop recorded in other owned engagements. */
  related: EmergencyStop[]
}

export type ScheduleStatus = 'scheduled' | 'claimed' | 'dispatched' | 'refused' | 'canceled' | 'missed' | 'uncertain'

export interface GovernanceSchedule {
  id: string
  version: number
  planId: string
  threadId: string
  status: ScheduleStatus
  executeAt: string
  timezone: string
  reason: string
  runId: string | null
  outcomeDetail: string | null
}

export interface ScheduleInput { planId: string; threadId: string; executeAt: string; timezone: string; reason: string; requestId: string }

export interface ExecutionThread { threadId: string }

export interface GovernanceService {
  plans(ctx: RequestContext): Promise<ServiceResult<GovernancePlans>>
  draftPlan(ctx: RequestContext, input: PlanInput): Promise<ServiceResult<GovernancePlan>>
  proposePlan(ctx: RequestContext, planId: string): Promise<ServiceResult<GovernancePlan>>
  /** The decision carries the version the reviewer read, so a stale decision is refused. */
  decidePlan(ctx: RequestContext, planId: string, decision: 'approved' | 'rejected', expectedVersion: number): Promise<ServiceResult<GovernancePlan>>
  /** A revision is a new draft at the next version; the reviewed version stays unchanged. */
  revisePlan(ctx: RequestContext, planId: string, input: PlanInput): Promise<ServiceResult<GovernancePlan>>
  comparePlans(ctx: RequestContext, planId: string, baseId: string): Promise<ServiceResult<{ base: GovernancePlan; revision: GovernancePlan }>>
  /** `threadId` scopes the playbook check to the selected thread; null checks the engagement only. */
  preflight(ctx: RequestContext, threadId: string | null): Promise<ServiceResult<PreflightRead>>
  bindPlan(ctx: RequestContext, planId: string, threadId: string): Promise<ServiceResult<GovernanceBinding>>
  executionThreads(ctx: RequestContext): Promise<ServiceResult<ExecutionThread[]>>
  stops(ctx: RequestContext): Promise<ServiceResult<EmergencyStop[]>>
  requestStop(ctx: RequestContext, input: { scope: StopScope; reason: string }): Promise<ServiceResult<EmergencyStop>>
  /** Explicit resolution with a recorded reason; it never resumes anything. */
  resolveStop(ctx: RequestContext, stopId: string, reason: string, concurrencyVersion: number): Promise<ServiceResult<EmergencyStop>>
  schedules(ctx: RequestContext): Promise<ServiceResult<GovernanceSchedule[]>>
  createSchedule(ctx: RequestContext, input: ScheduleInput): Promise<ServiceResult<GovernanceSchedule>>
  cancelSchedule(ctx: RequestContext, scheduleId: string, expectedVersion: number): Promise<ServiceResult<GovernanceSchedule>>
  rescheduleSchedule(ctx: RequestContext, scheduleId: string, input: { executeAt: string; timezone: string; expectedVersion: number }): Promise<ServiceResult<GovernanceSchedule>>
}

