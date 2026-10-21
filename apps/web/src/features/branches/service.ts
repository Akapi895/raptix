/**
 * Branch group reads + branch action handlers (ticket 43, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The multi-agent fanout read model lives here as feature-local handlers over
 * the one database authority: scope-checked group/branch reads (a non-member's
 * read is `not-found` without an existence leak; a member reading from another
 * project context is `forbidden` with the owning project on the entity ref)
 * plus the retry/reassign/cancel writes.
 *
 * Every write captures actor and project explicitly at call time and binds to
 * the addressed branch — its own projectId is the binding a late/switched
 * scope respects, so a persona/project switch never retargets an in-flight
 * action. Retry/reassign are requests: they preserve the source branch's
 * approval/preflight waiting states and never execute anything — the state
 * machine only records a pending request that approval and preflight must both
 * pass again. Cancel is a real terminal write: it requires a reason, refuses
 * terminal branches and writes the audit row in the same commit. Handlers
 * re-check role (`run`), read-only context, branch state and — for reassign —
 * agent eligibility (connected, assigned to the branch's project), so the UI
 * gates are presentation, not the enforcement site.
 */
import { can, projectAccessible, readOnlyContext } from '../../domain/policy'
import { BRANCH_LABEL, BRANCH_TERMINAL, toolFacets } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import { formatDemoInstant, type MockClock } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Agent, Audit, Branch, BranchState, BranchGroup, Facets, Project, ToolEvent } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

const CONN = (a?: Agent) => !!a && (a.status === 'online' || a.status === 'idle')
const aggregateScope = (ctx: RequestContext) => !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''

/** Live counts for one group. `missing` is derived, never inferred as success. */
export interface BranchCounts {
  total: number
  running: number
  done: number
  failed: number
  blocked: number
  waiting: number
  queued: number
  paused: number
  unknown: number
  /** Branches that have not reached a terminal state. */
  open: number
  /** Terminal-less results the fan-in step will never receive. */
  missing: number
  evidence: number
}

export function countsOf(db: Db, groupId: string): BranchCounts {
  const bs = db.branches.filter((b) => b.groupId === groupId)
  const n = (st: BranchState) => bs.filter((b) => b.state === st).length
  const done = n('completed')
  const failed = n('failed')
  const blocked = n('blocked')
  const open = bs.filter((b) => !BRANCH_TERMINAL.includes(b.state)).length
  const missing = bs.length - done - failed - n('cancelled') - blocked
  return {
    total: bs.length, running: n('running'), done, failed, blocked, waiting: n('waiting_approval'),
    queued: n('queued'), paused: n('paused'), unknown: n('unknown'), open, missing,
    evidence: bs.reduce((a, b) => a + b.evidence.length, 0),
  }
}

/** Group rollup. Degraded/Partially Completed are never reported as Completed. */
export function overallOf(c: BranchCounts): string {
  if (c.open > 0) return c.paused + c.unknown > 0 ? 'Degraded — branches paused or unknown' : 'In progress'
  return c.failed + c.blocked > 0 ? 'Partially Completed' : 'Completed'
}

/** One per-branch row of the group read: canonical branch + observed agent state. */
export interface BranchRow {
  branch: Branch
  agentConnected: boolean
  /** Proposed valid replacement when the branch agent is disconnected (paused/unknown). */
  replacement?: { id: string; host: string }
}

export interface BranchGroupListItem {
  group: BranchGroup
  counts: BranchCounts
  overall: string
}

export interface BranchGroupListRead {
  groups: BranchGroupListItem[]
}

export interface BranchGroupDetailRead {
  group: BranchGroup
  rows: BranchRow[]
  counts: BranchCounts
  overall: string
}

export interface BranchDetailRead {
  branch: Branch
  agent?: Agent
  agentConnected: boolean
  /** Proposed valid replacement while the agent is disconnected. */
  replacement?: { id: string; host: string }
  /** Same-project agents eligible as reassign targets (excludes the current one). */
  reassignCandidates: { id: string; host: string; connected: boolean }[]
  toolEvent?: ToolEvent
  facets: Facets | null
  /** Approval/branch audit rows for this branch (object or correlation match). */
  audits: Audit[]
  /** In-scope asset matching the branch target, for the View Target link. */
  assetId?: string
  /** Branches in the group (the cancel impact line). */
  groupSize: number
}

