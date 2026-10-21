/**
 * Project approval + scope governance handlers (ticket 21, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * An approval is a decision, never a mutation of scope content: submitting a
 * request only captures what is proposed, and an independent reviewer's
 * decision admits it. The handlers own the four-eyes rules the UI used to
 * merely hint at — an unauthorized role and the request's own submitter are
 * refused with an explainable failure, and a decision without the required
 * review information (emergency contact, in-scope assets, return reason)
 * commits nothing.
 *
 * Scope revisions invalidate at SUBMISSION, not approval (execution contract
 * invariant a): {@link reviseScopeTransaction} bumps the ROE version,
 * re-locks approval, expires approved plans, resets ready operations and
 * clears preflight in ONE atomic commit, while added assets stay pending.
 * An approved scope can therefore never be weakened by a pending one — a
 * running operation keeps its last approved scope and new work stays blocked
 * (PRE-02/PRE-03) until an independent approval admits the revision.
 *
 * Refusals commit nothing: every check runs before the commit, so a failed
 * call leaves the whole dataset unchanged. Closure specifics and the close
 * checklist stay with ticket 22; plan expiry enforcement with ticket 39.
 */
import { APR } from '../../domain/catalog';
import { can, projectAccessible, readOnlyContext } from '../../domain/policy'
import type { Db } from '../../demo/seed';
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Approval, Project } from '../../domain/entities'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
/** The demo dataset's independent reviewer; seeded approvals and notices name her. */
const REVIEWER = 'Pat Kim'

const approvalRef = (a: { id: string; projectId: string }) => ({ kind: 'approval' as const, id: a.id, projectId: a.projectId })
const projectRef = (id: string) => ({ kind: 'project' as const, id, projectId: id })
const stampOf = (clock: Clock) => formatDemoInstant(clock.now())
const bumpRoeVersion = (v: string) => v.replace(/v(\d+)$/, (_, n) => `v${+n + 1}`)

/** Project/scope are the governance types this ticket owns; closure is 22, plans 39, access 46. */
const isGoverned = (type: string) => type === APR.create || type === APR.scope

/** Resolves an approval with its project; a foreign request is not-found (no existence leak). */
function resolveApproval(db: Db, ctx: RequestContext, id: string): { ok: true; approval: Approval; project: Project } | { ok: false; failure: ServiceFailure } {
  const approval = db.approvals.find((x) => x.id === id)
  const project = approval && db.projects.find((x) => x.id === approval.projectId)
  if (!approval || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This approval request does not exist or is not available for your account.', entity: { kind: 'approval', id } } }
  }
  return { ok: true, approval, project }
}

/* ───────────── Submit (project creation / scope resubmission / requests) ───────────── */

export interface ApprovalSubmitInput { projectId: string; type: string; note: string; diff?: string }
export interface ApprovalRef { id: string; projectId: string; type: string }

/**
 * Submits an approval request in one atomic commit (request, project state
 * for creations, reviewer notice, audit). Refusal order: out-of-scope
 * project → not-found; closed/cancelled → forbidden; missing `editScope`
 * for project/scope types → forbidden; an already-pending request of the
 * same governance type → conflict; missing submission essentials →
 * validation with the exact gaps the review panel lists.
 */
