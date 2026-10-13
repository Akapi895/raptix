/**
 * Findings inventory read model (ticket 31, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the findings list and detail: scope-checked
 * reads over the one database authority. Every request captures actor and
 * project explicitly; a non-member's specific-project read is denied with
 * `not-found` (no existence leak), a finding from an accessible project
 * outside the active project context is refused with `forbidden` and the
 * owning project on the entity ref (the screen can offer an explicit
 * switch), and the aggregate scope (`'all'`) folds in only projects the
 * actor can access. Evidence references stay opaque: they are matched
 * against the project's evidence records and never parsed. AI suggestions
 * are proposals — they are listed and counted separately and never enter
 * the severity breakdown. Ticket 32 adds the write side: every mutation is
 * a scope-checked handler that enforces the lifecycle's role/state policy
 * at the handler (never in the screen), commits once through the shared
 * authority and publishes the affected identities, so legacy consumers and
 * Query views observe the same change.
 */
import { projectAccessible, projectLocked, can as policyCan } from '../../auth/policy'
import type { CanAction } from '../../domain/permissions'
import { formatDemoInstant } from '../../domain/clock'
import { TECHNIQUES, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Evidence, Finding, FindingStatus, Project, Role, Severity } from '../../domain/entities'
import type { EvidenceReference } from '../../domain/evidence'

/** Filter/sort state for the findings inventory (all optional; empty = unfiltered). */
export interface FindingListQuery {
  /** Tab key (''|confirmed|review|ai|drafts|remediation) or one detailed status. */
  status?: string
  severity?: string
  /** Case-insensitive substring over id + title. */
  q?: string
  /** Explicit project filter (aggregate view only). */
  project?: string
  owner?: string
  asset?: string
  /** Linked operation id. */
  op?: string
  sort?: FindingSort
  /** Dismissed AI suggestions; excluded from the 'ai' category until restored. */
  dismissed?: string[]
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
}

export type FindingSort = 'updated' | 'created' | 'severity' | 'id'
export type FindingCategory = 'all' | 'confirmed' | 'review' | 'ai' | 'drafts' | 'remediation'

/** One table row: the canonical finding plus the labels its columns render. */
export interface FindingListItem {
  finding: Finding
  /** Client label of the owning project. */
  projectClient?: string
}

/** The whole list read: page + tab/severity counts + filter options. */
export interface FindingListRead {
  items: FindingListItem[]
  page: number
  pageSize: number
  total: number
  /** Status-tab counts; each category excludes its own dimension so tabs stay live. */
  counts: Record<FindingCategory, number>
  /** Severity breakdown over verified findings only — AI suggestions are proposals, not counts. */
  severity: Record<Severity, number>
  /** Verified findings awaiting review / resolved (the workflow KPIs). */
  awaitingReview: number
  resolved: number
  owners: string[]
  assets: string[]
  ops: string[]
  projects: string[]
}

/**
 * One linked evidence row for the detail read. `ref` is the opaque evidence
 * reference from the finding (never parsed or dereferenced by the console);
 * display metadata comes from the matching evidence record in the same
 * project. `masked` withholds the capture name from roles without
 * `viewSensitive` — the reference itself stays visible.
 */
export interface EvidenceView {
  ref: EvidenceReference
  name?: string
  masked: boolean
  kind: string
  source: string
  at: string
  by: string
  projectId: string
  findingId?: string
  opId?: string
  sensitive: boolean
}

/** One detail read: finding + masked evidence + the labels the detail renders. */
export interface FindingDetailRead {
  finding: Finding
  evidence: EvidenceView[]
  project: { id: string; name: string; client: string }
  /** Resolved affected-asset id for navigation (finding.asset is a display name). */
  assetId?: string
  operation?: { id: string; name: string }
  /** Producing step observation behind the finding, when one is linked. */
  step?: { id: string; name: string; agent: string; asset: string; technique: string; output: string; ts: string }
  techniqueName?: string
  /** Reports that include this finding. */
  inReports: { id: string; title: string }[]
  canViewSensitive: boolean
}

