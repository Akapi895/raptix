import type { RequestContext, ServiceResult } from '../../domain/service'

import type { ExportRec, FindingStatus, Project, Report, Severity, Template } from '../../domain/entities'

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

/** One review checklist row; `fail` blocks submit, `warn` is advisory. */
export interface RCheck { id: string; label: string; state: 'pass' | 'fail' | 'warn'; detail: string }

/** The report's no-findings closure variant (screen-owned UI state, passed explicitly to reads/writes). */
export interface NoFind { on: boolean; note: string }

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
  readonly capabilities: ReportCapabilities
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

/** What the active implementation supports (ADR-0096). Presentation branches on these flags, never on the data mode. */
export interface ReportCapabilities {
  /** The no-findings closure variant is offered when a report is created and edited. */
  noFindingsVariant: boolean
  /** Simulated editor helpers: scope insertion, filling empty sections and marked AI drafts. */
  simulatedEditorHelpers: boolean
  /** A draft needs a template and a reviewer on the client (the simulated rules). */
  simulatedDraftRules: boolean
  /** How a draft period is written: an ISO range from the server, or a display range in the simulated store. */
  periodStyle: 'iso' | 'display'
  /** Export artifacts (JSON, Markdown, PDF, DOCX) are downloaded from the server. */
  artifactDownloads: boolean
  /** A new version can be started from a delivered or returned report. */
  revision: boolean
  /** Templates are stored by the server and can be created here. */
  storedTemplates: boolean
}
