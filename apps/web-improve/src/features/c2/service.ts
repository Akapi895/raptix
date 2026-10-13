/**
 * C2 overview, channels and session-list read model (ticket 45, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local read handlers for the five-tab C2 shell over the one
 * database authority. Scoping follows the legacy seam exactly: a specific
 * project read is `not-found` for a non-member (no existence leak), the
 * aggregate view folds accessible projects (pool agents count as connected
 * inventory, workspace audit rows stay visible), and every session row
 * reports its connection state separately from the actor's access grant —
 * "Connected" never implies "interactive" and an ended state never fakes a
 * termination that the recorded stop machine did not perform. Grant expiry
 * is not evaluated here (ticket 46 owns the deadline lifecycle — see
 * ./grants); access reflects recorded grants/requests as-is, with the
 * grant deadline checked where it matters (the command handler and the
 * factory-registered sweep). Request/grant mutations run through the
 * feature-local transactions in ./grants — every commit publishes the
 * session / session-request / audit ChangeSets these reads observe.
 */
import { projectAccessible, can as policyCan } from '../../auth/policy'
import { parseDemoInstant } from '../../domain/clock'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Agent, Asset, Audit, C2Node, Channel, Session, SessionPerm, SessionRequest, SessionState } from '../../domain/entities'
import type { Instant, RequestContext, ServiceResult } from '../../domain/service'

/* ───────────── Access derivation (connection ≠ permission) ───────────── */

export type C2AccessKey = 'none' | 'read-only' | 'interactive' | 'pending' | 'expired' | 'rejected' | 'changes'
export interface C2AccessInfo { key: C2AccessKey; label: string; tone: 'ok' | 'warn' | 'bad' | 'cyan' | 'neutral'; detail?: string }

export type C2Perm = 'none' | 'read-only' | 'interactive'

/** Recorded per-user permission for one session (viewer ⇒ none; grant ⇒ grant perm; member ⇒ read-only). */
export function sessionPermOf(db: Db, ctx: RequestContext, s: Session): C2Perm {
  if (ctx.actor.role === 'viewer' || !projectAccessible(db.projects.find((p) => p.id === s.projectId), ctx.actor)) return 'none'
  const g = s.grants.find((x) => x.user === ctx.actor.id)
  return g ? g.perm : 'read-only'
}

/** The actor's access state for one session, derived only from recorded grants/requests. */
export function accessOf(db: Db, ctx: RequestContext, s: Session): C2AccessInfo {
  if (sessionPermOf(db, ctx, s) === 'none') return { key: 'none', label: 'None', tone: 'neutral', detail: 'No access to this project' }
  if (['terminated', 'revoking'].includes(s.state)) return { key: 'none', label: 'None', tone: 'neutral', detail: 'Session ended' }
  const g = s.grants.find((x) => x.user === ctx.actor.id)
  if (g) {
    const until = g.expires.replace('Oct 13, 2026, ', '')
    return g.perm === 'interactive'
      ? { key: 'interactive', label: `Interactive until ${until}`, tone: 'warn' }
      : { key: 'read-only', label: `Read-only until ${until}`, tone: 'cyan' }
  }
  const last = db.sessionRequests.find((r) => r.sessionId === s.id && r.by === ctx.actor.id)
  if (last?.status === 'pending') return { key: 'pending', label: 'Pending request', tone: 'warn', detail: last.id }
  if (last?.status === 'expired') return { key: 'expired', label: 'Expired — read-only', tone: 'neutral', detail: last.id }
  if (last?.status === 'rejected') return { key: 'rejected', label: 'Request rejected — read-only', tone: 'bad', detail: last.id }
  if (last?.status === 'changes') return { key: 'changes', label: 'Changes requested — read-only', tone: 'warn', detail: last.id }
  return { key: 'read-only', label: 'Read-only', tone: 'cyan' }
}

/* ───────────── Overview (KPI band, infrastructure, banners) ───────────── */

/** One infrastructure row: the canonical node plus in-scope channel/session decorations. */
export interface C2NodeRow extends C2Node {
  /** Channels of this node within the request scope. */
  channelIds: string[]
  /** Connected, scope-visible sessions routed through this node. */
  connectedVia: number
  /** Scope-visible sessions routed through this node regardless of state. */
  relatedSessions: number
}

