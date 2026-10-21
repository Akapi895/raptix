/**
 * Plan workbench + approval handlers (ticket 39, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The plan lifecycle draft → proposed → in_review → approved/expired lives
 * here as feature-local transactions over the one database authority; the
 * legacy store actions and the workbench screen both go through these
 * handlers. The four-eyes rules the UI used to merely hint at are enforced here: only a
 * plan-capable role requests review, only a Reviewer/Organization Admin
 * decides, and the request's own author is refused (with an explainable
 * failure) so approval stays an independent decision. Approving also checks
 * the plan's current ROE binding — a plan pinned to a superseded ROE version
 * (e.g. after ticket 21's submission-time invalidation) cannot be approved.
 *
 * Approval expiry is a REAL absolute deadline: a decision stamps
 * `decision instant + 24h` (the seeded demo deadlines stay explicit), and
 * `usableApproval`/`effectivePlanStatus` enforce `now >= expiresAt` at the
 * handler with the factory clock — an expired approval is unusable (it reads
 * as `expired` and refuses use) even before any cleanup sweep would run.
 * Chat proposals (ticket 38) enter this lifecycle only as gated drafts: the
 * only import path is `requestReview`, which a plan-capable human calls, and
 * nothing here ever starts an operation (ticket 40 owns that bridge).
 *
 * Refusals commit nothing: every check runs before the commit, so a failed
 * call leaves the whole dataset unchanged. Every request captures actor and
 * project explicitly and publishes one ChangeSet both the legacy store and
 * Query consumers observe.
 */
import { can, projectAccessible, readOnlyContext } from '../../domain/policy'
import { formatDemoInstant, parseDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import { planVer } from '../../data'
import type { Db, Plan, PlanStep, Project } from '../../data'
import type { Clock, Instant, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { PlanStatus } from '../../domain/entities'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** The 24h approval window, applied to decision instants (never to wall-clock). */
export const DAY_MS = 24 * 60 * 60 * 1000

const planRef = (id: string, projectId?: string) => ({ kind: 'plan' as const, id, projectId })

/**
 * Effective status at `now`: an approved/executed plan past its absolute
 * deadline reads as `expired` at the service boundary — the stored status
 * string stays untouched until something commits (cleanup is not required
 * for the rule to bite; execution.md invariant b).
 */
export function effectivePlanStatus(plan: Plan, now: Instant): PlanStatus {
  if ((plan.status === 'approved' || plan.status === 'executed') && plan.expires) {
    const at = parseDemoInstant(plan.expires)
    if (at !== undefined && now >= at) return 'expired'
  }
  return plan.status
}

/**
 * The approval-validity gate every use of an approved plan passes (the
 * execution bridge consults it before creating/starting an operation;
 * ticket 40 wires the call site). Seeded plans without an expiry stay valid.
 */
export function usableApproval(plan: Plan, now: Instant): { ok: true; expiresAt?: Instant } | { ok: false; error: string } {
  if (plan.status !== 'approved' && plan.status !== 'executed') {
    return { ok: false, error: 'Only an approved plan can be executed.' }
  }
  const at = plan.expires ? parseDemoInstant(plan.expires) : undefined
  if (at === undefined) return { ok: true }
  if (now >= at) {
    return { ok: false, error: `The approval of ${plan.id} ${planVer(plan)} expired ${plan.expires} — re-approve the plan before it can be used.` }
  }
  return { ok: true, expiresAt: at }
}

/** Resolves a plan with its project; foreign reads are not-found (no existence leak). Ticket 42's compare read shares this scope rule. */
export function resolvePlan(db: Db, ctx: RequestContext, id: string): { ok: true; plan: Plan; project: Project } | { ok: false; failure: ServiceFailure } {
  const plan = db.plans.find((x) => x.id === id)
  const project = plan ? db.projects.find((x) => x.id === plan.projectId) : undefined
  if (!plan || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Plan ${id} does not exist or is not available for your account.`, entity: { kind: 'plan', id, projectId: plan?.projectId } } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== plan.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Plan ${id} belongs to project ${plan.projectId}. Switch to that project to work with it.`, entity: { kind: 'plan', id, projectId: plan.projectId } } }
  }
  return { ok: true, plan, project }
}