export interface FindingService {
  list(ctx: RequestContext, query?: FindingListQuery): Promise<ServiceResult<FindingListRead>>
  get(ctx: RequestContext, id: string): Promise<ServiceResult<FindingDetailRead>>
  /** Creates (id `null`) or edits a draft/returned finding; `submit` moves it to review. */
  save(ctx: RequestContext, id: string | null, input: FindingSaveInput): Promise<ServiceResult<Finding>>
  /** One lifecycle move; the transition map enforces role + state policy at the handler. */
  transition(ctx: RequestContext, id: string, to: FindingTransitionTarget, note?: string): Promise<ServiceResult<Finding>>
  /** Imports an AI suggestion as a DRAFT (invariant 5 — the AI never publishes a finding). */
  importSuggestion(ctx: RequestContext, id: string): Promise<ServiceResult<Finding>>
  /** Links an existing evidence reference into the finding (same project, masking respected). */
  attachEvidence(ctx: RequestContext, findingId: string, evidenceId: string): Promise<ServiceResult<Finding>>
  /** Simulated evidence upload that records and links the capture in one commit. */
  uploadEvidence(ctx: RequestContext, input: EvidenceUploadInput): Promise<ServiceResult<Evidence>>
  /** Records one retest result; a "Resolved" result closes the finding. */
  recordRetest(ctx: RequestContext, id: string, input: RetestInput): Promise<ServiceResult<Finding>>
}

/** Category → statuses the tab covers; drafts also include returned findings. */
const CATEGORIES: readonly (readonly [Exclude<FindingCategory, 'all'>, readonly FindingStatus[]])[] = [
  ['confirmed', ['confirmed']], ['review', ['review']], ['ai', ['ai_suggested']],
  ['drafts', ['draft', 'returned']], ['remediation', ['remediation', 'retest', 'resolved']],
]
const SEVS: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const PAGE_SIZE = 10

function matchesStatus(f: Finding, status: string): boolean {
  if (!status) return true
  const cat = CATEGORIES.find(([k]) => k === status)
  if (cat) return cat[1].includes(f.status)
  return f.status === status
}

/** Parses the dataset's demo-date display strings for ordering only. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ts = (s: string) => {
  const m = s.match(/([A-Za-z]{3}) (\d+), (\d{4}), (\d+):(\d+) ([AP])M/)
  if (!m) return 0
  const h = (+m[4] % 12) + (m[6] === 'P' ? 12 : 0)
  return Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2], h, +m[5])
}

function compareFindings(a: Finding, b: Finding, sort: FindingSort): number {
  if (sort === 'severity') return SEV_RANK[a.severity] - SEV_RANK[b.severity] || ts(b.updated) - ts(a.updated)
  if (sort === 'id') return a.id.localeCompare(b.id)
  if (sort === 'created') return ts(b.date) - ts(a.date)
  return ts(b.updated) - ts(a.updated)
}

/**
 * Pure list handler. Scope semantics: a specific projectId reads only that
 * project's findings and only for members (elevated roles included);
 * `'all'`/`''` aggregates across the actor's accessible projects. Counts and
 * filter options derive from the same accessible base, each excluding its
 * own filter dimension so tabs and KPIs show live totals. Dismissed AI
 * suggestions stay out of the 'ai' category until restored.
 */
