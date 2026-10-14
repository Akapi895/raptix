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
import { can, projectAccessible, projectLocked, readOnlyContext } from '../../auth/policy'
import { planVer } from '../../data'
import type { Db } from '../../data'
import { DEMO_TZ, parseDemoInstant, formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Agent, Asset, Operation, Plan, Playbook, Project, Step } from '../../domain/entities'
import type { Clock, Instant, RequestContext, ServiceResult } from '../../domain/service'
// Ticket 40: the resume re-check consults the plans feature's approval-validity
// gate (execution.md row b — expiry integrated by 40).
import { usableApproval } from '../plans/service'
import {
  PROJECT_TZ_OFFSET_MS, scheduleInstantOf, scheduleLabelOf, roeWindowIssue,
  computePreflightChecks, preflightPass, eligibility, type Check, type EligKind,
} from './preflight'

/* Ticket 26: the schedule/window helpers and the preflight policy live in
 * ./preflight; they are re-exported here so established `./service` import
 * sites (screens, tests) keep one import surface. */
export { PROJECT_TZ_OFFSET_MS, scheduleInstantOf, scheduleLabelOf, roeWindowIssue }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

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
}

/** Category → statuses the category pill covers ("needs" also takes review-pending drafts). */
const CATEGORIES: readonly (readonly [Exclude<OperationCategory, 'all'>, readonly string[]])[] = [
  ['draft', ['draft']], ['needs', ['pending']], ['running', ['running', 'paused']], ['done', ['done']],
]
const PAGE_SIZE = 10

function matchesStatus(op: Operation, status: string, inReviewPlans: ReadonlySet<string>): boolean {
  if (!status) return true
  const cat = CATEGORIES.find(([k]) => k === status)
  if (cat) {
    if (cat[1].includes(op.status)) return true
    return status === 'needs' && op.status === 'draft' && !!op.planId && inReviewPlans.has(op.planId)
  }
  return op.status === status
}

/**
 * Pure list/read handler. Scope semantics: a specific projectId reads only
 * that project's operations and only for members (elevated roles included);
 * `'all'`/`''` aggregates across the actor's accessible projects. Counts and
 * filter options derive from the same accessible base set, with the status
 * category excluded from the counts so the pills always show live totals.
 */
export function listOperations(db: Db, ctx: RequestContext, query: OperationListQuery = {}): ServiceResult<OperationListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = db.operations.filter((o) => (aggregate ? accessible.has(o.projectId) : o.projectId === pid))
  const inReviewPlans = new Set(db.plans.filter((pl) => pl.status === 'in_review').map((pl) => pl.id))
  const q = (query.q || '').toLowerCase()
  const pre = base.filter((o) =>
    (!query.technique || o.steps.some((s) => s.technique === query.technique)) &&
    (!query.project || o.projectId === query.project) &&
    (!query.owner || o.owner === query.owner) &&
    (!q || (o.id + o.name).toLowerCase().includes(q)))
  const categories: OperationCategory[] = ['all', 'draft', 'needs', 'running', 'done']
  const counts = Object.fromEntries(categories.map((c) => [c, pre.filter((o) => matchesStatus(o, c === 'all' ? '' : c, inReviewPlans)).length])) as Record<OperationCategory, number>
  const rows = pre.filter((o) => matchesStatus(o, query.status || '', inReviewPlans))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const planById = new Map(db.plans.map((pl) => [pl.id, pl]))
  const playbookById = new Map(db.playbooks.map((pb) => [pb.id, pb]))
  const projectById = new Map(db.projects.map((p) => [p.id, p]))
  const items: OperationListItem[] = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((op) => {
    const pl = op.planId ? planById.get(op.planId) : undefined
    const el = eligibility(db, op.projectId)
    return {
      op,
      planLabel: pl ? `${pl.id} ${planVer(pl)}` : undefined,
      playbookName: !pl ? playbookById.get(op.playbookId)?.name : undefined,
      roeVersion: projectById.get(op.projectId)?.roeVersion,
      eligibility: { kind: el.kind, label: el.label },
    }
  })
  const scopePlans = aggregate ? db.plans.filter((pl) => accessible.has(pl.projectId)) : db.plans.filter((pl) => pl.projectId === pid)
  const readyPlans: ReadyPlanRef[] = scopePlans
    .filter((pl) => pl.status === 'approved' && !(pl.opId && db.operations.some((o) => o.id === pl.opId)))
    .map((pl) => ({ id: pl.id, ver: planVer(pl), title: pl.title }))
  return {
    ok: true,
    data: {
      items, page, pageSize: PAGE_SIZE, total: rows.length, counts,
      owners: [...new Set(base.map((o) => o.owner))].sort(),
      projects: [...new Set(base.map((o) => o.projectId))],
      readyPlans,
    },
  }
}