export interface BranchService {
  /** Scope-checked group overview ('all' aggregates accessible projects). */
  listGroups(ctx: RequestContext): Promise<ServiceResult<BranchGroupListRead>>
  /** One group with per-branch rows, timelines and rollup; cross-context is refused with the owning project. */
  getGroup(ctx: RequestContext, id: string): Promise<ServiceResult<BranchGroupDetailRead>>
  /** One branch with its display joins; cross-context is refused with the owning project. */
  get(ctx: RequestContext, id: string): Promise<ServiceResult<BranchDetailRead>>
  /** Requests a retry — pending approval; nothing runs. */
  retry(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<Branch>>
  /** Requests reassignment to a connected project agent — pending approval. */
  reassign(ctx: RequestContext, id: string, agentId: string, reason: string): Promise<ServiceResult<Branch>>
  /** Cancels the branch: reason required, terminal branches refused, audited. */
  cancel(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<Branch>>
}

/** Eligible replacement: connected same-project agent with the lightest open load. */
function replacementFor(db: Db, b: Branch): Agent | undefined {
  const load = (id: string) => db.branches.filter((x) => x.agent === id && !BRANCH_TERMINAL.includes(x.state)).length
  return db.agents
    .filter((a) => a.projectId === b.projectId && CONN(a) && a.id !== b.agent)
    .sort((x, y) => load(x.id) - load(y.id))[0]
}

function rowOf(db: Db, b: Branch, degraded: boolean): BranchRow {
  const agent = db.agents.find((a) => a.id === b.agent)
  const lost = !CONN(agent)
  const repl = lost && degraded ? replacementFor(db, b) : undefined
  return {
    branch: b,
    agentConnected: !!CONN(agent),
    replacement: repl ? { id: repl.id, host: repl.host } : undefined,
  }
}

/**
 * Pure list handler. A specific projectId reads only that project's groups and
 * only for members; `'all'`/`''` aggregates across the actor's accessible
 * projects. Out-of-scope reads are not-found — never a leaked existence signal.
 */
export function listBranchGroups(db: Db, ctx: RequestContext): ServiceResult<BranchGroupListRead> {
  const aggregate = aggregateScope(ctx)
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Branch groups for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const groups = db.branchGroups.filter((g) => (aggregate ? accessible.has(g.projectId) : g.projectId === pid))
  return {
    ok: true,
    data: {
      groups: groups.map((group) => {
        const counts = countsOf(db, group.id)
        return { group, counts, overall: overallOf(counts) }
      }),
    },
  }
}

/** One scope-checked group read: not-found outside access, forbidden cross-context. */
export function getBranchGroup(db: Db, ctx: RequestContext, id: string): ServiceResult<BranchGroupDetailRead> {
  const g = db.branchGroups.find((x) => x.id === id)
  const project = g ? db.projects.find((p) => p.id === g.projectId) : undefined
  if (!g || !project || !projectAccessible(project, ctx.actor)) {
    return {
      ok: false,
      failure: {
        kind: 'not-found',
        message: `Branch group ${id} does not exist or is not available for your account.`,
        entity: { kind: 'branch-group', id, projectId: g?.projectId },
      },
    }
  }
  if (!aggregateScope(ctx) && ctx.projectId !== g.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Branch group ${id} belongs to project ${g.projectId}. Switch to that project to view it.`,
        entity: { kind: 'branch-group', id, projectId: g.projectId },
      },
    }
  }
  const bs = db.branches.filter((b) => b.groupId === id)
  const counts = countsOf(db, id)
  const degraded = counts.paused + counts.unknown > 0
  return { ok: true, data: { group: g, rows: bs.map((b) => rowOf(db, b, degraded)), counts, overall: overallOf(counts) } }
}

/** One scope-checked branch read with the display joins the inspector renders. */
export function getBranchDetail(db: Db, ctx: RequestContext, id: string): ServiceResult<BranchDetailRead> {
  const b = db.branches.find((x) => x.id === id)
  const project = b ? db.projects.find((p) => p.id === b.projectId) : undefined
  if (!b || !project || !projectAccessible(project, ctx.actor)) {
    return {
      ok: false,
      failure: {
        kind: 'not-found',
        message: `Branch ${id} does not exist or is not available for your account.`,
        entity: { kind: 'branch', id, projectId: b?.projectId },
      },
    }
  }
  if (!aggregateScope(ctx) && ctx.projectId !== b.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Branch ${id} belongs to project ${b.projectId}. Switch to that project to view it.`,
        entity: { kind: 'branch', id, projectId: b.projectId },
      },
    }
  }
  const agent = db.agents.find((a) => a.id === b.agent)
  const toolEvent = b.toolEventId ? db.toolEvents.find((t) => t.id === b.toolEventId) : undefined
  const asset = db.assets.find((x) => x.projectId === b.projectId && (x.name === b.target || x.ident === b.target))
  return {
    ok: true,
    data: {
      branch: b,
      agent,
      agentConnected: CONN(agent),
      replacement: !CONN(agent) ? orNone(replacementFor(db, b)) : undefined,
      reassignCandidates: db.agents
        .filter((a) => a.projectId === b.projectId && a.id !== b.agent)
        .map((a) => ({ id: a.id, host: a.host, connected: CONN(a) })),
      toolEvent,
      facets: toolEvent ? toolFacets(toolEvent) : null,
      audits: db.audit.filter((a) => a.obj === b.id || a.corr === b.corr),
      assetId: asset?.id,
      groupSize: db.branches.filter((x) => x.groupId === b.groupId).length,
    },
  }
}

