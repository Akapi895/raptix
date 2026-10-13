/**
 * Project closure governance handlers (ticket 22, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Closure is a two-step governance decision. The REQUEST is manager-gated
 * and deliberately NOT checklist-gated: it is a request for independent
 * review, so a manager may flag closure intent while conditions are still
 * open — the checklist is evaluated at request time for the record (note,
 * itemized diff, documented no-findings waiver) and re-derived from
 * canonical state at confirmation. The CONFIRMATION is where the policy
 * gates: an independent Reviewer/Admin (four-eyes — the requester can never
 * confirm their own request), and the checklist re-derived from the current
 * dataset, so a late blocking change (a resumed operation, a new live
 * session, an undispositioned finding, a confirmed finding voiding the
 * waiver) prevents closure. The checklist itself is always derived, never
 * stored: there is no facet write anywhere in the closure path.
 *
 * Reopening a closed project requires the admin role and an audited reason;
 * refusals commit nothing — every check runs before the single atomic commit.
 */
import { APR } from '../../data'
import { can, projectAccessible } from '../../auth/policy'
import type { Db } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
/** The demo dataset's independent reviewer; seeded approvals and notices name her. */
const REVIEWER = 'Pat Kim'

/** Marker recorded on a closure request filed as an approved no-findings closure — the documented waiver, kept explicit. */
export const NO_FINDINGS_WAIVER = 'no-findings-waiver'

const OPEN_FINDING_STATES = ['draft', 'review', 'returned']
const RESOLVED_FINDING_STATES = ['confirmed', 'remediation', 'retest', 'resolved']
const LIVE_SESSION_STATES = ['connected', 'available', 'awaiting', 'suspended', 'revoking']

const approvalRef = (a: { id: string; projectId: string }) => ({ kind: 'approval' as const, id: a.id, projectId: a.projectId })
const projectRef = (id: string) => ({ kind: 'project' as const, id, projectId: id })
const stampOf = (clock: Clock) => formatDemoInstant(clock.now())

export interface CloseCheck { id: string; label: string; ok: boolean; detail: string; fix: { page: string; tab?: string; id?: string } }
export interface CloseChecklistOptions { waiverNoFindings?: boolean }

/** True when the project has no confirmed-and-tracked finding — the documented precondition of the no-findings closure waiver. */
export function noConfirmedFindings(db: Db, projectId: string): boolean {
  return !db.findings.some((f) => f.projectId === projectId && RESOLVED_FINDING_STATES.includes(f.status))
}

/**
 * The closure checklist, derived from canonical state on every call and
 * never persisted: ended operations, no live C2 sessions, dispositioned
 * findings, a delivered final report and no outstanding required approvals.
 * The documented no-findings waiver replaces the report condition only when
 * it was requested and no confirmed finding exists.
 */
export function evaluateCloseChecklist(db: Db, projectId: string, opts?: CloseChecklistOptions): CloseCheck[] {
  const ops = db.operations.filter((o) => o.projectId === projectId)
  const fs = db.findings.filter((f) => f.projectId === projectId)
  const reps = db.reports.filter((r) => r.projectId === projectId)
  const appr = db.approvals.filter((a) => a.projectId === projectId && a.status === 'pending' && a.type !== APR.close)
  const running = ops.filter((o) => ['running', 'paused'].includes(o.status))
  const openF = fs.filter((f) => OPEN_FINDING_STATES.includes(f.status))
  const delivered = reps.some((r) => r.status === 'delivered')
  const live = db.sessions.filter((s) => s.projectId === projectId && LIVE_SESSION_STATES.includes(s.state))
  const waived = opts?.waiverNoFindings === true && !delivered && noConfirmedFindings(db, projectId)
  return [
    { id: 'c1', label: 'No running or paused operations', ok: running.length === 0, detail: running.length ? `Still open: ${running.map((o) => o.id).join(', ')}` : 'All operations have ended or are drafts', fix: { page: 'project', tab: 'operations', id: projectId } },
    { id: 'c1b', label: 'No live C2 sessions', ok: live.length === 0, detail: live.length ? `Live: ${live.map((s) => s.id).join(', ')}` : 'No live sessions', fix: { page: 'c2' } },
    { id: 'c2', label: 'Findings reviewed per policy', ok: openF.length === 0, detail: openF.length ? `${openF.length} findings not reviewed: ${openF.map((f) => f.id).join(', ')}` : `${fs.length} findings handled`, fix: { page: 'project', tab: 'findings', id: projectId } },
    { id: 'c3', label: 'Final report approved and delivered', ok: delivered || waived, detail: delivered ? 'A report is Delivered' : waived ? 'Waived: approved no-findings closure (documented statement replaces the final report)' : 'No report has been delivered', fix: { page: 'project', tab: 'reports', id: projectId } },
    { id: 'c4', label: 'No outstanding required approvals', ok: appr.length === 0, detail: appr.length ? `${appr.length} requests pending` : 'No open requests', fix: { page: 'project', tab: 'team', id: projectId } },
  ]
}