export interface C2OverviewRead {
  nodes: C2NodeRow[]
  channels: Channel[]
  /** Live session counts within scope (active = still open, terminated = ended). */
  sessionCounts: { active: number; terminated: number }
  /** Connected or idle agents of the scope (pool agents count in aggregate). */
  connectedAgents: number
  /** Pending session-access requests within scope. */
  pending: number
  noC2: boolean
  noC2Reasons: string[]
}

/* ───────────── Session list (Active Sessions tab) ───────────── */

/** One session row: the canonical session plus the actor's access decoration. */
export interface C2SessionRow extends Session {
  access: C2AccessInfo
  /** The actor's own recorded grant expiry, when one exists. */
  grantExpires?: string
}

export interface C2SessionQuery {
  /** Case-insensitive substring over id + target + agent + operation. */
  q?: string
  connection?: 'all' | 'connected' | 'disconnected' | 'ended'
  type?: 'all' | 'reverse' | 'web'
  agent?: string
  op?: string
  access?: 'all' | C2AccessKey
  page?: number
}

export interface C2SessionListRead {
  items: C2SessionRow[]
  page: number
  pageSize: number
  total: number
  /** Filter options from the whole scoped base (never the filtered page). */
  agentIds: string[]
  opIds: string[]
}

const PAGE_SIZE = 10
const ENDED: readonly SessionState[] = ['terminated', 'revoking', 'expired']

/* ───────────── Requests + audit + channel detail ───────────── */

export interface C2RequestListRead {
  items: SessionRequest[]
  pending: number
}

export type C2AuditView = 'access' | 'events' | 'policy' | 'term'

export interface C2AuditQuery {
  view: C2AuditView
  /** Case-insensitive substring over correlation + object + actor + action. */
  q?: string
  page?: number
}

export interface C2AuditListRead {
  items: Audit[]
  page: number
  pageSize: number
  total: number
}

export interface C2ChannelDetailRead {
  channel: Channel
  node?: C2Node
  /** Sessions of this channel the actor may see (perm ≠ none), decorated. */
  sessions: C2SessionRow[]
  agents: { id: string; host: string; status: Agent['status']; lastSeen: string }[]
  operations: { id: string; name: string; status: string }[]
  /** Callback configuration and similar fields unmask only with the policy permission. */
  canViewSensitive: boolean
}

/* ───────────── Session detail (ticket 47: console + linked panels) ───────────── */

/** One evidence row of the session's operation; the sensitive identity masks without viewSensitive. */
export interface C2SessionEvidenceRow { id: string; name: string; kind: string; source: string; sensitive: boolean }

export interface C2SessionDetailRead {
  session: Session
  /** Recorded per-user permission for this session (viewer ⇒ none). */
  perm: C2Perm
  access: C2AccessInfo
  /** Sensitive unmasking gate — the shared `viewSensitive` policy action. */
  canViewSensitive: boolean
  project?: { id: string; name: string; roeVersion: string; window: string }
  op?: { id: string; name: string; owner: string; status: string }
  agent?: { id: string; host: string }
  /** Connection health of the channel/node as recorded — separate from the access grant. */
  channel?: { id: string; status: Channel['status']; last: string; nodeLatency?: string }
  asset?: { id: string; name: string; scope: Asset['scope'] }
  /** Access requests recorded for this session. */
  requests: SessionRequest[]
  /** The actor's own grant; `expiresAt` is the absolute instant when the display string parses. */
  myGrant?: { perm: SessionPerm; expires: string; by: string; expiresAt?: Instant }
  /** Audit rows for this session (newest first). */
  audit: Audit[]
  /** Evidence rows of the session's operation (sensitive names mask without viewSensitive). */
  evidence: C2SessionEvidenceRow[]
  /** Findings recorded against the session's target. */
  findings: { id: string; title: string }[]
}