export function listFindings(db: Db, ctx: RequestContext, query: FindingListQuery = {}): ServiceResult<FindingListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Findings for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = db.findings.filter((f) => (aggregate ? accessible.has(f.projectId) : f.projectId === pid))
  const q = (query.q || '').toLowerCase()
  const sort: FindingSort = query.sort || 'updated'
  // `core` excludes the severity and status dimensions so counts and KPIs stay live.
  const core = base.filter((f) =>
    (!query.project || f.projectId === query.project) &&
    (!query.owner || f.owner === query.owner) &&
    (!query.asset || f.asset === query.asset) &&
    (!query.op || f.op === query.op) &&
    (!q || (f.id + ' ' + f.title).toLowerCase().includes(q)))
  const dismissed = new Set(query.dismissed || [])
  const categories: FindingCategory[] = ['all', 'confirmed', 'review', 'ai', 'drafts', 'remediation']
  const counts = Object.fromEntries(categories.map((c) => [c, core.filter((f) => (c === 'all' || matchesStatus(f, c)) && (c !== 'ai' || !dismissed.has(f.id))).length])) as Record<FindingCategory, number>
  // AI suggestions are proposals: they never enter the severity breakdown or workflow KPIs.
  const verified = core.filter((f) => f.status !== 'ai_suggested')
  const severity = Object.fromEntries(SEVS.map((s) => [s, verified.filter((f) => f.severity === s).length])) as Record<Severity, number>
  const rows = core
    .filter((f) => (!query.severity || f.severity === query.severity) && matchesStatus(f, query.status || '') && (query.status !== 'ai' || !dismissed.has(f.id)))
    .sort((a, b) => compareFindings(a, b, sort))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const items: FindingListItem[] = rows
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((finding) => ({ finding, projectClient: db.projects.find((p) => p.id === finding.projectId)?.client }))
  return {
    ok: true,
    data: {
      items, page, pageSize: PAGE_SIZE, total: rows.length, counts, severity,
      awaitingReview: verified.filter((f) => f.status === 'review').length,
      resolved: verified.filter((f) => f.status === 'resolved').length,
      owners: [...new Set(base.map((f) => f.owner))].sort(),
      assets: [...new Set(base.map((f) => f.asset))],
      ops: [...new Set(base.map((f) => f.op).filter(Boolean))],
      projects: [...accessible],
    },
  }
}

/**
 * Pure detail handler. A finding outside the actor's access is `not-found`
 * (indistinguishable from a missing one); a finding in an accessible
 * project but outside the active project context is `forbidden` with the
 * owning project on the entity ref and no content. Evidence references are
 * resolved within the finding's own project only; sensitive captures are
 * masked (name withheld) for roles without `viewSensitive`.
 */
