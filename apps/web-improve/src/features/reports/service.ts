/**
 * Report catalog read model + validated draft creation (ticket 34, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the reports catalog (list, templates, delivery
 * history) and draft creation. Every request captures actor and project
 * explicitly; a non-member's specific-project read is denied with
 * `not-found` (no existence leak) and the aggregate scope (`'all'`/`''`)
 * folds in only projects the actor can access. Template reads are global —
 * templates are organization assets, not project-scoped data.
 *
 * Draft creation is role-gated (`editReport`) at the handler with the reason
 * carried in the failure, never decided in the screen. Only confirmed (or
 * later) findings may be included — suggested and unreviewed findings are
 * refused by status, and every finding id must belong to the report's own
 * project. Validation happens before the single atomic commit, so a refused
 * creation leaves no partial records.
 */
import { can, projectAccessible, projectLocked } from '../../auth/policy'
import { USERS, type Db } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { ExportRec, Finding, FindingStatus, Project, Report, ReportSnapshot, ReportStatus, Role, Severity, Template } from '../../domain/entities'

/** Finding statuses a formal report may include: confirmed or later. AI suggestions never qualify. */
export const CONFIRMED_OR_LATER: FindingStatus[] = ['confirmed', 'remediation', 'retest', 'resolved']

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_TEXT: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
const STATUS_TEXT: Record<FindingStatus, string> = { ai_suggested: 'an unverified AI suggestion', draft: 'a draft', review: 'in review', returned: 'returned for changes', confirmed: 'confirmed', remediation: 'in remediation', retest: 'in retest', resolved: 'resolved' }
const PAGE_SIZE = 10

/** Accessible project ids for the request scope; specific scopes verify membership. */
function scopedProjectIds(db: Db, ctx: RequestContext): Set<string> | { failure: ServiceFailure } {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === ctx.projectId)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { failure: { kind: 'not-found', message: 'Reports for this project are not available for your account.' } }
    }
    return new Set([ctx.projectId])
  }
  return new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
}

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

const KPI: readonly (readonly [keyof ReportListRead['counts'], readonly ReportStatus[]])[] = [
  ['open', ['draft', 'returned']], ['review', ['review']], ['approved', ['approved', 'exported']], ['delivered', ['delivered']],
]

/** Pure catalog list handler: scope-checked rows plus KPI counts and filter
 *  options derived from the same accessible base (counts stay live while
 *  filters narrow the rows). */
export function listReports(db: Db, ctx: RequestContext, query: ReportListQuery = {}): ServiceResult<ReportListRead> {
  const ids = scopedProjectIds(db, ctx)
  if ('failure' in ids) return { ok: false, failure: ids.failure }
  const base = db.reports.filter((r) => ids.has(r.projectId))
  const q = (query.q || '').toLowerCase()
  const rows = base.filter((r) =>
    (!query.status || r.status === query.status) &&
    (!query.project || r.projectId === query.project) &&
    (!query.template || r.template === query.template) &&
    (!query.author || r.author === query.author) &&
    (!q || (r.id + ' ' + r.title).toLowerCase().includes(q)))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const items: ReportListItem[] = rows
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((report) => ({ report, projectClient: db.projects.find((p) => p.id === report.projectId)?.client }))
  return {
    ok: true,
    data: {
      items, page, pageSize: PAGE_SIZE, total: rows.length,
      counts: Object.fromEntries(KPI.map(([k, sts]) => [k, base.filter((r) => sts.includes(r.status)).length])) as ReportListRead['counts'],
      projects: [...new Set(base.map((r) => r.projectId))].sort(),
      templates: [...new Set(base.map((r) => r.template))].sort(),
      authors: [...new Set(base.map((r) => r.author))].sort(),
    },
  }
}

/* ───────────── Templates + delivery history ───────────── */

