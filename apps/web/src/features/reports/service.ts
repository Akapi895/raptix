

import type { Db } from '../../demo/seed';



import type { RequestContext, ServiceResult } from '../../domain/service'

import type { ExportRec, Finding, FindingStatus, Project, Report, Severity, Template } from '../../domain/entities'


/** Finding statuses a formal report may include: confirmed or later. AI suggestions never qualify. */
export const CONFIRMED_OR_LATER: FindingStatus[] = ['confirmed', 'remediation', 'retest', 'resolved']

/* ───────────── Report list ───────────── */
export interface ReportListQuery {
  status?: string
  /** Case-insensitive substring over id + title. */
  q?: string
  /** Explicit project filter (aggregate view only). */
  project?: string
  template?: string
  author?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
}

export interface ReportListItem {
  report: Report
  /** Client label of the owning project. */
  projectClient?: string
}

export interface ReportListRead {
  items: ReportListItem[]
  page: number
  pageSize: number
  total: number
  /** KPI counts over the scoped base (unfiltered): open = draft+returned. */
  counts: { open: number; review: number; approved: number; delivered: number }
  projects: string[]
  templates: string[]
  authors: string[]
}

export interface DeliveryListQuery { status?: string; page?: number }

export interface DeliveryListItem { rec: ExportRec; reportTitle: string }

export interface DeliveryListRead {
  items: DeliveryListItem[]
  page: number
  pageSize: number
  total: number
  statuses: string[]
}

/* ───────────── Draft creation options ───────────── */

/** One selectable finding row for the draft form; `reportable` gates the checkbox. */
export interface DraftOptionFinding {
  id: string
  title: string
  severity: Severity
  status: FindingStatus
  reportable: boolean
}

export interface DraftOptionsRead {
  projectId: string
  templates: Template[]
  findings: DraftOptionFinding[]
  /** Users holding the independent reviewer role. */
  reviewers: string[]
  /** Role/read-only decision computed at the handler; empty reason = allowed. */
  canCreate: boolean
  createReason: string
  confirmedCount: number
}

/* ───────────── Draft creation (write) ───────────── */
export interface ReportDraftInput {
  title: string
  /** Template NAME — `Report.template` stores the display name. */
  template: string
  kind: string
  reviewer: string
  /** Finding ids to link; every one must be a confirmed-or-later finding of the report's project. */
  findings: string[]
  period: string
}

/* ───────────── Editor + preview read (ticket 35) ───────────── */

/** One finding row in the editor's selection panel; `reportable` gates adding. */
export interface EditorFindingRow {
  id: string
  title: string
  severity: Severity
  status: FindingStatus
  asset: string
  reportable: boolean
  linked: boolean
}

/** One opaque evidence reference plus the redaction marker the preview renders. */
export interface LinkedEvidenceRef { ref: string; sensitive: boolean }

/** One linked finding as the preview's findings table renders it. */
export interface LinkedFindingRow {
  id: string
  title: string
  severity: Severity
  asset: string
  evidence: LinkedEvidenceRef[]
}

/**
 * Editor/preview read model: the report aggregate, its project summary, the
 * handler-computed edit gate and the resolved finding rows. Both screens read
 * the same model — the preview renders it strictly read-only. Scope follows
 * {@link resolveReport}: a non-member's read is `not-found` (no existence
 * leak), a member scoped to another project gets `forbidden` with the owning
 * project on the entity ref so the screen can offer an explicit switch.
 */
export interface ReportEditorRead {
  report: Report
  project: { id: string; client: string; type: string; roeVersion: string; window: string }
  /** Handler-computed `editReport`/status gate; empty reason = editable. */
  canEdit: boolean
  editReason: string
  findings: EditorFindingRow[]
  linked: LinkedFindingRow[]
}

/* ───────────── Review checklist (moved from the screen — one implementation) ───────────── */

/** One review checklist row; `fail` blocks submit, `warn` is advisory. */
export interface RCheck { id: string; label: string; state: 'pass' | 'fail' | 'warn'; detail: string }