export interface C2Service {
  /** Whole-shell overview: scoped nodes/channels, live session KPIs, readiness reasons. */
  overview(ctx: RequestContext): Promise<ServiceResult<C2OverviewRead>>
  /** Scoped, filtered, paged session rows with access decorations. */
  sessions(ctx: RequestContext, query?: C2SessionQuery): Promise<ServiceResult<C2SessionListRead>>
  /** Scoped access requests, pending first. */
  requests(ctx: RequestContext): Promise<ServiceResult<C2RequestListRead>>
  /** Scoped audit views (access/events/policy/termination) with search + page. */
  audit(ctx: RequestContext, query: C2AuditQuery): Promise<ServiceResult<C2AuditListRead>>
  /** One channel with its node, sessions, agents and operations. */
  channel(ctx: RequestContext, id: string): Promise<ServiceResult<C2ChannelDetailRead>>
  /** One session with its linked panels (scoped, masked per viewSensitive). */
  session(ctx: RequestContext, id: string): Promise<ServiceResult<C2SessionDetailRead>>
}

/* ───────────── Shared scoping (matches the legacy seam) ───────────── */

/** Accessible project ids for the actor; a specific out-of-scope project denies the read. */
function scopeSets(db: Db, ctx: RequestContext): ServiceResult<Set<string>> {
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (!aggregate && !accessible.has(ctx.projectId)) {
    return { ok: false, failure: { kind: 'not-found', message: 'C2 data for this project is not available for your account.' } }
  }
  return { ok: true, data: accessible }
}

const inProject = (projectId: string, ctx: RequestContext, accessible: Set<string>): boolean =>
  (!ctx.projectId || ctx.projectId === 'all') ? accessible.has(projectId) || projectId === '' : projectId === ctx.projectId

const connAgent = (a: Agent) => a.status === 'online' || a.status === 'idle'

/** The overview-visible session base of the scope: every scoped session (the legacy perm filter never narrows it — it only decorates). */
function scopedSessions(db: Db, ctx: RequestContext, accessible: Set<string>): Session[] {
  return db.sessions.filter((s) => inProject(s.projectId, ctx, accessible))
}

const AUDIT_VIEWS: Record<C2AuditView, RegExp> = {
  access: /access|grant/i,
  events: /session|connect/i,
  policy: /policy|denied|blocked|tool call/i,
  term: /terminat|revok|stop/i,
}

/* ───────────── Handlers ───────────── */

/** Pure overview handler: one consistent snapshot for the whole KPI band and infrastructure tab. */
export function getOverview(db: Db, ctx: RequestContext): ServiceResult<C2OverviewRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const channels = db.channels.filter((c) => inProject(c.projectId, ctx, accessible))
  const channelByNode = new Map<string, Channel[]>()
  channels.forEach((c) => { channelByNode.set(c.nodeId, [...(channelByNode.get(c.nodeId) ?? []), c]) })
  const sessions = scopedSessions(db, ctx, accessible)
  const nodes = db.c2Nodes
    .filter((n) => (aggregate ? n.projectIds.some((p) => accessible.has(p)) || n.projectIds.length === 0 : n.projectIds.includes(ctx.projectId)))
    .map((n) => {
      const chans = channelByNode.get(n.id) ?? []
      const via = sessions.filter((s) => chans.some((c) => c.id === s.channelId))
      return { ...n, channelIds: chans.map((c) => c.id), connectedVia: via.filter((s) => s.state === 'connected').length, relatedSessions: via.filter((s) => sessionPermOf(db, ctx, s) !== 'none').length }
    })
  const agents = db.agents.filter((a) => inProject(a.projectId, ctx, accessible) && connAgent(a))
  const requests = db.sessionRequests.filter((r) => inProject(r.projectId, ctx, accessible))
  const project = aggregate ? undefined : db.projects.find((p) => p.id === ctx.projectId)
  const noC2 = !aggregate && nodes.length === 0 && channels.length === 0
  const noC2Reasons = project
    ? [
        project.roeStatus !== 'approved' ? `ROE ${project.roeVersion} is ${project.roeStatus}, not approved` : '',
        agents.length === 0 ? 'No agents are assigned to this project' : '',
        'No C2 node or channel is allocated to this project',
      ].filter(Boolean)
    : []
  return {
    ok: true,
    data: {
      nodes,
      channels,
      sessionCounts: { active: sessions.filter((s) => s.state === 'connected').length, terminated: sessions.filter((s) => s.state === 'terminated').length },
      connectedAgents: agents.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      noC2,
      noC2Reasons,
    },
  }
}