/** Templates are organization assets: readable by any signed-in actor, created/published only by admins (screen-simulated). */
export function listTemplates(db: Db): ServiceResult<Template[]> {
  return { ok: true, data: db.templates }
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

/** Delivery history for the reports the actor can access; earlier exports are never replaced. */
export function listDeliveries(db: Db, ctx: RequestContext, query: DeliveryListQuery = {}): ServiceResult<DeliveryListRead> {
  const ids = scopedProjectIds(db, ctx)
  if ('failure' in ids) return { ok: false, failure: ids.failure }
  const reportOf = new Map(db.reports.filter((r) => ids.has(r.projectId)).map((r) => [r.id, r]))
  const base = db.exportsList.filter((e) => reportOf.has(e.reportId))
  const rows = base.filter((e) => !query.status || e.status === query.status)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const items: DeliveryListItem[] = rows
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((rec) => ({ rec, reportTitle: reportOf.get(rec.reportId)?.title || rec.reportId }))
  return {
    ok: true,
    data: { items, page, pageSize: PAGE_SIZE, total: rows.length, statuses: [...new Set(db.exportsList.map((e) => e.status))] },
  }
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

/** Scoped options for the draft form: templates, the project's findings with
 *  their reportability, reviewer candidates and the handler-computed gate. */
export function draftOptions(db: Db, ctx: RequestContext): ServiceResult<DraftOptionsRead> {
  if (!ctx.projectId || ctx.projectId === 'all') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Select a specific project before creating a report.' } }
  }
  const project = db.projects.find((p) => p.id === ctx.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project is not available for your account.' } }
  }
  const findings = db.findings
    .filter((f) => f.projectId === project.id)
    .map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, reportable: CONFIRMED_OR_LATER.includes(f.status) }))
  const locked = projectLocked(project)
  const roleOk = can(ctx.actor, 'editReport', project)
  const createReason = locked
    ? ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — reports are read-only.`
    : roleOk ? '' : `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot create reports. Ask a Red Team Manager, Operator or Analyst to create it.`
  return {
    ok: true,
    data: {
      projectId: project.id,
      templates: db.templates,
      findings,
      reviewers: USERS.filter((u) => u.role === 'reviewer').map((u) => u.name),
      canCreate: !locked && roleOk,
      createReason,
      confirmedCount: findings.filter((f) => f.reportable).length,
    },
  }
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

const DEFAULT_SECTIONS = ['Cover Page', 'Executive Summary', 'Scope', 'Methodology', 'Objectives', 'Timeline', 'Operation Narrative', 'Results', 'Detailed Findings', 'Recommendations', 'Appendix']

/**
 * Creates a draft report in one atomic commit. Refusal order: aggregate
 * context → forbidden, missing/out-of-scope project → not-found, read-only
 * project or missing `editReport` role → forbidden with the reason, then the
 * field validations (title, template, independent reviewer, finding scope
 * and confirmed status). Validation runs before the commit, so a refused
 * creation leaves no partial records.
 */
export function createReportDraft(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: ReportDraftInput): ServiceResult<Report> {
  const db = authority.snapshot()
  if (!ctx.projectId || ctx.projectId === 'all') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Select a specific project before creating a report.' } }
  }
  const project = db.projects.find((p) => p.id === ctx.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project is not available for your account.' } }
  }
  if (projectLocked(project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Project ${project.id} is closed or cancelled — reports are read-only.` } }
  }
  if (!can(ctx.actor, 'editReport', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot create reports. Ask a Red Team Manager, Operator or Analyst to create it.` } }
  }
  if (!input.title.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'Enter a report title.' } }
  }
  const tpl = db.templates.find((t) => t.name === input.template)
  if (!tpl) {
    return { ok: false, failure: { kind: 'validation', message: 'Choose a template.' } }
  }
  if (!input.reviewer) {
    return { ok: false, failure: { kind: 'validation', message: 'Choose a reviewer.' } }
  }
  if (input.reviewer === ctx.actor.id) {
    return { ok: false, failure: { kind: 'validation', message: 'The reviewer cannot be the author.' } }
  }
  if (!USERS.some((u) => u.name === input.reviewer && u.role === 'reviewer')) {
    return { ok: false, failure: { kind: 'validation', message: 'The reviewer must hold the Reviewer role.' } }
  }
  for (const id of input.findings) {
    const f = db.findings.find((x) => x.id === id)
    if (!f || f.projectId !== project.id) {
      return { ok: false, failure: { kind: 'validation', message: `Finding ${id} is not part of project ${project.id}.` } }
    }
    if (!CONFIRMED_OR_LATER.includes(f.status)) {
      return { ok: false, failure: { kind: 'validation', message: `Finding ${id} is ${STATUS_TEXT[f.status]} — only confirmed findings can be included in a report.` } }
    }
  }
  const at = formatDemoInstant(clock.now())
  const id = 'REP-' + String(db.counters.report + 1).padStart(3, '0')
  const sections = (tpl.sections.length > 7 ? tpl.sections : DEFAULT_SECTIONS).map((t, i) => ({ id: 's' + i, title: t, body: i === 0 ? `Security Assessment Report — ${project.client}` : '' }))
  authority.commit(ctx.corr, (d) => {
    d.counters.report++
    d.reports.unshift({
      id, projectId: project.id, title: input.title.trim(), template: tpl.name, version: 'v0.1', status: 'draft',
      author: ctx.actor.id, reviewer: input.reviewer, updated: at, findings: [...input.findings], sections, reviews: [],
    })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Created report', obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === id)! }
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

const EDITABLE_REPORT: readonly ReportStatus[] = ['draft', 'returned']
const STATUS_EN: Record<ReportStatus, string> = { draft: 'a draft', returned: 'returned', review: 'In Review', approved: 'Approved', exported: 'Exported', delivered: 'Delivered' }

const reportNotFound = (id: string): ServiceFailure => ({
  kind: 'not-found',
  message: 'This report does not exist or is not available for your account.',
  entity: { kind: 'report', id },
})

/** The read-only reason for a report the actor cannot edit (status →
 *  read-only project → role, mirroring the legacy editor's lock message). */
function editGate(report: Report, project: Project, ctx: RequestContext): { canEdit: boolean; editReason: string } {
  if (!EDITABLE_REPORT.includes(report.status)) {
    return { canEdit: false, editReason: `This report is ${STATUS_EN[report.status]}, so it is read-only. ${report.status === 'delivered' ? 'Create a new version to make changes.' : 'Wait for the reviewer to decide.'}` }
  }
  if (projectLocked(project)) return { canEdit: false, editReason: `Project ${project.id} is closed or cancelled — reports are read-only.` }
  if (!can(ctx.actor, 'editReport', project)) return { canEdit: false, editReason: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot edit reports. Ask a Red Team Manager, Operator or Analyst to make the change.` }
  return { canEdit: true, editReason: '' }
}