/**
 * The close console's display list: the policy checklist plus the
 * agent-reservation condition (documented closure behavior retained
 * explicitly), so the panel and the request/confirm handlers read one
 * derivation.
 */
export function closePanelItems(db: Db, projectId: string, opts?: CloseChecklistOptions): CloseCheck[] {
  const heldAgents = db.agents.filter((a) => a.projectId === projectId && a.op && db.operations.some((o) => o.id === a.op && ['running', 'paused'].includes(o.status)))
  return [
    ...evaluateCloseChecklist(db, projectId, opts),
    { id: 'c5', label: 'Agent reservations released', ok: heldAgents.length === 0, detail: heldAgents.length ? `Still reserved: ${heldAgents.map((a) => a.id).join(', ')}` : 'No agent is reserved by an active operation', fix: { page: 'agents' } },
  ]
}

/* ───────────── Request (manager-gated, not checklist-gated) ───────────── */

export interface CloseRequestInput { reason: string; waiverNoFindings?: boolean }
export interface CloseRef { id: string; projectId: string }

/**
 * Requests project closure in one atomic commit (pending close approval with
 * the evaluated checklist recorded, project state, both audit rows, reviewer
 * notice). Refusal order: unknown/foreign project → not-found; missing
 * `requestClose` role → forbidden; an already-pending closure request →
 * conflict; a missing reason → validation. A failing checklist is accepted —
 * the request is UI-only and the reviewer's confirmation is the gate.
 */
export function requestCloseTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, projectId: string, input: CloseRequestInput): ServiceResult<CloseRef> {
  const db = authority.snapshot()
  const project = db.projects.find((x) => x.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project does not exist or is not available for your account.', entity: projectRef(projectId) } }
  }
  if (!can(ctx.actor, 'requestClose', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Red Team Manager can request project closure; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: projectRef(projectId) } }
  }
  if (db.approvals.some((a) => a.projectId === projectId && a.type === APR.close && a.status === 'pending')) {
    return { ok: false, failure: { kind: 'conflict', message: `${projectId} already has a pending closure request. Wait for its decision or withdraw it first.`, entity: { kind: 'approval', id: '', projectId } } }
  }
  if (!input.reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to request project closure. Document the closure rationale for the reviewer.', entity: projectRef(projectId) } }
  }
  const waiver = input.waiverNoFindings === true && noConfirmedFindings(db, projectId)
  const items = evaluateCloseChecklist(db, projectId, { waiverNoFindings: waiver })
  const open = items.filter((i) => !i.ok)
  const at = stampOf(clock)
  let approvalId = ''
  authority.commit(ctx.corr, (d) => {
    approvalId = 'APR-' + ++d.counters.approval
    d.approvals.unshift({
      id: approvalId, projectId, type: APR.close, by: ctx.actor.id, reviewer: REVIEWER, at, status: 'pending',
      note: open.length ? `Requesting project closure — ${open.length} checklist condition${open.length === 1 ? '' : 's'} still open.` : 'Requesting project closure — checklist complete.',
      diff: `Checklist at request (re-checked at confirmation):\n${items.map((i) => `${i.ok ? '[met] ' : '[open] '}${i.label} — ${i.detail}`).join('\n')}`,
      refId: waiver ? NO_FINDINGS_WAIVER : undefined,
    })
    d.projects.find((x) => x.id === projectId)!.status = 'review'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Requested project closure', obj: projectId, projectId, result: 'Success', reason: '' })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: waiver ? 'Closure reason (approved no-findings closure)' : 'Closure reason', obj: projectId, projectId, result: 'Success', reason: input.reason.trim() })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `${projectId} requested closure — awaiting confirmation`, projectId, at, read: false, to: { name: 'project', id: projectId }, category: 'approvals' })
  })
  return { ok: true, data: { id: approvalId, projectId } }
}

