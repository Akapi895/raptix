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
import { parseDemoInstant, formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Agent, Asset, Operation, Plan, Playbook, Project, Step } from '../../domain/entities'
import type { Clock, Instant, RequestContext, ServiceResult } from '../../domain/service'

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
    return {
      op,
      planLabel: pl ? `${pl.id} ${planVer(pl)}` : undefined,
      playbookName: !pl ? playbookById.get(op.playbookId)?.name : undefined,
      roeVersion: projectById.get(op.projectId)?.roeVersion,
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
  }
}

/* ═════════════ Ticket 25 — schedule instants, draft options, creation/edit/schedule ═════════════ */

/** Project timezone offset (Asia/Ho_Chi_Minh, UTC+7): display/window checks only. */
export const PROJECT_TZ_OFFSET_MS = 7 * 60 * 60 * 1000

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Normalizes a datetime-local value at the service boundary: the absolute
 * instant (true epoch ms) of that wall-clock time in the project timezone.
 * Undefined for anything that is not a real calendar instant.
 */
export function scheduleInstantOf(v: string | undefined): Instant | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((v || '').trim())
  if (!m) return undefined
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return undefined
  const instant = Date.UTC(y, mo - 1, d, h, mi) - PROJECT_TZ_OFFSET_MS
  const wall = new Date(instant + PROJECT_TZ_OFFSET_MS)
  if (wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return undefined
  return instant
}

/** UTC+7 wall-clock projection of an instant — the canonical `Operation.schedule` string. */
export function scheduleLabelOf(instant: Instant): string {
  const w = new Date(instant + PROJECT_TZ_OFFSET_MS)
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}T${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`
}

/**
 * The one ROE window rule (Mon–Fri, 9:00 AM–5:00 PM project time) over an
 * absolute instant. The screen-layer helper delegates its wall-clock input.
 */
export function roeWindowIssue(project: Pick<Project, 'window'> | undefined, instant: Instant): string {
  const w = new Date(instant + PROJECT_TZ_OFFSET_MS)
  const day = w.getUTCDay()
  const hour = w.getUTCHours() + w.getUTCMinutes() / 60
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17
    ? ''
    : `Start time is outside the ROE window (${project?.window || 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)'}).`
}

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

/** Edits a draft: invalidates stale preflight, refuses in-flight operations, preserves baseline edit semantics. */
export function updateOperationDraft(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, patch: OperationDraftPatch): ServiceResult<OperationWriteRead> {
  const db = authority.snapshot()
  const gated = addressedOperationGate(db, ctx, db.operations.find((o) => o.id === id), 'edit operations', 'edited')
  if (!gated.ok) return gated
  const { op } = gated.data
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