export function getFinding(db: Db, ctx: RequestContext, id: string): ServiceResult<FindingDetailRead> {
  const notFound = { ok: false as const, failure: { kind: 'not-found' as const, message: `Finding ${id} does not exist or is not available for your account.`, entity: { kind: 'finding' as const, id } } }
  const f = db.findings.find((x) => x.id === id)
  if (!f) return notFound
  const project = db.projects.find((p) => p.id === f.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return notFound
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  if (!aggregate && ctx.projectId !== f.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Finding ${id} belongs to project ${f.projectId}. Switch to that project to view its content.`,
        entity: { kind: 'finding', id, projectId: f.projectId },
      },
    }
  }
  const canSensitive = policyCan(ctx.actor, 'viewSensitive', project)
  const evidence: EvidenceView[] = f.evidence.map((ref) => {
    // References stay opaque: matched by equality against this project's records, never parsed.
    const rec = db.evidence.find((e) => e.id === ref && e.projectId === f.projectId)
    if (!rec) return { ref, masked: false, kind: 'Unresolved reference', source: '—', at: '—', by: '—', projectId: f.projectId, sensitive: false }
    const masked = rec.sensitive && !canSensitive
    return { ref: rec.id, name: masked ? undefined : rec.name, masked, kind: rec.kind, source: rec.source, at: rec.at, by: rec.by, projectId: rec.projectId, findingId: rec.findingId, opId: rec.opId, sensitive: rec.sensitive }
  })
  const op = f.op ? db.operations.find((o) => o.id === f.op) : undefined
  const step = op?.steps.find((x) => x.evidence && f.evidence.includes(x.evidence)) || op?.steps.find((x) => x.technique === f.technique)
  const asset = db.assets.find((a) => a.projectId === f.projectId && a.name === f.asset)
  return {
    ok: true,
    data: {
      finding: f,
      evidence,
      project: { id: project.id, name: project.name, client: project.client },
      assetId: asset?.id,
      operation: op ? { id: op.id, name: op.name } : undefined,
      step: step ? { id: step.id, name: step.name, agent: step.agent, asset: step.asset, technique: step.technique, output: step.output, ts: step.ts } : undefined,
      techniqueName: TECHNIQUES.find((t) => t.id === f.technique)?.name,
      inReports: db.reports.filter((r) => r.findings.includes(f.id)).map((r) => ({ id: r.id, title: r.title })),
      canViewSensitive: canSensitive,
    },
  }
}

/* ───────────── Write side (ticket 32) ───────────── */

/** Validated payload for creating a finding or saving an edit from the finding form. */
export interface FindingSaveInput {
  title: string
  severity: Severity
  /** Required for critical severity; stored as a rationale comment. */
  severityReason?: string
  asset: string
  op?: string
  technique?: string
  desc: string
  scopeNote?: string
  impact: string
  rec: string
  /** Opaque evidence references; every one must resolve in the finding's project. */
  evidence: string[]
  owner: string
  kind?: string
  stepId?: string
  /** Submit for review instead of keeping the finding at its current stage. */
  submit?: boolean
}

/** Simulated evidence upload attached to a finding (no real bytes are stored). */
export interface EvidenceUploadInput { findingId: string; name: string; kind: string; source: string; sensitive: boolean; opId?: string }

/** One retest observation; result "Resolved" closes the finding. */
export interface RetestInput { result: string; note: string }

/** Lifecycle targets a finding can move to (the return path included). */
export type FindingTransitionTarget = 'draft' | 'review' | 'confirmed' | 'returned' | 'remediation' | 'retest' | 'resolved'

/** Display labels for audit rows; kept local so the service never imports the legacy store. */
const ROLE_TEXT: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
const STATUS_TEXT: Record<FindingStatus, string> = { ai_suggested: 'an unverified AI suggestion', draft: 'a draft', review: 'in review', returned: 'returned for changes', confirmed: 'confirmed', remediation: 'in remediation', retest: 'in retest', resolved: 'resolved' }
const TARGET_TEXT: Record<FindingTransitionTarget, string> = { draft: 'a draft', review: 'review', confirmed: 'confirmed', returned: 'returned for changes', remediation: 'remediation', retest: 'retest', resolved: 'resolved' }
const HISTORY_TEXT: Record<FindingTransitionTarget, string> = { draft: 'Imported AI suggestion as a draft', review: 'Submitted for review', confirmed: 'Confirmed', returned: 'Returned for changes', remediation: 'Sent to remediation', retest: 'Moved to retest', resolved: 'Marked resolved' }
const VERB_TEXT: Record<FindingTransitionTarget, string> = { draft: 'import AI suggestions', review: 'submit findings for review', confirmed: 'confirm findings', returned: 'return findings for changes', remediation: 'move findings to remediation', retest: 'move findings to retest', resolved: 'resolve findings' }

/**
 * The lifecycle contract (requirement 33): from-status → legal targets with
 * the policy actions that may execute the move. Invariant 5 lives here, not
 * in the screen: an `ai_suggested` record's only legal target is `draft` —
 * the AI never publishes a finding; a human imports it as a draft to curate,
 * and it enters review only through a human submit with `createFinding`.
 */
const TRANSITIONS: Partial<Record<FindingStatus, Partial<Record<FindingTransitionTarget, readonly CanAction[]>>>> = {
  ai_suggested: { draft: ['createFinding'] },
  draft: { review: ['createFinding'] },
  returned: { review: ['createFinding'] },
  review: { confirmed: ['reviewFinding'], returned: ['reviewFinding'] },
  confirmed: { remediation: ['createFinding', 'reviewFinding'] },
  remediation: { retest: ['createFinding', 'reviewFinding'] },
  retest: { resolved: ['createFinding', 'reviewFinding'] },
  resolved: {},
}

const findingRef = (f: Finding) => ({ kind: 'finding' as const, id: f.id, projectId: f.projectId })
const stampOf = (clock: Clock) => formatDemoInstant(clock.now())
const notFoundFailure = (id: string): ServiceFailure => ({
  kind: 'not-found',
  message: `Finding ${id} does not exist or is not available for your account.`,
  entity: { kind: 'finding', id },
})

/** Resolves a finding for a write, or the scope failure that refuses it
 *  (missing/out-of-scope → not-found without leaking existence; a finding in
 *  an accessible project outside the active context → forbidden with the
 *  owning project on the entity ref, mirroring the detail read). */
function writableFinding(db: Db, ctx: RequestContext, id: string): { ok: true; finding: Finding; project: Project } | { ok: false; failure: ServiceFailure } {
  const f = db.findings.find((x) => x.id === id)
  if (!f) return { ok: false, failure: notFoundFailure(id) }
  const project = db.projects.find((p) => p.id === f.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return { ok: false, failure: notFoundFailure(id) }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== f.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Finding ${id} belongs to project ${f.projectId}. Switch to that project to change it.`,
        entity: { kind: 'finding', id, projectId: f.projectId },
      },
    }
  }
  return { ok: true, finding: f, project }
}