/** Resolves a report for a read or write: missing/out-of-scope → `not-found`
 *  without leaking existence; an accessible report outside the active project
 *  context → `forbidden` with the owning project on the entity ref. */
function resolveReport(db: Db, ctx: RequestContext, id: string): { ok: true; report: Report; project: Project } | { ok: false; failure: ServiceFailure } {
  const r = db.reports.find((x) => x.id === id)
  if (!r) return { ok: false, failure: reportNotFound(id) }
  const project = db.projects.find((p) => p.id === r.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return { ok: false, failure: reportNotFound(id) }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== r.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Report ${id} belongs to project ${r.projectId}. Switch to that project to open it.`, entity: { kind: 'report', id, projectId: r.projectId } } }
  }
  return { ok: true, report: r, project }
}

/** Pure editor/preview read: gate, selection rows and the linked findings
 *  with their redaction markers, all resolved within the report's own project. */
export function readReportEditor(db: Db, ctx: RequestContext, id: string): ServiceResult<ReportEditorRead> {
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  const gate = editGate(report, project, ctx)
  return {
    ok: true,
    data: {
      report,
      project: { id: project.id, client: project.client, type: project.type, roeVersion: project.roeVersion, window: project.window },
      canEdit: gate.canEdit,
      editReason: gate.editReason,
      findings: db.findings
        .filter((f) => f.projectId === project.id)
        .map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, asset: f.asset, reportable: CONFIRMED_OR_LATER.includes(f.status), linked: report.findings.includes(f.id) })),
      linked: report.findings
        .map((fid) => db.findings.find((f) => f.id === fid && f.projectId === project.id))
        .filter((f): f is Finding => !!f)
        .map((f) => ({
          id: f.id, title: f.title, severity: f.severity, asset: f.asset,
          evidence: f.evidence.map((ref) => ({ ref, sensitive: !!db.evidence.find((e) => e.id === ref && e.projectId === project.id)?.sensitive })),
        })),
    },
  }
}

/* ───────────── Section + findings writes (ticket 35) ───────────── */

/** Write gate for report content: read-only project, missing `editReport`
 *  role or a non-draft report refuse the mutation at the handler — never
 *  only in the screen (locked approved content stays locked here). */
function sectionWriteFailure(report: Report, project: Project, ctx: RequestContext): ServiceFailure | undefined {
  if (projectLocked(project)) return { kind: 'forbidden', message: `Project ${project.id} is closed or cancelled — reports are read-only.` }
  if (!can(ctx.actor, 'editReport', project)) return { kind: 'forbidden', message: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot edit reports. Ask a Red Team Manager, Operator or Analyst to make the change.` }
  if (!EDITABLE_REPORT.includes(report.status)) {
    return { kind: 'conflict', message: `This report is ${STATUS_EN[report.status]}, so it is read-only. ${report.status === 'delivered' ? 'Create a new version to make changes.' : 'Wait for the reviewer to decide.'}` }
  }
  return undefined
}