/* ───────────── Confirm (four-eyes + re-derived checklist) ───────────── */

/**
 * Confirms a closure request with the four-eyes policy and the checklist
 * owned by the handler. Refusal order: unknown/foreign request → not-found;
 * not a closure request or not pending → conflict; missing `confirmClose`
 * role → forbidden; the request's own submitter → forbidden (four-eyes); a
 * checklist condition re-derived from canonical state → validation naming
 * each blocker, so a late blocking change prevents closure. On success the
 * decision, the read-only project state and the audit row commit together.
 */
export function confirmCloseTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, approvalId: string): ServiceResult<CloseRef> {
  const db = authority.snapshot()
  const approval = db.approvals.find((x) => x.id === approvalId)
  const project = approval && db.projects.find((x) => x.id === approval.projectId)
  if (!approval || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This closure request does not exist or is not available for your account.', entity: { kind: 'approval', id: approvalId } } }
  }
  if (approval.type !== APR.close) {
    return { ok: false, failure: { kind: 'conflict', message: `${approvalId} is not a project closure request.`, entity: approvalRef(approval) } }
  }
  if (approval.status !== 'pending') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a pending closure request can be confirmed — ${approvalId} is ${approval.status}.`, entity: approvalRef(approval) } }
  }
  if (!can(ctx.actor, 'confirmClose', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Reviewer or Organization Admin can confirm project closure; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: approvalRef(approval) } }
  }
  if (ctx.actor.id === approval.by) {
    return { ok: false, failure: { kind: 'forbidden', message: 'You requested this closure, so you cannot confirm it yourself (four-eyes principle). Ask an independent reviewer.', entity: approvalRef(approval) } }
  }
  const waiver = approval.refId === NO_FINDINGS_WAIVER && noConfirmedFindings(db, project.id)
  const failing = evaluateCloseChecklist(db, project.id, { waiverNoFindings: waiver }).filter((i) => !i.ok)
  if (failing.length) {
    return { ok: false, failure: { kind: 'validation', message: `Cannot confirm closure: ${failing.map((i) => `${i.label} (${i.detail})`).join('; ')}. A late blocking change prevents closure — resolve the blockers first.`, entity: approvalRef(approval) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const a = d.approvals.find((x) => x.id === approvalId)!
    const pr = d.projects.find((x) => x.id === project.id)!
    a.status = 'approved'
    pr.status = 'closed'
    pr.closedAt = at
    pr.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Confirmed project closure', obj: project.id, projectId: project.id, result: 'Success', reason: 'Closure criteria met' })
  })
  return { ok: true, data: { id: approvalId, projectId: project.id } }
}

/* ───────────── Reopen (admin + audited reason) ───────────── */

/**
 * Reopens a closed project: the admin role and an audited reason are both
 * required by the handler (the UI used to gate these alone). Refusal order:
 * unknown/foreign project → not-found; not closed → conflict; missing
 * `reopen` role → forbidden; missing reason → validation.
 */
export function reopenProjectTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, projectId: string, reason: string): ServiceResult<CloseRef> {
  const db = authority.snapshot()
  const project = db.projects.find((x) => x.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project does not exist or is not available for your account.', entity: projectRef(projectId) } }
  }
  if (project.status !== 'closed') {
    return { ok: false, failure: { kind: 'conflict', message: `Only a closed project can be reopened — ${projectId} is ${project.status}.`, entity: projectRef(projectId) } }
  }
  if (!can(ctx.actor, 'reopen', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only an Organization Admin can reopen a closed project; the ${ROLE_LABEL[ctx.actor.role]} role cannot.`, entity: projectRef(projectId) } }
  }
  if (!reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to reopen a closed project. It is recorded in the audit log.', entity: projectRef(projectId) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const pr = d.projects.find((x) => x.id === projectId)!
    pr.status = 'active'
    pr.closedAt = undefined
    pr.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Reopened project', obj: projectId, projectId, result: 'Success', reason: reason.trim() })
  })
  return { ok: true, data: { id: projectId, projectId } }
}