/** Read-only context first, then the role matrix for any of the granted actions. */
function roleDenied(ctx: RequestContext, project: Project, actions: readonly CanAction[], message: string): ServiceFailure | undefined {
  if (projectLocked(project)) return { kind: 'forbidden', message: `Project ${project.id} is closed or cancelled — findings are read-only.` }
  if (!actions.some((a) => policyCan(ctx.actor, a, project))) return { kind: 'forbidden', message }
  return undefined
}

/** Evidence references stay opaque: matched by equality against the finding's
 *  own project records, never parsed. Cross-project references are rejected
 *  (scope compatibility) and sensitive captures need `viewSensitive` (masking).
 *  `allowRelink` keeps the form's legacy re-point semantics for prefilled
 *  evidence; the explicit link action refuses evidence another finding holds. */
function evidenceScopeFailure(db: Db, ctx: RequestContext, project: Project, refs: readonly string[], opts: { findingId?: string; allowRelink?: boolean } = {}): ServiceFailure | undefined {
  for (const ref of refs) {
    const rec = db.evidence.find((e) => e.id === ref)
    if (!rec || rec.projectId !== project.id) return { kind: 'validation', message: `Evidence ${ref} is not part of project ${project.id}.` }
    if (!opts.allowRelink && rec.findingId && rec.findingId !== opts.findingId) return { kind: 'validation', message: `Evidence ${ref} is already linked to ${rec.findingId}.` }
    if (rec.sensitive && !policyCan(ctx.actor, 'viewSensitive', project)) return { kind: 'forbidden', message: `Evidence ${ref} is labeled sensitive; the ${ROLE_TEXT[ctx.actor.role]} role cannot link it.` }
  }
  return undefined
}

/** Handler-side re-check of the form's inline validation (defense in depth).
 *  Drafts may stay sparse — only a usable title is required; the full field
 *  set and the evidence requirement are enforced when submitting for review. */
function saveValidationFailure(db: Db, input: FindingSaveInput, projectId: string, submit: boolean): ServiceFailure | undefined {
  if (input.title.trim().length < 5) return { kind: 'validation', message: 'Enter a finding title (at least 5 characters).' }
  if (!submit) return undefined
  if (!input.asset) return { kind: 'validation', message: 'Select the affected asset.' }
  if (!db.assets.some((a) => a.projectId === projectId && a.name === input.asset)) return { kind: 'validation', message: 'Select an asset that belongs to the project.' }
  if (!input.desc.trim() || !input.impact.trim() || !input.rec.trim()) return { kind: 'validation', message: 'Description, impact and recommendation are required.' }
  if (input.severity === 'critical' && !input.severityReason?.trim()) return { kind: 'validation', message: 'Critical severity requires a rationale.' }
  if (input.technique && !TECHNIQUES.some((t) => t.id === input.technique)) return { kind: 'validation', message: `Unknown ATT&CK technique ${input.technique}.` }
  if (input.evidence.length === 0) return { kind: 'validation', message: 'At least 1 piece of evidence is required to submit for review (you can save a draft first).' }
  return undefined
}