const stampOf = (clock: Clock) => formatDemoInstant(clock.now())
const nextSectionId = (sections: Report['sections']) => {
  let n = sections.length + 1
  while (sections.some((s) => s.id === 's' + n)) n++
  return 's' + n
}

/** Saves one section's body. A refused save commits nothing — the editor
 *  keeps its draft and renders the failure. */
export function saveReportSection(authority: DbAuthority, clock: Clock, ctx: RequestContext, reportId: string, sectionId: string, body: string): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, reportId)
  if (!t.ok) return t
  const denied = sectionWriteFailure(t.report, t.project, ctx)
  if (denied) return { ok: false, failure: denied }
  if (!t.report.sections.some((s) => s.id === sectionId)) {
    return { ok: false, failure: { kind: 'validation', message: `Section ${sectionId} does not exist in ${reportId}.` } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === reportId)!
    const s = r.sections.find((x) => x.id === sectionId)!
    s.body = body
    r.updated = at
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === reportId)! }
}

/** Appends one empty section with a generated id and an audit row. */
export function addReportSection(authority: DbAuthority, clock: Clock, ctx: RequestContext, reportId: string, title: string): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, reportId)
  if (!t.ok) return t
  const denied = sectionWriteFailure(t.report, t.project, ctx)
  if (denied) return { ok: false, failure: denied }
  if (!title.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter a section title.' } }
  const at = stampOf(clock)
  const id = nextSectionId(t.report.sections)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === reportId)!
    r.sections.push({ id, title: title.trim(), body: '' })
    r.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Added report section', obj: reportId, projectId: r.projectId, result: 'Success', reason: title.trim() })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === reportId)! }
}

/** Removes one section (never the last one) with an audit row. */
export function removeReportSection(authority: DbAuthority, clock: Clock, ctx: RequestContext, reportId: string, sectionId: string): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, reportId)
  if (!t.ok) return t
  const denied = sectionWriteFailure(t.report, t.project, ctx)
  if (denied) return { ok: false, failure: denied }
  if (!t.report.sections.some((s) => s.id === sectionId)) {
    return { ok: false, failure: { kind: 'validation', message: `Section ${sectionId} does not exist in ${reportId}.` } }
  }
  if (t.report.sections.length <= 1) {
    return { ok: false, failure: { kind: 'validation', message: 'A report needs at least one section.' } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === reportId)!
    r.sections = r.sections.filter((s) => s.id !== sectionId)
    r.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Removed report section', obj: reportId, projectId: r.projectId, result: 'Success', reason: sectionId })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === reportId)! }
}

/** Persists a section order; the ids must be a permutation of the report's
 *  own sections (no duplicates, none missing, none unknown). */
export function reorderReportSections(authority: DbAuthority, clock: Clock, ctx: RequestContext, reportId: string, order: string[]): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, reportId)
  if (!t.ok) return t
  const denied = sectionWriteFailure(t.report, t.project, ctx)
  if (denied) return { ok: false, failure: denied }
  const ids = t.report.sections.map((s) => s.id)
  if (order.length !== ids.length || [...order].sort().join(',') !== [...ids].sort().join(',')) {
    return { ok: false, failure: { kind: 'validation', message: `The section order does not match the sections of ${reportId}.` } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === reportId)!
    r.sections = order.map((sid) => r.sections.find((s) => s.id === sid)!)
    r.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Reordered report sections', obj: reportId, projectId: r.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === reportId)! }
}

/** Replaces the linked-findings selection. Every finding must belong to the
 *  report's own project; newly added ones must be confirmed-or-later —
 *  suggested and unreviewed findings are refused (already-linked findings
 *  may stay, and unlinking is always allowed). */
export function setReportFindings(authority: DbAuthority, clock: Clock, ctx: RequestContext, reportId: string, ids: string[]): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, reportId)
  if (!t.ok) return t
  const { report, project } = t
  const denied = sectionWriteFailure(report, project, ctx)
  if (denied) return { ok: false, failure: denied }
  for (const fid of ids) {
    const f = db.findings.find((x) => x.id === fid)
    if (!f || f.projectId !== project.id) {
      return { ok: false, failure: { kind: 'validation', message: `Finding ${fid} is not part of project ${project.id}.` } }
    }
    if (!report.findings.includes(fid) && !CONFIRMED_OR_LATER.includes(f.status)) {
      return { ok: false, failure: { kind: 'validation', message: `Finding ${fid} is ${STATUS_TEXT[f.status]} — only confirmed findings can be included in a report.` } }
    }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === reportId)!
    r.findings = [...ids]
    r.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Updated report findings', obj: reportId, projectId: r.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === reportId)! }
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