/** Write precondition: resolved plan + writable context (closed/cancelled and viewers refuse). */
function addressPlan(db: Db, ctx: RequestContext, id: string): { ok: true; plan: Plan; project: Project } | { ok: false; failure: ServiceFailure } {
  const t = resolvePlan(db, ctx, id)
  if (!t.ok) return t
  if (readOnlyContext(t.project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${t.project.id} is closed or cancelled — plans are read-only.`, entity: planRef(id, t.project.id) } }
  }
  return t
}

/** Chat message appended to the plan's conversation (the AI workspace thread mirrors the lifecycle). */
function sayChat(d: Db, plan: Plan, text: string, role: 'system' | 'ai', kind?: 'plan') {
  const c = d.conversations.find((x) => x.id === plan.conversationId)
  c?.messages.push({ id: role + Math.random().toString(36).slice(2, 7), role, kind, planId: kind ? plan.id : undefined, text, at: plan.updated })
}

/* ───────────── Request review — the gated import path for proposals ───────────── */

export interface PlanMutationOutcome { planId: string; projectId: string; status: PlanStatus; expiresAt?: Instant }

/**
 * The one import path from a chat/workbench proposal into the review
 * lifecycle: draft/proposed → in_review. A proposal can only be imported by
 * a plan-capable member of a writable project, and the review window is
 * stamped as a REAL absolute deadline from the factory clock (now + 24h) —
 * replacing the legacy wall-clock string. Proposals whose ROE is not
 * approved stay drafts at the chat side; this handler still admits the
 * request (the reviewer's ROE check refuses the approval, and ticket 26's
 * PRE-02 gate blocks anything downstream) because the legacy action allowed
 * it and the my-tasks countdown is its visible consumer.
 */
export function requestPlanReviewTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<PlanMutationOutcome> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'draft' && plan.status !== 'proposed') {
    return { ok: false, failure: { kind: 'conflict', message: `Review can only be requested for a draft or proposed plan — ${id} is ${plan.status.replace('_', ' ')}.`, entity: planRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'plan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot request plan approval. Ask a Red Team Operator or Lead.`, entity: planRef(id, project.id) } }
  }
  const now = clock.now()
  const at = formatDemoInstant(now)
  const expiresAt = now + DAY_MS
  authority.commit(ctx.corr, (d) => {
    const x = d.plans.find((y) => y.id === id)!
    x.status = 'in_review'
    x.updated = at
    x.expires = formatDemoInstant(expiresAt)
    sayChat(d, { ...x, updated: at }, `${x.id} ${planVer(x)} sent to ${x.reviewer} for approval.`, 'system')
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Requested plan approval', obj: id, projectId: project.id, result: 'Success', reason: '' })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `AI plan ${id} needs review`, projectId: project.id, at, read: false, to: { name: 'ai-plan-review', id }, category: 'plans' })
  })
  return { ok: true, data: { planId: id, projectId: project.id, status: 'in_review', expiresAt } }
}

/* ───────────── Decide (four-eyes, current ROE binding) ───────────── */

export type PlanReviewDecision = 'approved' | 'rejected' | 'returned'

/**
 * The independent reviewer's decision with the plan four-eyes policy owned by
 * the handler. Refusal order: unknown/foreign plan → not-found; read-only
 * context → forbidden; not in_review → conflict; the requester deciding
 * their own plan → forbidden (four-eyes); missing `approvePlan` role →
 * forbidden; approving without an approved project ROE → validation;
 * approving a plan pinned to a superseded ROE version → validation; a newer
 * open revision already exists → conflict; returning/rejecting without a
 * justification → validation. On approve the expiry stamps
 * decision + 24h (a re-approval stamps its own decision time — never a
 * silent timer extension), the planless predecessor is superseded, and the
 * decision, chat message, audit row and notice commit together.
 */
