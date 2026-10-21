import type { RequestContext, ServiceResult } from '../../domain/service'
import type { ClosureCheckView, ClosureRead, ClosureRecordView, ClosureService } from '../../features/closure/service'
import { decideClosure, fetchClosure, requestClosure, type ClosureChecklistEntryView, type ClosureView } from '../../features/closure/remote';
import { guarded } from './shared'

/** The checks the server reads; the label names each source the checklist depends on. */
const CHECK_LABEL: Readonly<Record<string, string>> = {
  runtime: 'Runtime requests settled',
  estop: 'No unresolved emergency stops',
  c2: 'No live C2 session grants',
  findings: 'No findings left in review',
  reports: 'All reports delivered',
  approvals: 'No pending approvals',
  'scope-reviews': 'No pending scope reviews',
  'plan-reviews': 'No pending plan reviews',
  'grant-reviews': 'No pending grant reviews',
  'provider-sessions': 'Provider sessions disconnected',
  'runtime-questions': 'Runtime runs and questions settled',
}

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its closure.' }

function toCheck(entry: ClosureChecklistEntryView): ClosureCheckView {
  return {
    id: entry.id,
    label: CHECK_LABEL[entry.id] ?? entry.id,
    ok: entry.state === 'pass',
    unknown: entry.state === 'unavailable',
    detail: entry.detail ?? (entry.state === 'pass' ? 'settled' : entry.state === 'unavailable' ? 'The source is not readable; closure stays blocked.' : 'Not settled.'),
  }
}

function toRecord(view: ClosureView): ClosureRecordView {
  return { id: view.id, status: view.status, requestedBy: view.requestedBy, decidedBy: view.decidedBy, decidedAt: view.decidedAt, reason: view.reason, updatedAt: view.updatedAt }
}

export function createRealClosureService(): ClosureService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  return {
    read: (ctx) => guarded(async (): Promise<ServiceResult<ClosureRead>> => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const surface = await fetchClosure(engagementId)
      const pending = surface.closure?.status === 'requested'
      // The server decides who may request or decide; the console shows the refusal it returns.
      return {
        ok: true,
        data: {
          checklist: surface.checklist.entries.map(toCheck),
          waivedChecklist: null,
          record: surface.closure ? toRecord(surface.closure) : null,
          readOnly: surface.readOnly,
          canRequest: !surface.readOnly && !pending,
          requestBlockReason: null,
          requestReason: surface.readOnly ? 'This engagement is closed.' : pending ? 'A closure request is already waiting for a decision.' : null,
          canDecide: pending,
          decideReason: null,
        },
      }
    }),
    request: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      if (input.waiverNoFindings) return { ok: false, failure: { kind: 'validation', message: 'A no-findings waiver is not available in this deployment; resolve the checklist instead.' } }
      return { ok: true, data: toRecord(await requestClosure(engagementId, input.reason)) }
    }),
    decide: (ctx, decision) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await decideClosure(engagementId, decision)
      return { ok: true, data: toRecord(view) }
    }),
  }
}