/** The baseline export/delivery role gate: Manager, Reviewer or Admin. */
const EXPORT_ROLES: readonly Role[] = ['admin', 'manager', 'reviewer']
const reportRef = (r: Report) => ({ kind: 'report' as const, id: r.id, projectId: r.projectId })
const readOnlyReason = (project: Project, ctx: RequestContext) =>
  ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — reports are read-only.`

/**
 * Review read model: the report aggregate, its project, the checklist, the
 * linked findings with redaction markers, this report's export/delivery
 * records and the handler-computed action gates. Scope follows
 * {@link resolveReport} (non-member → not-found without a leak; a member
 * scoped elsewhere → forbidden with the owning project). `nf` is the
 * report's no-findings variant; the checklist depends on it.
 */
export function readReportReview(db: Db, ctx: RequestContext, id: string, nf?: NoFind): ServiceResult<ReportReviewRead> {
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  const ro = projectLocked(project)
  const roGate = (): ReviewGate => ({ allowed: false, reason: readOnlyReason(project, ctx) })
  const checks = reportChecks(db, report, nf)
  const exports = db.exportsList.filter((e) => e.reportId === report.id)
  const roleExport = EXPORT_ROLES.includes(ctx.actor.role)
  const tplPublished = db.templates.find((x) => x.name === report.template)?.status !== 'draft'
  const statusOk = ['approved', 'exported'].includes(report.status)
  // Every gate mirrors its handler's refusal order exactly: the read-only
  // project context first, then the report state, then the role.
  const decide: ReviewGate = ro
    ? roGate()
    : report.status !== 'review'
      ? { allowed: false, reason: `A report can be decided only while it is In Review — ${report.id} is ${STATUS_EN[report.status]}.` }
      : !can(ctx.actor, 'approveReport', project)
        ? { allowed: false, reason: `Only a Reviewer can approve or return reports. This report is assigned to ${report.reviewer}.` }
        : ctx.actor.id === report.author
          ? { allowed: false, reason: 'The author cannot decide their own report (four-eyes principle).' }
          : { allowed: true, reason: '' }
  const exportGate: ReviewGate = ro
    ? roGate()
    : !statusOk
      ? { allowed: false, reason: report.status === 'delivered' ? 'This report is already delivered. Create a new version to export changes.' : 'Export unlocks after the report is approved.' }
      : !roleExport ? { allowed: false, reason: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot export reports. Ask a Manager, Reviewer or Admin.` }
      : { allowed: true, reason: '' }
  const deliverGate: ReviewGate = ro
    ? roGate()
    : report.status === 'delivered'
      ? { allowed: false, reason: 'Already delivered.' }
      : !statusOk
        ? { allowed: false, reason: 'Delivery unlocks after the report is approved and exported.' }
        : !roleExport ? { allowed: false, reason: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot mark delivery. Ask a Manager, Reviewer or Admin.` }
        : !exports.some((e) => e.version === report.version) ? { allowed: false, reason: 'Export PDF or DOCX for this version first (step 2).' }
        : !tplPublished ? { allowed: false, reason: 'The template is not approved, so formal delivery is blocked. Switch the report to a published template.' }
        : { allowed: true, reason: '' }
  const ackGate: ReviewGate = report.status !== 'delivered'
    ? { allowed: false, reason: 'Only a delivered report can acknowledge receipt.' }
    : ro ? roGate()
    : !roleExport ? { allowed: false, reason: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot record acknowledgements.` }
    : { allowed: true, reason: '' }
  return {
    ok: true,
    data: {
      report,
      project: { id: project.id, client: project.client, type: project.type, roeVersion: project.roeVersion, roeStatus: project.roeStatus },
      checks,
      linked: report.findings
        .map((fid) => db.findings.find((f) => f.id === fid && f.projectId === project.id))
        .filter((f): f is Finding => !!f)
        .map((f) => ({
          id: f.id, title: f.title, severity: f.severity, asset: f.asset, status: f.status,
          evidence: f.evidence.map((ref) => ({ ref, sensitive: !!db.evidence.find((e) => e.id === ref && e.projectId === project.id)?.sensitive })),
        })),
      exports,
      deliveryAuditId: db.audit.find((a) => a.obj === report.id && a.action === 'Marked as delivered')?.id,
      gates: { decide, export: exportGate, deliver: deliverGate, ack: ackGate },
    },
  }
}

/** Submit/resubmit input: the section bodies to snapshot for this version. */
export interface ReportSubmitInput { bodies: Record<string, string> }

