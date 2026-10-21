/**
 * Mock adapter for the closure port (plan P09, Closure slice). The closure
 * request and its decision are approval records in the mock; this adapter
 * presents them as the closure record, derives the checklist from the same
 * canonical service the mock Closeout tab used, and writes through the closure
 * and approval transactions.
 */
import { can } from '../../domain/policy'
import { APR, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import { decideApprovalTransaction, withdrawApprovalTransaction } from '../approvals/service'
import { confirmCloseTransaction, evaluateCloseChecklist, requestCloseTransaction, type CloseCheck } from './service'
import type { ClosureCheckView, ClosureRead, ClosureRecordView, ClosureService } from './service'

const ELIGIBLE = ['active', 'approved', 'paused']

const checkView = (c: CloseCheck): ClosureCheckView => ({ id: c.id, label: c.label, ok: c.ok, unknown: false, detail: c.detail, fix: c.fix })

function readClosure(db: Db, ctx: RequestContext): ServiceResult<ClosureRead> {
  const project = db.projects.find((p) => p.id === ctx.projectId)
  if (!project) return { ok: false, failure: { kind: 'not-found', message: `Project ${ctx.projectId} was not found.` } }
  const pending = db.approvals.find((a) => a.projectId === project.id && a.type === APR.close && a.status === 'pending') ?? null
  const approved = db.approvals.filter((a) => a.projectId === project.id && a.type === APR.close && a.status === 'approved').sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null
  const closed = project.status === 'closed'
  // The requester's reason is recorded on the audit row; the approval note carries only the checklist summary.
  const reasonOf = (note: string): string => db.audit.find((a) => a.obj === project.id && a.action.startsWith('Closure reason'))?.reason ?? note
  const record: ClosureRecordView | null = pending
    ? { id: pending.id, status: 'requested', requestedBy: pending.by, decidedBy: null, decidedAt: null, reason: reasonOf(pending.note), updatedAt: pending.at }
    : closed && approved
      ? { id: approved.id, status: 'closed', requestedBy: approved.by, decidedBy: approved.reviewer, decidedAt: project.closedAt ?? null, reason: reasonOf(approved.note), updatedAt: approved.at }
      : null
  const canRequest = can(ctx.actor, 'requestClose', project)
  const eligible = ELIGIBLE.includes(project.status) && !pending
  const canDecide = !!pending && can(ctx.actor, 'confirmClose', project) && pending.by !== ctx.actor.id
  return {
    ok: true,
    data: {
      checklist: evaluateCloseChecklist(db, project.id).map(checkView),
      waivedChecklist: evaluateCloseChecklist(db, project.id, { waiverNoFindings: true }).map(checkView),
      record,
      readOnly: project.status === 'closed' || project.status === 'cancelled',
      canRequest: canRequest && eligible,
      requestBlockReason: evaluateCloseChecklist(db, project.id).some((c) => !c.ok) ? 'Resolve the blockers first' : null,
      requestReason: !canRequest ? 'Only a Red Team Manager can request project closure.' : !eligible ? `The project is “${project.status}”, so closure cannot be requested yet.` : null,
      canDecide,
      decideReason: pending && !canDecide ? (pending.by === ctx.actor.id ? 'The requester cannot confirm their own request.' : 'Only a Reviewer or Admin can confirm the closure request.') : null,
    },
  }
}

export function createMockClosureService(authority: DbAuthority, clock: Clock, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): ClosureService {
  const recordAfter = (ctx: RequestContext): ServiceResult<ClosureRecordView | null> => {
    const read = readClosure(authority.snapshot(), ctx)
    return read.ok ? { ok: true, data: read.data.record } : read
  }
  return {
    read: (ctx) => guard(() => readClosure(authority.snapshot(), ctx)),
    request: async (ctx, input) => {
      const requested = requestCloseTransaction(authority, clock, ctx, ctx.projectId, { reason: input.reason, waiverNoFindings: input.waiverNoFindings })
      if (!requested.ok) return requested
      const after = recordAfter(ctx)
      return after.ok && after.data ? { ok: true, data: after.data } : { ok: false, failure: { kind: 'conflict', message: 'The closure request was recorded but cannot be read back.' } }
    },
    decide: async (ctx, decision, reason) => {
      const pending = authority.snapshot().approvals.find((a) => a.projectId === ctx.projectId && a.type === APR.close && a.status === 'pending')
      if (!pending) return { ok: false, failure: { kind: 'conflict', message: 'There is no closure request awaiting a decision.' } }
      const written = decision === 'confirmed'
        ? confirmCloseTransaction(authority, clock, ctx, pending.id)
        : decision === 'cancelled'
          ? withdrawApprovalTransaction(authority, clock, ctx, pending.id)
          : decideApprovalTransaction(authority, clock, ctx, pending.id, 'returned', reason)
      if (!written.ok) return written
      return recordAfter(ctx)
    },
  }
}