/** The report's no-findings closure variant (screen-owned UI state, passed explicitly to reads/writes). */
export interface NoFind { on: boolean; note: string }

/** Completion evidence used by the no-findings closure variant. */
export function closureEvidence(db: Db, projectId: string) {
  const ops = db.operations.filter((o) => o.projectId === projectId)
  const run = ops.filter((o) => ['done', 'running', 'paused', 'estop'].includes(o.status) && o.steps.some((s) => s.status === 'ok' || s.status === 'fail'))
  const ev = db.evidence.filter((e) => e.projectId === projectId)
  return { ops, run, ev }
}

/** The submit/review checklist over the one database (catalog, editor, preview and review screens share it). */
export function reportChecks(db: Db, r: Report, nf?: NoFind): RCheck[] {
  const exec = r.sections.find((s) => /executive summary/i.test(s.title))
  const linked = r.findings.map((id) => db.findings.find((f) => f.id === id)).filter(Boolean) as Finding[]
  const unconf = linked.filter((f) => !CONFIRMED_OR_LATER.includes(f.status))
  const empty = r.sections.filter((s) => !s.body.trim())
  const tpl = db.templates.find((t) => t.name === r.template)
  const ce = closureEvidence(db, r.projectId)
  const nfMissing = [!(nf?.note || '').trim() || (nf?.note || '').trim().length < 20 ? 'a closure justification (at least 20 characters)' : '', ce.run.length === 0 ? 'at least one operation with recorded execution results' : '', ce.ev.length === 0 ? 'at least one evidence item or coverage observation' : '', linked.length ? 'unlinking the findings (a no-findings closure cannot list findings)' : ''].filter(Boolean)
  const findChecks: RCheck[] = nf?.on
    ? [{ id: 'find', label: 'No-findings closure is supported', state: nfMissing.length ? 'fail' : 'pass', detail: nfMissing.length ? `Needs ${nfMissing.join('; ')}.` : `Justification recorded, ${ce.run.length} operation(s) and ${ce.ev.length} evidence item(s) support the closure.` }]
    : [
      { id: 'find', label: 'At least one confirmed finding linked', state: r.findings.length ? 'pass' : 'fail', detail: r.findings.length ? `${r.findings.length} finding(s) linked.` : 'No confirmed findings are linked. Link one, or switch to the No-findings closure variant if the assessment found nothing.' },
      { id: 'conf', label: 'Linked findings are confirmed', state: unconf.length ? 'fail' : 'pass', detail: unconf.length ? `Not confirmed: ${unconf.map((f) => f.id).join(', ')}` : linked.length ? 'All are confirmed or later.' : 'No findings to check.' },
    ]
  return [
    { id: 'exec', label: 'Executive Summary present', state: exec && exec.body.trim() ? 'pass' : 'fail', detail: exec && exec.body.trim() ? 'Content is present.' : 'The Executive Summary section is empty.' },
    ...findChecks,
    { id: 'empty', label: 'Empty sections', state: empty.length ? 'warn' : 'pass', detail: empty.length ? `${empty.length} empty section(s): ${empty.map((s) => s.title).join(', ')}` : 'Every section has content.' },
    { id: 'tpl', label: 'Template is published', state: tpl && tpl.status !== 'published' ? 'warn' : 'pass', detail: tpl && tpl.status !== 'published' ? `${tpl.name} is not approved, so formal delivery is blocked.` : 'Template is published.' },
  ]
}

/* ───────────── Review read + transitions (ticket 36) ───────────── */

/** One handler-computed action gate; empty reason = allowed. */
export interface ReviewGate { allowed: boolean; reason: string }

export interface ReportReviewRead {
  report: Report
  project: { id: string; client: string; type: string; roeVersion: string; roeStatus: Project['roeStatus'] }
  /** Review checklist over the committed content. */
  checks: RCheck[]
  /** Linked findings with their evidence redaction markers (status included). */
  linked: (LinkedFindingRow & { status: FindingStatus })[]
  /** Export/delivery records for this report — the canonical delivery history. */
  exports: ExportRec[]
  /** Id of the immutable delivery audit row (ticket 37), resolved by the read so the screen never inspects the audit log. */
  deliveryAuditId?: string
  gates: {
    /** Approve/return decisions (four-eyes + reviewer role + state). */
    decide: ReviewGate
    /** Simulated PDF/DOCX export of the approved version. */
    export: ReviewGate
    /** Marking the locked version delivered. */
    deliver: ReviewGate
    /** Recording the recipient acknowledgement. */
    ack: ReviewGate
  }
}

