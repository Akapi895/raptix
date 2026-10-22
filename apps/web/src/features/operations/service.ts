/**
 * Operations inventory read model (ticket 24, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handler for the operations list: one scope-checked read that
 * returns the page of accessible canonical operations plus the categorized
 * counts, filter options and approved-plans references the screen renders.
 * Every request captures actor and project explicitly; a non-member's
 * specific-project read is denied with `not-found` (no existence leak), and
 * the aggregate scope (`'all'` or `''`) folds in only projects the actor can
 * access.
 *
 * Ticket 25 appends the creation/scheduling half: scoped wizard option reads
 * plus atomic draft create/edit/schedule writes. Schedule input is normalized
 * at this boundary into an absolute instant; `Operation.scheduleAt` stores the
 * canonical instant and `Operation.schedule` its UTC+7 wall-clock projection
 * (the display convention the legacy screens render). Writes commit through
 * the shared authority and publish a ChangeSet, so legacy screens and Query
 * consumers observe one dataset.
 */
import { DEMO_TZ, parseDemoInstant } from '../../domain/clock'
import type { Agent, Asset, BranchGroup, Conversation, Operation, Plan, Playbook, Project } from '../../domain/entities'
import type { Clock, Instant, RequestContext, ServiceResult } from '../../domain/service'
import {
  PROJECT_TZ_OFFSET_MS, scheduleInstantOf, scheduleLabelOf, roeWindowIssue,
  type Check, type EligKind,
} from './preflight'

/* Ticket 26: the schedule/window helpers and the preflight policy live in
 * ./preflight; they are re-exported here so established `./service` import
 * sites (screens, tests) keep one import surface. */
export { PROJECT_TZ_OFFSET_MS, scheduleInstantOf, scheduleLabelOf, roeWindowIssue }


/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
export const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** Filter state for the operations inventory (all optional; empty = unfiltered). */
export interface OperationListQuery {
  /** Category key (''|draft|needs|running|done) or one detailed OpStatus value. */
  status?: string
  /** ATT&CK technique id; matches operations with at least one step using it. */
  technique?: string
  /** Case-insensitive substring over id + name. */
  q?: string
  /** Explicit project filter (aggregate view only). */
  project?: string
  owner?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
}

export type OperationCategory = 'all' | 'draft' | 'needs' | 'running' | 'done'

/** One table row: the canonical operation plus the labels its columns render. */
export interface OperationListItem {
  op: Operation
  /** Linked plan reference, formatted "PL-021 v1.2". */
  planLabel?: string
  /** Playbook name when no plan label is available. */
  playbookName?: string
  roeVersion?: string
  /** Project-level execution eligibility label, derived from canonical state (ticket 26). */
  eligibility: { kind: EligKind; label: string }
}

/** Approved plan ready to become an operation (legacy bridge action still creates it). */
export interface ReadyPlanRef { id: string; ver: string; title: string }

/** The whole list read: page + counts + filter options + ready plans. */
export interface OperationListRead {
  items: OperationListItem[]
  page: number
  pageSize: number
  total: number
  counts: Record<OperationCategory, number>
  owners: string[]
  projects: string[]
  readyPlans: ReadyPlanRef[]
}

