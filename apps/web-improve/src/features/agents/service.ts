/**
 * Agent fleet read model (ticket 48, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the fleet list and agent detail: scope-checked
 * reads over the one database authority. Every request captures actor and
 * project explicitly; a non-member's specific-project read is denied with
 * `not-found` (no existence leak), and an agent in an accessible project
 * outside the active project context is refused with `forbidden` and the
 * owning project on the entity ref (the screen can offer an explicit
 * switch). Pool agents (projectId '') are shared inventory: visible in every
 * scope, never counted as a project's agents. Status and reservations
 * describe the last observed state — never a guarantee of execution ability.
 * Reads are pure projections — mutations stay with the legacy actions until
 * ticket 49 migrates allocation, and the health-failure replacement flow
 * stays with the operations features.
 */
import { projectAccessible, can as policyCan } from '../../auth/policy'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Agent, AgentStatus, BranchState, ProjectStatus } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Which slice of the scoped base the list returns ('all' also backs the connectivity tab). */
export type AgentListMode = 'all' | 'project' | 'pool'

/** KPI pill filter keys ('' = unfiltered is handled by omitting the field). */
export type AgentKpi = 'conn' | 'lost' | 'assigned' | 'avail' | 'busy' | 'attn'

/** Filter state for the fleet list (all optional; empty = unfiltered). */
export interface AgentListQuery {
  mode?: AgentListMode
  /** Case-insensitive substring over id + hostname + IP. */
  q?: string
  /** One AgentStatus value. */
  status?: string
  os?: string
  /** Explicit project filter (aggregate view, project mode only). */
  project?: string
  group?: string
  /** KPI pill filter. */
  kpi?: AgentKpi
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
  /** Row cap override (the connectivity tab reads the whole scoped base). */
  pageSize?: number
}

/** One table row: the canonical agent plus the decorations its columns render. */
export interface AgentListItem {
  agent: Agent
  /** Active C2 sessions on this agent within the request scope. */
  sessions: number
  /** Pending assignment approval, when one is in review for this agent. */
  pendingAssignment?: { id: string; by: string; at: string; reviewer: string }
}

/** Whole-base counts for the KPI pills and tab badges (never mode-filtered). */
export interface AgentKpis {
  connected: number
  connectedAssigned: number
  connectedPool: number
  disconnected: number
  assigned: number
  pool: number
  poolAvailable: number
  busy: number
  attention: number
}

/** The whole list read: page + KPI counts + filter options + banner data. */
export interface AgentListRead {
  items: AgentListItem[]
  page: number
  pageSize: number
  total: number
  kpis: AgentKpis
  groups: string[]
  osList: string[]
  projects: string[]
  /** Assigned agents currently disconnected (fleet banner data). */
  lostAssigned: { id: string; host: string; lastSeen: string }[]
}

export interface AgentOpRef { id: string; name: string; projectId: string; status: string; startedAt: string }
export interface AgentSessionRef { id: string; asset: string; state: string; channelId: string; projectId: string }
export interface AgentBranchRef { id: string; state: BranchState; target: string; tool: string; opId: string; groupId: string }
export type AgentHistoryTone = 'warn' | 'accent' | 'bad' | 'neutral'
export interface AgentHistoryItem { at: string; title: string; sub: string; tone: AgentHistoryTone }

/** One detail read: agent + observed-health presentation data. */
export interface AgentDetailRead {
  agent: Agent
  /** Owning project; undefined for a pool agent. */
  project?: { id: string; name: string; status: ProjectStatus }
  group?: { name: string; policy: string }
  /** Operations that reference the agent, within scope (observation history). */
  operations: AgentOpRef[]
  /** Active sessions within scope. */
  activeSessions: AgentSessionRef[]
  /** Fan-out branches last handled by the agent, within scope. */
  branches: AgentBranchRef[]
  /** Audit trail + heartbeat observations, newest first. */
  history: AgentHistoryItem[]
  /** Pool only: accessible projects whose status permits assignment. */
  eligibleProjects: string[]
  canViewSensitive: boolean
}

export interface AgentService {
  list(ctx: RequestContext, query?: AgentListQuery): Promise<ServiceResult<AgentListRead>>
  get(ctx: RequestContext, id: string): Promise<ServiceResult<AgentDetailRead>>
}

