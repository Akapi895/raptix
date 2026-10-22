

import type { ExportRec, FindingStatus, Report, ReportStatus, Severity, Template } from '../../domain/entities'

import type { ServiceResult } from '../../domain/service'

import type { DeliveryInput, DeliveryListQuery, DeliveryListRead, DraftOptionsRead, EditorFindingRow, LinkedFindingRow, ReportDecision, ReportDraftInput, ReportEditorRead, ReportListQuery, ReportListRead, ReportReviewRead, ReportService, ReportSubmitInput } from '../../features/reports/service';

import { fetchAuthSession } from '../../platform/auth-api';

import { fetchCuratedFindings } from '../../features/findings/remote';

import { fetchMembers } from '../team/api';

import type { CuratedFindingView } from '@raptix/web-contracts';

import { displayTime, guarded } from '../../platform/adapter-shared'

import { unavailable } from '../../platform/adapter-stub'

import { type ReportTemplateView, type ReportView, type ReportsView, fetchReports, createReport, decideReportReview, deliverReport, reviseReport, createReportTemplate, updateReportSetup, setReportFindings, acknowledgeReportDelivery, submitReportForReview, updateReport, exportReport } from './endpoints';

const PAGE_SIZE = 10

const SUMMARY_ID = 'summary'

/** Roles the server accepts for editing a report (operator and above). */
const EDIT_ROLES: readonly string[] = ['admin', 'manager', 'operator', 'analyst']

/** Roles that may approve or return a version (reviewer and above, never the author). */
const REVIEW_ROLES: readonly string[] = ['admin', 'manager', 'reviewer']

/** Findings that may enter a report: confirmed-or-later stages (ADR-0088, P06). */
const REPORTABLE: readonly string[] = ['confirmed', 'remediation', 'retest', 'resolved']

const STATUS_FROM_API: Readonly<Record<ReportView['status'], ReportStatus>> = {
  draft: 'draft', in_review: 'review', approved: 'approved', changes_requested: 'returned', delivered: 'delivered',
}

type Section = { id: string; title: string; body: string }

/** Everything a report read needs from the same engagement: the reports with their templates, and member labels. */
interface ReportContext {
  view: ReportsView
  labels: Map<string, string>
}

async function readContext(engagementId: string): Promise<ReportContext> {
  const [view, members] = await Promise.all([fetchReports(engagementId), fetchMembers(engagementId)])
  return { view, labels: new Map(members.members.map((m) => [m.id, m.label])) }
}

/** The real body is a summary plus titled sections; the summary is presented as the first, fixed section. */
function sectionsOf(view: ReportView): Section[] {
  return [
    { id: SUMMARY_ID, title: 'Summary', body: view.body.summary },
    ...view.body.sections.map((section, index) => ({ id: `s${index}`, title: section.title, body: section.content })),
  ]
}

export function label(labels: Map<string, string>, userId: string | null): string {
  return userId === null ? '' : labels.get(userId) ?? userId
}

function toReport(view: ReportView, ctx: ReportContext): Report {
  const delivered = view.deliveries.find((d) => d.kind === 'delivery')
  const template = ctx.view.templates.find((t) => t.id === view.templateId)
  const reviews = view.reviewedBy
    ? [{ at: displayTime(view.reviewedAt ?? ''), by: label(ctx.labels, view.reviewedBy), action: view.status === 'changes_requested' ? 'returned' : 'approved', note: view.reviewComment ?? '', version: `v${view.approvedVersion ?? view.version}` }]
    : []
  return {
    id: view.id,
    projectId: view.engagementId,
    title: view.title,
    template: template?.name ?? '',
    version: `v${view.version}`,
    status: STATUS_FROM_API[view.status],
    author: label(ctx.labels, view.createdBy),
    reviewer: label(ctx.labels, view.reviewerId),
    updated: displayTime(view.updatedAt),
    deliveredAt: delivered ? displayTime(delivered.createdAt) : undefined,
    findings: view.selectedFindings.map((f) => f.findingId),
    sections: sectionsOf(view).map(({ id, title, body }) => ({ id, title, body })),
    reviews,
    readiness: view.readiness,
    period: view.period ? `${displayTime(view.period.start)} – ${displayTime(view.period.end)}` : '',
    reviewerId: view.reviewerId,
  }
}

