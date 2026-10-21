/**
 * AI conversation-history read model (ticket 42, ADR-0067).
 *
 * The history & provenance presentation reads the message archive here as a
 * feature-local handler over the one database authority: scoped per
 * project/persona (member-only specific reads; 'all' aggregates only
 * accessible projects — foreign conversations are never merged), masked at
 * the boundary (every archived message text passes the one `maskSensitive`
 * rule; the stored record is never rewritten), with provenance annotations
 * (artifact plans via the prevPlanId chain + requested changes, tool
 * approvals with their facets, project context and per-row
 * same-correlation related events) derived from the same snapshot. Search,
 * the actor-type/AI-related filters and audit pagination apply inside the
 * handler; reads share the factory's superseded-scope guard.
 */
import { projectAccessible } from '../../domain/policy'
import { planVer, toolFacets } from '../../data'
import type { Db, Facets, Plan } from '../../data'
import type { AiMode, Audit, Conversation } from '../../domain/entities'
import type { DbAuthority } from '../../domain/database'
import type { PageRequest, RequestContext, ServiceResult } from '../../domain/service'
import { maskSensitive } from '../trace/service'

/** Plan provenance a history conversation annotates its messages with. */
export interface PlanAnnotation {
  id: string
  /** Display version (`v1.2` style) of the artifact plan. */
  version: string
  status: string
  /** Plan this revision revises (the canonical prevPlanId chain). */
  revises?: string
  /** Requested-change notes the revision transaction recorded. */
  changes: string[]
}

/** Tool approval provenance with the facets derived from the one stored state. */
export interface ToolApprovalRef {
  id: string
  tool: string
  facets: Facets
}

/** One archived conversation: masked message archive plus provenance annotations. */
export interface HistoryConversation {
  /** The conversation with its message archive; message TEXTS are masked at this boundary. */
  conversation: Conversation
  plans: PlanAnnotation[]
  toolApprovals: ToolApprovalRef[]
}

export type ActorType = 'AI' | 'Human' | 'System'

/** One audit row with its boundary-derived presentation. */
export interface HistoryAuditRow {
  audit: Audit
  actorType: ActorType
  eventType: string
  /** Same-correlation events resolved from the same snapshot (detail reads only). */
  related?: {
    audits: { id: string; actor: string; action: string }[]
    tools: { id: string; tool: string }[]
  }
}

export interface HistoryQuery {
  /** Free-text search over event id, actor, action, object and correlation id. */
  q?: string
  /** Actor-type filter ('all' disables it). */
  actorType?: ActorType | 'all'
  /** true keeps only AI-related events (the legacy 'AI-related' scope). */
  aiOnly?: boolean
  page?: PageRequest
}

export interface AiHistoryRead {
  projectId: string
  plans: Plan[]
  conversations: HistoryConversation[]
  /** Unfiltered scoped counts for the scope toggle (search-independent). */
  counts: { ai: number; all: number }
  audit: { items: HistoryAuditRow[]; page: number; pageSize: number; total: number }
  /** Project context the provenance drawer states (derived, never read from the database by the screen). */
  context: { roeVersion?: string; inScopeAssets: number; agents: number }
}

export interface AiHistoryService {
  /** Scope-checked history archive with masked messages and provenance annotations. */
  list(ctx: RequestContext, query?: HistoryQuery): Promise<ServiceResult<AiHistoryRead>>
  /** One scope-checked audit row with its same-correlation related events. */
  getAudit(ctx: RequestContext, id: string): Promise<ServiceResult<HistoryAuditRow>>
}

const actorTypeOf = (a: Audit): ActorType => (a.actor === 'AI Operator' ? 'AI' : a.role === 'System' ? 'System' : 'Human')
const eventTypeOf = (a: Audit) => (/plan/i.test(a.action) ? 'AI plan decision' : /blocked|tool/i.test(a.action) ? 'Tool policy decision' : /session/i.test(a.action) ? 'Session access' : /operation/i.test(a.action) ? 'Operation lifecycle' : 'Other')

const planAnnotation = (p: Plan | undefined): PlanAnnotation | undefined =>
  p ? { id: p.id, version: planVer(p), status: p.status, revises: p.prevPlanId, changes: p.changes ?? [] } : undefined