/** Builds the typed list service; `guard` is the factory's superseded-scope read guard. */
export function createOperationService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): OperationService {
  return {
    list: (ctx, query) => guard(() => listOperations(authority.snapshot(), ctx, query)),
    // Writes capture ctx at call time and commit once; they are never cancelled
    // mid-flight (the factory's superseded-scope guard only covers reads).
    draftOptions: (ctx, forOperation) => Promise.resolve(operationDraftOptions(authority.snapshot(), ctx, forOperation)),
    create: (ctx, input) => Promise.resolve(createOperationDraft(authority, clock, ctx, input)),
    update: (ctx, id, patch) => Promise.resolve(updateOperationDraft(authority, clock, ctx, id, patch)),
    schedule: (ctx, id, at) => Promise.resolve(scheduleOperation(authority, clock, ctx, id, at)),
    detail: (ctx, id) => Promise.resolve(operationDetail(authority.snapshot(), ctx, id)),
    preflight: (ctx, id) => Promise.resolve(runOperationPreflight(authority, clock, ctx, id)),
    startGate: (ctx, id) => Promise.resolve(operationStartGate(authority, clock, ctx, id)),
    start: (ctx, id) => Promise.resolve(startOperation(authority, clock, ctx, id)),
    pause: (ctx, id, reason) => Promise.resolve(pauseOperation(authority, clock, ctx, id, reason)),
    resume: (ctx, id) => Promise.resolve(resumeOperation(authority, clock, ctx, id)),
    stop: (ctx, id, reason) => Promise.resolve(stopOperation(authority, clock, ctx, id, reason)),
    complete: (ctx, id) => Promise.resolve(completeOperation(authority, clock, ctx, id)),
    reviewStep: (ctx, id, stepId, decision, note) => Promise.resolve(reviewOperationStep(authority, clock, ctx, id, stepId, decision, note)),
  }
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
  db: Db,
  cand: { id?: string; agents: string[]; assets: string[]; start: Instant; mins: number },
  now: Instant,
): ScheduleConflict[] {
  const end = cand.start + cand.mins * 60000
  const out: ScheduleConflict[] = []
  db.operations.forEach((o) => {
    if (o.id === cand.id) return
    const w = occupancyOf(o, now)
    if (!w || w.start >= end || w.end <= cand.start) return
    const from = Math.max(w.start, cand.start), to = Math.min(w.end, end)
    o.agents.filter((a) => cand.agents.includes(a)).forEach((a) => out.push({ kind: 'agent', ref: a, label: `Agent ${a} is reserved by ${o.id}`, other: o, from, to }))
    o.assets.filter((a) => cand.assets.includes(a)).forEach((a) => out.push({ kind: 'asset', ref: a, label: `Asset ${db.assets.find((x) => x.id === a)?.name || a} is targeted by ${o.id}`, other: o, from, to }))
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

const agentIssueOf = (a: Agent, forOperation?: string): string => {
  if (a.status === 'lost') return ''
  if (a.status !== 'online' && a.status !== 'idle') return a.status === 'disabled' ? 'Agent is disabled.' : 'Agent status is unknown.'
  if (a.op && a.op !== forOperation) return `Busy with ${a.op} (policy: one agent, one operation).`
  return ''
}

const assetIssueOf = (a: Asset): string =>
  a.scope === 'in' ? '' : a.scope === 'out' ? 'Out of scope per ROE — cannot be selected.' : a.scope === 'pending' ? 'Scope approval pending — cannot be selected yet.' : 'Scope not classified — cannot be selected.'

const memberOwnersOf = (p: Project): string[] =>
  [...new Set([p.owner, ...p.members.filter((m) => m.role === 'manager' || m.role === 'operator').map((m) => m.user)])]

export function operationDraftOptions(db: Db, ctx: RequestContext, forOperation?: string): ServiceResult<OperationDraftOptions> {
  /* Editing an existing draft addresses that operation's project (the legacy
     wizard allowed this from the aggregate view); creating requires an
     explicit specific-project scope. */
  const editOp = forOperation ? db.operations.find((o) => o.id === forOperation) : undefined
  if (forOperation && !editOp) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  const projectId = editOp ? editOp.projectId : ctx.projectId
  if (!projectId || projectId === 'all') {
    return { ok: false, failure: { kind: 'validation', message: 'Select a project to draft an operation — operations cannot be created in All Projects mode.' } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== projectId) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  const project = db.projects.find((p) => p.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  return {
    ok: true,
    data: {
      project,
      owners: memberOwnersOf(project),
      playbooks: db.playbooks.filter((x) => x.kind === 'playbook' && x.status === 'approved'),
      agents: db.agents.filter((a) => a.projectId === project.id || a.projectId === '').map((agent) => ({ agent, issue: agentIssueOf(agent, forOperation) })),
      assets: db.assets.filter((a) => a.projectId === project.id).map((asset) => ({ asset, issue: assetIssueOf(asset) })),
    },
  }
}

/* ── Write gates: the creation-side rules the wizard UI enforced, now enforced
   at the service boundary (preflight/start gates stay with ticket 26). ── */

const IN_FLIGHT: readonly string[] = ['running', 'paused', 'done', 'cancelled', 'estop', 'error']

/** Membership + role gate shared by every operation write. `action` is the active verb phrase
 * ("create operations"); `passive` is its participle ("created") for refusal messages. */
function operationWriteGate(
  db: Db,
  ctx: RequestContext,
  projectId: string,
  action: string,
  passive: string,
): ServiceResult<Project> {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `The Viewer role has read-only access${projectLocked(project) ? ` (project ${project.id} is ${project.status})` : ''}; operations cannot be ${passive}.` } }
  }
  if (!can({ id: ctx.actor.id, role: ctx.actor.role }, 'run', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Manager or Operator can ${action}.` } }
  }
  return { ok: true, data: project }
}

/** Addressed-operation gate: scope without existence leak, role gate, in-flight refusal.
 * The aggregate scope is allowed (the legacy screens permitted editing and
 * scheduling an addressed draft from All Projects) — the write binds to the
 * operation's own project either way. */
function addressedOperationGate(
  db: Db,
  ctx: RequestContext,
  op: Operation | undefined,
  action: string,
  passive: string,
): ServiceResult<{ op: Operation; project: Project }> {
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.` } }
  }
  const gated = operationWriteGate(db, ctx, op.projectId, action, passive)
  if (!gated.ok) return gated
  if (IN_FLIGHT.includes(op.status)) {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${op.id} is ${op.status === 'estop' ? 'emergency stopped' : op.status} — only Draft or Ready operations can be ${passive}.` } }
  }
  return { ok: true, data: { op, project: gated.data } }
}

/** Create-side selection rules (baseline wizard gates, enforced atomically here). */
function validateDraftSelections(db: Db, project: Project, input: OperationDraftInput, editId?: string): string {
  if (!memberOwnersOf(project).includes(input.owner)) {
    return `${input.owner || 'The owner'} is not a Manager or Operator on project ${project.id}.`
  }
  if (input.playbookId) {
    const pb = db.playbooks.find((x) => x.id === input.playbookId)
    if (!pb || pb.kind !== 'playbook') return `Playbook ${input.playbookId} does not exist.`
    if (pb.status !== 'approved') return `Playbook ${pb.id} is not approved — unapproved revisions cannot be selected.`
  }
  for (const id of input.assets) {
    const a = db.assets.find((x) => x.id === id)
    if (!a || a.projectId !== project.id) return `Asset ${id} does not belong to project ${project.id}.`
    if (a.scope !== 'in') return `Asset ${a.name} is not approved in scope (${a.scope}) — it cannot be selected.`
  }
  for (const id of input.agents) {
    const ag = db.agents.find((x) => x.id === id)
    if (!ag || (ag.projectId !== project.id && ag.projectId !== '')) return `Agent ${id} is not available to project ${project.id}.`
    if (ag.status === 'disabled') return `Agent ${id} is disabled.`
    if (ag.status !== 'online' && ag.status !== 'idle' && ag.status !== 'lost') return `Agent ${id}'s status is unknown.`
    if (ag.op && ag.op !== editId) return `Agent ${id} is busy with ${ag.op} (policy: one agent, one operation).`
    const pb = input.playbookId ? db.playbooks.find((x) => x.id === input.playbookId) : undefined
    if (pb && !pb.os.includes(ag.os)) return `Agent ${id} is incompatible: the playbook supports ${pb.os.join(', ')}, the agent runs ${ag.os}.`
  }
  return ''
}

/** Resolves a schedule input to its canonical pair (absolute instant + UTC+7 projection). */
function normalizeScheduleInput(at: string | undefined): ServiceResult<{ instant?: Instant; label?: string; iso?: string }> {
  if (!at || at === 'now') return { ok: true, data: {} }
  const instant = scheduleInstantOf(at)
  if (instant === undefined) return { ok: false, failure: { kind: 'validation', message: 'The scheduled start is not a valid date and time (project time UTC+7).' } }
  return { ok: true, data: { instant, label: scheduleLabelOf(instant), iso: new Date(instant).toISOString() } }
}

/** Step linkage for a created draft: plan steps win, otherwise the approved playbook's sequence (legacy parity). */
function draftSteps(planSteps: Plan['steps'] | undefined, pb: Playbook | undefined, agents: string[], assetNames: string[]): Step[] {
  if (planSteps) {
    return planSteps.map((st, i) => ({ id: 'S' + pad2(i + 1), name: st.name, agent: st.agent, asset: st.asset, technique: st.technique, status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
  }
  const techs = pb?.techniques || ['T1082']
  return (pb?.steps || []).map((name, i) => ({ id: 'S' + pad2(i + 1), name, agent: agents.length ? agents[i % agents.length] : '—', asset: assetNames.length ? assetNames[i % assetNames.length] : '—', technique: techs[i % techs.length], status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
}

/** Creates a draft operation in one atomic commit: selections, pool-agent assignment, plan linkage, audit. */
export function createOperationDraft(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: OperationDraftInput): ServiceResult<OperationWriteRead> {
  if (!ctx.projectId || ctx.projectId === 'all') {
    return { ok: false, failure: { kind: 'validation', message: 'Select the project the operation belongs to — operations cannot be created in All Projects mode.' } }
  }
  const db = authority.snapshot()
  const gated = operationWriteGate(db, ctx, ctx.projectId, 'create operations', 'created')
  if (!gated.ok) return gated
  const project = gated.data
  const selectionError = validateDraftSelections(db, project, input)
  if (selectionError) return { ok: false, failure: { kind: 'validation', message: selectionError, entity: { kind: 'operation', id: '', projectId: project.id } } }
  const schedule = normalizeScheduleInput(input.schedule)
  if (!schedule.ok) return schedule
  const inst = schedule.data.instant
  const plan = input.planId ? db.plans.find((x) => x.id === input.planId) : undefined
  const pb = db.playbooks.find((x) => x.id === input.playbookId)
  const assetNames = input.assets.map((a) => db.assets.find((x) => x.id === a)?.name).filter((x): x is string => !!x)
  const name = input.name.trim() || 'Untitled draft operation'
  let id = ''
  authority.commit(ctx.corr, (d) => {
    id = 'OP-' + String(++d.counters.op).padStart(3, '0')
    d.operations.push({
      id, projectId: project.id, name, status: 'draft', owner: input.owner, playbookId: input.playbookId,
      agents: input.agents, assets: input.assets, mode: input.mode, startedAt: '—',
      updated: formatDemoInstant(clock.now()), steps: draftSteps(plan?.steps, pb, input.agents, assetNames),
      planId: input.planId, schedule: schedule.data.label, scheduleAt: schedule.data.iso,
    })
    if (input.planId) { const pl = d.plans.find((x) => x.id === input.planId); if (pl) pl.opId = id }
    // Pool agents join the project with the same commit that reserves them.
    input.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && !a.projectId) a.projectId = project.id })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Created operation (draft)', obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((o) => o.id === id)!, scheduleInstant: inst } }
}

/** Rechecks replacement eligibility before invalidating preflight and rebuilding draft steps. */
export function replaceOperationAgent(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, from: string, to: string, reason: string): ServiceResult<Operation> {
  const db = authority.snapshot()
  const gate = addressedOperationGate(db, ctx, db.operations.find((o) => o.id === id), 'replace agents', 'edited')
  if (!gate.ok) return gate
  const { op } = gate.data
  const previous = db.agents.find((a) => a.id === from)
  const replacement = db.agents.find((a) => a.id === to)
  if (!['draft', 'ready'].includes(op.status) || !reason.trim() || !op.agents.includes(from) || !previous || !replacement || replacement.projectId !== op.projectId || previous.os !== replacement.os || !['online', 'idle'].includes(replacement.status) || replacement.op) {
    return { ok: false, failure: { kind: 'validation', message: 'Replacement requires a reason and an available, compatible agent in the same project.' } }
  }
  authority.commit(ctx.corr, (d) => {
    const target = d.operations.find((o) => o.id === id)!
    target.agents = target.agents.map((a) => a === from ? to : a)
    target.preflightAt = undefined
    if (target.status === 'ready') target.status = 'draft'
    target.updated = formatDemoInstant(clock.now())
    if (target.status === 'draft' && !target.planId) {
      const pb = d.playbooks.find((p) => p.id === target.playbookId)
      target.steps = draftSteps(undefined, pb, target.agents, target.assets.map((aid) => d.assets.find((a) => a.id === aid)?.name).filter((name): name is string => !!name))
    }
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Replaced offline agent in operation', obj: `${id}: ${from} → ${to}`, projectId: op.projectId, result: 'Success', reason })
  })
  return { ok: true, data: authority.snapshot().operations.find((o) => o.id === id)! }
}

/** Edits a draft and invalidates its stale preflight. */
export function updateOperationDraft(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, patch: OperationDraftPatch): ServiceResult<OperationWriteRead> {
  const db = authority.snapshot()
  const gated = addressedOperationGate(db, ctx, db.operations.find((o) => o.id === id), 'edit operations', 'edited')
  if (!gated.ok) return gated
  const project = gated.data.project
  if (patch.owner !== undefined && !memberOwnersOf(project).includes(patch.owner)) {
    return { ok: false, failure: { kind: 'validation', message: `${patch.owner || 'The owner'} is not a Manager or Operator on project ${project.id}.` } }
  }
  if (patch.playbookId) {
    const pb = db.playbooks.find((x) => x.id === patch.playbookId)
    if (!pb || pb.kind !== 'playbook') return { ok: false, failure: { kind: 'validation', message: `Playbook ${patch.playbookId} does not exist.` } }
    if (pb.status !== 'approved') return { ok: false, failure: { kind: 'validation', message: `Playbook ${pb.id} is not approved — unapproved revisions cannot be selected.` } }
  }
  // Selection identity is scope-checked; soft status drift (an agent that became
  // busy, an asset that left scope) stays tolerated — preflight re-checks it.
  for (const aid of patch.agents || []) {
    const ag = db.agents.find((x) => x.id === aid)
    if (!ag || (ag.projectId !== project.id && ag.projectId !== '')) return { ok: false, failure: { kind: 'validation', message: `Agent ${aid} is not available to project ${project.id}.` } }
  }
  for (const aid of patch.assets || []) {
    const a = db.assets.find((x) => x.id === aid)
    if (!a || a.projectId !== project.id) return { ok: false, failure: { kind: 'validation', message: `Asset ${aid} does not belong to project ${project.id}.` } }
  }
  const schedule = patch.schedule !== undefined ? normalizeScheduleInput(patch.schedule) : undefined
  if (schedule && !schedule.ok) return schedule
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    Object.assign(o, {
      name: patch.name !== undefined ? patch.name.trim() || 'Untitled draft operation' : o.name,
      owner: patch.owner ?? o.owner, playbookId: patch.playbookId ?? o.playbookId,
      agents: patch.agents ?? o.agents, assets: patch.assets ?? o.assets, mode: patch.mode ?? o.mode,
    })
    if (patch.schedule !== undefined) { o.schedule = schedule?.data.label; o.scheduleAt = schedule?.data.iso }
    // Any draft edit invalidates the preflight snapshot; ready drafts fall back to draft.
    o.preflightAt = undefined
    if (o.status === 'ready') o.status = 'draft'
    o.updated = formatDemoInstant(clock.now())
    if ((patch.playbookId !== undefined || patch.agents !== undefined || patch.assets !== undefined) && o.status === 'draft' && !o.planId) {
      const pb = d.playbooks.find((x) => x.id === o.playbookId)
      const as = o.assets.map((a) => d.assets.find((x) => x.id === a)!).filter(Boolean)
      o.steps = draftSteps(undefined, pb || undefined, o.agents, as.map((a) => a.name))
    }
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Updated operation (draft)', obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  const next = authority.snapshot().operations.find((o) => o.id === id)!
  return { ok: true, data: { op: next, scheduleInstant: next.scheduleAt ? Date.parse(next.scheduleAt) : undefined } }
}

/** Schedules an operation: full window/conflict validation, atomic write, absolute instant stored. */
export function scheduleOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, at: 'now' | string): ServiceResult<OperationWriteRead> {
  const db = authority.snapshot()
  const gated = addressedOperationGate(db, ctx, db.operations.find((o) => o.id === id), 'schedule operations', 'scheduled')
  if (!gated.ok) return gated
  const { op, project } = gated.data
  let instant: Instant | undefined
  let label: string | undefined
  let iso: string | undefined
  if (at !== 'now') {
    instant = scheduleInstantOf(at)
    if (instant === undefined) {
      return { ok: false, failure: { kind: 'validation', message: 'Choose a start time — the scheduled start is not a valid date and time (project time UTC+7).', entity: { kind: 'operation', id, projectId: project.id } } }
    }
    if (instant <= clock.now()) {
      return { ok: false, failure: { kind: 'validation', message: 'Start time is in the past. Choose a future time or start the operation manually after preflight.', entity: { kind: 'operation', id, projectId: project.id } } }
    }
    const win = roeWindowIssue(project, instant)
    if (win) return { ok: false, failure: { kind: 'validation', message: `${win} Pick a time inside the window or request an ROE window change.`, entity: { kind: 'operation', id, projectId: project.id } } }
    const blocking = findScheduleConflicts(db, { id, agents: op.agents, assets: op.assets, start: instant, mins: draftMinutes(op.steps.length) }, clock.now()).filter((c) => c.kind === 'agent')
    if (blocking.length > 0) {
      return { ok: false, failure: { kind: 'validation', message: `${blocking[0]!.label} (policy: one agent, one operation). Choose a later time, other agents or other assets.`, entity: { kind: 'operation', id, projectId: project.id } } }
    }
    label = scheduleLabelOf(instant)
    iso = new Date(instant).toISOString()
  }
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.schedule = label
    o.scheduleAt = iso
    o.preflightAt = undefined
    if (o.status === 'ready') o.status = 'draft'
    o.updated = formatDemoInstant(clock.now())
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: label ? 'Scheduled operation' : 'Cleared operation schedule', obj: id, projectId: project.id, result: 'Success', reason: label ? `Start ${label} (UTC+7)` : 'Manual start after preflight' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((o) => o.id === id)!, scheduleInstant: instant } }
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
  conversation?: Db['conversations'][number]
  branchGroups: Db['branchGroups']
  /** Project-level execution eligibility label derived from canonical state. */
  eligibility: { kind: EligKind; label: string }
}

export function operationDetail(db: Db, ctx: RequestContext, id: string): ServiceResult<OperationDetailRead> {
  const op = db.operations.find((o) => o.id === id)
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.`, entity: { kind: 'operation', id: op.id, projectId: op.projectId } } }
  }
  const project = db.projects.find((p) => p.id === op.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  const plan = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  return {
    ok: true,
    data: {
      op,
      project,
      plan,
      planLabel: plan ? `${plan.id} ${planVer(plan)}` : undefined,
      playbook: db.playbooks.find((x) => x.id === op.playbookId),
      conversation: plan ? db.conversations.find((c) => c.id === plan.conversationId) : undefined,
      branchGroups: db.branchGroups.filter((g) => g.opId === op.id),
      eligibility: (({ kind, label }) => ({ kind, label }))(eligibility(db, op.projectId)),
    },
  }
}

/** The committed outcome of one preflight run: re-derived checks plus the op. */
export interface PreflightRunRead { op: Operation; checks: Check[]; pass: boolean; at: Instant }

/**
 * Runs preflight at the handler: the eight checks are RE-DERIVED from
 * canonical state at this instant — never read from a stored snapshot — and
 * the outcome (ready/draft, `preflightAt`, audit row) commits atomically. A
 * scope revision that invalidated the operation (ticket 21) is therefore
 * observed here: the re-run fails its check until the ROE is re-approved.
 */
export function runOperationPreflight(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<PreflightRunRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.`, entity: { kind: 'operation', id: op.id, projectId: op.projectId } } }
  }
  const project = db.projects.find((p) => p.id === op.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `The Viewer role has read-only access${projectLocked(project) ? ` (project ${project.id} is ${project.status})` : ''}; preflight cannot be run.` } }
  }
  if (!can({ id: ctx.actor.id, role: ctx.actor.role }, 'run', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can run preflight.' } }
  }
  if (IN_FLIGHT.includes(op.status)) {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${op.id} is ${op.status === 'estop' ? 'emergency stopped' : op.status} — preflight applies to Draft or Ready operations.` } }
  }
  const checks = computePreflightChecks(db, op, clock.now())
  const pass = preflightPass(checks)
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.preflightAt = formatDemoInstant(clock.now())
    if (o.status === 'draft' || o.status === 'ready' || o.status === 'pending') o.status = pass ? 'ready' : 'draft'
    o.updated = formatDemoInstant(clock.now())
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Ran preflight', obj: id, projectId: project.id, result: pass ? 'Passed' : 'Failed', reason: pass ? 'All eight checks passed' : checks.filter((c) => c.state !== 'pass').map((c) => c.code).join(', ') + ' failed' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((o) => o.id === id)!, checks, pass, at: clock.now() } }
}

/** The start gate outcome: the operation is eligible; the start transition itself stays with ticket 27. */
export interface OperationStartRead { op: Operation; checks: Check[] }

/**
 * The execution gate: re-derives the eight checks from canonical state at the
 * handler and refuses start with the first failing check's code, detail and
 * fix. This is the site the spec's "preflight gates execution" invariant
 * lives at — a stale snapshot or a scope revision cleared after the check can
 * never admit a start, because nothing is trusted but the current records.
 */
export function operationStartGate(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<OperationStartRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.`, entity: { kind: 'operation', id: op.id, projectId: op.projectId } } }
  }
  const project = db.projects.find((p) => p.id === op.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `The Viewer role has read-only access${projectLocked(project) ? ` (project ${project.id} is ${project.status})` : ''}; operations cannot be started.` } }
  }
  if (!can({ id: ctx.actor.id, role: ctx.actor.role }, 'run', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can start operations.' } }
  }
  if (IN_FLIGHT.includes(op.status)) {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${op.id} is ${op.status === 'estop' ? 'emergency stopped' : op.status} — it has already started.` } }
  }
  const checks = computePreflightChecks(db, op, clock.now())
  const firstBad = checks.find((c) => c.state !== 'pass')
  if (firstBad) {
    const why = firstBad.reason || firstBad.detail
    return {
      ok: false,
      failure: {
        kind: 'validation',
        message: `${firstBad.code} ${firstBad.state === 'review' ? 'is waiting' : 'failed'}: ${firstBad.detail} ${why}`.trim(),
        entity: { kind: 'operation', id: op.id, projectId: op.projectId },
      },
    }
  }
  return { ok: true, data: { op, checks } }
}

/* ═════════════ Ticket 27 — operation lifecycle controls ═════════════ */

/** Transcript time-of-day stamp (HH:MM:SS project time) from the injected clock. */
const tickOf = (clock: Clock) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(clock.now()))

/** Session states a normal stop terminates (legacy parity: 'awaiting' included). */
const STOP_SESSION_STATES: readonly string[] = ['connected', 'available', 'awaiting', 'suspended']
/** Session states completion terminates (legacy parity: 'awaiting' left open). */
const COMPLETE_SESSION_STATES: readonly string[] = ['connected', 'available', 'suspended']

/** The committed outcome of one lifecycle transition. */
export interface OperationTransitionRead { op: Operation }

const opEntity = (op: Operation) => ({ kind: 'operation' as const, id: op.id, projectId: op.projectId })

/** Addressed-operation gate shared by the control transitions: scope without
 * existence leak, membership, read-only and role gates with reasons. Ticket 29
 * appends the message overrides the review gate words its refusals with. */
function lifecycleGate(
  db: Db,
  ctx: RequestContext,
  op: Operation | undefined,
  verb: string,
  rolePhrase: string = `${verb} operations`,
  readonlyPhrase: string = verb,
): ServiceResult<{ op: Operation; project: Project }> {
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.`, entity: opEntity(op) } }
  }
  const project = db.projects.find((p) => p.id === op.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `The Viewer role has read-only access${projectLocked(project) ? ` (project ${project.id} is ${project.status})` : ''}; operations cannot be ${readonlyPhrase}.` } }
  }
  if (!can({ id: ctx.actor.id, role: ctx.actor.role }, 'run', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Manager or Operator can ${rolePhrase}.` } }
  }
  return { ok: true, data: { op, project } }
}

/** Creates the operation's first C2 session inside the start commit (legacy parity). */
function startSession(d: Db, o: Operation, at: string, tick: string): string {
  const ag = d.agents.find((a) => a.id === o.agents[0])
  const asset = d.assets.find((a) => a.id === o.assets[0])
  const ch = d.channels.find((c) => c.projectId === o.projectId) || d.channels[0]
  const id = 'SS-' + String(++d.counters.session).padStart(3, '0')
  d.sessions.unshift({ id, projectId: o.projectId, opId: o.id, agentId: ag?.id || '—', asset: asset?.name || '—', kind: 'reverse', channelId: ch?.id || '—', account: 'svc-demo', integrity: 'Standard', state: 'connected', started: at, last: at, grants: [], transcript: [{ ts: tick, who: 'system', text: `Session established via ${ch?.name || 'channel'} (demo).` }] })
  o.sessionId = id
  return id
}

/**
 * Starts an operation (ticket 27). The ticket-26 gate RE-DERIVES the eight
 * checks first — a start without a currently passing preflight, an expired or
 * rejected plan approval or a non-run role is refused with its reason and
 * commits nothing; nothing is trusted but the current records. The transition
 * itself is ONE atomic commit: run state, first-step dispatch, the agent
 * reservations (policy: one agent, one operation), project activation, the
 * first C2 session, the linked plan's executed transition and the audit row —
 * a partial start is impossible, and the single ChangeSet refreshes the
 * operation views and the agent fleet together.
 */
export function startOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<OperationTransitionRead> {
  const gate = operationStartGate(authority, clock, ctx, id)
  if (!gate.ok) return gate
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.status = 'running'; o.startedAt = at; o.updated = at
    o.steps.forEach((s, i) => { s.status = i === 0 ? 'running' : 'pending'; s.ts = i === 0 ? tick.slice(0, 5) : '—' })
    o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a) a.op = id })
    const p = d.projects.find((x) => x.id === o.projectId)!
    if (p.status === 'approved') p.status = 'active'
    if (!o.sessionId) startSession(d, o, at, tick)
    const pl = o.planId ? d.plans.find((x) => x.id === o.planId) : undefined
    if (pl && pl.status === 'approved') pl.status = 'executed'
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Started operation', obj: id, projectId: o.projectId, result: 'Success', reason: 'Preflight passed' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}

/**
 * Pauses a running operation: the reason is required (it is audited), and the
 * refusal paths (role, read-only, out-of-scope, anything not running) commit
 * nothing. Progress stops in one atomic commit with its stop attribution.
 */
export function pauseOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, reason: string): ServiceResult<OperationTransitionRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  const gated = lifecycleGate(db, ctx, op, 'pause')
  if (!gated.ok) return gated
  if (!reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to pause an operation. It is recorded in the audit log.', entity: opEntity(op!) } }
  }
  if (op!.status !== 'running') {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${id} is ${op!.status === 'estop' ? 'emergency stopped' : op!.status} — only a running operation can be paused.`, entity: opEntity(op!) } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.status = 'paused'; o.stopReason = reason; o.stopBy = ctx.actor.id; o.stopAt = at; o.updated = at
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Paused operation', obj: id, projectId: o.projectId, result: 'Success', reason })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}

/**
 * Resumes a paused operation after the rechecks the resume dialog previews,
 * now enforced at the handler: agents must be connected, a revised linked
 * plan needs re-approval, and stopped/estopped operations never resume
 * automatically. Success moves the run state in one atomic commit.
 */
export function resumeOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<OperationTransitionRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  const gated = lifecycleGate(db, ctx, op, 'resume')
  if (!gated.ok) return gated
  if (op!.status !== 'paused') {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${id} is ${op!.status === 'estop' ? 'emergency stopped' : op!.status} — it does not resume automatically. Only a paused operation can be resumed.`, entity: opEntity(op!) } }
  }
  const lost = op!.agents.filter((aid) => db.agents.find((x) => x.id === aid)?.status !== 'online')
  if (lost.length) {
    return { ok: false, failure: { kind: 'validation', message: `Cannot resume: ${lost.join(', ')} not connected. Restore the connection or replace the agent.`, entity: opEntity(op!) } }
  }
  const pl = op!.planId ? db.plans.find((x) => x.id === op!.planId) : undefined
  if (pl && !['approved', 'executed'].includes(pl.status)) {
    return { ok: false, failure: { kind: 'validation', message: `Cannot resume: revised plan ${pl.id} ${planVer(pl)} needs re-approval.`, entity: opEntity(op!) } }
  }
  /* Ticket 40: the approval is re-checked at resume time — a plan past its
   * absolute 24h deadline (stored status still `approved`) never resumes. */
  if (pl && !usableApproval(pl, clock.now()).ok) {
    return { ok: false, failure: { kind: 'validation', message: `Cannot resume: the approval of plan ${pl.id} ${planVer(pl)} expired ${pl.expires} — re-approve the plan before the operation can continue.`, entity: opEntity(op!) } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.status = 'running'; o.stopReason = undefined; o.updated = at
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Resumed operation', obj: id, projectId: o.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}

/**
 * The normal stop (ticket 27): the reason is required, and everything that
 * makes a stop real commits in the SAME atomic transaction — stopped state
 * and attribution, running steps → Unknown, queued steps → Not run, the agent
 * reservation release (policy: one agent, one operation) and linked session
 * termination. One ChangeSet, so the fleet and the operation views agree.
 */
export function stopOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, reason: string): ServiceResult<OperationTransitionRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  const gated = lifecycleGate(db, ctx, op, 'stop')
  if (!gated.ok) return gated
  if (!reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to stop an operation. It is recorded in the audit log.', entity: opEntity(op!) } }
  }
  if (op!.status !== 'running' && op!.status !== 'paused') {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${id} is ${op!.status === 'estop' ? 'emergency stopped' : op!.status} — only a running or paused operation can be stopped.`, entity: opEntity(op!) } }
  }
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.status = 'cancelled'; o.stopReason = reason; o.stopBy = ctx.actor.id; o.stopAt = at; o.updated = at
    o.steps.forEach((s) => { if (s.status === 'running') s.status = 'unknown'; if (s.status === 'pending') s.status = 'notrun' })
    o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === id) a.op = null })
    d.sessions.forEach((s) => { if (s.opId === id && STOP_SESSION_STATES.includes(s.state)) { s.state = 'terminated'; s.transcript.push({ ts: tick, who: 'system', text: 'Session terminated: operation stopped.' }) } })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Stopped operation', obj: id, projectId: o.projectId, result: 'Success', reason })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}