/**
 * Submits (or resubmits) a report for review in one atomic commit: the
 * committed content is snapshotted for the version (ticket 36 version
 * snapshots live in the one database, never in UI state), a returned report
 * advances to the next minor version, and the review entry, audit row and
 * reviewer notice share the commit. Refusals: read-only project or missing
 * `editReport` role → forbidden; a non-draft state → conflict.
 */
export function submitReportVersion(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: ReportSubmitInput): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  if (projectLocked(project)) return { ok: false, failure: { kind: 'forbidden', message: readOnlyReason(project, ctx), entity: reportRef(report) } }
  if (!can(ctx.actor, 'editReport', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot edit reports. Ask a Red Team Manager, Operator or Analyst to submit it.`, entity: reportRef(report) } }
  }
  if (!EDITABLE_REPORT.includes(report.status)) {
    return { ok: false, failure: { kind: 'conflict', message: `This report is ${STATUS_EN[report.status]}, so it cannot be submitted for review.`, entity: reportRef(report) } }
  }
  const at = stampOf(clock)
  const version = report.status === 'returned'
    ? (() => { const [maj, min] = report.version.replace('v', '').split('.').map(Number); return `v${maj}.${min + 1}` })()
    : report.version
  const bodies = Object.fromEntries(report.sections.filter((s) => s.id in input.bodies).map((s) => [s.id, input.bodies[s.id] ?? s.body]))
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === id)!
    r.status = 'review'
    r.version = version
    r.updated = at
    r.reviews.push({ at, by: ctx.actor.id, action: 'Submitted for review', note: '', version })
    const snapshots: ReportSnapshot[] = (r.snapshots || []).filter((x) => x.version !== version)
    snapshots.push({ version, at, by: ctx.actor.id, bodies, findings: [...r.findings] })
    r.snapshots = snapshots
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Submitted report for review', obj: id, projectId: r.projectId, result: 'Success', reason: '' })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', category: 'reports', text: `${id} needs review`, projectId: r.projectId, at, read: false, to: { name: 'report-review', id } })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === id)! }
}

/** The reviewer's decision on a report in review. */
export type ReportDecision = 'approve' | 'return'

/**
 * The review decision (approve/return) with the four-eyes policy owned by
 * the handler: the author can never decide their own report, only a
 * Reviewer (`approveReport`) may decide, the report must be In Review, and
 * the mandatory decision comment is recorded with the version in the
 * canonical review history. Approval pins the submitted snapshot — later
 * edits start a new draft and never mutate the approved content.
 */
export function decideReport(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, decision: ReportDecision, note: string): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  if (projectLocked(project)) return { ok: false, failure: { kind: 'forbidden', message: readOnlyReason(project, ctx), entity: reportRef(report) } }
  if (report.status !== 'review') {
    return { ok: false, failure: { kind: 'conflict', message: `A report can be decided only while it is In Review — ${id} is ${STATUS_EN[report.status]}.`, entity: reportRef(report) } }
  }
  if (!can(ctx.actor, 'approveReport', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Only a Reviewer can approve or return reports; the ${ROLE_TEXT[ctx.actor.role]} role cannot. Ask the assigned reviewer (${report.reviewer}) to act.`, entity: reportRef(report) } }
  }
  if (ctx.actor.id === report.author) {
    return { ok: false, failure: { kind: 'forbidden', message: 'The author cannot decide their own report (four-eyes principle). Assign an independent reviewer.', entity: reportRef(report) } }
  }
  if (!note.trim()) {
    return { ok: false, failure: { kind: 'validation', message: decision === 'approve' ? 'An approval reasoning is required and is recorded with the pinned version.' : 'A comment for the author is required to return a report.' } }
  }
  const at = stampOf(clock)
  const approved = decision === 'approve'
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === id)!
    r.status = approved ? 'approved' : 'returned'
    r.updated = at
    r.reviews.push({ at, by: ctx.actor.id, action: approved ? 'Approved' : 'Changes requested', note: note.trim(), version: r.version })
    if (approved) {
      // Pin the approved content: the submitted snapshot when one exists, otherwise
      // the committed sections (a report that entered review through the legacy path).
      const snapshots: ReportSnapshot[] = [...(r.snapshots || [])]
      const i = snapshots.findIndex((s) => s.version === r.version)
      if (i >= 0) snapshots[i] = { ...snapshots[i], pinned: true }
      else snapshots.push({ version: r.version, at, by: ctx.actor.id, bodies: Object.fromEntries(r.sections.map((s) => [s.id, s.body])), findings: [...r.findings], pinned: true })
      r.snapshots = snapshots
    }
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: approved ? 'Approved report' : 'Requested report changes', obj: id, projectId: r.projectId, result: 'Success', reason: note.trim() })
    if (!approved) d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', category: 'reports', text: `${id} was returned for changes`, projectId: r.projectId, at, read: false, to: { name: 'report', id } })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === id)! }
}