export function submitApprovalTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: ApprovalSubmitInput): ServiceResult<ApprovalRef> {
  const db = authority.snapshot()
  const project = db.projects.find((x) => x.id === input.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project does not exist or is not available for your account.', entity: projectRef(input.projectId) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Project ${project.id} is closed or cancelled — nothing can be submitted for approval.`, entity: projectRef(project.id) } }
  }
  if (isGoverned(input.type) && !can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot submit ${input.type === APR.scope ? 'a scope' : 'the project'} for approval. Ask a Red Team Manager or Organization Admin.`, entity: projectRef(project.id) } }
  }
  if (isGoverned(input.type) && db.approvals.some((a) => a.projectId === project.id && a.type === input.type && a.status === 'pending')) {
    return { ok: false, failure: { kind: 'conflict', message: `${project.id} already has a pending “${input.type}” request. Wait for its decision or withdraw it first.`, entity: { kind: 'approval', id: '', projectId: project.id } } }
  }
  if (isGoverned(input.type)) {
    const missing: string[] = []
    if (!db.assets.some((a) => a.projectId === project.id && ['in', 'pending'].includes(a.scope))) missing.push('no in-scope assets')
    if (!project.emergency.trim()) missing.push('no emergency contact')
    if (!project.window.trim()) missing.push('no assessment window')
    if (missing.length) {
      return { ok: false, failure: { kind: 'validation', message: `Cannot submit yet: ${missing.join('; ')}. Complete the scope and ROE first.`, entity: projectRef(project.id) } }
    }
  }
  const at = stampOf(clock)
  let approvalId = ''
  authority.commit(ctx.corr, (d) => {
    const pr = d.projects.find((x) => x.id === project.id)!
    approvalId = 'APR-' + ++d.counters.approval
    if (input.type === APR.create) { pr.status = 'pending'; pr.roeStatus = 'pending' }
    d.approvals.unshift({ id: approvalId, projectId: project.id, type: input.type, by: ctx.actor.id, reviewer: REVIEWER, at, status: 'pending', note: input.note, diff: input.diff })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Submitted for approval: ' + input.type, obj: project.id, projectId: project.id, result: 'Success', reason: input.note })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `${project.id} is waiting for your approval (${input.type})`, projectId: project.id, at, read: false, to: { name: 'project', id: project.id }, category: 'approvals' })
  })
  return { ok: true, data: { id: approvalId, projectId: project.id, type: input.type } }
}

/* ───────────── Withdraw ───────────── */

/**
 * Withdraws a pending request: the submitter always can, and scope
 * managers/admins can withdraw on the submitter's behalf. Only pending
 * requests can be withdrawn.
 */
export function withdrawApprovalTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<ApprovalRef> {
  const db = authority.snapshot()
  const t = resolveApproval(db, ctx, id)
  if (!t.ok) return t
  const { approval, project } = t
  if (approval.status !== 'pending') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a pending request can be withdrawn — ${id} is ${approval.status}.`, entity: approvalRef(approval) } }
  }
  if (approval.by !== ctx.actor.id && !can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only the submitter, a Red Team Manager or an Organization Admin can withdraw this request.', entity: approvalRef(approval) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const a = d.approvals.find((x) => x.id === id)!
    a.status = 'withdrawn'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: `Withdrew approval request: ${a.type}`, obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: { id, projectId: project.id, type: approval.type } }
}

/* ───────────── Decide (four-eyes) ───────────── */

export type ApprovalDecision = 'approved' | 'returned'

/**
 * The reviewer's decision with the four-eyes policy owned by the handler.
 * Refusal order: unknown/foreign request → not-found; not pending →
 * conflict; missing `approve` role → forbidden; the request's own submitter
 * → forbidden (four-eyes); a closure request marked approved → conflict (it
 * resolves only through ticket 22's gated closure confirmation, which
 * re-derives the close checklist); approving without the required review
 * information (emergency contact, in-scope assets) → validation; returning
 * without a reason → validation. On success the decision, its dependent
 * entity changes (project state, admitted scope assets, assigned agent),
 * the audit row and the submitter notice commit together.
 */
