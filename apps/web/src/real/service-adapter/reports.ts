import type { ExportRec, Report, ReportStatus } from '../../domain/entities'
import type { ServiceResult } from '../../domain/service'
import type {
  DeliveryInput, DeliveryListQuery, DeliveryListRead, DraftOptionsRead, ReportDecision,
  ReportDraftInput, ReportEditorRead, ReportListQuery, ReportListRead, ReportReviewRead, ReportService, ReportSubmitInput,
} from '../../features/reports/service'
import {
  createReport, decideReportReview, deliverReport, fetchReports, submitReportForReview, updateReport,
  type ReportView,
} from '../api'
import { REAL_CONTROL_GAPS } from './control-gaps'
import { displayTime, guarded } from './shared'
import { unavailable, unsupportedControl } from './stub'

const PAGE_SIZE = 10
const SUMMARY_ID = 'summary'
/** Roles the server accepts for editing a report (operator and above). */
const EDIT_ROLES: readonly string[] = ['admin', 'manager', 'operator', 'analyst']
/** Roles that may approve or return a version (reviewer and above, never the author). */
const REVIEW_ROLES: readonly string[] = ['admin', 'manager', 'reviewer']

const STATUS_FROM_API: Readonly<Record<ReportView['status'], ReportStatus>> = {
  draft: 'draft', in_review: 'review', approved: 'approved', changes_requested: 'returned', delivered: 'delivered',
}

type Section = { id: string; title: string; body: string }

/** The real body is a summary plus titled sections; the summary is presented as the first, fixed section. */
function sectionsOf(view: ReportView): Section[] {
  return [
    { id: SUMMARY_ID, title: 'Summary', body: view.body.summary },
    ...view.body.sections.map((section, index) => ({ id: `s${index}`, title: section.title, body: section.content })),
  ]
}

function toReport(view: ReportView, engagementId: string): Report {
  const delivered = view.deliveries.find((d) => d.kind === 'delivery')
  const reviews = view.reviewedBy
    ? [{ at: displayTime(view.reviewedAt ?? ''), by: view.reviewedBy, action: view.status === 'changes_requested' ? 'returned' : 'approved', note: view.reviewComment ?? '', version: `v${view.approvedVersion ?? view.version}` }]
    : []
  return {
    id: view.id,
    projectId: engagementId,
    title: view.title,
    template: '',
    version: `v${view.version}`,
    status: STATUS_FROM_API[view.status],
    author: view.createdBy,
    reviewer: view.reviewedBy ?? '',
    updated: displayTime(view.updatedAt),
    deliveredAt: delivered ? displayTime(delivered.createdAt) : undefined,
    findings: [],
    sections: sectionsOf(view).map(({ id, title, body }) => ({ id, title, body })),
    reviews,
  }
}

function toExportRec(view: ReportView, deliveries: ReportView['deliveries']): ExportRec[] {
  return deliveries.map((d) => ({
    id: d.id,
    reportId: view.id,
    version: `v${view.version}`,
    format: d.format,
    by: view.createdBy,
    at: displayTime(d.createdAt),
    recipient: '',
    status: d.status,
    checksum: '',
  }))
}

function notFound<T>(id: string): Promise<ServiceResult<T>> {
  return Promise.resolve({ ok: false, failure: { kind: 'not-found', message: `Report ${id} does not exist or is not available for your account.` } })
}

function validation<T>(message: string): Promise<ServiceResult<T>> {
  return Promise.resolve({ ok: false, failure: { kind: 'validation', message } })
}

async function readReport(engagementId: string, id: string): Promise<ReportView | null> {
  const view = await fetchReports(engagementId)
  return view.reports.find((r) => r.id === id) ?? null
}

/** Rebuilds the real body from the sections the caller edited, keeping the summary fixed. */
function bodyFromSections(sections: Section[]): { summary: string; sections: { title: string; content: string }[] } {
  const summary = sections.find((s) => s.id === SUMMARY_ID)?.body ?? ''
  return { summary, sections: sections.filter((s) => s.id !== SUMMARY_ID).map((s) => ({ title: s.title, content: s.body })) }
}

/**
 * Real ReportService over the report-records resource (ADR-0084). The real
 * body has a summary and titled sections, which is what the editor edits;
 * findings links, templates, PDF/DOCX export, checklist results, ROE data,
 * snapshots and recipient acknowledgement have no backend concept yet and
 * resolve to registered control gaps. Every write carries the version the
 * caller last read, so a stale edit is refused rather than overwriting.
 */
