/**
 * HITL tool decisions + resolution records (ticket 42, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The human decision on a pending tool proposal is a feature-local
 * transaction over the one database authority; the legacy `decideTool`
 * action and the trace/chat surfaces both go through it, so the gates the
 * UI used to merely hint at are enforced at one execution site:
 *
 * - Only an `awaiting` proposal can be decided — a decided/executed event
 *   has no pending decision (`conflict`).
 * - Four-eyes: the human who requested the proposal (the conversation's
 *   owner) can never decide it, even when a role override grants them a
 *   decision-capable role — independence is identity-based.
 * - Role gate: `approvePlan` on the addressed project (Reviewer /
 *   Organization Admin) — the UI gate is presentation, not enforcement.
 * - A reason is required and recorded: the persisted resolution record
 *   (outcome + actor + instant + reason) and the audit row commit in the
 *   SAME ChangeSet, so the outcome history and the record never diverge.
 *
 * Policy Allowed is not execution: an allowed decision stores the
 * `allowed` state — which the facet derivation reads as Policy Allowed /
 * Approval Approved / Execution Not executed — and never fabricates a
 * result. Execution remains a separate recorded event; the deny path
 * mirrors the proposal onto its branch as blocked. Refusals commit
 * nothing; every request captures actor and project explicitly.
 */
import { can, projectAccessible, readOnlyContext } from '../../auth/policy'
import type { Db } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Project, ToolEvent, ToolEventResolution, ToolState } from '../../domain/entities'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** The decision a reviewer makes on one pending proposal. */
export type ToolDecision = 'allowed' | 'denied'

/** The committed outcome of one HITL decision: new state plus the persisted record. */
export interface ToolDecisionOutcome {
  toolId: string
  projectId: string
  /** The stored state after the decision (`allowed`/`denied`). */
  state: ToolState
  /** The resolution record persisted on the event (outcome + actor + reason). */
  decision: ToolEventResolution
}

const toolRef = (id: string, projectId?: string) => ({ kind: 'tool-event' as const, id, projectId })

/** Resolves the addressed event with its project; foreign reads are not-found (no existence leak). */
function resolveToolEvent(db: Db, ctx: RequestContext, id: string): { ok: true; event: ToolEvent; project: Project } | { ok: false; failure: ServiceFailure } {
  const event = db.toolEvents.find((x) => x.id === id)
  const project = event ? db.projects.find((x) => x.id === event.projectId) : undefined
  if (!event || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Tool event ${id} does not exist or is not available for your account.`, entity: toolRef(id, event?.projectId) } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== event.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Tool event ${id} belongs to project ${event.projectId}. Switch to that project to decide it.`, entity: toolRef(id, event.projectId) } }
  }
  return { ok: true, event, project }
}

/**
 * The reviewer's HITL decision on one pending proposal, with the gates owned
 * by the handler. Refusal order: unknown/foreign event → not-found;
 * cross-context → forbidden; read-only project or viewer → forbidden; not
 * awaiting → conflict; the requester deciding their own proposal → forbidden
 * (four-eyes); missing `approvePlan` role → forbidden; missing reason →
 * validation. On success the stored state, the resolution record, the
 * branch mirrors and the audit row commit as ONE ChangeSet.
 */
export function decideToolEventTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, decision: ToolDecision, reason: string): ServiceResult<ToolDecisionOutcome> {
  const db = authority.snapshot()
  const t = resolveToolEvent(db, ctx, id)
  if (!t.ok) return t
  const { event, project } = t
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — tool decisions are read-only.`, entity: toolRef(id, project.id) } }
  }
  if (event.state !== 'awaiting') {
    return { ok: false, failure: { kind: 'conflict', message: `Tool event ${id} is ${event.state}; no decision is pending.`, entity: toolRef(id, project.id) } }
  }
  // Four-eyes: the proposal's requester (the conversation owner) is refused
  // even when a role override hands them a decision-capable role.
  const requester = db.conversations.find((c) => c.id === event.conversationId)?.owner
  if (requester && ctx.actor.id === requester) {
    return { ok: false, failure: { kind: 'forbidden', message: 'You cannot decide a tool call you requested. Ask another reviewer.', entity: toolRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'approvePlan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Reviewer or Organization Admin can decide tool calls; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: toolRef(id, project.id) } }
  }
  if (!reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A decision reason is required and recorded in the audit trail.', entity: toolRef(id, project.id) } }
  }
  const at = formatDemoInstant(clock.now())
  const allowed = decision === 'allowed'
  const resolution: ToolEventResolution = { outcome: decision, by: ctx.actor.id, at, note: reason.trim() }
  authority.commit(ctx.corr, (d) => {
    const x = d.toolEvents.find((y) => y.id === id)!
    // Policy Allowed is not execution: the decision stores `allowed`, which
    // the facet derivation reads as Allowed / Approved / Not executed — no
    // result is fabricated and nothing runs.
    x.state = allowed ? 'allowed' : 'denied'
    x.reason = resolution.note
    x.decision = resolution
    d.branches.forEach((b) => {
      if (b.toolEventId !== id) return
      b.approval = allowed ? 'approved' : 'denied'
      b.state = allowed ? 'queued' : 'blocked'
      b.lastEvent = allowed ? `Approved by ${ctx.actor.id} — queued, not executed` : 'Denied by reviewer'
    })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: allowed ? 'Allowed tool call' : 'Denied tool call', obj: event.tool, projectId: project.id, result: 'Success', reason: resolution.note })
  })
  return { ok: true, data: { toolId: id, projectId: project.id, state: allowed ? 'allowed' : 'denied', decision: resolution } }
}
