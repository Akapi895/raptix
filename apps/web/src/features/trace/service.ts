/**
 * Tool/analysis trace read model (ticket 41, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The trace presentation reads recorded tool events here as a feature-local
 * handler over the one database authority. The facet invariant (execution.md
 * requirement 4) is structural: each event keeps its single stored state and
 * the three Policy/Approval/Execution facets are derived at this boundary on
 * every read (`toolFacets`) — nothing here persists a four-field facet model
 * and no path creates an executed proposal. Policy Allowed is never
 * execution: an `awaiting`/`allowed` state reads Policy Allowed with
 * Execution Not executed.
 *
 * Sensitive values in recorded params/results are masked at this boundary
 * (credentials, tokens and IP literals) so raw values never reach the UI;
 * the stored record itself is never rewritten. Provenance a trace link needs
 * (plan version, plan-step name, branch state) is resolved from the same
 * snapshot, and every read is project-scoped: non-member reads are not-found
 * without leaking existence, aggregates exclude inaccessible projects.
 * Reads share the factory's superseded-scope guard (cancel-on-switch), so a
 * delayed response cannot restore another scope's visibility.
 */
import { projectAccessible } from '../../domain/policy'
import { planVer, toolFacets } from '../../data'
import type { Db, Facets, ToolEvent } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import { decideToolEventTransaction, type ToolDecision, type ToolDecisionOutcome } from './writes'

/** Plan provenance resolved for trace links (version preserved). */
export interface TracePlanRef {
  id: string
  /** Display version of the linked plan (`v1.2` style). */
  version: string
  /** Name of the linked plan step, when the event names one. */
  stepName?: string
}

/** Branch provenance resolved for trace links. */
export interface TraceBranchRef {
  id: string
  state: string
}

/** One trace row: the stored event plus its boundary-derived presentation. */
export interface TraceRow {
  event: ToolEvent
  /** The three independent facets derived from the one stored state. */
  facets: Facets
  /** Recorded inputs with credential/token/IP values redacted. */
  params: string
  /** Recorded output with the same redaction; undefined when nothing was returned. */
  result?: string
  plan?: TracePlanRef
  branch?: TraceBranchRef
}

export interface TraceListRead {
  events: TraceRow[]
}

export interface TraceService {
  /** Scope-checked trace rows with derived facets ('all' aggregates accessible projects). */
  list(ctx: RequestContext): Promise<ServiceResult<TraceListRead>>
  /**
   * The HITL decision on one pending proposal (ticket 42): role gate +
   * four-eyes + the persisted resolution record live in the handler; a
   * committed decision publishes the ChangeSet both bridges observe.
   */
  decide(ctx: RequestContext, id: string, decision: ToolDecision, reason: string): Promise<ServiceResult<ToolDecisionOutcome>>
}

const IP_LITERAL = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const SECRET_ASSIGN = /(password|passwd|secret|token|api[_-]?key|credential)\s*[=:]\s*\S+/gi

/** Redacts credential assignments and IP literals; the only masking rule for trace text. */
export function maskSensitive(text: string): string {
  return text.replace(IP_LITERAL, '[ip redacted]').replace(SECRET_ASSIGN, '$1=[redacted]')
}

/** Derives one presentation row from the stored event and the same snapshot. */
function toRow(e: ToolEvent, db: Db): TraceRow {
  const plan = e.planId ? db.plans.find((p) => p.id === e.planId) : undefined
  const op = e.opId ? db.operations.find((o) => o.id === e.opId) : undefined
  // The step an event names lives in its operation's step list (chat-proposed
  // events fall back to the plan's own step ids).
  const stepName = [...(op?.steps ?? []), ...(plan?.steps ?? [])].find((s) => s.id === e.stepId)?.name
  const branch = e.branchId ? db.branches.find((b) => b.id === e.branchId) : undefined
  return {
    event: e,
    facets: toolFacets(e),
    params: maskSensitive(e.params),
    result: e.result == null ? undefined : maskSensitive(e.result),
    plan: plan ? { id: plan.id, version: planVer(plan), stepName } : undefined,
    branch: branch ? { id: branch.id, state: branch.state } : undefined,
  }
}

/**
 * Pure list handler. A specific projectId reads only that project's events
 * and only for members; `'all'`/`''` aggregates across the actor's
 * accessible projects. Out-of-scope reads are not-found, never a leaked
 * existence signal.
 */
export function listToolEvents(db: Db, ctx: RequestContext): ServiceResult<TraceListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Tool trace for this project is not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const events = db.toolEvents
    .filter((e) => (aggregate ? accessible.has(e.projectId) : e.projectId === pid))
    .map((e) => toRow(e, db))
  return { ok: true, data: { events } }
}

/** Builds the typed trace service; `guard` is the factory's superseded-scope read guard. */
export function createTraceService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): TraceService {
  return {
    list: (ctx) => guard(() => listToolEvents(authority.snapshot(), ctx)),
    // The decision captures ctx at call time and commits once; it is never
    // cancelled mid-flight (the superseded-scope guard only covers reads).
    decide: (ctx, id, decision, reason) => Promise.resolve(decideToolEventTransaction(authority, clock, ctx, id, decision, reason)),
  }
}