/** Archives one conversation: masked texts plus the plan/tool annotations from the same snapshot. */
function toHistoryConversation(c: Conversation, db: Db): HistoryConversation {
  const planIds = [...new Set(c.messages.filter((m) => m.planId).map((m) => m.planId!))]
  return {
    conversation: { ...c, messages: c.messages.map((m) => ({ ...m, text: maskSensitive(m.text) })) },
    plans: planIds.map((id) => planAnnotation(db.plans.find((p) => p.id === id))).filter((x): x is PlanAnnotation => !!x),
    toolApprovals: db.toolEvents
      .filter((t) => t.conversationId === c.id && t.projectId === c.projectId)
      .map((t) => ({ id: t.id, tool: t.tool, facets: toolFacets(t) })),
  }
}

const toHistoryAuditRow = (a: Audit): HistoryAuditRow => ({ audit: a, actorType: actorTypeOf(a), eventType: eventTypeOf(a) })

/**
 * Pure history handler. A specific projectId reads only that project's
 * history and only for members; `'all'`/`''` aggregates across the actor's
 * accessible projects. Out-of-scope reads are not-found, never a leaked
 * existence signal.
 */
export function listAiHistory(db: Db, ctx: RequestContext, query: HistoryQuery = {}): ServiceResult<AiHistoryRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Conversation history for this project is not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const inScope = (x: { projectId: string }) => (aggregate ? accessible.has(x.projectId) : x.projectId === pid)
  const plans = db.plans.filter(inScope)
  const conversations = db.conversations.filter(inScope).map((c) => toHistoryConversation(c, db))
  const nq = (query.q ?? '').trim().toLowerCase()
  const at = query.actorType ?? 'all'
  const scoped = db.audit.filter(inScope)
  const all = scoped
    .filter((a) => (query.aiOnly ? a.actor === 'AI Operator' || /AI plan|plan|tool|Blocked/i.test(a.action) : true))
    .filter((a) => (at !== 'all' ? actorTypeOf(a) === at : true))
    .filter((a) => !nq || `${a.id} ${a.actor} ${a.action} ${a.obj} ${a.corr || ''}`.toLowerCase().includes(nq))
    .map(toHistoryAuditRow)
  const req = query.page ?? { page: 1, pageSize: Math.max(1, all.length) }
  const start = (req.page - 1) * req.pageSize
  const project = aggregate ? undefined : db.projects.find((p) => p.id === pid)
  return {
    ok: true,
    data: {
      projectId: aggregate ? 'all' : pid,
      plans,
      conversations,
      counts: {
        ai: scoped.filter((a) => a.actor === 'AI Operator' || /AI plan|plan|tool|Blocked/i.test(a.action)).length,
        all: scoped.length,
      },
      audit: { items: all.slice(start, start + req.pageSize), page: req.page, pageSize: req.pageSize, total: all.length },
      context: { roeVersion: project?.roeVersion, inScopeAssets: db.assets.filter((a) => inScope(a) && a.scope === 'in').length, agents: db.agents.filter(inScope).length },
    },
  }
}

/**
 * One audit row with its provenance. Scope rules match the list: a row from
 * another project (or an unknown id) is not-found — the message names only
 * the requested id, never another project's data.
 */
export function getAiHistoryRow(db: Db, ctx: RequestContext, id: string): ServiceResult<HistoryAuditRow> {
  const a = db.audit.find((x) => x.id === id)
  const project = a ? db.projects.find((p) => p.id === a.projectId) : undefined
  if (!a || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Audit event ${id} does not exist or is not available for your account.` } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== a.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Audit event ${id} belongs to project ${a.projectId}. Switch to that project to inspect it.`, entity: { kind: 'audit', id, projectId: a.projectId } } }
  }
  return {
    ok: true,
    data: {
      ...toHistoryAuditRow(a),
      related: {
        audits: db.audit.filter((x) => a.corr && x.corr === a.corr && x.id !== a.id).map((x) => ({ id: x.id, actor: x.actor, action: x.action })),
        tools: db.toolEvents.filter((t) => a.corr && t.corr === a.corr).map((t) => ({ id: t.id, tool: t.tool })),
      },
    },
  }
}

/** Builds the typed history service; `guard` is the factory's superseded-scope read guard. */
export function createAiHistoryService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): AiHistoryService {
  return {
    list: (ctx, query) => guard(() => listAiHistory(authority.snapshot(), ctx, query)),
    getAudit: (ctx, id) => guard(() => getAiHistoryRow(authority.snapshot(), ctx, id)),
  }
}

/** Mode display label (the surface's only conversation-mode wording). */
export const modeLabel = (m: AiMode) => (m === 'execution' ? 'Approved Execution' : m === 'propose' ? 'Propose' : 'Observe')