/** Simulated export checksum — identical format to the baseline export records. */
const checksumOf = () => 'sha256:' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6)

/**
 * Simulated PDF/DOCX export: requires an eligible approved version and an
 * export-capable role, and records the export with its checksum on the
 * export record (never on preview content). An approved report advances to
 * exported; the export alone is not a delivery.
 */
export function exportReportVersion(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, format: 'PDF' | 'DOCX'): ServiceResult<{ report: Report; rec: ExportRec }> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  if (projectLocked(project)) return { ok: false, failure: { kind: 'forbidden', message: readOnlyReason(project, ctx), entity: reportRef(report) } }
  if (!['approved', 'exported'].includes(report.status)) {
    return { ok: false, failure: { kind: 'conflict', message: report.status === 'delivered' ? 'This report is already delivered. Create a new version to export changes.' : 'Export unlocks after the report is approved. Submit it for review first.', entity: reportRef(report) } }
  }
  if (!EXPORT_ROLES.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot export reports. Ask a Manager, Reviewer or Admin.`, entity: reportRef(report) } }
  }
  const at = stampOf(clock)
  const recId = 'EX-' + (91 + db.exportsList.length)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === id)!
    if (r.status === 'approved') r.status = 'exported'
    d.exportsList.unshift({ id: recId, reportId: id, version: r.version, format, by: ctx.actor.id, at, recipient: '—', status: 'Completed', checksum: checksumOf() })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: `Exported report (${format})`, obj: id, projectId: r.projectId, result: 'Success', reason: '' })
  })
  const next = authority.snapshot()
  return { ok: true, data: { report: next.reports.find((x) => x.id === id)!, rec: next.exportsList.find((x) => x.id === recId)! } }
}

/** Delivery/handover input: who received the locked version, how, with what note. */
export interface DeliveryInput {
  recipient: string
  channel: string
  notes: string
  /** Explicit handover confirmation (ticket 37): the handler refuses delivery without it. */
  confirm: boolean
}

/**
 * Marks the locked version delivered: requires an approved version, a valid
 * export of that exact version, a published template, a recipient and the
 * explicit handover confirmation. The handover history persists on the
 * delivered export records — recipient/channel/notes plus the delivery
 * actor and its own instant (ticket 37), distinct from the export stamp —
 * and the immutable audit row carries actor/reason/timestamp/version. The
 * delivery history is the export history, and export alone is never delivery.
 */
export function deliverReportVersion(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: DeliveryInput): ServiceResult<Report> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  if (projectLocked(project)) return { ok: false, failure: { kind: 'forbidden', message: readOnlyReason(project, ctx), entity: reportRef(report) } }
  if (report.status === 'delivered') {
    return { ok: false, failure: { kind: 'conflict', message: 'This report is already delivered.', entity: reportRef(report) } }
  }
  if (!['approved', 'exported'].includes(report.status)) {
    return { ok: false, failure: { kind: 'conflict', message: 'Cannot deliver: the report has not been approved.', entity: reportRef(report) } }
  }
  if (!EXPORT_ROLES.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot mark delivery. Ask a Manager, Reviewer or Admin.`, entity: reportRef(report) } }
  }
  if (!db.exportsList.some((e) => e.reportId === id && e.version === report.version)) {
    return { ok: false, failure: { kind: 'validation', message: 'Cannot deliver: no valid export exists for this version. Export PDF/DOCX first.', entity: reportRef(report) } }
  }
  if (db.templates.find((x) => x.name === report.template)?.status === 'draft') {
    return { ok: false, failure: { kind: 'validation', message: 'The template is not approved, so formal delivery is blocked. Switch the report to a published template.', entity: reportRef(report) } }
  }
  if (!input.recipient.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'Enter the recipient.' } }
  }
  if (!input.confirm) {
    return { ok: false, failure: { kind: 'validation', message: 'Confirm that the handover happened before marking delivery.', entity: reportRef(report) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const r = d.reports.find((x) => x.id === id)!
    r.status = 'delivered'
    r.deliveredAt = at
    r.updated = at
    d.exportsList.filter((e) => e.reportId === id && e.version === r.version).forEach((e) => {
      e.recipient = input.recipient.trim()
      e.status = 'Delivered'
      e.channel = input.channel
      e.notes = input.notes
      e.deliveredBy = ctx.actor.id
      e.deliveredAt = at
    })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Marked as delivered', obj: id, projectId: r.projectId, result: 'Success', reason: input.recipient.trim() })
  })
  return { ok: true, data: authority.snapshot().reports.find((x) => x.id === id)! }
}

