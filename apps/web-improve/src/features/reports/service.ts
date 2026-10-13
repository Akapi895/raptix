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
import type { ExportRec, Finding, FindingStatus, Project, Report, ReportStatus, Severity, Template } from '../../domain/entities'

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
  }
}

export type ReportService = ReturnType<typeof createReportService>
