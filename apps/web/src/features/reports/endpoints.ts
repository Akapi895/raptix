import { apiFetch } from '../../platform/transport';
import { owned } from '../../platform/ownership';

/* ───────────── Report lifecycle/delivery (integration ticket 11) ───────────── */
export interface ReportTemplateSection { title: string; required: boolean }

export interface ReportTemplateView {
  id: string
  engagementId: string
  name: string
  version: number
  sections: ReportTemplateSection[]
  createdBy: string
  createdAt: string
}

export interface ReportSnapshotEvidence {
  id: string
  captureId: string | null
  kind: 'artifact' | 'digest'
  artifactPath: string | null
  digest: string | null
  producer: string | null
}

/** A finding as pinned by a report: the version, content and evidence references at selection time. */
export interface ReportFindingSnapshotView {
  id: string
  findingId: string
  findingVersion: number
  position: number
  title: string
  severity: string
  status: string
  body: { detail: string; impact: string; recommendation: string; severityRationale: string; scopeNote: string }
  evidence: ReportSnapshotEvidence[]
}

export interface ReportReadinessCheck {
  id: 'findings' | 'evidence' | 'template' | 'period' | 'reviewer'
  label: string
  state: 'pass' | 'fail' | 'unavailable'
  detail: string
}

export interface ReportReadinessView { ready: boolean; checks: ReportReadinessCheck[] }

export interface ReportDeliveryView {
  id: string
  kind: string
  format: string
  status: string
  createdAt: string
  /** Receipt recorded at delivery by the manual flow; it is not a recipient acknowledgement. */
  recordedReceipt: { recipient: string; receipt: string; actorId: string | null } | null
  acknowledgement: { id: string; actorId: string; receipt: string; createdAt: string } | null
}

export interface ReportView {
  id: string
  engagementId: string
  title: string
  version: number
  status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'delivered'
  body: { summary: string; sections: { title: string; content: string }[] }
  createdBy: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewComment: string | null
  approvedVersion: number | null
  updatedAt: string
  templateId: string | null
  templateVersion: number | null
  period: { start: string; end: string } | null
  reviewerId: string | null
  parentReportId: string | null
  rootReportId: string | null
  selectedFindings: ReportFindingSnapshotView[]
  readiness: ReportReadinessView
  deliveries: ReportDeliveryView[]
}

export interface ReportsView {
  engagementId: string
  reports: ReportView[]
  templates: ReportTemplateView[]
  exportFormats: string[]
  source: 'db'
}

export function isReportsView(v: unknown): v is ReportsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as ReportsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.reports) && Array.isArray(doc.templates) && doc.source === 'db'
}

export function fetchReports(engagementId: string): Promise<ReportsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records`, owned(engagementId, isReportsView))
}

export function createReport(engagementId: string, input: { title: string; summary: string }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && typeof (v as ReportView).id === 'string' && (v as ReportView).status === 'draft',
  { method: 'POST', body: input })
}

export function decideReportReview(engagementId: string, reportId: string, body: Record<string, unknown>): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/review`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && typeof (v as ReportView).status === 'string',
  { method: 'POST', body })
}

export function deliverReport(engagementId: string, reportId: string, input: { kind: 'export' | 'delivery'; format: string; requestId: string; expectedVersion?: number; recipient?: string; receipt?: string }): Promise<ReportView & { artifact: { reportId: string; version: number; format: string; mediaType: string; content: string; encoding: 'utf8' | 'base64'; digest: string } }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/deliveries`, (v): v is ReportView & { artifact: { reportId: string; version: number; format: string; mediaType: string; content: string; encoding: 'utf8' | 'base64'; digest: string } } =>
    typeof v === 'object' && v !== null && typeof (v as { artifact?: { content?: unknown } }).artifact?.content === 'string' && typeof (v as { artifact?: { digest?: unknown } }).artifact?.digest === 'string',
  { method: 'POST', body: input })
}

/** W20: a fresh draft revision of an approved/delivered report; the reviewed snapshot stays immutable. */
export function reviseReport(engagementId: string, reportId: string, input: { expectedVersion: number }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/revision`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && (v as ReportView).status === 'draft' && (v as ReportView).version === 1,
  { method: 'POST', body: input })
}

/** P06: a new immutable template version; the owner role manages templates. */
export function createReportTemplate(engagementId: string, input: { name: string; sections: ReportTemplateSection[] }): Promise<ReportTemplateView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-templates`, (v): v is ReportTemplateView =>
    typeof v === 'object' && v !== null && typeof (v as ReportTemplateView).id === 'string' && typeof (v as ReportTemplateView).version === 'number',
  { method: 'POST', body: input })
}

/** P06: template, reporting period and named reviewer; only while the report is a draft at the version the editor read. */
export function updateReportSetup(engagementId: string, reportId: string, input: { expectedVersion: number; templateId?: string | null; periodStart?: string | null; periodEnd?: string | null; reviewerId?: string | null }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/setup`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && (v as ReportView).id === reportId && typeof (v as ReportView).readiness === 'object',
  { method: 'PATCH', body: input })
}

/** P06: replaces the pinned finding selection of a draft report. */
export function setReportFindings(engagementId: string, reportId: string, input: { expectedVersion: number; findingIds: string[] }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/findings`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && (v as ReportView).id === reportId && Array.isArray((v as ReportView).selectedFindings),
  { method: 'PUT', body: input })
}

/** P07: a recipient acknowledgement, recorded separately from the delivery; a replay returns the stored receipt. */
export function acknowledgeReportDelivery(engagementId: string, reportId: string, deliveryId: string, input: { requestId: string; receipt: string }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/deliveries/${encodeURIComponent(deliveryId)}/acknowledgements`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && (v as ReportView).id === reportId,
  { method: 'POST', body: input })
}

/* ───────────── C2 session grants (integration ticket 12) ───────────── */

/** Moves the report's current content into review (the reviewer then decides on this exact version). */
export function submitReportForReview(engagementId: string, reportId: string): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/review`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && typeof (v as ReportView).status === 'string',
  { method: 'POST', body: { action: 'submit' } })
}

export function updateReport(engagementId: string, reportId: string, input: { expectedVersion: number; title: string; summary: string; sections: { title: string; content: string }[] }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}`, owned(engagementId, (v): v is ReportView => typeof v === 'object' && v !== null && (v as ReportView).id === reportId && Number.isInteger((v as ReportView).version)), { method: 'PATCH', body: input })
}

/** json and markdown are text; pdf and docx are base64 bytes (P07). */
export type ReportExportFormat = 'json' | 'markdown' | 'pdf' | 'docx'

export interface ReportArtifactView { engagementId: string; reportId: string; version: number; format: string; mediaType: string; content: string; encoding: 'utf8' | 'base64'; digest: string }

export function exportReport(engagementId: string, reportId: string, format: ReportExportFormat): Promise<ReportArtifactView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/export?format=${format}`, owned(engagementId, (v): v is ReportArtifactView => typeof v === 'object' && v !== null && (v as ReportArtifactView).reportId === reportId && typeof (v as ReportArtifactView).content === 'string' && ((v as ReportArtifactView).encoding === 'utf8' || (v as ReportArtifactView).encoding === 'base64') && /^[a-f0-9]{64}$/.test((v as ReportArtifactView).digest)))
}