/**
 * Completes an active operation: refuses while any step is still running
 * (baseline invariant — wait for it or pause first) and releases the agent
 * reservations and linked sessions in the same atomic commit as the done
 * state, so completion never leaves a reserved agent behind.
 */
export function completeOperation(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<OperationTransitionRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  const gated = lifecycleGate(db, ctx, op, 'complete')
  if (!gated.ok) return gated
  if (op!.status !== 'running' && op!.status !== 'paused') {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${id} is ${op!.status === 'estop' ? 'emergency stopped' : op!.status} — only an active operation can be completed.`, entity: opEntity(op!) } }
  }
  if (op!.steps.some((s) => s.status === 'running')) {
    return { ok: false, failure: { kind: 'validation', message: 'Cannot complete: a step is still running. Wait for it to finish or use Pause.', entity: opEntity(op!) } }
  }
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(ctx.corr, (d) => {
    const o = d.operations.find((x) => x.id === id)!
    o.status = 'done'; o.updated = at
    o.steps.forEach((s) => { if (s.status === 'pending') s.status = 'notrun' })
    o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === id) a.op = null })
    d.sessions.forEach((s) => { if (s.opId === id && COMPLETE_SESSION_STATES.includes(s.state)) { s.state = 'terminated'; s.transcript.push({ ts: tick, who: 'system', text: 'Session terminated at operation completion.' }) } })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Completed operation', obj: id, projectId: o.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}

/* ═════════════ Ticket 29 — the human review gate ═════════════ */

/** A reviewer's decision on one review-gated step (the AI never decides). */
export type StepDecision = 'approve' | 'skip' | 'fail'

const DECISION_WORD: Record<StepDecision, { past: string; output: string }> = {
  approve: { past: 'approved', output: 'Sanitized output. No sensitive content.' },
  skip: { past: 'skipped', output: 'Skipped by operator.' },
  fail: { past: 'rejected', output: 'Rejected at review.' },
}

/**
 * Records a human reviewer's decision on one review-gated step (ticket 29).
 * The gate is re-derived HERE, independently of any screen: only a
 * Manager/Operator (never a read-only viewer or other role, never an AI
 * proposal path) may decide — and only on a running operation, on the one
 * step that is actually awaiting review, with a note for Skip/Reject. A
 * refusal commits nothing. Like every transition, the step outcome and its
 * audit row commit in ONE atomic ChangeSet.
 */
export function reviewOperationStep(
  authority: DbAuthority,
  clock: Clock,
  ctx: RequestContext,
  id: string,
  stepId: string,
  decision: StepDecision,
  note?: string,
): ServiceResult<OperationTransitionRead> {
  const db = authority.snapshot()
  const op = db.operations.find((o) => o.id === id)
  const gated = lifecycleGate(db, ctx, op, 'decide on review steps in', 'decide on review steps', 'given review decisions')
  if (!gated.ok) return gated
  const o = gated.data.op
  const reason = (note || '').trim()
  if (o.status !== 'running') {
    return { ok: false, failure: { kind: 'validation', message: `Operation ${id} is ${o.status === 'estop' ? 'emergency stopped' : o.status} — a review decision can only be recorded while it is running.`, entity: opEntity(o) } }
  }
  const step = o.steps.find((s) => s.id === stepId)
  if (!step) {
    return { ok: false, failure: { kind: 'validation', message: `Step ${stepId} was not found on operation ${id}.`, entity: opEntity(o) } }
  }
  if (step.status !== 'review') {
    return { ok: false, failure: { kind: 'validation', message: `Step ${stepId} (${step.name}) is not awaiting a reviewer decision — it is ${step.status}. No decision was recorded.`, entity: opEntity(o) } }
  }
  if (decision !== 'approve' && !reason) {
    return { ok: false, failure: { kind: 'validation', message: 'A reviewer note is required to Skip or Reject a step. It is recorded in the audit log.', entity: opEntity(o) } }
  }
  authority.commit(ctx.corr, (d) => {
    const st = d.operations.find((x) => x.id === id)!.steps.find((s) => s.id === stepId)!
    st.status = decision === 'approve' ? 'ok' : decision === 'skip' ? 'notrun' : 'fail'
    st.dur = decision === 'approve' ? '01:20' : '—'
    st.output = DECISION_WORD[decision].output
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: `Step review: ${decision}`, obj: `${id}/${stepId}`, projectId: o.projectId, result: 'Success', reason })
  })
  return { ok: true, data: { op: authority.snapshot().operations.find((x) => x.id === id)! } }
}
