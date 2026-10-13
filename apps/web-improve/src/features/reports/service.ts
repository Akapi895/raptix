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
import type { ExportRec, FindingStatus, Report, ReportStatus, Severity, Template } from '../../domain/entities'

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

/** Builds the typed report service; `guard` is the factory's superseded-scope read guard.
 *  Reads observe scope cancellation; the create captures its context at call time and commits once. */
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
  }
}

export type ReportService = ReturnType<typeof createReportService>
