import { apiFetch } from '../../platform/transport';
import { owned } from '../../platform/ownership';

/* ───────────── Governed plans/preflight/estop (integration ticket 09) ───────────── */
export interface PlanView {
  id: string
  engagementId: string
  version: number
  status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'superseded'
  objective: string
  methods: string[]
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  expiresAt: string | null
  roeVersion: number | null
  createdAt: string
}

export interface PlansView {
  engagementId: string
  plans: PlanView[]
  latestApprovedScopeVersion: number | null
  deadlineHours: number
  source: 'db'
}

export function isPlansView(v: unknown): v is PlansView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as PlansView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.plans) && doc.source === 'db'
    && doc.plans.every((p) => typeof p.id === 'string' && typeof p.version === 'number' && typeof p.status === 'string')
}

export function fetchPlans(engagementId: string): Promise<PlansView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans`, owned(engagementId, isPlansView))
}

export function savePlan(engagementId: string, input: { objective: string; methods: string[] }): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && typeof (v as PlanView).id === 'string' && (v as PlanView).status === 'draft',
  { method: 'POST', body: input })
}

export function proposePlan(engagementId: string, planId: string): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/propose`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === 'proposed',
  { method: 'POST' })
}

export function decidePlan(engagementId: string, planId: string, decision: 'approved' | 'rejected', expectedVersion: number): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/decision`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === decision,
  { method: 'POST', body: { decision, expectedVersion } })
}

/** Revises a reviewed plan: the reviewed version stays untouched; a new draft at the next version carries the body. */
export function revisePlan(engagementId: string, planId: string, input: { objective: string; methods: string[] }): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/revisions`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === 'draft',
    { method: 'POST', body: input })
}

export interface PlanComparisonView {
  base: PlanView
  revision: PlanView
  source: 'db'
}

export function comparePlans(engagementId: string, planId: string, baseId: string): Promise<PlanComparisonView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/compare?baseId=${encodeURIComponent(baseId)}`, (v): v is PlanComparisonView =>
    typeof v === 'object' && v !== null && typeof (v as PlanComparisonView).base === 'object' && typeof (v as PlanComparisonView).revision === 'object')
}

export interface PreflightView {
  engagementId: string
  ok: boolean
  checks: { id: string; state: 'pass' | 'fail' | 'unavailable'; detail: string | null }[]
  source: 'db'
}

export function isPreflightView(v: unknown): v is PreflightView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as PreflightView
  return typeof doc.engagementId === 'string' && typeof doc.ok === 'boolean' && Array.isArray(doc.checks) && doc.source === 'db'
}

export function fetchPreflight(engagementId: string, threadId?: string): Promise<PreflightView> {
  const qs = threadId !== undefined && threadId !== '' ? `?threadId=${encodeURIComponent(threadId)}` : ''
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/preflight${qs}`, owned(engagementId, isPreflightView))
}

export interface OperationBindingView {
  id: string
  engagementId: string
  planId: string
  planVersion: number
  threadId: string | null
  status: string
  concurrencyVersion: number
  createdBy: string
  createdAt: string
}

export function bindPlan(engagementId: string, planId: string, threadId: string): Promise<OperationBindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/bindings`, (v): v is OperationBindingView =>
    typeof v === 'object' && v !== null && typeof (v as OperationBindingView).id === 'string' && (v as OperationBindingView).status === 'bound',
    { method: 'POST', body: { planId, threadId } })
}

export interface EmergencyStopView {
  id: string
  engagementId: string
  scope: 'operation' | 'project' | 'workspace'
  targetId: string | null
  requestedBy: string
  outcome: 'requested' | 'acknowledged' | 'stopped' | 'failed' | 'unknown' | 'resolved'
  reason: string
  concurrencyVersion: number
  createdAt: string
  updatedAt: string
  /** W10/ADR-0074: sibling latches a workspace stop recorded in other owned engagements. */
  related?: EmergencyStopView[]
}

/** Outcomes that block work start until an explicit resolution (server contract). */
export const ACTIVE_STOP_OUTCOMES = ['requested', 'acknowledged', 'stopped', 'failed', 'unknown'] as const

export function requestEmergencyStop(engagementId: string, input: { scope: 'operation' | 'project' | 'workspace'; reason: string; threadId?: string }): Promise<EmergencyStopView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops`, (v): v is EmergencyStopView =>
    typeof v === 'object' && v !== null && typeof (v as EmergencyStopView).id === 'string' && typeof (v as EmergencyStopView).outcome === 'string',
  { method: 'POST', body: input })
}

export interface EmergencyStopsView {
  engagementId: string
  stops: EmergencyStopView[]
  source: 'db'
}

export function isEmergencyStopsView(v: unknown): v is EmergencyStopsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as EmergencyStopsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.stops) && doc.source === 'db'
}

export function fetchEmergencyStops(engagementId: string): Promise<EmergencyStopsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops`, owned(engagementId, isEmergencyStopsView))
}

/** W10: explicit resolution records why work may restart; it never resumes anything. The version guards against stale resolvers. */
export function resolveEmergencyStop(engagementId: string, stopId: string, reason: string, concurrencyVersion: number): Promise<EmergencyStopView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops/${encodeURIComponent(stopId)}/resolve`, (v): v is EmergencyStopView =>
    typeof v === 'object' && v !== null && (v as EmergencyStopView).outcome === 'resolved',
  { method: 'POST', body: { reason, concurrencyVersion } })
}

/* ───────────── W11 operation schedules (ADR-0073 durable execution intents) ───────────── */
export type ScheduleStatus = 'scheduled' | 'claimed' | 'dispatched' | 'refused' | 'canceled' | 'missed' | 'uncertain'

export interface ScheduleView {
  id: string
  engagementId: string
  planId: string
  threadId: string
  requestId: string
  status: ScheduleStatus
  version: number
  executeAt: string
  timezone: string
  reason: string
  runId: string | null
  outcomeDetail: string | null
  claimedBy: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SchedulesView {
  engagementId: string
  schedules: ScheduleView[]
  source: 'db'
}

export function isSchedulesView(v: unknown): v is SchedulesView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as SchedulesView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.schedules) && doc.source === 'db'
    && doc.schedules.every((s) => typeof s.id === 'string' && typeof s.status === 'string' && typeof s.version === 'number')
}

export function fetchSchedules(engagementId: string): Promise<SchedulesView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules`, owned(engagementId, isSchedulesView))
}

export function createSchedule(engagementId: string, input: { planId: string; threadId: string; executeAt: string; timezone: string; reason: string; requestId: string }): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && (v as ScheduleView).status === 'scheduled',
  { method: 'POST', body: input })
}

export function cancelSchedule(engagementId: string, scheduleId: string, expectedVersion: number): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules/${encodeURIComponent(scheduleId)}/cancel`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && (v as ScheduleView).status === 'canceled',
  { method: 'POST', body: { expectedVersion } })
}

export function rescheduleSchedule(engagementId: string, scheduleId: string, input: { executeAt: string; timezone: string; expectedVersion: number }): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules/${encodeURIComponent(scheduleId)}/reschedule`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && typeof (v as ScheduleView).version === 'number',
  { method: 'POST', body: input })
}