export function decidePlanTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, decision: 'approved' | 'rejected' | 'returned', note: string): ServiceResult<PlanMutationOutcome> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'in_review') {
    return { ok: false, failure: { kind: 'conflict', message: `Plan ${id} is ${plan.status.replace('_', ' ')}; no decision is pending.`, entity: planRef(id, project.id) } }
  }
  if (decision === 'approved' && ctx.actor.id === plan.requestedBy) {
    return { ok: false, failure: { kind: 'forbidden', message: 'You cannot approve a plan you requested. Ask another reviewer.', entity: planRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'approvePlan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Reviewer or Organization Admin can decide AI plans; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: planRef(id, project.id) } }
  }
  const approved = decision === 'approved'
  if (approved && project.roeStatus !== 'approved') {
    return { ok: false, failure: { kind: 'validation', message: `Cannot approve: ${project.id} has no approved ROE.`, entity: planRef(id, project.id) } }
  }
  if (approved && plan.roeVersion !== project.roeVersion) {
    return { ok: false, failure: { kind: 'validation', message: `Cannot approve: the plan is pinned to ${plan.roeVersion}, but the project is on ${project.roeVersion}. Re-approve under the current ROE.`, entity: planRef(id, project.id) } }
  }
  if (approved && db.plans.some((x) => x.prevPlanId === id && ['draft', 'proposed', 'in_review'].includes(x.status))) {
    return { ok: false, failure: { kind: 'conflict', message: `A newer revision of ${id} is open — decide on the latest version instead.`, entity: planRef(id, project.id) } }
  }
  if (!approved && !note.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required for every plan decision. Tell the requester what to change.', entity: planRef(id, project.id) } }
  }
  const now = clock.now()
  const at = formatDemoInstant(now)
  const expiresAt = approved ? now + DAY_MS : undefined
  authority.commit(ctx.corr, (d) => {
    const x = d.plans.find((y) => y.id === id)!
    x.status = approved ? 'approved' : decision === 'returned' ? 'draft' : 'rejected'
    x.updated = at
    x.decision = { by: ctx.actor.id, at, note }
    x.expires = approved ? formatDemoInstant(expiresAt!) : undefined
    if (approved && x.prevPlanId) { const prev = d.plans.find((y) => y.id === x.prevPlanId); if (prev && prev.status !== 'executed' && !prev.opId) prev.status = 'superseded' }
    sayChat(d, { ...x, updated: at }, `${x.id} ${planVer(x)} ${approved ? 'approved' : decision === 'returned' ? 'returned for changes' : 'rejected'} by ${ctx.actor.id}${note ? ': ' + note : ''}.`, 'system')
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: `${approved ? 'Approved' : decision === 'returned' ? 'Returned' : 'Rejected'} AI plan`, obj: id, projectId: project.id, result: 'Success', reason: note })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `AI plan ${id} was ${decision === 'returned' ? 'returned for changes' : decision}`, projectId: project.id, at, read: false, to: { name: 'ai-plan', id }, category: 'plans' })
  })
  return { ok: true, data: { planId: id, projectId: project.id, status: approved ? 'approved' : decision === 'returned' ? 'draft' : 'rejected', expiresAt } }
}

/* ───────────── Withdraw review ───────────── */

/**
 * Pulls a plan out of review before a decision: the requester always can,
 * and scope managers/admins can withdraw on the requester's behalf. Only a
 * plan in_review can be withdrawn; the review window clears so no stale
 * countdown survives.
 */