function toExportRec(view: ReportView, ctx: ReportContext): ExportRec[] {
  return view.deliveries.map((d) => ({
    id: d.id,
    reportId: view.id,
    version: `v${view.version}`,
    format: d.format,
    by: label(ctx.labels, view.createdBy),
    at: displayTime(d.createdAt),
    recipient: d.recordedReceipt?.recipient ?? '',
    status: d.acknowledgement ? 'acknowledged' : d.status,
    checksum: '',
    ackAt: d.acknowledgement ? displayTime(d.acknowledgement.createdAt) : undefined,
  }))
}

function notFound<T>(id: string): Promise<ServiceResult<T>> {
  return Promise.resolve({ ok: false, failure: { kind: 'not-found', message: `Report ${id} does not exist or is not available for your account.` } })
}

function validation<T>(message: string): Promise<ServiceResult<T>> {
  return Promise.resolve({ ok: false, failure: { kind: 'validation', message } })
}

function findReport(ctx: ReportContext, id: string): ReportView | null {
  return ctx.view.reports.find((r) => r.id === id) ?? null
}

/** Rebuilds the real body from the sections the caller edited, keeping the summary fixed. */
function bodyFromSections(sections: Section[]): { summary: string; sections: { title: string; content: string }[] } {
  const summary = sections.find((s) => s.id === SUMMARY_ID)?.body ?? ''
  return { summary, sections: sections.filter((s) => s.id !== SUMMARY_ID).map((s) => ({ title: s.title, content: s.body })) }
}

function severityOf(value: string): Severity {
  return value === 'informational' ? 'info' : (['critical', 'high', 'medium', 'low'].includes(value) ? value as Severity : 'info')
}

function reportableFindings(findings: CuratedFindingView[]): CuratedFindingView[] {
  return findings.filter((f) => REPORTABLE.includes(f.status))
}

function draftFinding(f: CuratedFindingView): { id: string; title: string; severity: Severity; status: FindingStatus; reportable: boolean } {
  return { id: f.id, title: f.title, severity: severityOf(f.severity), status: f.status as FindingStatus, reportable: REPORTABLE.includes(f.status) }
}