/**
 * Creates (id `null`) or edits a draft/returned finding in one atomic commit
 * — content, new evidence links, the severity rationale comment and the
 * optional submit all share one corr, so the form's save is one user-visible
 * action. A failed save commits nothing and the caller keeps its draft.
 */
export function saveFinding(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string | null, input: FindingSaveInput): ServiceResult<Finding> {
  const db = authority.snapshot()
  if (!id) {
    // A finding belongs to exactly one project; the aggregate context cannot create one.
    if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'forbidden', message: 'Select a specific project before creating a finding.' } }
    const project = db.projects.find((p) => p.id === ctx.projectId)
    if (!project || !projectAccessible(project, ctx.actor)) return { ok: false, failure: { kind: 'not-found', message: `Project ${ctx.projectId} is not available for your account.` } }
    const denied = roleDenied(ctx, project, ['createFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot create findings.`)
    if (denied) return { ok: false, failure: denied }
    const invalid = saveValidationFailure(db, input, project.id, !!input.submit) || evidenceScopeFailure(db, ctx, project, input.evidence, { allowRelink: true })
    if (invalid) return { ok: false, failure: invalid }
    const at = stampOf(clock)
    const newId = 'FD-' + String(db.counters.finding + 1).padStart(3, '0')
    authority.commit(ctx.corr, (d) => {
      d.counters.finding++
      d.findings.unshift({
        id: newId, projectId: project.id, title: input.title.trim(), severity: input.severity, status: input.submit ? 'review' : 'draft',
        asset: input.asset, op: input.op || '', technique: input.technique || '', owner: input.owner, date: at, updated: at,
        desc: input.desc, impact: input.impact, rec: input.rec, evidence: [...input.evidence],
        comments: input.severityReason?.trim() ? [{ by: ctx.actor.id, at, text: `Severity rationale (${input.severity}): ${input.severityReason.trim()}` }] : [],
        history: [{ at, by: ctx.actor.id, text: 'Draft created' }, ...(input.submit ? [{ at, by: ctx.actor.id, text: 'Submitted for review' }] : [])],
        retests: [],
      })
      input.evidence.forEach((ref) => { const rec = d.evidence.find((x) => x.id === ref); if (rec) rec.findingId = newId })
      d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: input.submit ? 'Created finding and submitted for review' : 'Created draft finding', obj: newId, projectId: project.id, result: 'Success', reason: '' })
      if (input.submit) d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `${newId} needs review`, projectId: project.id, at, read: false, to: { name: 'finding', id: newId } })
    })
    return { ok: true, data: authority.snapshot().findings.find((x) => x.id === newId)! }
  }
  const t = writableFinding(db, ctx, id)
  if (!t.ok) return t
  const { finding, project } = t
  if (!['draft', 'returned'].includes(finding.status)) {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is ${STATUS_TEXT[finding.status]} — only drafts or returned findings can be edited.`, entity: findingRef(finding) } }
  }
  const denied = roleDenied(ctx, project, ['createFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot edit findings.`)
  if (denied) return { ok: false, failure: denied }
  const invalid = saveValidationFailure(db, input, project.id, !!input.submit)
    || evidenceScopeFailure(db, ctx, project, input.evidence, { findingId: id, allowRelink: true })
  if (invalid) return { ok: false, failure: invalid }
  const at = stampOf(clock)
  const severityChanged = input.severity !== finding.severity
  authority.commit(ctx.corr, (d) => {
    const f = d.findings.find((x) => x.id === id)!
    Object.assign(f, {
      title: input.title.trim(), severity: input.severity, desc: input.desc, impact: input.impact, rec: input.rec,
      asset: input.asset, technique: input.technique || '', owner: input.owner, op: input.op || '', evidence: [...input.evidence], updated: at,
    })
    f.history.push({ at, by: ctx.actor.id, text: 'Content updated' })
    input.evidence.filter((ref) => !finding.evidence.includes(ref)).forEach((ref) => { const rec = d.evidence.find((x) => x.id === ref); if (rec) rec.findingId = id })
    if (severityChanged && input.severityReason?.trim()) f.comments.push({ by: ctx.actor.id, at, text: `Rationale for changing severity to ${input.severity}: ${input.severityReason.trim()}` })
    if (input.submit) { f.status = 'review'; f.history.push({ at, by: ctx.actor.id, text: 'Submitted for review' }) }
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === id)! }
}