/** Pure session-list handler: scoped rows, legacy filters, clamped page, whole-base filter options. */
export function listSessions(db: Db, ctx: RequestContext, query: C2SessionQuery = {}): ServiceResult<C2SessionListRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const base = scopedSessions(db, ctx, accessible)
  const q = (query.q || '').toLowerCase()
  const rows = base
    .map((s) => ({ ...s, access: accessOf(db, ctx, s), grantExpires: s.grants.find((x) => x.user === ctx.actor.id)?.expires }))
    .filter((r) =>
      (!q || `${r.id} ${r.asset} ${r.agentId} ${r.opId}`.toLowerCase().includes(q)) &&
      (!query.agent || r.agentId === query.agent) &&
      (!query.op || r.opId === query.op) &&
      (!query.type || query.type === 'all' || r.kind === query.type) &&
      (query.access === undefined || query.access === 'all' || r.access.key === query.access) &&
      (!query.connection || query.connection === 'all' ||
        (query.connection === 'ended' ? ENDED.includes(r.state) : r.state === query.connection)))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  return {
    ok: true,
    data: {
      items: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page, pageSize: PAGE_SIZE, total: rows.length,
      agentIds: [...new Set(base.map((s) => s.agentId))],
      opIds: [...new Set(base.map((s) => s.opId))],
    },
  }
}

/** Pure request-list handler: scoped requests, pending first (stable). */
export function listRequests(db: Db, ctx: RequestContext): ServiceResult<C2RequestListRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const items = db.sessionRequests
    .filter((r) => inProject(r.projectId, ctx, accessible))
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  return { ok: true, data: { items, pending: items.filter((r) => r.status === 'pending').length } }
}

/** Pure audit handler: the legacy view regexes + search, scoped and paged. */
export function listAudit(db: Db, ctx: RequestContext, query: C2AuditQuery): ServiceResult<C2AuditListRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const re = AUDIT_VIEWS[query.view] ?? AUDIT_VIEWS.access
  const q = (query.q || '').toLowerCase()
  const rows = db.audit
    .filter((a) => re.test(a.action) || (query.view === 'policy' && a.result === 'Denied'))
    .filter((a) => inProject(a.projectId, ctx, accessible))
    .filter((a) => !q || `${a.corr || ''} ${a.obj} ${a.actor} ${a.action}`.toLowerCase().includes(q))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  return { ok: true, data: { items: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pageSize: PAGE_SIZE, total: rows.length } }
}

/**
 * Pure channel-detail handler. A channel outside the scope is `not-found`
 * (indistinguishable from a missing one). Connection health of the channel
 * and node is reported as recorded; the actor's session visibility follows
 * the recorded per-user permission, and the masked callback configuration
 * unmasking is gated on the shared `viewSensitive` policy action.
 */
export function getChannel(db: Db, ctx: RequestContext, id: string): ServiceResult<C2ChannelDetailRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const c = db.channels.find((x) => x.id === id)
  if (!c || !inProject(c.projectId, ctx, accessible)) {
    return { ok: false, failure: { kind: 'not-found', message: `No channel "${id}" in this project. It may belong to another project.`, entity: { kind: 'channel', id } } }
  }
  const node = db.c2Nodes.find((n) => n.id === c.nodeId)
  const sessions = db.sessions
    .filter((s) => s.channelId === c.id && sessionPermOf(db, ctx, s) !== 'none')
    .map((s) => ({ ...s, access: accessOf(db, ctx, s), grantExpires: s.grants.find((x) => x.user === ctx.actor.id)?.expires }))
  const agentIds = new Set(sessions.map((s) => s.agentId))
  const agents = db.agents.filter((a) => agentIds.has(a.id)).map((a) => ({ id: a.id, host: a.host, status: a.status, lastSeen: a.lastSeen }))
  const opIds = new Set(sessions.map((s) => s.opId))
  const operations = db.operations.filter((o) => opIds.has(o.id)).map((o) => ({ id: o.id, name: o.name, status: o.status }))
  const project = db.projects.find((p) => p.id === c.projectId)
  return {
    ok: true,
    data: { channel: c, node, sessions, agents, operations, canViewSensitive: policyCan(ctx.actor, 'viewSensitive', project) },
  }
}