const orNone = (a?: Agent) => (a ? { id: a.id, host: a.host } : undefined)

const refused = (kind: 'validation' | 'forbidden' | 'not-found', message: string, branch: Branch): ServiceResult<never> => ({
  ok: false,
  failure: { kind, message, entity: { kind: 'branch', id: branch.id, projectId: branch.projectId } },
})

/* ── Writes: addressed-branch gate shared by every action. The aggregate scope
   is allowed (the write binds to the branch's own project either way); role,
   read-only and membership checks are re-enforced here, not in the screen. ── */

function addressBranch(db: Db, ctx: RequestContext, id: string, verb: 'view' | 'act on'): ServiceResult<{ branch: Branch; project: Project }> {
  const branch = db.branches.find((x) => x.id === id)
  const project = branch ? db.projects.find((p) => p.id === branch.projectId) : undefined
  if (!branch || !project || !projectAccessible(project, ctx.actor)) {
    return refused('not-found', `Branch ${id} does not exist or is not available for your account.`, branch ?? ({ id } as Branch))
  }
  if (!aggregateScope(ctx) && ctx.projectId !== branch.projectId) {
    return refused('forbidden', `Branch ${id} belongs to project ${branch.projectId}. Switch to that project to ${verb} it.`, branch)
  }
  if (readOnlyContext(project, ctx.actor)) {
    return refused('forbidden', `This project is read-only${project.status === 'closed' ? ` (project ${project.id} is closed)` : ''}: branch actions cannot be requested here.`, branch)
  }
  if (!can(ctx.actor, 'run', project)) {
    return refused('forbidden', 'Your role cannot run or modify operations in this project.', branch)
  }
  return { ok: true, data: { branch, project } }
}

const RETRYABLE: readonly BranchState[] = ['failed', 'cancelled', 'unknown', 'paused']

/**
 * Requests a retry for a retryable branch. The source branch keeps its state;
 * the request itself becomes the pending thing: approval goes back to
 * `pending` and the last event names both approval and preflight, so nothing
 * is silently executed and no waiting state is bypassed.
 */
export function requestBranchRetry(authority: DbAuthority, clock: MockClock, ctx: RequestContext, id: string, reason: string): ServiceResult<Branch> {
  const db = authority.snapshot()
  const addressed = addressBranch(db, ctx, id, 'act on')
  if (!addressed.ok) return addressed
  const { branch } = addressed.data
  const why = branch.pendingRequest
    ? `A ${branch.pendingRequest} request is already pending approval.`
    : RETRYABLE.includes(branch.state) ? '' : 'Only failed, cancelled, paused or unknown branches can be retried.'
  if (why) return refused('validation', why, branch)
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const x = d.branches.find((y) => y.id === id)!
    x.pendingRequest = 'retry'
    x.approval = 'pending'
    x.lastEvent = 'Retry requested — awaiting approval and preflight'
    x.timeline.push({ at, text: `Retry requested: ${reason}` })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Requested branch retry', obj: id, projectId: branch.projectId, result: 'Pending', reason })
  })
  return { ok: true, data: authority.snapshot().branches.find((x) => x.id === id)! }
}