/** Parses the reporting period typed in the creation form ("start/end", any Date-parseable text). */
function parsePeriod(text: string): { start: string; end: string } | null {
  if (text.trim().length === 0) return null
  const [from, to] = text.split('/').map((part) => part.trim())
  const start = from ? Date.parse(from) : Number.NaN
  const end = to ? Date.parse(to) : Number.NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

/**
 * Real ReportService over the report-records resource (ADR-0084). The real
 * body has a summary and titled sections, the template and reviewer are
 * persisted, and the pinned findings and readiness come from the server.
 * PDF/DOCX export stays a registered control gap. Every write carries the
 * version the caller last read, so a stale edit is refused rather than
 * overwriting a newer version.
 */
const REAL_CAPABILITIES: ReportCapabilities = { noFindingsVariant: false, simulatedEditorHelpers: false, simulatedDraftRules: false, periodStyle: 'iso', artifactDownloads: true, revision: true, storedTemplates: true }

export function createRealReportService(): ReportService {
  return {
    capabilities: REAL_CAPABILITIES,
    list: (ctx, query: ReportListQuery = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<ReportListRead>('Select an engagement to read its reports.')
      const rc = await readContext(ctx.projectId)
      const all = rc.view.reports.map((r) => toReport(r, rc))
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
          templates: rc.view.templates.map((t) => t.name),
          authors: [...new Set(all.map((r) => r.author).filter(Boolean))].sort(),
        },
      }
    }),

    templates: (ctx) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Template[]>('Select an engagement to read its templates.')
      const view = await fetchReports(ctx.projectId)
      return { ok: true, data: view.templates.map(toTemplate) }
    }),

    deliveries: (ctx, query: DeliveryListQuery = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<DeliveryListRead>('Select an engagement to read its deliveries.')
      const rc = await readContext(ctx.projectId)
      const rows = rc.view.reports.flatMap((r) => toExportRec(r, rc).map((rec) => ({ rec, reportTitle: r.title })))
      const filtered = query.status ? rows.filter((row) => row.rec.status === query.status) : rows
      return { ok: true, data: { items: filtered, page: 1, pageSize: filtered.length || PAGE_SIZE, total: filtered.length } } as ServiceResult<DeliveryListRead>
    }),

    draftOptions: (ctx) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<DraftOptionsRead>('Select an engagement to create a report.')
      const allowed = EDIT_ROLES.includes(ctx.actor.role)
      const [rc, curated, members] = await Promise.all([readContext(ctx.projectId), fetchCuratedFindings(ctx.projectId), fetchMembers(ctx.projectId)])
      const findings = curated.findings.map(draftFinding)
      const data: DraftOptionsRead = {
        projectId: ctx.projectId,
        templates: rc.view.templates.map(toTemplate),
        findings,
        reviewers: members.members.filter((m) => m.role === 'owner' || m.role === 'reviewer').map((m) => m.label),
        canCreate: allowed,
        createReason: allowed ? '' : 'The role on this engagement cannot create reports.',
        confirmedCount: reportableFindings(curated.findings).length,
      } as DraftOptionsRead
      return { ok: true, data }
    }),

    createDraft: (ctx, input: ReportDraftInput) => guarded(async () => {
      if (!EDIT_ROLES.includes(ctx.actor.role)) return { ok: false, failure: { kind: 'forbidden', message: 'The role on this engagement cannot create reports.' } }
      const rc = await readContext(ctx.projectId)
      const template = rc.view.templates.find((t) => t.name === input.template)
      const period = parsePeriod(input.period)
      if (input.period.trim().length > 0 && period === null) return validation<Report>('The reporting period must be two dates separated by "/".')
      const reviewerId = [...rc.labels.entries()].find(([, name]) => name === input.reviewer)?.[0] ?? null
      const created = await createReport(ctx.projectId, { title: input.title, summary: '' })
      let current = created
      if (template || period || reviewerId) {
        current = await updateReportSetup(ctx.projectId, created.id, {
          expectedVersion: created.version,
          templateId: template?.id ?? null,
          periodStart: period?.start ?? null,
          periodEnd: period?.end ?? null,
          reviewerId,
        })
      }
      if (input.findings.length > 0) {
        current = await setReportFindings(ctx.projectId, created.id, { expectedVersion: current.version, findingIds: input.findings })
      }
      const fresh = await readContext(ctx.projectId)
      return { ok: true, data: toReport(findReport(fresh, current.id) ?? current, fresh) }
    }),

    editor: (ctx, id: string) => guarded(async () => {
      if (!id) return notFound<ReportEditorRead>(id)
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<ReportEditorRead>(id)
      const editable = (view.status === 'draft' || view.status === 'changes_requested') && EDIT_ROLES.includes(ctx.actor.role)
      const curated = await fetchCuratedFindings(ctx.projectId)
      const linkedIds = new Set(view.selectedFindings.map((f) => f.findingId))
      const findings: EditorFindingRow[] = reportableFindings(curated.findings).map((f) => ({
        id: f.id, title: f.title, severity: severityOf(f.severity), status: f.status as FindingStatus,
        asset: f.references.assetId ?? '', reportable: true, linked: linkedIds.has(f.id),
      }))
      const linked: LinkedFindingRow[] = view.selectedFindings.map((f) => ({
        id: f.findingId, title: f.title, severity: severityOf(f.severity), asset: '',
        evidence: f.evidence.map((e) => ({ ref: e.artifactPath ?? (e.digest ? `digest ${e.digest.slice(0, 12)}` : e.id), sensitive: false })),
      }))
      const data: ReportEditorRead = {
        report: toReport(view, rc),
        project: { id: ctx.projectId, client: '', type: '', roeVersion: '', window: '' },
        canEdit: editable,
        editReason: editable ? '' : (EDIT_ROLES.includes(ctx.actor.role) ? 'Only a draft or a returned report can be edited; approved or delivered content is pinned.' : 'The role on this engagement cannot edit reports.'),
        findings,
        linked,
      }
      return { ok: true, data }
    }),

    review: (ctx, id: string) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<ReportReviewRead>(id)
      // The stored ids are the account ids the server issued; the console name is not one, so the signed-in account is read from the session.
      const actorId = (await fetchAuthSession())?.actor?.id ?? ctx.actor.id
      const isAuthor = view.createdBy === actorId
      const reviewerRole = REVIEW_ROLES.includes(ctx.actor.role)
      const namedOk = view.reviewerId === null || view.reviewerId === actorId
      const data: ReportReviewRead = {
        report: toReport(view, rc),
        project: { id: ctx.projectId, client: '', type: '', roeVersion: '', roeStatus: 'none', window: '' } as ReportReviewRead['project'],
        checks: view.readiness.checks.map((check) => ({
          id: check.id, label: check.label, state: check.state === 'pass' ? 'pass' : check.state === 'fail' ? 'fail' : 'warn', detail: check.detail,
        })),
        linked: [],
        exports: toExportRec(view, rc),
        gates: {
          decide: {
            allowed: view.status === 'in_review' && reviewerRole && !isAuthor && namedOk && view.readiness.ready,
            reason: view.status !== 'in_review' ? 'Only a report in review can be approved or returned.' : !reviewerRole ? 'Approving or returning requires the reviewer role.' : isAuthor ? 'The author cannot review their own report.' : !namedOk ? 'Only the named reviewer of this report can decide.' : !view.readiness.ready ? 'Readiness checks must pass before approval.' : '',
          },
          export: { allowed: view.status === 'approved' && view.approvedVersion === view.version, reason: view.status === 'approved' ? '' : 'Export is available only after the report is approved.' },
          deliver: {
            allowed: view.status === 'approved' && EDIT_ROLES.includes(ctx.actor.role) && view.readiness.ready,
            reason: view.status !== 'approved' ? 'Delivery requires an approved version.' : !EDIT_ROLES.includes(ctx.actor.role) ? 'Recording a delivery requires the operator role on this engagement.' : !view.readiness.ready ? 'Readiness checks must pass before delivery.' : '',
          },
          ack: { allowed: view.status === 'delivered' && view.deliveries.some((d) => d.kind === 'delivery' && !d.acknowledgement), reason: view.status === 'delivered' ? '' : 'Only a delivered report can record an acknowledgement.' },
        },
      } as ReportReviewRead
      return { ok: true, data }
    }),

    saveSection: (ctx, id: string, sectionId: string, body: string) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const sections = sectionsOf(view).map((s) => (s.id === sectionId ? { ...s, body } : s))
      if (!sections.some((s) => s.id === sectionId)) return notFound<Report>(sectionId)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, rc) }
    }),

    addSection: (ctx, id: string, title: string) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const sections = [...sectionsOf(view), { id: `new-${view.body.sections.length}`, title, body: '' }]
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, rc) }
    }),

    removeSection: (ctx, id: string, sectionId: string) => guarded(async () => {
      if (sectionId === SUMMARY_ID) return validation<Report>('The summary is part of the report and cannot be removed.')
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const sections = sectionsOf(view).filter((s) => s.id !== sectionId)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, rc) }
    }),

    reorderSections: (ctx, id: string, order: string[]) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const current = sectionsOf(view)
      if (order.length !== current.length || new Set(order).size !== order.length || order[0] !== SUMMARY_ID) {
        return validation<Report>('The new order must list every section once and keep the summary first.')
      }
      const byId = new Map(current.map((s) => [s.id, s]))
      const sections = order.map((sid) => byId.get(sid)).filter((s): s is Section => s !== undefined)
      const updated = await updateReport(ctx.projectId, id, { expectedVersion: view.version, title: view.title, ...bodyFromSections(sections) })
      return { ok: true, data: toReport(updated, rc) }
    }),

    /** P06: pins the selected findings at the version the editor read; a newer report version is refused. */
    setFindings: (ctx, id: string, ids: string[], expectedVersion: number) => guarded(async () => {
      if (!EDIT_ROLES.includes(ctx.actor.role)) return { ok: false, failure: { kind: 'forbidden', message: 'The role on this engagement cannot change the findings of a report.' } }
      const updated = await setReportFindings(ctx.projectId, id, { expectedVersion, findingIds: ids })
      const rc = await readContext(ctx.projectId)
      return { ok: true, data: toReport(findReport(rc, updated.id) ?? updated, rc) }
    }),

    submit: (ctx, id: string, input: ReportSubmitInput) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const stale = sectionsOf(view).find((s) => s.id in input.bodies && input.bodies[s.id] !== s.body)
      if (stale) return validation<Report>(`Section “${stale.title}” has unsaved changes. Save it before submitting for review.`)
      const submitted = await submitReportForReview(ctx.projectId, id)
      return { ok: true, data: toReport(submitted, rc) }
    }),

    decide: (ctx, id: string, decision: ReportDecision, note: string) => guarded(async () => {
      if (!note.trim()) return validation<Report>('A review comment is mandatory.')
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      const decided = await decideReportReview(ctx.projectId, id, {
        decision: decision === 'approve' ? 'approved' : 'changes_requested',
        comment: note.trim(),
        expectedVersion: view.version,
      })
      return { ok: true, data: toReport(decided, rc) }
    }),

    /** P07: a recorded export of the approved version. The server stores the export record and returns the file to save. */
    exportVersion: (ctx, id: string, format: 'PDF' | 'DOCX') => guarded(async () => {
      const before = await readContext(ctx.projectId)
      const view = findReport(before, id)
      if (!view) return notFound<{ report: Report; rec: ExportRec }>(id)
      if (view.approvedVersion !== view.version || view.status !== 'approved') {
        return validation<{ report: Report; rec: ExportRec }>('Export is available only after the report is approved.')
      }
      const knownDeliveries = new Set(view.deliveries.map((d) => d.id))
      const exported = await deliverReport(ctx.projectId, id, { kind: 'export', format: format.toLowerCase(), requestId: crypto.randomUUID() })
      const after = await readContext(ctx.projectId)
      const rec = toExportRec(findReport(after, id) ?? exported, after).find((r) => !knownDeliveries.has(r.id))
      if (!rec) return validation<{ report: Report; rec: ExportRec }>('The export was recorded but could not be read back.')
      const extension = format.toLowerCase()
      return {
        ok: true,
        data: {
          report: toReport(exported, after),
          rec,
          artifact: { filename: `report-${id}-v${view.version}.${extension}`, mediaType: exported.artifact.mediaType, content: exported.artifact.content, encoding: exported.artifact.encoding },
        },
      }
    }),

    deliver: (ctx, id: string, input: DeliveryInput) => guarded(async () => {
      if (!input.confirm) return validation<Report>('Confirm the handover before recording the delivery.')
      if (!input.recipient.trim()) return validation<Report>('A recipient is required for a manual delivery.')
      const receipt = (input.notes || input.channel).trim()
      if (!receipt) return validation<Report>('A delivery receipt (channel or note) is required.')
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
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
      return { ok: true, data: toReport(delivered, await readContext(ctx.projectId)) }
    }),

    /** P06: owner-managed template version; the server refuses other roles. */
    createTemplate: (ctx, input: { name: string; sections: { title: string; required: boolean }[] }) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Template>('Select an engagement to create a template.')
      if (ctx.actor.role !== 'admin' && ctx.actor.role !== 'manager') return { ok: false, failure: { kind: 'forbidden', message: 'Only organization admins and managers can create report templates.' } }
      const created = await createReportTemplate(ctx.projectId, input)
      return { ok: true, data: toTemplate(created) }
    }),

    /** W20: a fresh draft revision of an approved or delivered version; the approved snapshot stays as it was. */
    revise: (ctx, id: string, expectedVersion: number) => guarded(async () => {
      const rc = await readContext(ctx.projectId)
      const view = findReport(rc, id)
      if (!view) return notFound<Report>(id)
      if (view.status !== 'approved' && view.status !== 'delivered') return validation<Report>('Only an approved or delivered report gets a revision; edit the draft instead.')
      if (view.version !== expectedVersion) return { ok: false, failure: { kind: 'conflict', message: `The report moved to v${view.version} while you read v${expectedVersion}. Reload and retry.` } }
      const created = await reviseReport(ctx.projectId, id, { expectedVersion })
      const fresh = await readContext(ctx.projectId)
      return { ok: true, data: toReport(findReport(fresh, created.id) ?? created, fresh) }
    }),

    /** JSON and Markdown bytes of the stored version (the server's read export); PDF/DOCX stay a registered gap. */
    exportArtifact: (ctx, id: string, format: 'json' | 'markdown' | 'pdf' | 'docx') => guarded(async () => {
      if (!id) return notFound<{ filename: string; mediaType: string; content: string; encoding: 'utf8' | 'base64'; digest: string }>(id)
      const artifact = await exportReport(ctx.projectId, id, format)
      const extension = format === 'markdown' ? 'md' : format
      return { ok: true, data: { filename: `report-${artifact.reportId}-v${artifact.version}.${extension}`, mediaType: artifact.mediaType, content: artifact.content, encoding: artifact.encoding, digest: artifact.digest } }
    }),

    /** P07: the recipient's acknowledgement is its own request, keyed by a stable request id so a lost response can be replayed. */
    acknowledge: (ctx, id: string, input: { deliveryId: string; receipt: string; requestId: string }) => guarded(async () => {
      if (input.receipt.trim().length === 0) return validation<ExportRec>('An acknowledgement receipt is required.')
      const updated = await acknowledgeReportDelivery(ctx.projectId, id, input.deliveryId, { requestId: input.requestId, receipt: input.receipt.trim() })
      const rc = await readContext(ctx.projectId)
      const rec = toExportRec(findReport(rc, updated.id) ?? updated, rc).find((r) => r.id === input.deliveryId)
      if (!rec) return notFound<ExportRec>(input.deliveryId)
      return { ok: true, data: rec }
    }),
  } as ReportService
}

function toTemplate(template: ReportTemplateView): Template {
  return {
    id: template.id,
    name: template.name,
    kind: 'report',
    version: `v${template.version}`,
    owner: template.createdBy,
    status: 'published',
    lang: '',
    updated: displayTime(template.createdAt),
    sections: template.sections.map((section) => section.title),
  }
}
import type { ReportCapabilities } from './service'