/** Records the recipient acknowledgement on the delivered export record. */
export function acknowledgeDelivery(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<ExportRec> {
  const db = authority.snapshot()
  const t = resolveReport(db, ctx, id)
  if (!t.ok) return t
  const { report, project } = t
  if (report.status !== 'delivered') {
    return { ok: false, failure: { kind: 'conflict', message: 'Only a delivered report can acknowledge receipt.', entity: reportRef(report) } }
  }
  if (projectLocked(project) || !EXPORT_ROLES.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: projectLocked(project) ? readOnlyReason(project, ctx) : `Your role (${ROLE_TEXT[ctx.actor.role]}) cannot record acknowledgements.`, entity: reportRef(report) } }
  }
  const rec = db.exportsList.find((e) => e.reportId === id && e.status === 'Delivered')
  if (!rec) return { ok: false, failure: { kind: 'validation', message: 'No delivery record to acknowledge.', entity: reportRef(report) } }
  if (rec.ackAt) return { ok: true, data: rec }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const target = d.exportsList.find((e) => e.id === rec.id)!
    target.ackAt = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Recorded delivery acknowledgement', obj: id, projectId: report.projectId, result: 'Success', reason: `Receipt confirmed by ${target.recipient}` })
  })
  return { ok: true, data: authority.snapshot().exportsList.find((x) => x.id === rec.id)! }
}

/** Builds the typed report service; `guard` is the factory's superseded-scope read guard.
 *  Reads observe scope cancellation; writes capture their context at call time and commit once. */
export function createReportService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
) {
  return {
    list: (ctx: RequestContext, query?: ReportListQuery) => guard(() => listReports(authority.snapshot(), ctx, query)),
    templates: () => guard(() => listTemplates(authority.snapshot())),
    deliveries: (ctx: RequestContext, query?: DeliveryListQuery) => guard(() => listDeliveries(authority.snapshot(), ctx, query)),
    draftOptions: (ctx: RequestContext) => guard(() => draftOptions(authority.snapshot(), ctx)),
    createDraft: (ctx: RequestContext, input: ReportDraftInput) => Promise.resolve(createReportDraft(authority, clock, ctx, input)),
    /* Ticket 35: the editor/preview read and the section/findings writes. */
    editor: (ctx: RequestContext, id: string) => guard(() => readReportEditor(authority.snapshot(), ctx, id)),
    saveSection: (ctx: RequestContext, id: string, sectionId: string, body: string) => Promise.resolve(saveReportSection(authority, clock, ctx, id, sectionId, body)),
    addSection: (ctx: RequestContext, id: string, title: string) => Promise.resolve(addReportSection(authority, clock, ctx, id, title)),
    removeSection: (ctx: RequestContext, id: string, sectionId: string) => Promise.resolve(removeReportSection(authority, clock, ctx, id, sectionId)),
    reorderSections: (ctx: RequestContext, id: string, order: string[]) => Promise.resolve(reorderReportSections(authority, clock, ctx, id, order)),
    setFindings: (ctx: RequestContext, id: string, ids: string[]) => Promise.resolve(setReportFindings(authority, clock, ctx, id, ids)),
    /* Ticket 36: review read + submit/approve/return + export/delivery. */
    review: (ctx: RequestContext, id: string, nf?: NoFind) => guard(() => readReportReview(authority.snapshot(), ctx, id, nf)),
    submit: (ctx: RequestContext, id: string, input: ReportSubmitInput) => Promise.resolve(submitReportVersion(authority, clock, ctx, id, input)),
    decide: (ctx: RequestContext, id: string, decision: ReportDecision, note: string) => Promise.resolve(decideReport(authority, clock, ctx, id, decision, note)),
    exportVersion: (ctx: RequestContext, id: string, format: 'PDF' | 'DOCX') => Promise.resolve(exportReportVersion(authority, clock, ctx, id, format)),
    deliver: (ctx: RequestContext, id: string, input: DeliveryInput) => Promise.resolve(deliverReportVersion(authority, clock, ctx, id, input)),
    acknowledge: (ctx: RequestContext, id: string) => Promise.resolve(acknowledgeDelivery(authority, clock, ctx, id)),
  }
}

export type ReportService = ReturnType<typeof createReportService>