const CONN: readonly AgentStatus[] = ['online', 'idle']
const ATTN: readonly AgentStatus[] = ['lost', 'unknown', 'disabled', 'unhealthy']
const ACTIVE_PROJECT: readonly ProjectStatus[] = ['active', 'approved']
const SESSION_ACTIVE: readonly string[] = ['connected', 'available', 'awaiting']
const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

const conn = (a: Agent) => CONN.includes(a.status)

function matchesKpi(a: Agent, kpi: AgentKpi | undefined): boolean {
  switch (kpi) {
    case 'conn': return conn(a)
    case 'lost': return a.status === 'lost'
    case 'assigned': return !!a.projectId
    case 'avail': return !a.projectId && conn(a) && !a.op
    case 'busy': return !!a.op
    case 'attn': return ATTN.includes(a.status)
    default: return true
  }
}

/** Base set for the scope: aggregate folds in accessible projects' agents plus the pool; a specific project reads its own agents plus the pool. */
function scopedAgents(db: Db, ctx: RequestContext, accessible: Set<string>): Agent[] {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (aggregate) return db.agents.filter((a) => a.projectId === '' || accessible.has(a.projectId))
  return db.agents.filter((a) => a.projectId === ctx.projectId || a.projectId === '')
}

/** Scope predicate for related rows (sessions/branches/audit) of one agent read. */
function inScope(ctx: RequestContext, accessible: Set<string>, projectId: string): boolean {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  return aggregate ? accessible.has(projectId) : projectId === ctx.projectId
}

const pendingAssignmentOf = (db: Db, agentId: string) => {
  const x = db.approvals.find((ap) => ap.type.startsWith('Agent assignment') && ap.status === 'pending' && (ap.diff || '').includes(agentId))
  return x ? { id: x.id, by: x.by, at: x.at, reviewer: x.reviewer } : undefined
}

/**
 * Pure list handler. KPIs and filter options always derive from the whole
 * scoped base (pool included), so pills and tab badges stay live regardless
 * of the active mode/filter; `items` apply the mode + filters + page.
 */
export function listAgents(db: Db, ctx: RequestContext, query: AgentListQuery = {}): ServiceResult<AgentListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Agents for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = scopedAgents(db, ctx, accessible)
  const kpis: AgentKpis = {
    connected: base.filter(conn).length,
    connectedAssigned: base.filter((a) => a.projectId && conn(a)).length,
    connectedPool: base.filter((a) => !a.projectId && conn(a)).length,
    disconnected: base.filter((a) => a.status === 'lost').length,
    assigned: base.filter((a) => !!a.projectId).length,
    pool: base.filter((a) => !a.projectId).length,
    poolAvailable: base.filter((a) => !a.projectId && conn(a) && !a.op).length,
    busy: base.filter((a) => !!a.op).length,
    attention: base.filter((a) => ATTN.includes(a.status)).length,
  }
  const mode = query.mode === 'pool' ? 'pool' : query.mode === 'project' ? 'project' : 'all'
  const sliced = base.filter((a) => (mode === 'pool' ? a.projectId === '' : mode === 'project' ? a.projectId !== '' : true))
  const q = (query.q || '').toLowerCase()
  const rows = sliced.filter((a) =>
    (!q || (a.id + a.host + a.ip).toLowerCase().includes(q)) &&
    (!query.status || a.status === query.status) &&
    (!query.os || a.os === query.os) &&
    (!query.project || a.projectId === query.project) &&
    (!query.group || a.group === query.group) &&
    matchesKpi(a, query.kpi))
  const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const items: AgentListItem[] = rows
    .slice((page - 1) * pageSize, page * pageSize)
    .map((agent) => ({
      agent,
      sessions: db.sessions.filter((s) => s.agentId === agent.id && SESSION_ACTIVE.includes(s.state) && inScope(ctx, accessible, s.projectId)).length,
      pendingAssignment: pendingAssignmentOf(db, agent.id),
    }))
  return {
    ok: true,
    data: {
      items, page, pageSize, total: rows.length, kpis,
      groups: [...new Set(sliced.map((a) => a.group).filter(Boolean))],
      osList: [...new Set(sliced.map((a) => a.os))],
      projects: [...new Set(sliced.map((a) => a.projectId).filter(Boolean))],
      lostAssigned: base.filter((a) => a.status === 'lost' && !!a.projectId).map((a) => ({ id: a.id, host: a.host, lastSeen: a.lastSeen })),
    },
  }
}