/**
 * Pure session-detail handler: one consistent snapshot for the session
 * detail screen and its console. A session outside the scope is `not-found`
 * (indistinguishable from a missing one, no existence leak). Connection
 * health is reported as recorded and separate from the actor's access
 * grant; the sensitive evidence identity masks unless the actor holds the
 * shared `viewSensitive` policy action. The readable transcript and linked
 * panels follow the recorded read policy — they are never hidden merely
 * because interactive access is absent (the view locks the viewer's
 * transcript instead); interactive authorization stays in the grant
 * lifecycle (./grants) and is not derived here.
 */
export function getSessionDetail(db: Db, ctx: RequestContext, id: string): ServiceResult<C2SessionDetailRead> {
  const scope = scopeSets(db, ctx)
  if (!scope.ok) return scope
  const accessible = scope.data
  const s = db.sessions.find((x) => x.id === id)
  if (!s || !inProject(s.projectId, ctx, accessible)) {
    return { ok: false, failure: { kind: 'not-found', message: `No session "${id}" in this project. It may belong to another project.`, entity: { kind: 'session', id } } }
  }
  const project = db.projects.find((p) => p.id === s.projectId)
  const op = db.operations.find((o) => o.id === s.opId)
  const agent = db.agents.find((a) => a.id === s.agentId)
  const channel = db.channels.find((c) => c.id === s.channelId)
  const node = channel ? db.c2Nodes.find((n) => n.id === channel.nodeId) : undefined
  const asset = db.assets.find((a) => a.name === s.asset && a.projectId === s.projectId)
  const canViewSensitive = policyCan(ctx.actor, 'viewSensitive', project)
  const g = s.grants.find((x) => x.user === ctx.actor.id)
  return {
    ok: true,
    data: {
      session: s,
      perm: sessionPermOf(db, ctx, s),
      access: accessOf(db, ctx, s),
      canViewSensitive,
      project: project && { id: project.id, name: project.name, roeVersion: project.roeVersion, window: project.window },
      op: op && { id: op.id, name: op.name, owner: op.owner, status: op.status },
      agent: agent && { id: agent.id, host: agent.host },
      channel: channel && { id: channel.id, status: channel.status, last: channel.last, nodeLatency: node?.latency },
      asset: asset && { id: asset.id, name: asset.name, scope: asset.scope },
      requests: db.sessionRequests.filter((r) => r.sessionId === s.id),
      myGrant: g && { perm: g.perm, expires: g.expires, by: g.by, expiresAt: parseDemoInstant(g.expires) },
      audit: db.audit.filter((a) => a.obj === s.id && a.projectId === s.projectId),
      evidence: db.evidence
        .filter((e) => e.projectId === s.projectId && e.opId === s.opId)
        .map((e) => ({ id: e.id, name: e.sensitive && !canViewSensitive ? '•••••• (redacted)' : e.name, kind: e.kind, source: e.source, sensitive: e.sensitive })),
      findings: db.findings.filter((f) => f.asset === s.asset && f.projectId === s.projectId).map((f) => ({ id: f.id, title: f.title })),
    },
  }
}

/** Builds the typed C2 read service; `guard` is the factory's superseded-scope read guard. */
export function createC2Service(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): C2Service {
  return {
    overview: (ctx) => guard(() => getOverview(authority.snapshot(), ctx)),
    sessions: (ctx, query) => guard(() => listSessions(authority.snapshot(), ctx, query)),
    requests: (ctx) => guard(() => listRequests(authority.snapshot(), ctx)),
    audit: (ctx, query) => guard(() => listAudit(authority.snapshot(), ctx, query)),
    channel: (ctx, id) => guard(() => getChannel(authority.snapshot(), ctx, id)),
    session: (ctx, id) => guard(() => getSessionDetail(authority.snapshot(), ctx, id)),
  }
}