/**
 * One lifecycle move. Order of refusals: missing/out-of-scope → not-found,
 * cross-project context → forbidden, illegal from→to pair → conflict, then
 * read-only context and role policy → forbidden with the reason, then the
 * stage's own validation rules (evidence for submit, reason for return).
 */
export function transitionFinding(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, to: FindingTransitionTarget, note?: string): ServiceResult<Finding> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, id)
  if (!t.ok) return t
  const { finding, project } = t
  if (projectLocked(project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Project ${project.id} is closed or cancelled — findings are read-only.`, entity: findingRef(finding) } }
  }
  const actions = TRANSITIONS[finding.status]?.[to]
  if (!actions) {
    return { ok: false, failure: { kind: 'conflict', message: `Finding ${id} is ${STATUS_TEXT[finding.status]}; it cannot move to ${TARGET_TEXT[to]} from there.`, entity: findingRef(finding) } }
  }
  const denied = roleDenied(ctx, project, actions, `The ${ROLE_TEXT[ctx.actor.role]} role cannot ${VERB_TEXT[to]}.`)
  if (denied) return { ok: false, failure: denied }
  if (to === 'review' && finding.evidence.length === 0) {
    return { ok: false, failure: { kind: 'validation', message: 'At least 1 piece of evidence is required to submit for review (you can save a draft first).' } }
  }
  if (to === 'returned' && !note?.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required to return a finding for changes.' } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const f = d.findings.find((x) => x.id === id)!
    f.status = to
    f.updated = at
    f.history.push({ at, by: ctx.actor.id, text: HISTORY_TEXT[to] + (note?.trim() ? `: ${note.trim()}` : '') })
    if (to === 'returned') f.comments.push({ by: ctx.actor.id, at, text: note!.trim() })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: HISTORY_TEXT[to], obj: id, projectId: f.projectId, result: 'Success', reason: note?.trim() || '' })
    if (to === 'returned') d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `${id} was returned for changes`, projectId: f.projectId, at, read: false, to: { name: 'finding', id } })
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === id)! }
}

/**
 * Invariant 5 at the handler: the AI's only write path is this import, and
 * the transition map gives `ai_suggested` no route except `draft`. A human
 * curates the draft; review/confirmed are reachable only through the same
 * human-driven transitions as any other finding.
 */
export function importFindingSuggestion(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<Finding> {
  return transitionFinding(authority, clock, ctx, id, 'draft')
}

/** Links one existing evidence reference into the finding — same project only. */
export function attachFindingEvidence(authority: DbAuthority, clock: Clock, ctx: RequestContext, findingId: string, evidenceId: string): ServiceResult<Finding> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, findingId)
  if (!t.ok) return t
  const { finding, project } = t
  const denied = roleDenied(ctx, project, ['createFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot add evidence.`)
  if (denied) return { ok: false, failure: denied }
  const invalid = evidenceScopeFailure(db, ctx, project, [evidenceId], { findingId })
  if (invalid) return { ok: false, failure: invalid }
  if (finding.evidence.includes(evidenceId)) return { ok: true, data: finding }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const f = d.findings.find((x) => x.id === findingId)!
    f.evidence.push(evidenceId)
    f.updated = at
    const rec = d.evidence.find((x) => x.id === evidenceId)
    if (rec) rec.findingId = findingId
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === findingId)! }
}