export function decideApprovalTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, decision: ApprovalDecision, note: string): ServiceResult<ApprovalRef> {
  const db = authority.snapshot()
  const t = resolveApproval(db, ctx, id)
  if (!t.ok) return t
  const { approval, project } = t
  if (approval.status !== 'pending') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a pending request can be decided — ${id} is ${approval.status}.`, entity: approvalRef(approval) } }
  }
  if (!can(ctx.actor, 'approve', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Reviewer or Organization Admin can decide approvals; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: approvalRef(approval) } }
  }
  if (ctx.actor.id === approval.by) {
    return { ok: false, failure: { kind: 'forbidden', message: 'You submitted this request, so you cannot decide it yourself (four-eyes principle). Ask an independent reviewer.', entity: approvalRef(approval) } }
  }
  if (decision === 'approved' && approval.type === APR.close) {
    // Ticket 22: closure resolves only through the gated closure confirmation —
    // this path must never bypass the re-derived close checklist.
    return { ok: false, failure: { kind: 'conflict', message: 'Project closure is confirmed only through the closure console, which independently re-checks the close policy before closing.', entity: approvalRef(approval) } }
  }
  if (decision === 'approved' && isGoverned(approval.type)) {
    if (!project.emergency.trim()) {
      return { ok: false, failure: { kind: 'validation', message: 'Cannot approve: the ROE has no emergency contact. Return it for changes with a reason.', entity: approvalRef(approval) } }
    }
    if (!db.assets.some((a) => a.projectId === project.id && ['in', 'pending'].includes(a.scope))) {
      return { ok: false, failure: { kind: 'validation', message: 'Cannot approve: the project has no in-scope assets. Return it for changes.', entity: approvalRef(approval) } }
    }
  }
  if (decision === 'returned' && !note.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to return a request. Tell the submitter what to change.', entity: approvalRef(approval) } }
  }
  const at = stampOf(clock)
  const approved = decision === 'approved'
  authority.commit(ctx.corr, (d) => {
    const a = d.approvals.find((x) => x.id === id)!
    const pr = d.projects.find((x) => x.id === approval.projectId)!
    a.status = decision
    a.note = note.trim() || a.note
    if (approved) {
      if (a.type === APR.create) { pr.status = 'approved'; pr.roeStatus = 'approved' }
      if (a.type === APR.scope) pr.roeStatus = 'approved'
      if (a.type === APR.create || a.type === APR.scope) d.assets.forEach((x) => { if (x.projectId === pr.id && x.scope === 'pending') x.scope = 'in' })
      if (a.type.startsWith('Agent assignment')) { const ag = d.agents.find((x) => x.id === /AG-\d+/.exec(a.diff || '')?.[0]); if (ag && !ag.projectId) ag.projectId = pr.id }
    } else {
      if (a.type === APR.create) { pr.status = 'rejected'; pr.roeStatus = 'rejected' }
      if (a.type === APR.scope) pr.roeStatus = 'rejected'
      if (a.type === APR.close) pr.status = pr.status === 'review' ? 'active' : pr.status
    }
    pr.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: `${approved ? 'Approved' : 'Returned'}: ${a.type}`, obj: pr.id, projectId: pr.id, result: 'Success', reason: note.trim() })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `${a.type} for ${pr.id} was ${approved ? 'approved' : 'returned'}`, projectId: pr.id, at, read: false, to: { name: 'project', id: pr.id }, category: 'approvals' })
  })
  return { ok: true, data: { id, projectId: project.id, type: approval.type } }
}

/* ───────────── Scope revision — the governance transaction (invariant a) ───────────── */

export type ScopeFieldPatch = Partial<Pick<Project, 'window' | 'emergency' | 'methods' | 'restrictions' | 'desc'>>
export interface ScopeAssetInput { name: string; ident: string; type: string; os: string; owner: string; scope: 'in' | 'out'; source: string; ip?: string }
export interface ScopeRevisionInput { patch?: ScopeFieldPatch; assets?: ScopeAssetInput[]; reason?: string; note?: string; diff?: string }

/** What one revision changed, returned so callers (and ticket 51's asset path) can message it. */
export interface ScopeRevisionOutcome {
  projectId: string
  /** ROE version after the revision (bumped when the revision invalidated a governed scope). */
  roeVersion: string
  /** True when the submission invalidated dependents (submission-time invalidation). */
  invalidated: boolean
  /** Plans expired by this submission (Re-validation Required). */
  plansExpired: string[]
  /** Ready operations reset to Draft with preflight cleared. */
  operationsReset: string[]
}

/**
 * The one scope-revision transaction behind `editScope` and `addAssets`
 * (and ticket 51's asset import path). On a governed scope (approved ROE on
 * an approved/active project) ANY revision — ROE field edit or in-scope
 * asset addition — invalidates at submission in a single commit: the ROE
 * bumps to the next draft version, approval re-locks to pending, approved
 * plans expire with a Re-validation Required risk, ready operations return
 * to Draft with preflight cleared, and added assets stay pending until an
 * independent approval admits them. Running operations are deliberately not
 * touched: they keep their last approved scope until they end (documented
 * behavior; resume is refused while the plan needs re-approval). On a
 * non-governed project the patch/assets still apply — drafts are editable —
 * but nothing is invalidated and no request is created.
 */
export function reviseScopeTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, projectId: string, input: ScopeRevisionInput): ServiceResult<ScopeRevisionOutcome> {
  const db = authority.snapshot()
  const project = db.projects.find((x) => x.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project does not exist or is not available for your account.', entity: projectRef(projectId) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — scope is read-only.`, entity: projectRef(projectId) } }
  }
  if (!can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot edit scope. Only a Red Team Manager or Organization Admin can.`, entity: projectRef(projectId) } }
  }
  const patch = input.patch
  const assets = input.assets ?? []
  if ((!patch || Object.keys(patch).length === 0) && assets.length === 0) {
    return { ok: false, failure: { kind: 'validation', message: 'Provide scope changes or assets to add.', entity: projectRef(projectId) } }
  }
  if (patch?.window !== undefined && !patch.window.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'Assessment window is required.', entity: projectRef(projectId) } }
  }
  if (patch?.emergency !== undefined && !patch.emergency.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'Emergency contact is required.', entity: projectRef(projectId) } }
  }
  const governed = project.roeStatus === 'approved' && ['approved', 'active'].includes(project.status)
  const invalidated = governed && (!!patch || assets.some((a) => a.scope !== 'out'))
  const at = stampOf(clock)
  const nextVersion = bumpRoeVersion(project.roeVersion)
  const outcome: ScopeRevisionOutcome = { projectId, roeVersion: project.roeVersion, invalidated, plansExpired: [], operationsReset: [] }
  authority.commit(ctx.corr, (d) => {
    const pr = d.projects.find((x) => x.id === projectId)!
    if (patch) Object.assign(pr, patch)
    assets.forEach((a, i) => {
      const id = `AS-${projectId.slice(-3)}${d.assets.filter((x) => x.projectId === projectId).length + i + 1}${Math.floor(Math.random() * 9)}`
      d.assets.push({ id, name: a.name, ident: a.ident, ip: a.ip || '203.0.113.' + (120 + i), type: a.type, os: a.os, owner: a.owner, projectId, scope: a.scope === 'out' ? 'out' : 'pending', source: a.source, updated: at })
    })
    if (invalidated) {
      // Invariant (a): invalidation happens HERE, at submission — the pending
      // request can never weaken the still-approved effective scope below.
      pr.roeVersion = nextVersion
      pr.roeStatus = 'pending'
      d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId, type: APR.scope, by: ctx.actor.id, reviewer: REVIEWER, at, status: 'pending', note: input.note || input.reason || 'Scope / ROE edit', diff: input.diff || `New version ${nextVersion}` })
      d.plans.forEach((pl) => {
        if (pl.projectId === projectId && pl.status === 'approved') {
          pl.status = 'expired'
          pl.risks = [...pl.risks, `Re-validation required: scope changed (${nextVersion} draft). Re-approve under the new ROE.`]
          outcome.plansExpired.push(pl.id)
        }
      })
      d.operations.forEach((o) => {
        if (o.projectId === projectId && o.status === 'ready') {
          o.status = 'draft'
          o.preflightAt = undefined
          outcome.operationsReset.push(o.id)
        }
      })
    }
    pr.updated = at
    const rows: { action: string; obj: string; reason: string }[] = []
    if (patch) rows.push({ action: invalidated ? 'Edited approved scope' : 'Updated scope', obj: projectId, reason: input.reason || '' })
    if (assets.length) rows.push({ action: 'Added assets', obj: assets.map((a) => a.name).join(', '), reason: '' })
    if (invalidated) rows.push({ action: 'Approved plans and ready operations invalidated by scope change', obj: projectId, reason: `${outcome.plansExpired.length} plan(s) need re-approval; ready operations returned to Draft` })
    rows.forEach((r) => d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: r.action, obj: r.obj, projectId, result: 'Success', reason: r.reason }))
    if (invalidated) {
      d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `Scope change on ${projectId}: approved plans and ready operations need re-validation`, projectId, at, read: false, to: { name: 'project', id: projectId } })
    }
  })
  if (invalidated) outcome.roeVersion = nextVersion
  return { ok: true, data: outcome }
}