export function withdrawPlanReviewTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<PlanMutationOutcome> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'in_review') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a plan in review can be withdrawn — ${id} is ${plan.status.replace('_', ' ')}.`, entity: planRef(id, project.id) } }
  }
  if (plan.requestedBy !== ctx.actor.id && !can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only the requester, a Red Team Manager or an Organization Admin can withdraw this review.', entity: planRef(id, project.id) } }
  }
  const now = clock.now()
  const at = formatDemoInstant(now)
  authority.commit(ctx.corr, (d) => {
    const x = d.plans.find((y) => y.id === id)!
    x.status = 'draft'
    x.updated = at
    x.expires = undefined
    sayChat(d, { ...x, updated: at }, `${x.id} ${planVer(x)} withdrawn from review by ${ctx.actor.id}.`, 'system')
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Withdrew plan review', obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: { planId: id, projectId: project.id, status: 'draft' } }
}

/* ───────────── Revision (the approved plan is never modified) ───────────── */

export interface PlanRevisionOutcome { planId: string; prevPlanId: string; version: number }

const bumpVer = (p: Plan) => { const m = (p.ver ?? `v${p.version}`).match(/^v(\d+)(?:\.(\d+))?$/); return m ? `v${m[1]}.${(+(m[2] ?? 0)) + 1}` : `v${p.version + 1}` }

/**
 * Creates a revision as a NEW draft version: the addressed plan must be
 * approved/executed and at least one requested change is required
 * (validation). The approved plan is never modified — it stays pinned to its
 * operation for audit, the draft re-pins to the project's CURRENT ROE
 * version, carries no operation and no expiry, and re-approval is required
 * before it can be used.
 */
export function revisePlanTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, changes: string[], note?: string): ServiceResult<PlanRevisionOutcome> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'approved' && plan.status !== 'executed') {
    return { ok: false, failure: { kind: 'conflict', message: `Only an approved plan can be revised — ${id} is ${plan.status.replace('_', ' ')}.`, entity: planRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'plan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot revise plans.`, entity: planRef(id, project.id) } }
  }
  const list = changes.map((c) => c.trim()).filter(Boolean)
  if (list.length === 0) {
    return { ok: false, failure: { kind: 'validation', message: 'Describe at least one change for the revision.', entity: planRef(id, project.id) } }
  }
  const now = clock.now()
  const at = formatDemoInstant(now)
  let newId = ''
  authority.commit(ctx.corr, (d) => {
    const old = d.plans.find((x) => x.id === id)!
    newId = 'PL-' + String(++d.counters.plan).padStart(3, '0')
    const steps: PlanStep[] = old.steps.map((s) => ({ ...s }))
    list.forEach((c, i) => { if (/gate|approval/i.test(c) && steps[i % steps.length]) { const st = steps[(steps.length - 1 - i) % steps.length]; st.needsApproval = true; st.risk = st.risk === 'low' ? 'medium' : st.risk } })
    d.plans.unshift({ ...old, id: newId, ver: bumpVer(old), version: old.version + 1, status: 'draft', steps, created: at, updated: at, prevPlanId: old.id, changes: list, decision: undefined, expires: undefined, requestedBy: ctx.actor.id, rationale: `${old.rationale} Revised: ${list.join('; ') || note || 'updated'}.`, roeVersion: d.projects.find((x) => x.id === old.projectId)!.roeVersion })
    // Revision never replaces the plan an operation uses: the approved plan stays pinned; the draft has no operation.
    d.plans.find((y) => y.id === newId)!.opId = undefined
    sayChat(d, { ...old, updated: at }, `Revised as ${newId} (${bumpVer(old)} draft). ${list.join('; ')}. It needs approval before it can be used; ${old.id} stays approved and unchanged.`, 'ai', 'plan')
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Revised AI plan', obj: newId, projectId: project.id, result: 'Success', reason: list.join('; ') })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `Revised plan ${newId} needs re-approval`, projectId: project.id, at, read: false, to: { name: 'ai-plan-review', id: newId }, category: 'plans' })
  })
  return { ok: true, data: { planId: newId, prevPlanId: id, version: plan.version + 1 } }
}

/* ───────────── Draft editing / discard ───────────── */

/**
 * Saves draft edits (steps/title). Only draft/proposed plans are editable —
 * approved/in-review plans are frozen and refuse with the status named.
 */
export function editPlanDraftTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, patch: { steps?: PlanStep[]; title?: string }): ServiceResult<Plan> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'draft' && plan.status !== 'proposed') {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is ${plan.status.replace('_', ' ')} and frozen — use Revise to create a new version.`, entity: planRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'plan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot edit plans.`, entity: planRef(id, project.id) } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const x = d.plans.find((y) => y.id === id)!
    if (patch.steps) x.steps = patch.steps
    if (patch.title) x.title = patch.title
    x.updated = at
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Saved draft plan', obj: id, projectId: project.id, result: 'Success', reason: 'Draft edited' })
  })
  return { ok: true, data: authority.snapshot().plans.find((x) => x.id === id)! }
}