export interface OperationService {
  list(ctx: RequestContext, query?: OperationListQuery): Promise<ServiceResult<OperationListRead>>
  /** Wizard option read (ticket 25): the scoped, selectable selections for one project. */
  draftOptions(ctx: RequestContext, forOperation?: string): Promise<ServiceResult<OperationDraftOptions>>
  /** Creates a draft atomically: scope-checked selections, pool-agent assignment, plan linkage, audit. */
  create(ctx: RequestContext, input: OperationDraftInput): Promise<ServiceResult<OperationWriteRead>>
  /** Edits a draft; invalidates stale preflight and refuses in-flight operations (ticket 25). */
  update(ctx: RequestContext, id: string, patch: OperationDraftPatch): Promise<ServiceResult<OperationWriteRead>>
  /** Writes the schedule as a normalized absolute instant with window/conflict validation (ticket 25). */
  schedule(ctx: RequestContext, id: string, at: 'now' | string): Promise<ServiceResult<OperationWriteRead>>
  /** Scope-checked detail read: the canonical bundle the console detail page renders (ticket 26). */
  detail(ctx: RequestContext, id: string): Promise<ServiceResult<OperationDetailRead>>
  /** The eight preflight checks re-derived at this instant; reads only, never commits a preflight run. */
  preflightChecks(ctx: RequestContext, id: string): Promise<ServiceResult<Check[]>>
  /** Runs preflight: the eight checks are re-derived from canonical state at the handler (ticket 26). */
  preflight(ctx: RequestContext, id: string): Promise<ServiceResult<PreflightRunRead>>
  /** The start gate: re-derived checks; a refusal names the failed check and reason (ticket 26). */
  startGate(ctx: RequestContext, id: string): Promise<ServiceResult<OperationStartRead>>
  /* Ticket 27 — lifecycle controls: each transition re-derives its gate at
   * the handler (a stale render can never admit an action) and commits
   * atomically, publishing one ChangeSet both entry points observe. */
  /** Starts a passing operation: run state + agent reservations + first session + plan + audit in one commit. */
  start(ctx: RequestContext, id: string): Promise<ServiceResult<OperationTransitionRead>>
  /** Pauses a running operation; the reason is required and audited. */
  pause(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<OperationTransitionRead>>
  /** Resumes a paused operation after the connectivity/plan rechecks; stopped operations never resume. */
  resume(ctx: RequestContext, id: string): Promise<ServiceResult<OperationTransitionRead>>
  /** The normal stop: releases reservations and terminates sessions in the same commit; reason required. */
  stop(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<OperationTransitionRead>>
  /** Completes an active operation with no running step; releases reservations in the same commit. */
  complete(ctx: RequestContext, id: string): Promise<ServiceResult<OperationTransitionRead>>
  /** Records the human decision for one review-gated step (ticket 29); the AI never decides. */
  reviewStep(ctx: RequestContext, id: string, stepId: string, decision: StepDecision, note: string): Promise<ServiceResult<OperationTransitionRead>>
  /** Swaps an assigned agent for a connected replacement in the same project, with a reason; atomic and audited. */
  replaceAgent(ctx: RequestContext, id: string, from: string, to: string, reason: string): Promise<ServiceResult<Operation>>
}

/* ═════════════ Ticket 25 — schedule instants, draft options, creation/edit/schedule ═════════════ */

/** Estimated duration of a draft/operation in minutes (legacy step-load heuristic). */
export const draftMinutes = (steps: number) => Math.max(20, (steps || 8) * 7)

export interface ScheduleOccupancy { start: Instant; end: Instant; basis: 'running' | 'scheduled' }

/** Time window an operation occupies its agents/assets, as absolute instants. */
export function occupancyOf(op: Operation, now: Instant): ScheduleOccupancy | null {
  if (op.status === 'running' || op.status === 'paused') {
    const s = parseDemoInstant(op.startedAt) ?? now
    return { start: s, end: Math.max(s + draftMinutes(op.steps.length) * 60000, now + 20 * 60000), basis: 'running' }
  }
  if (op.status === 'draft' || op.status === 'ready' || op.status === 'pending') {
    const s = op.scheduleAt ? Date.parse(op.scheduleAt) : scheduleInstantOf(op.schedule)
    return s == null || Number.isNaN(s) ? null : { start: s, end: s + draftMinutes(op.steps.length) * 60000, basis: 'scheduled' }
  }
  return null
}

export interface ScheduleConflict { kind: 'agent' | 'asset'; ref: string; label: string; other: Operation; from: Instant; to: Instant }

/** Overlaps between a candidate slot and committed operations (agent conflicts block; asset conflicts warn). */
export function findScheduleConflicts(
  operations: readonly Operation[],
  assets: readonly Asset[],
  cand: { id?: string; agents: string[]; assets: string[]; start: Instant; mins: number },
  now: Instant,
): ScheduleConflict[] {
  const end = cand.start + cand.mins * 60000
  const out: ScheduleConflict[] = []
  operations.forEach((o) => {
    if (o.id === cand.id) return
    const w = occupancyOf(o, now)
    if (!w || w.start >= end || w.end <= cand.start) return
    const from = Math.max(w.start, cand.start), to = Math.min(w.end, end)
    o.agents.filter((a) => cand.agents.includes(a)).forEach((a) => out.push({ kind: 'agent', ref: a, label: `Agent ${a} is reserved by ${o.id}`, other: o, from, to }))
    o.assets.filter((a) => cand.assets.includes(a)).forEach((a) => out.push({ kind: 'asset', ref: a, label: `Asset ${assets.find((x) => x.id === a)?.name || a} is targeted by ${o.id}`, other: o, from, to }))
  })
  return out
}

/* ── Wizard option read: selections are scoped here, so pending/out-of-scope
   assets and unapproved playbooks never reach the form as selectable. ── */

export interface OperationDraftInput {
  name: string
  owner: string
  desc: string
  objective: string
  playbookId: string
  agents: string[]
  assets: string[]
  mode: string
  needConfirm: boolean
  note: string
  /** 'now' or '' = manual start after preflight; otherwise datetime-local (project time UTC+7). */
  schedule: string
  planId?: string
}

export interface OperationDraftPatch {
  name?: string
  owner?: string
  playbookId?: string
  agents?: string[]
  assets?: string[]
  mode?: string
  schedule?: string
}

export interface OperationWriteRead {
  op: Operation
  /** Absolute instant of a validated schedule; undefined for manual start. */
  scheduleInstant?: Instant
}

export interface OperationDraftOptions {
  project: Project
  /** Project owner plus manager/operator members — the owner select's options. */
  owners: string[]
  /** Approved playbooks only; unapproved revisions are unavailable. */
  playbooks: Playbook[]
  /** Project agents and the unassigned pool, with why a row cannot be selected. */
  agents: { agent: Agent; issue: string }[]
  /** The project's assets; anything not approved in scope carries an issue. */
  assets: { asset: Asset; issue: string }[]
}

export const memberOwnersOf = (p: Project): string[] =>
  [...new Set([p.owner, ...p.members.filter((m) => m.role === 'manager' || m.role === 'operator').map((m) => m.user)])]

/* ── Write gates: the creation-side rules the wizard UI enforced, now enforced
   at the service boundary (preflight/start gates stay with ticket 26). ── */

/** Resolves a schedule input to its canonical pair (absolute instant + UTC+7 projection). */
export function normalizeScheduleInput(at: string | undefined): ServiceResult<{ instant?: Instant; label?: string; iso?: string }> {
  if (!at || at === 'now') return { ok: true, data: {} }
  const instant = scheduleInstantOf(at)
  if (instant === undefined) return { ok: false, failure: { kind: 'validation', message: 'The scheduled start is not a valid date and time (project time UTC+7).' } }
  return { ok: true, data: { instant, label: scheduleLabelOf(instant), iso: new Date(instant).toISOString() } }
}

/* ═════════════ Ticket 26 — console detail read, preflight run and start gate ═════════════ */

/**
 * The canonical bundle the operation console detail page renders: the
 * operation with its steps, the project, the linked plan/playbook/conversation
 * and the branch groups. One scope-checked read — a non-member's read is
 * `not-found` with no existence leak, and a member reading from the wrong
 * specific project is pointed back to the operation's own project via the
 * failure entity (no data crosses).
 */
export interface OperationDetailRead {
  op: Operation
  project: Project
  plan?: Plan
  planLabel?: string
  playbook?: Playbook
  /** Conversation linked through the plan (undefined for planless operations). */
  conversation?: Conversation
  branchGroups: BranchGroup[]
  /** Project-level execution eligibility label derived from canonical state. */
  eligibility: { kind: EligKind; label: string }
}

/** The committed outcome of one preflight run: re-derived checks plus the op. */
export interface PreflightRunRead { op: Operation; checks: Check[]; pass: boolean; at: Instant }

/** The start gate outcome: the operation is eligible; the start transition itself stays with ticket 27. */
export interface OperationStartRead { op: Operation; checks: Check[] }

/* ═════════════ Ticket 27 — operation lifecycle controls ═════════════ */

/** Transcript time-of-day stamp (HH:MM:SS project time) from the injected clock. */
export const tickOf = (clock: Clock) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(clock.now()))

/** The committed outcome of one lifecycle transition. */
export interface OperationTransitionRead { op: Operation }

export const opEntity = (op: Operation) => ({ kind: 'operation' as const, id: op.id, projectId: op.projectId })

/* ═════════════ Ticket 29 — the human review gate ═════════════ */

/** A reviewer's decision on one review-gated step (the AI never decides). */
export type StepDecision = 'approve' | 'skip' | 'fail'