/** Simulated upload: records the capture in the finding's own project (the
 *  scope is derived from the finding, never claimed by the caller) and links it. */
export function uploadFindingEvidence(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: EvidenceUploadInput): ServiceResult<Evidence> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, input.findingId)
  if (!t.ok) return t
  const { finding, project } = t
  const denied = roleDenied(ctx, project, ['createFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot add evidence.`)
  if (denied) return { ok: false, failure: denied }
  if (!input.name.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter a file name.' } }
  const at = stampOf(clock)
  const id = 'EV-' + (400 + db.evidence.length + 1)
  authority.commit(ctx.corr, (d) => {
    d.evidence.push({ id, name: input.name.trim(), kind: input.kind, source: input.source, at, by: ctx.actor.id, projectId: finding.projectId, opId: input.opId, findingId: finding.id, sensitive: input.sensitive })
    const f = d.findings.find((x) => x.id === finding.id)!
    if (!f.evidence.includes(id)) f.evidence.push(id)
    f.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Uploaded evidence', obj: id, projectId: finding.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().evidence.find((x) => x.id === id)! }
}

/** Records one retest observation in the same commit as its outcome: a
 *  "Resolved" result closes the finding; a failed retest from `retest`
 *  returns it to remediation with the reason in the history. */
export function recordFindingRetest(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: RetestInput): ServiceResult<Finding> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, id)
  if (!t.ok) return t
  const { finding, project } = t
  const denied = roleDenied(ctx, project, ['createFinding', 'reviewFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot record retests.`)
  if (denied) return { ok: false, failure: denied }
  if (!['confirmed', 'remediation', 'retest', 'resolved'].includes(finding.status)) {
    return { ok: false, failure: { kind: 'conflict', message: `Retest is only available after the finding has been confirmed — ${id} is ${STATUS_TEXT[finding.status]}.`, entity: findingRef(finding) } }
  }
  if (!input.note.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter notes about the retest.' } }
  const at = stampOf(clock)
  const resolved = input.result === 'Resolved'
  const backToRemediation = !resolved && finding.status === 'retest'
  authority.commit(ctx.corr, (d) => {
    const f = d.findings.find((x) => x.id === id)!
    f.retests.push({ at, by: ctx.actor.id, result: input.result, note: input.note.trim() })
    f.history.push({ at, by: ctx.actor.id, text: `Retest: ${input.result}` })
    if (resolved) f.status = 'resolved'
    else if (backToRemediation) { f.status = 'remediation'; f.history.push({ at, by: ctx.actor.id, text: `Sent to remediation: Retest not passed (${input.result}): ${input.note.trim()}` }) }
    f.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Retested', obj: id, projectId: f.projectId, result: 'Success', reason: input.note.trim() })
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === id)! }
}

/** Builds the typed findings service; `guard` is the factory's superseded-scope read guard.
 *  Reads observe scope cancellation; mutations capture their context at call time and commit once. */
export function createFindingService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): FindingService {
  return {
    list: (ctx, query) => guard(() => listFindings(authority.snapshot(), ctx, query)),
    get: (ctx, id) => guard(() => getFinding(authority.snapshot(), ctx, id)),
    save: (ctx, id, input) => Promise.resolve(saveFinding(authority, clock, ctx, id, input)),
    transition: (ctx, id, to, note) => Promise.resolve(transitionFinding(authority, clock, ctx, id, to, note)),
    importSuggestion: (ctx, id) => Promise.resolve(transitionFinding(authority, clock, ctx, id, 'draft')),
    attachEvidence: (ctx, findingId, evidenceId) => Promise.resolve(attachFindingEvidence(authority, clock, ctx, findingId, evidenceId)),
    uploadEvidence: (ctx, input) => Promise.resolve(uploadFindingEvidence(authority, clock, ctx, input)),
    recordRetest: (ctx, id, input) => Promise.resolve(recordFindingRetest(authority, clock, ctx, id, input)),
  }
}