/**
 * Discards a draft proposal (draft/proposed only): the plan record and its
 * chat cards are removed in one commit. Approved plans are never discarded —
 * they are revised or expire by policy.
 */
export function discardPlanTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<PlanMutationOutcome> {
  const db = authority.snapshot()
  const t = addressPlan(db, ctx, id)
  if (!t.ok) return t
  const { plan, project } = t
  if (plan.status !== 'draft' && plan.status !== 'proposed') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a draft proposal can be discarded — ${id} is ${plan.status.replace('_', ' ')}.`, entity: planRef(id, project.id) } }
  }
  if (!can(ctx.actor, 'plan', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot discard plans.`, entity: planRef(id, project.id) } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.plans = d.plans.filter((x) => x.id !== id)
    d.conversations.forEach((c) => { c.messages = c.messages.filter((m) => m.planId !== id) })
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Discarded draft plan', obj: id, projectId: project.id, result: 'Success', reason: 'Draft discarded' })
  })
  return { ok: true, data: { planId: id, projectId: project.id, status: plan.status } }
}

/* ───────────── Typed service ───────────── */

export interface PlanService {
  /** One scope-checked plan; an approval past its deadline reads as `expired`. */
  get(ctx: RequestContext, id: string): Promise<ServiceResult<Plan>>
  /** The gated import path from proposal to review (draft/proposed only). */
  requestReview(ctx: RequestContext, id: string): Promise<ServiceResult<PlanMutationOutcome>>
  /** Independent four-eyes decision; approve stamps decision + 24h. */
  decide(ctx: RequestContext, id: string, decision: 'approved' | 'rejected' | 'returned', note: string): Promise<ServiceResult<PlanMutationOutcome>>
  /** The requester (or a scope manager) pulls a plan out of review. */
  withdrawReview(ctx: RequestContext, id: string): Promise<ServiceResult<PlanMutationOutcome>>
  /** Validated revision: a new draft version; the approved plan stays pinned. */
  revise(ctx: RequestContext, id: string, changes: string[], note?: string): Promise<ServiceResult<PlanRevisionOutcome>>
  /** Draft-only step/title edits. */
  editDraft(ctx: RequestContext, id: string, patch: { steps?: PlanStep[]; title?: string }): Promise<ServiceResult<Plan>>
  /** Discards a draft proposal and its chat cards. */
  discard(ctx: RequestContext, id: string): Promise<ServiceResult<PlanMutationOutcome>>
}

/** Builds the typed plan service; `guard` is the factory's superseded-scope read guard. */
export function createPlanService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): PlanService {
  return {
    get: (ctx, id) => guard(() => {
      const t = resolvePlan(authority.snapshot(), ctx, id)
      if (!t.ok) return t
      return { ok: true, data: { ...t.plan, status: effectivePlanStatus(t.plan, clock.now()) } }
    }),
    // Writes capture ctx at call time and commit once; they are never
    // cancelled mid-flight (the superseded-scope guard only covers reads).
    requestReview: (ctx, id) => Promise.resolve(requestPlanReviewTransaction(authority, clock, ctx, id)),
    decide: (ctx, id, decision, note) => Promise.resolve(decidePlanTransaction(authority, clock, ctx, id, decision, note)),
    withdrawReview: (ctx, id) => Promise.resolve(withdrawPlanReviewTransaction(authority, clock, ctx, id)),
    revise: (ctx, id, changes, note) => Promise.resolve(revisePlanTransaction(authority, clock, ctx, id, changes, note)),
    editDraft: (ctx, id, patch) => Promise.resolve(editPlanDraftTransaction(authority, clock, ctx, id, patch)),
    discard: (ctx, id) => Promise.resolve(discardPlanTransaction(authority, clock, ctx, id)),
  }
}