/**
 * Pure detail handler. An agent outside the actor's access is `not-found`
 * (indistinguishable from a missing one); an assigned agent outside the
 * active project context is `forbidden` with the owning project on the
 * entity ref and no content. Pool agents are shared inventory and readable
 * in every scope. Everything presented describes the last observation —
 * history, sessions and branches are scoped to the request's project.
 */
export function getAgent(db: Db, ctx: RequestContext, id: string): ServiceResult<AgentDetailRead> {
  const notFound = { ok: false as const, failure: { kind: 'not-found' as const, message: `Agent ${id} does not exist or is not available for your account.`, entity: { kind: 'agent' as const, id } } }
  const a = db.agents.find((x) => x.id === id)
  if (!a) return notFound
  const project = a.projectId ? db.projects.find((p) => p.id === a.projectId) : undefined
  if (a.projectId && (!project || !projectAccessible(project, ctx.actor))) return notFound
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  if (!aggregate && a.projectId && ctx.projectId !== a.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Agent ${id} is assigned to ${a.projectId}. Switch to that project to view its data.`,
        entity: { kind: 'agent', id, projectId: a.projectId },
      },
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const operations = db.operations
    .filter((o) => o.agents.includes(a.id) && inScope(ctx, accessible, o.projectId))
    .map((o) => ({ id: o.id, name: o.name, projectId: o.projectId, status: o.status, startedAt: o.startedAt }))
  const activeSessions = db.sessions
    .filter((s) => s.agentId === a.id && SESSION_ACTIVE.includes(s.state) && inScope(ctx, accessible, s.projectId))
    .map((s) => ({ id: s.id, asset: s.asset, state: s.state, channelId: s.channelId, projectId: s.projectId }))
  const branches = db.branches
    .filter((b) => b.agent === a.id && inScope(ctx, accessible, b.projectId))
    .map((b) => ({ id: b.id, state: b.state, target: b.target, tool: b.tool, opId: b.opId, groupId: b.groupId }))
  const grp = a.group ? db.groups.find((g) => g.name === a.group) : undefined
  const history: AgentHistoryItem[] = [
    ...db.audit
      .filter((x) => (x.obj === a.id || x.obj.includes(a.id)) && inScope(ctx, accessible, x.projectId))
      .map((x) => ({ at: x.at, title: `${x.action} — ${x.actor}`, sub: x.reason ? `Reason: ${x.reason}` : x.result, tone: (x.result === 'Warning' ? 'warn' : 'accent') as AgentHistoryTone })),
    ...(a.status === 'lost' ? [{ at: a.lastSeen, title: 'Disconnected — last heartbeat recorded', sub: 'Status reflects the most recent observation.', tone: 'bad' as const }] : []),
    { at: a.lastSeen, title: `Latest heartbeat (${a.status === 'lost' ? 'last received' : 'normal'})`, sub: a.conn, tone: 'neutral' as const },
  ]
  const eligibleProjects = db.projects.filter((p) => accessible.has(p.id) && ACTIVE_PROJECT.includes(p.status)).map((p) => p.id)
  return {
    ok: true,
    data: {
      agent: a,
      project: project ? { id: project.id, name: project.name, status: project.status } : undefined,
      group: grp ? { name: grp.name, policy: grp.policy } : undefined,
      operations, activeSessions, branches, history, eligibleProjects,
      canViewSensitive: policyCan(ctx.actor, 'viewSensitive', project),
    },
  }
}

/** Builds the typed agent service; `guard` is the factory's superseded-scope read guard. */
export function createAgentService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): AgentService {
  return {
    list: (ctx, query) => guard(() => listAgents(authority.snapshot(), ctx, query)),
    get: (ctx, id) => guard(() => getAgent(authority.snapshot(), ctx, id)),
  }
}