/**
 * Requests reassignment to an eligible agent: connected and assigned to the
 * branch's project (the shared pool needs an explicit assignment first). The
 * old assignment stays in the assignment log; the request waits for approval.
 */
export function requestBranchReassign(authority: DbAuthority, clock: MockClock, ctx: RequestContext, id: string, agentId: string, reason: string): ServiceResult<Branch> {
  const db = authority.snapshot()
  const addressed = addressBranch(db, ctx, id, 'act on')
  if (!addressed.ok) return addressed
  const { branch } = addressed.data
  const stateWhy = branch.pendingRequest
    ? `A ${branch.pendingRequest} request is already pending approval.`
    : ['completed', 'cancelled'].includes(branch.state) ? `A ${BRANCH_LABEL[branch.state]} branch cannot be reassigned.` : ''
  if (stateWhy) return refused('validation', stateWhy, branch)
  const ag = db.agents.find((a) => a.id === agentId)
  const agentWhy = !ag
    ? 'Agent not found.'
    : !CONN(ag)
      ? `${agentId} is not connected. Disconnected agents can't be assigned.`
      : ag.projectId && ag.projectId !== branch.projectId
        ? `${agentId} belongs to another project.`
        : !ag.projectId
          ? `${agentId} is in the shared pool. Request assignment to ${branch.projectId} first.`
          : ''
  if (agentWhy) return refused('validation', agentWhy, branch)
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const x = d.branches.find((y) => y.id === id)!
    x.assignLog.push({ at, text: `Reassignment ${x.agent} → ${agentId} requested: ${reason}` })
    x.pendingRequest = 'reassign'
    x.approval = 'pending'
    x.lastEvent = `Reassignment to ${agentId} awaiting approval`
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Requested branch reassignment', obj: id, projectId: branch.projectId, result: 'Pending', reason: `${branch.agent} → ${agentId}: ${reason}` })
  })
  return { ok: true, data: authority.snapshot().branches.find((x) => x.id === id)! }
}

/** Cancels the branch: reason required, non-terminal only, audited in the same commit. */
export function cancelBranch(authority: DbAuthority, clock: MockClock, ctx: RequestContext, id: string, reason: string): ServiceResult<Branch> {
  const db = authority.snapshot()
  const addressed = addressBranch(db, ctx, id, 'act on')
  if (!addressed.ok) return addressed
  const { branch } = addressed.data
  if (!reason.trim()) return refused('validation', 'A reason is required to cancel a branch.', branch)
  if (BRANCH_TERMINAL.includes(branch.state)) {
    return refused('validation', `A ${BRANCH_LABEL[branch.state]} branch is already finished and cannot be cancelled.`, branch)
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const x = d.branches.find((y) => y.id === id)!
    x.state = 'cancelled'
    x.pendingRequest = undefined
    x.lastEvent = 'Cancelled by user'
    x.timeline.push({ at, text: `Cancelled: ${reason}` })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Cancelled branch', obj: id, projectId: branch.projectId, result: 'Success', reason })
  })
  return { ok: true, data: authority.snapshot().branches.find((x) => x.id === id)! }
}

/** Builds the typed branch service; `guard` is the factory's superseded-scope read guard. */
export function createBranchService(
  authority: DbAuthority,
  clock: MockClock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): BranchService {
  return {
    listGroups: (ctx) => guard(() => listBranchGroups(authority.snapshot(), ctx)),
    getGroup: (ctx, id) => guard(() => getBranchGroup(authority.snapshot(), ctx, id)),
    get: (ctx, id) => guard(() => getBranchDetail(authority.snapshot(), ctx, id)),
    // Writes capture ctx at call time and commit once; they are never cancelled
    // mid-flight (the factory's superseded-scope guard only covers reads).
    retry: (ctx, id, reason) => Promise.resolve(requestBranchRetry(authority, clock, ctx, id, reason)),
    reassign: (ctx, id, agentId, reason) => Promise.resolve(requestBranchReassign(authority, clock, ctx, id, agentId, reason)),
    cancel: (ctx, id, reason) => Promise.resolve(cancelBranch(authority, clock, ctx, id, reason)),
  }
}