/** Submit/resubmit input: the section bodies to snapshot for this version. */
export interface ReportSubmitInput { bodies: Record<string, string> }

/** The reviewer's decision on a report in review. */
export type ReportDecision = 'approve' | 'return'

/**
 * Simulated PDF/DOCX export: requires an eligible approved version and an
 * export-capable role, and records the export with its checksum on the
 * export record (never on preview content). An approved report advances to
 * exported; the export alone is not a delivery.
 */
/** A recorded export's file, as the server produced it (P07). Text is UTF-8; PDF and DOCX are base64 bytes. */
export interface ReportArtifactDownload { filename: string; mediaType: string; content: string; encoding: 'utf8' | 'base64' }

/** Delivery/handover input: who received the locked version, how, with what note. */
export interface DeliveryInput {
  recipient: string
  channel: string
  notes: string
  /** Explicit handover confirmation (ticket 37): the handler refuses delivery without it. */
  confirm: boolean
}

/**
 * The reports port (ADR-0096). The mock (`mock.ts`) and the real adapter (`remote.ts`) both implement it; presentation
 * reaches it only through the feature's hooks.
 */
export interface ReportService {
  list(ctx: RequestContext, query?: ReportListQuery): Promise<ServiceResult<ReportListRead>>
  templates(ctx: RequestContext): Promise<ServiceResult<Template[]>>
  deliveries(ctx: RequestContext, query?: DeliveryListQuery): Promise<ServiceResult<DeliveryListRead>>
  draftOptions(ctx: RequestContext): Promise<ServiceResult<DraftOptionsRead>>
  createDraft(ctx: RequestContext, input: ReportDraftInput): Promise<ServiceResult<Report>>
  editor(ctx: RequestContext, id: string): Promise<ServiceResult<ReportEditorRead>>
  saveSection(ctx: RequestContext, id: string, sectionId: string, body: string): Promise<ServiceResult<Report>>
  addSection(ctx: RequestContext, id: string, title: string): Promise<ServiceResult<Report>>
  removeSection(ctx: RequestContext, id: string, sectionId: string): Promise<ServiceResult<Report>>
  reorderSections(ctx: RequestContext, id: string, order: string[]): Promise<ServiceResult<Report>>
  setFindings(ctx: RequestContext, id: string, ids: string[], expectedVersion: number): Promise<ServiceResult<Report>>
  review(ctx: RequestContext, id: string, nf?: NoFind): Promise<ServiceResult<ReportReviewRead>>
  submit(ctx: RequestContext, id: string, input: ReportSubmitInput): Promise<ServiceResult<Report>>
  decide(ctx: RequestContext, id: string, decision: ReportDecision, note: string): Promise<ServiceResult<Report>>
  exportVersion(ctx: RequestContext, id: string, format: 'PDF' | 'DOCX'): Promise<ServiceResult<{ report: Report; rec: ExportRec; artifact?: ReportArtifactDownload }>>
  createTemplate(ctx: RequestContext, input: { name: string; sections: { title: string; required: boolean }[] }): Promise<ServiceResult<Template>>
  revise(ctx: RequestContext, id: string, expectedVersion: number): Promise<ServiceResult<Report>>
  exportArtifact(ctx: RequestContext, id: string, format: 'json' | 'markdown' | 'pdf' | 'docx'): Promise<ServiceResult<ReportArtifactDownload>>
  deliver(ctx: RequestContext, id: string, input: DeliveryInput): Promise<ServiceResult<Report>>
  acknowledge(ctx: RequestContext, id: string, input: { deliveryId: string; receipt: string; requestId: string }): Promise<ServiceResult<ExportRec>>
}