export function createRealReportService(): ReportService {
  return {
    list: (ctx, query: ReportListQuery = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<ReportListRead>('Select an engagement to read its reports.')
      const view = await fetchReports(ctx.projectId)
      const all = view.reports.map((r) => toReport(r, ctx.projectId))
      const needle = query.q?.trim().toLowerCase() ?? ''
      const rows = all.filter((r) =>
        (!needle || r.id.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle))
        && (!query.status || r.status === query.status)
        && (!query.author || r.author === query.author))
      const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
      const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
      const counts = {
        open: all.filter((r) => r.status === 'draft' || r.status === 'returned').length,
        review: all.filter((r) => r.status === 'review').length,
        approved: all.filter((r) => r.status === 'approved' || r.status === 'exported').length,
        delivered: all.filter((r) => r.status === 'delivered').length,
      }
      return {
        ok: true,
        data: {
          items: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((report) => ({ report })),
          page,
          pageSize: PAGE_SIZE,
          total: rows.length,
          counts,
          projects: [ctx.projectId],
          templates: [],
          authors: [...new Set(all.map((r) => r.author).filter(Boolean))].sort(),
        },
      }
    }),

    templates: () => Promise.resolve({ ok: true, data: [] }),

    deliveries: (ctx, query: DeliveryListQuery = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<DeliveryListRead>('Select an engagement to read its delivery history.')
      const view = await fetchReports(ctx.projectId)
      const items = view.reports.flatMap((r) => toExportRec(r, r.deliveries).map((rec) => ({ rec, reportTitle: r.title })))
      const rows = items.filter((item) => !query.status || item.rec.status === query.status)
      return {
        ok: true,
        data: { items: rows.slice(0, PAGE_SIZE), page: 1, pageSize: PAGE_SIZE, total: rows.length, statuses: [...new Set(items.map((i) => i.rec.status))].sort() },
      }
    }),

    draftOptions: (ctx) => guarded(async () => {
      const allowed = EDIT_ROLES.includes(ctx.actor.role)
      const data: DraftOptionsRead = {
        projectId: ctx.projectId,
        templates: [],
        findings: [],
        reviewers: [],
        canCreate: allowed,
        createReason: allowed ? '' : 'The role on this engagement cannot create reports.',
        confirmedCount: 0,
      }
      return { ok: true, data }
    }),

    createDraft: (ctx, input: ReportDraftInput) => guarded(async () => {
      if (input.findings.length > 0) return validation<Report>(REAL_CONTROL_GAPS['report.findingLink'])
      if (input.template || input.reviewer || input.period) return validation<Report>('Templates, a named reviewer and a reporting period are not stored by the report workflow yet.')
      if (!EDIT_ROLES.includes(ctx.actor.role)) return { ok: false, failure: { kind: 'forbidden', message: 'The role on this engagement cannot create reports.' } }
      const created = await createReport(ctx.projectId, { title: input.title, summary: '' })
      return { ok: true, data: toReport(created, ctx.projectId) }
    }),

    editor: (ctx, id: string) => guarded(async () => {
      if (!id) return notFound<ReportEditorRead>(id)
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<ReportEditorRead>(id)
      const editable = (view.status === 'draft' || view.status === 'changes_requested') && EDIT_ROLES.includes(ctx.actor.role)
      const data: ReportEditorRead = {
        report: toReport(view, ctx.projectId),
        project: { id: ctx.projectId, client: '', type: '', roeVersion: '', window: '' },
        canEdit: editable,
        editReason: editable ? '' : (EDIT_ROLES.includes(ctx.actor.role) ? 'Only a draft or a returned report can be edited; approved or delivered content is pinned.' : 'The role on this engagement cannot edit reports.'),
        findings: [],
        linked: [],
      }
      return { ok: true, data }
    }),

    review: (ctx, id: string) => guarded(async () => {
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<ReportReviewRead>(id)
      const isAuthor = view.createdBy === ctx.actor.id
      const reviewerRole = REVIEW_ROLES.includes(ctx.actor.role)
      const data: ReportReviewRead = {
        report: toReport(view, ctx.projectId),
        project: { id: ctx.projectId, client: '', type: '', roeVersion: '', roeStatus: 'none', window: '' } as ReportReviewRead['project'],
        checks: [],
        linked: [],
        exports: toExportRec(view, view.deliveries),
        gates: {
          decide: {
            allowed: view.status === 'in_review' && reviewerRole && !isAuthor,
            reason: view.status !== 'in_review' ? 'Only a report in review can be approved or returned.' : !reviewerRole ? 'Approving or returning requires the reviewer role.' : isAuthor ? 'The author cannot review their own report.' : '',
          },
          export: { allowed: false, reason: REAL_CONTROL_GAPS['report.pdfDocx'] },
          deliver: {
            allowed: view.status === 'approved' && EDIT_ROLES.includes(ctx.actor.role),
            reason: view.status !== 'approved' ? 'Delivery requires an approved version.' : !EDIT_ROLES.includes(ctx.actor.role) ? 'Recording a delivery requires the operator role on this engagement.' : '',
          },
          ack: { allowed: false, reason: REAL_CONTROL_GAPS['report.acknowledge'] },
        },
      } as ReportReviewRead
      return { ok: true, data }
    }),

    saveSection: (ctx, id: string, sectionId: string, body: string) => guarded(async () => {
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const sections = sectionsOf(view).map((s) => (s.id === sectionId ? { ...s, body } : s))
      if (!sections.some((s) => s.id === sectionId)) return notFound<Report>(sectionId)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, ctx.projectId) }
    }),

    addSection: (ctx, id: string, title: string) => guarded(async () => {
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const sections = [...sectionsOf(view), { id: `new-${view.body.sections.length}`, title, body: '' }]
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, ctx.projectId) }
    }),

    removeSection: (ctx, id: string, sectionId: string) => guarded(async () => {
      if (sectionId === SUMMARY_ID) return validation<Report>('The summary is part of the report and cannot be removed.')
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const sections = sectionsOf(view).filter((s) => s.id !== sectionId)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, ctx.projectId) }
    }),

    reorderSections: (ctx, id: string, order: string[]) => guarded(async () => {
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const current = sectionsOf(view)
      if (order.length !== current.length || new Set(order).size !== order.length || order[0] !== SUMMARY_ID) {
        return validation<Report>('The new order must list every section once and keep the summary first.')
      }
      const byId = new Map(current.map((s) => [s.id, s]))
      const sections = order.map((sid) => byId.get(sid)).filter((s): s is Section => s !== undefined)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, ctx.projectId) }
    }),

    setFindings: () => unsupportedControl<Report>('report.findingLink'),

    submit: (ctx, id: string, input: ReportSubmitInput) => guarded(async () => {
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const stale = sectionsOf(view).find((s) => s.id in input.bodies && input.bodies[s.id] !== s.body)
      if (stale) return validation<Report>(`Section “${stale.title}” has unsaved changes. Save it before submitting for review.`)
      const submitted = await submitReportForReview(ctx.projectId, id)
      return { ok: true, data: toReport(submitted, ctx.projectId) }
    }),

    decide: (ctx, id: string, decision: ReportDecision, note: string) => guarded(async () => {
      if (!note.trim()) return validation<Report>('A review comment is mandatory.')
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      const decided = await decideReportReview(ctx.projectId, id, {
        decision: decision === 'approve' ? 'approved' : 'changes_requested',
        comment: note.trim(),
        expectedVersion: view.version,
      })
      return { ok: true, data: toReport(decided, ctx.projectId) }
    }),

    exportVersion: () => unsupportedControl<{ report: Report; rec: ExportRec }>('report.pdfDocx'),

    deliver: (ctx, id: string, input: DeliveryInput) => guarded(async () => {
      if (!input.confirm) return validation<Report>('Confirm the handover before recording the delivery.')
      if (!input.recipient.trim()) return validation<Report>('A recipient is required for a manual delivery.')
      const receipt = (input.notes || input.channel).trim()
      if (!receipt) return validation<Report>('A delivery receipt (channel or note) is required.')
      const view = await readReport(ctx.projectId, id)
      if (!view) return notFound<Report>(id)
      if (view.approvedVersion === null) return validation<Report>('Delivery requires an approved version.')
      const delivered = await deliverReport(ctx.projectId, id, {
        kind: 'delivery',
        format: 'markdown',
        requestId: crypto.randomUUID(),
        expectedVersion: view.approvedVersion,
        recipient: input.recipient.trim(),
        receipt,
      })
      return { ok: true, data: toReport(delivered, ctx.projectId) }
    }),

    acknowledge: () => unsupportedControl<ExportRec>('report.acknowledge'),
  } as ReportService
}
