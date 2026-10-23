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
 * Query views observe the same change. Ticket 33 adds the standalone
 * evidence inspector reads: scoped list/detail over the same opaque
 * references, producer links resolved from real record links and the
 * simulated capture integrity, with masking and display gates decided at
 * the handler so they hold no matter which screen linked the capture.
 */
import { projectAccessible, projectLocked, can as policyCan, ROLE_LABEL } from '../../domain/policy'
import type { CanAction } from '../../domain/permissions'
import { formatDemoInstant } from '../../domain/clock'
import { TECHNIQUES } from '../../domain/catalog';
import type { Db, FindingRow, SuggestionDispositionState } from '../../demo/seed';
import type { DbAuthority } from '../../demo/authority'
import type { ActorRef, Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Evidence, Finding, FindingStatus, Project, Role, Severity } from '../../domain/entities'
import type { CaptureIntegrity, EvidenceReference } from '../../domain/evidence'
import type { FindingActivityKind, FindingActivityPage, FindingReferenceOptions, FindingSuggestionDisposition } from '@raptix/web-contracts'
export type { FindingActivityKind, FindingActivityItem, FindingActivityPage, FindingReferenceOptions, FindingSuggestionDisposition } from '@raptix/web-contracts'

/** Display label for each finding severity (ticket 67: moved from the legacy store; one definition for the findings/report surfaces). */
export const sevLabel: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' }

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
  /** Include the acting user's dismissed AI suggestions. They stay out of the 'ai' category until restored. */
  showDismissed?: boolean
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
  /** Display name of the owning project; null where the source does not record one. */
  projectName?: string
  /** Target the owning project tests; null where the source does not record one. */
  target?: string | null
}

/** Unfiltered totals across every project in scope; the all-projects stat cards read these, never the filtered page. */
export interface FindingSummary {
  total: number
  severity: Record<Severity, number>
}

/** Totals over every curated finding in scope; AI suggestions are proposals and stay out of every total. */
export function summarizeFindings(findings: Finding[]): FindingSummary {
  const verified = findings.filter((f) => f.status !== 'ai_suggested')
  const severity = Object.fromEntries(SEVS.map((s) => [s, verified.filter((f) => f.severity === s).length])) as Record<Severity, number>
  return { total: verified.length, severity }
}

/** The whole list read: page + tab/severity counts + filter options. */
export interface FindingListRead {
  items: FindingListItem[]
  page: number
  pageSize: number
  total: number
  /** Real mode: the producer projection skipped sources, so the list may be incomplete. */
  truncated?: boolean
  /** Status-tab counts; each category excludes its own dimension so tabs stay live. */
  counts: Record<FindingCategory, number>
  /** Severity breakdown over curated findings only (every status except AI suggestion) — AI suggestions are proposals, not counts. */
  severity: Record<Severity, number>
  /** Curated findings awaiting review / resolved (the workflow KPIs). */
  awaitingReview: number
  resolved: number
  dismissedCount: number
  owners: string[]
  assets: string[]
  ops: string[]
  projects: string[]
  /** Project id → display name for the project filter. */
  projectLabels: Record<string, string>
  summary: FindingSummary
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
  captureId?: string
  digest?: string
  sizeBytes?: number
  classification?: 'unclassified' | 'standard' | 'sensitive'
  classificationVersion?: number
  mediaType?: string
  canClassify?: boolean
  canViewOriginal?: boolean
}

export interface EvidenceDownload {
  bytes: Uint8Array
  filename: string
  mediaType: string
  digest: string
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
  /** Source metadata for a producer claim; the evidence text is not an evidence reference. */
  producer?: {
    path: string
    evidence?: string
    attackVector?: string
    quality?: { defaultSeverity: boolean; placeholderDescription: boolean; placeholderEvidence: boolean; unreadable: boolean }
    sizeBytes?: number
    resolved?: boolean
    digest?: string | null
  }
}

/** The verified original bytes of a retained capture a reproduction names; `text` is null when they are not UTF-8 text. */
export interface RetainedArtifact { captureId: string; filename: string; bytes: Uint8Array; text: string | null }

/** A retained capture a reproduction package can link. */
export interface RetainedCaptureOption { captureId: string; filename: string | null; mediaType: string; digest: string; sizeBytes: number; classification: string; canReadOriginal: boolean }

export interface FindingService {
  list(ctx: RequestContext, query?: FindingListQuery): Promise<ServiceResult<FindingListRead>>
  get(ctx: RequestContext, id: string): Promise<ServiceResult<FindingDetailRead>>
  /** Creates (id `null`) or edits a draft/returned finding; `submit` moves it to review. */
  save(ctx: RequestContext, id: string | null, input: FindingSaveInput): Promise<ServiceResult<Finding>>
  /** One lifecycle move; the transition map enforces role + state policy at the handler. */
  transition(ctx: RequestContext, id: string, to: FindingTransitionTarget, note?: string, expectedVersion?: number): Promise<ServiceResult<Finding>>
  referenceOptions(ctx: RequestContext): Promise<ServiceResult<FindingReferenceOptions>>
  loadActivity(ctx: RequestContext, id: string, kind: FindingActivityKind, cursor: string, version: number): Promise<ServiceResult<FindingActivityPage>>
  /** The mock keys the suggestion by its finding id; the real server keys it by producerRef and ignores the id. */
  setSuggestionDisposition(ctx: RequestContext, findingId: string, input: { producerRef: string; dismissed: boolean; reason: string; expectedVersion: number }): Promise<ServiceResult<FindingSuggestionDisposition>>
  /** Review-log entry for opening an original capture. Mock only: the real adapter keeps none, as before. */
  recordOriginalView(ctx: RequestContext, evidence: { ref: string; projectId: string }): Promise<ServiceResult<void>>
  /** Appends a persisted comment against the version the operator read. */
  addComment(ctx: RequestContext, id: string, text: string, expectedVersion: number, requestId: string): Promise<ServiceResult<Finding>>
  /** Imports an AI suggestion as a DRAFT (invariant 5 — the AI never publishes a finding). */
  importSuggestion(ctx: RequestContext, id: string): Promise<ServiceResult<Finding>>
  /** Links an existing evidence reference into the finding (same project, masking respected). */
  attachEvidence(ctx: RequestContext, findingId: string, evidenceId: string): Promise<ServiceResult<Finding>>
  classifyCapture(ctx: RequestContext, captureId: string, classification: 'standard' | 'sensitive', expectedVersion: number, reason: string): Promise<ServiceResult<EvidenceView>>
  downloadEvidence(ctx: RequestContext, evidenceId: string): Promise<ServiceResult<EvidenceDownload>>
  /** Reads a reproduction's retained capture and verifies its original bytes against the recorded digest before any copy or download. */
  readArtifact(ctx: RequestContext, artifact: import('@raptix/web-contracts').FindingReproductionArtifact): Promise<ServiceResult<RetainedArtifact>>
  /** Retained captures of the project that a reproduction package can link. */
  reproductionCaptures(ctx: RequestContext): Promise<ServiceResult<RetainedCaptureOption[]>>
  /** Simulated evidence upload that records and links the capture in one commit. */
  uploadEvidence(ctx: RequestContext, input: EvidenceUploadInput): Promise<ServiceResult<Evidence>>
  /** Imports the evidence files the agent wrote in the workspace as unclassified captures (ADR-0087). */
  importWorkspaceEvidence(ctx: RequestContext): Promise<ServiceResult<WorkspaceEvidenceImport>>
  /** Records one retest result; a "Resolved" result closes the finding. */
  recordRetest(ctx: RequestContext, id: string, input: RetestInput): Promise<ServiceResult<Finding>>
  /** Standalone evidence list for the scope (ticket 33 — masking at the handler). */
  listEvidence(ctx: RequestContext, query?: EvidenceListQuery): Promise<ServiceResult<EvidenceListRead>>
  /** Standalone evidence detail for both route aliases (ticket 33). */
  getEvidence(ctx: RequestContext, id: string): Promise<ServiceResult<EvidenceDetailRead>>
}

/** Category → statuses the tab covers; drafts also include returned findings. */
const CATEGORIES: readonly (readonly [Exclude<FindingCategory, 'all'>, readonly FindingStatus[]])[] = [
  ['confirmed', ['confirmed']], ['review', ['review']], ['ai', ['ai_suggested']],
  ['drafts', ['draft', 'returned']], ['remediation', ['remediation', 'retest', 'resolved']],
]
export const SEVS: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
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

/** The acting user's own disposition of a stored finding; another user's dismissal never hides it. */
function dispositionOf(f: FindingRow, actor: ActorRef): SuggestionDispositionState | undefined {
  return f.suggestionDispositions?.[actor.id]
}

function isDismissedFor(f: FindingRow, actor: ActorRef): boolean {
  return dispositionOf(f, actor)?.dismissed === true
}

/** The stored finding as the acting user reads it: the record without the per-actor map, plus that user's own disposition. */
function presentFinding(f: FindingRow, actor: ActorRef): Finding {
  const { suggestionDispositions: all, ...finding } = f
  const own = all?.[actor.id]
  return own ? { ...finding, suggestionDisposition: { dismissed: own.dismissed, reason: own.reason, version: own.version } } : finding
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
  const categories: FindingCategory[] = ['all', 'confirmed', 'review', 'ai', 'drafts', 'remediation']
  const counts = Object.fromEntries(categories.map((c) => [c, core.filter((f) => (c === 'all' || matchesStatus(f, c)) && (c !== 'ai' || query.showDismissed || !isDismissedFor(f, ctx.actor))).length])) as Record<FindingCategory, number>
  // AI suggestions are proposals: they never enter the severity breakdown or workflow KPIs.
  const curated = core.filter((f) => f.status !== 'ai_suggested')
  const severity = Object.fromEntries(SEVS.map((s) => [s, curated.filter((f) => f.severity === s).length])) as Record<Severity, number>
  const rows = core
    .filter((f) => (!query.severity || f.severity === query.severity) && matchesStatus(f, query.status || '') && (query.status !== 'ai' || query.showDismissed || !isDismissedFor(f, ctx.actor)))
    .sort((a, b) => compareFindings(a, b, sort))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const projectOf = (id: string) => db.projects.find((p) => p.id === id)
  const items: FindingListItem[] = rows
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((row) => ({ finding: presentFinding(row, ctx.actor), projectClient: projectOf(row.projectId)?.client, projectName: projectOf(row.projectId)?.name, target: null }))
  // The demo records no target per project, so the rows report it as unrecorded.
  return {
    ok: true,
    data: {
      items, page, pageSize: PAGE_SIZE, total: rows.length, counts, severity,
      awaitingReview: curated.filter((f) => f.status === 'review').length,
      resolved: curated.filter((f) => f.status === 'resolved').length,
      dismissedCount: base.filter((f) => isDismissedFor(f, ctx.actor)).length,
      owners: [...new Set(base.map((f) => f.owner))].sort(),
      assets: [...new Set(base.map((f) => f.asset))],
      ops: [...new Set(base.map((f) => f.op).filter(Boolean))],
      projects: [...accessible],
      projectLabels: Object.fromEntries([...accessible].map((id) => [id, projectOf(id)?.name ?? id])),
      summary: summarizeFindings(base),
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
      finding: presentFinding(f, ctx.actor),
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

/* ───────────── Evidence inspector reads (ticket 33) ───────────── */

/** Filter state for the standalone evidence list (all optional; empty = unfiltered). */
export interface EvidenceListQuery {
  /** Case-insensitive substring over the opaque ref, type and source (and the name only where it is not withheld). */
  q?: string
  /** Exact content-type filter. */
  kind?: string
}

/** One standalone evidence list read: masked rows + the type-filter options. */
export interface EvidenceListRead {
  items: EvidenceView[]
  /** Distinct content types in the scoped base (the type filter's options). */
  kinds: string[]
}

/**
 * Producer lineage behind a capture (GLOSSARY: producer lineage), resolved
 * from real record links — the capture's operation id, the step that carries
 * the reference and the tool event that recorded it. The console never
 * parses a reference or the display source string to guess at a producer.
 */
export interface EvidenceProducer {
  /** Producing invocation identity (the recorded tool event), when one exists. */
  invocation?: { id: string; tool: string; producer: string }
  operation?: { id: string; name: string }
  step?: { id: string; name: string; agent: string; asset: string; technique: string }
  agent?: { id: string; host: string }
  /** Interactive session the producing agent operated through. */
  session?: { id: string }
}

/**
 * One standalone evidence detail read: the masked view, producer links and
 * the simulated capture integrity. Display gates are handler decisions, so
 * they hold no matter which screen linked the capture.
 */
export interface EvidenceDetailRead {
  evidence: EvidenceView
  project: { id: string; name: string; client: string }
  /** Simulated capture integrity (GLOSSARY): describes the retained capture, never the truth of a finding. */
  integrity: CaptureIntegrity
  producer?: EvidenceProducer
  /** Findings referencing this capture (same project), with the link's recorded instant. */
  findings: { id: string; status: FindingStatus; updated: string }[]
  canViewSensitive: boolean
  /** The simulated unmasked view additionally needs a role above Analyst. */
  canViewOriginal: boolean
}

/** Simulated digest for the demo dataset (no real bytes are stored): a deterministic projection of the capture's identity. */
function simulatedDigest(id: string): string {
  let h = 2166136261
  const out: string[] = []
  for (let i = 0; i < 8; i++) {
    for (const c of id + i) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
    out.push((h >>> 0).toString(16).padStart(8, '0'))
  }
  return out.join('')
}

/**
 * Pure standalone evidence list. Scope semantics mirror the findings list:
 * a specific project reads only that project's captures and only for
 * members (a non-member's read is `not-found`, no existence leak); `'all'`
 * folds in only the actor's accessible projects. Masking is the handler's
 * decision — a capture is masked (name withheld, reference visible) for
 * roles without `viewSensitive` in its own project, and a masked row's
 * search haystack excludes the withheld name so a query cannot unmask it.
 */
export function listEvidence(db: Db, ctx: RequestContext, query: EvidenceListQuery = {}): ServiceResult<EvidenceListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === ctx.projectId)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Evidence for this project is not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = db.evidence.filter((e) => (aggregate ? accessible.has(e.projectId) : e.projectId === ctx.projectId))
  const q = (query.q || '').toLowerCase()
  const items = base
    .map((rec) => {
      const project = db.projects.find((p) => p.id === rec.projectId)
      const masked = rec.sensitive && !(project && policyCan(ctx.actor, 'viewSensitive', project))
      const hay = (masked ? `${rec.id} ${rec.kind} ${rec.source}` : `${rec.id} ${rec.name} ${rec.source}`).toLowerCase()
      return { rec, masked, hay }
    })
    .filter((x) => (!q || x.hay.includes(q)) && (!query.kind || x.rec.kind === query.kind))
    .map(({ rec, masked }) => ({ ref: rec.id, captureId: rec.captureId, name: masked ? undefined : rec.name, masked, kind: rec.kind, source: rec.source, at: rec.at, by: rec.by, projectId: rec.projectId, findingId: rec.findingId, opId: rec.opId, sensitive: rec.sensitive, classification: rec.classification ?? (rec.sensitive ? 'sensitive' : 'standard'), classificationVersion: rec.classificationVersion ?? 1, canClassify: !!db.projects.find((project) => project.id === rec.projectId && policyCan(ctx.actor, 'reviewFinding', project)), canViewOriginal: !rec.sensitive || !!db.projects.find((project) => project.id === rec.projectId && policyCan(ctx.actor, 'viewSensitive', project)) }))
  return { ok: true, data: { items, kinds: [...new Set(base.map((e) => e.kind))].sort() } }
}

/**
 * Pure standalone evidence detail (both route aliases). Refusal order
 * mirrors the finding detail: missing/out-of-scope → `not-found` without a
 * content leak; an accessible project outside the active context →
 * `forbidden` with the owning project on the entity ref (the screen offers
 * an explicit switch). Masking and the display/download gates are handler
 * decisions; producer links resolve from real record links, never by
 * parsing the source string.
 */
export function getEvidence(db: Db, ctx: RequestContext, id: string): ServiceResult<EvidenceDetailRead> {
  const notFound = { ok: false as const, failure: { kind: 'not-found' as const, message: `Evidence ${id} does not exist or is not available for your account.`, entity: { kind: 'evidence' as const, id } } }
  const rec = db.evidence.find((e) => e.id === id)
  if (!rec) return notFound
  const project = db.projects.find((p) => p.id === rec.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return notFound
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  if (!aggregate && ctx.projectId !== rec.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Evidence ${id} belongs to project ${rec.projectId}. Switch to that project to view its content.`,
        entity: { kind: 'evidence', id, projectId: rec.projectId },
      },
    }
  }
  const canSensitive = policyCan(ctx.actor, 'viewSensitive', project)
  const masked = rec.sensitive && !canSensitive
  const op = db.operations.find((o) => o.id === rec.opId)
  const event = db.toolEvents.find((t) => t.evidence?.includes(rec.id))
  // Direct step link first, else the producing invocation's recorded step.
  const step = op?.steps.find((x) => x.evidence === rec.id) || op?.steps.find((x) => x.id === event?.stepId)
  const agent = db.agents.find((a) => a.id === (step?.agent || event?.agentId))
  const session = op && agent ? db.sessions.find((x) => x.opId === op.id && x.agentId === agent.id) : undefined
  const findings = db.findings
    .filter((f) => f.projectId === rec.projectId && (f.id === rec.findingId || f.evidence.includes(rec.id)))
    .map((f) => ({ id: f.id, status: f.status, updated: f.updated }))
  return {
    ok: true,
    data: {
      evidence: { ref: rec.id, name: masked ? undefined : rec.name, masked, kind: rec.kind, source: rec.source, at: rec.at, by: rec.by, projectId: rec.projectId, findingId: rec.findingId, opId: rec.opId, sensitive: rec.sensitive, classification: rec.classification ?? (rec.sensitive ? 'sensitive' : 'standard'), classificationVersion: rec.classificationVersion ?? 1, canClassify: policyCan(ctx.actor, 'reviewFinding', project), canViewOriginal: !rec.sensitive || canSensitive },
      project: { id: project.id, name: project.name, client: project.client },
      integrity: { status: 'verified', digest: simulatedDigest(rec.id) },
      producer: (op || event) ? {
        invocation: event ? { id: event.id, tool: event.tool, producer: event.agentId || '—' } : undefined,
        operation: op ? { id: op.id, name: op.name } : undefined,
        step: step ? { id: step.id, name: step.name, agent: step.agent, asset: step.asset, technique: step.technique } : undefined,
        agent: agent ? { id: agent.id, host: agent.host } : undefined,
        session: session ? { id: session.id } : undefined,
      } : undefined,
      findings,
      canViewSensitive: canSensitive,
      canViewOriginal: canSensitive && ctx.actor.role !== 'analyst',
    },
  }
}

/* ───────────── Write side (ticket 32) ───────────── */

/** Validated payload for creating a finding or saving an edit from the finding form. */
export interface FindingSaveInput {
  expectedVersion?: number
  references?: { assetId: string | null; bindingId: string | null; threadId: string | null; runId: string | null; techniqueId: string | null }
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
  /** Reproduction package: omit to keep the recorded one, `null` to remove it, an object to set it. */
  reproduction?: import('@raptix/web-contracts').FindingReproductionInput | null
  /** Submit for review instead of keeping the finding at its current stage. */
  submit?: boolean
}

/** The mock records metadata; real mode requires original bytes and a supported media type. */
export interface WorkspaceEvidenceImport { files: number; skipped: { path: string; reason: string }[] }
export interface EvidenceUploadInput { findingId: string; name: string; kind: string; source: string; sensitive: boolean; opId?: string; bytes?: Uint8Array; mediaType?: string; requestId?: string }

/** One retest observation; result "Resolved" closes the finding. */
export interface RetestInput { result: string; note: string; requestId?: string; expectedVersion?: number; captureIds?: string[] }

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
  retest: { remediation: ['createFinding', 'reviewFinding'] },
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
/** Demo packages hold the operator's text only: demo data has no retained capture to link. */
function demoReproduction(input: import('@raptix/web-contracts').FindingReproductionInput): import('@raptix/web-contracts').FindingReproduction {
  return { prerequisites: input.prerequisites, inputs: input.inputs, steps: input.steps, expectedObservation: input.expectedObservation, limitations: input.limitations, artifact: null, verification: 'not_recorded' }
}

function saveValidationFailure(db: Db, input: FindingSaveInput, projectId: string, submit: boolean): ServiceFailure | undefined {
  if (input.reproduction?.artifact) return { kind: 'validation', message: 'Demo data has no retained captures to link. Link a capture in a real engagement.' }
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
        id: newId, projectId: project.id, title: input.title.trim(), severity: input.severity, status: input.submit ? 'review' : 'draft', version: 1,
        asset: input.asset, op: input.op || '', technique: input.technique || '', owner: input.owner, date: at, updated: at,
        desc: input.desc, impact: input.impact, rec: input.rec, severityRationale: input.severityReason?.trim() || '', scopeNote: input.scopeNote || '', references: input.references, evidence: [...input.evidence],
        comments: input.severityReason?.trim() ? [{ by: ctx.actor.id, at, text: `Severity rationale (${input.severity}): ${input.severityReason.trim()}` }] : [],
        history: [{ at, by: ctx.actor.id, text: 'Draft created' }, ...(input.submit ? [{ at, by: ctx.actor.id, text: 'Submitted for review' }] : [])],
        retests: [],
        ...(input.reproduction ? { reproduction: demoReproduction(input.reproduction) } : {}),
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
  if (input.expectedVersion !== undefined && input.expectedVersion !== (finding.version ?? 1)) return { ok: false, failure: { kind: 'conflict', message: 'The finding changed while this form was open. Reload and reapply.' } }
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
      severityRationale: input.severityReason?.trim() || '', scopeNote: input.scopeNote || '', references: input.references ?? finding.references,
      asset: input.asset, technique: input.technique || '', owner: input.owner, op: input.op || '', evidence: [...input.evidence], updated: at,
      ...(input.reproduction === undefined ? {} : { reproduction: input.reproduction === null ? undefined : demoReproduction(input.reproduction) }),
      version: (f.version ?? 1) + 1,
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
export function transitionFinding(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, to: FindingTransitionTarget, note?: string, expectedVersion?: number): ServiceResult<Finding> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, id)
  if (!t.ok) return t
  const { finding, project } = t
  if (expectedVersion !== undefined && expectedVersion !== (finding.version ?? 1)) return { ok: false, failure: { kind: 'conflict', message: 'The finding changed before this decision. Reload and retry.' } }
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
    f.version = (f.version ?? 1) + 1
    f.history.push({ at, by: ctx.actor.id, text: HISTORY_TEXT[to] + (note?.trim() ? `: ${note.trim()}` : ''), version: f.version })
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
    f.version = (f.version ?? 1) + 1
    f.history.push({ at, by: ctx.actor.id, text: 'Evidence attached', version: f.version, evidenceRefs: [evidenceId] })
    const rec = d.evidence.find((x) => x.id === evidenceId)
    if (rec) rec.findingId = findingId
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === findingId)! }
}

/** Demo classification mutates only the simulated sensitivity label; it does not create original capture bytes. */
export function classifyFindingEvidence(authority: DbAuthority, clock: Clock, ctx: RequestContext, evidenceId: string, classification: 'standard' | 'sensitive', expectedVersion: number, reason: string): ServiceResult<EvidenceView> {
  const db = authority.snapshot()
  const rec = db.evidence.find((e) => e.id === evidenceId)
  if (!rec) return { ok: false, failure: { kind: 'not-found', message: 'Evidence is not available for this project.' } }
  const project = db.projects.find((p) => p.id === rec.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return { ok: false, failure: { kind: 'not-found', message: 'Evidence is not available for this project.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== rec.projectId) return { ok: false, failure: { kind: 'forbidden', message: 'Evidence belongs to another project.' } }
  if (!policyCan(ctx.actor, 'reviewFinding', project)) return { ok: false, failure: { kind: 'forbidden', message: 'Capture classification requires an owner or reviewer.' } }
  if (!reason.trim()) return { ok: false, failure: { kind: 'validation', message: 'A classification reason is required.' } }
  const currentVersion = rec.classificationVersion ?? 1
  if (currentVersion !== expectedVersion) return { ok: false, failure: { kind: 'conflict', message: 'The capture classification changed; reload before deciding.' } }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const current = d.evidence.find((e) => e.id === evidenceId)!
    current.sensitive = classification === 'sensitive'
    current.classification = classification
    current.classificationVersion = currentVersion + 1
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Classified evidence', obj: evidenceId, projectId: rec.projectId, result: 'Success', reason: reason.trim() })
  })
  const updated = authority.snapshot().evidence.find((e) => e.id === evidenceId)!
  const canViewSensitive = policyCan(ctx.actor, 'viewSensitive', project)
  return { ok: true, data: { ref: updated.id, name: updated.sensitive && !canViewSensitive ? undefined : updated.name, masked: updated.sensitive && !canViewSensitive, kind: updated.kind, source: updated.source, at: updated.at, by: updated.by, projectId: updated.projectId, findingId: updated.findingId, opId: updated.opId, sensitive: updated.sensitive, classification, classificationVersion: updated.classificationVersion, canClassify: true, canViewOriginal: !updated.sensitive || canViewSensitive } }
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
    d.evidence.push({ id, captureId: id, name: input.name.trim(), kind: input.kind, source: input.source, at, by: ctx.actor.id, projectId: finding.projectId, opId: input.opId, findingId: finding.id, sensitive: input.sensitive, classification: input.sensitive ? 'sensitive' : 'standard', classificationVersion: 1 })
    const f = d.findings.find((x) => x.id === finding.id)!
    if (!f.evidence.includes(id)) f.evidence.push(id)
    f.updated = at
    f.version = (f.version ?? 1) + 1
    f.history.push({ at, by: ctx.actor.id, text: 'Evidence uploaded', version: f.version, evidenceRefs: [id] })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Uploaded evidence', obj: id, projectId: finding.projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().evidence.find((x) => x.id === id)! }
}

/** Records one retest with its outcome; a failed result keeps remediation active. */
export function recordFindingRetest(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: RetestInput): ServiceResult<Finding> {
  const db = authority.snapshot()
  const t = writableFinding(db, ctx, id)
  if (!t.ok) return t
  const { finding, project } = t
  const denied = roleDenied(ctx, project, ['createFinding', 'reviewFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot record retests.`)
  if (denied) return { ok: false, failure: denied }
  const existing = input.requestId ? finding.retests.find((retest) => retest.requestId === input.requestId) : undefined
  if (existing) {
    if (existing.result !== input.result || existing.note !== input.note.trim()) return { ok: false, failure: { kind: 'conflict', message: 'The retest request ID was already used for different content.' } }
    return { ok: true, data: finding }
  }
  if (!input.note.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter notes about the retest.' } }
  if (input.expectedVersion !== undefined && input.expectedVersion !== (finding.version ?? 1)) return { ok: false, failure: { kind: 'conflict', message: 'The finding changed before the retest was recorded.' } }
  const captureIds = input.captureIds ?? []
  const retestEvidence = captureIds.map((captureId) => db.evidence.find((evidence) => evidence.captureId === captureId && evidence.projectId === project.id))
  if (retestEvidence.some((evidence) => !evidence || !['standard', 'sensitive'].includes(evidence.classification ?? '') || evidence.sensitive && !policyCan(ctx.actor, 'viewSensitive', project))) return { ok: false, failure: { kind: 'forbidden', message: 'Retest evidence must be a retained capture authorized in this project.' } }
  if (!['confirmed', 'remediation', 'retest'].includes(finding.status)) {
    return { ok: false, failure: { kind: 'conflict', message: `Retest is only available after the finding has been confirmed — ${id} is ${STATUS_TEXT[finding.status]}.`, entity: findingRef(finding) } }
  }
  if (input.result === 'Resolved' && (finding.status !== 'retest' || captureIds.length === 0)) return { ok: false, failure: { kind: 'conflict', message: 'Resolution requires the retest stage and at least one classified retained capture.' } }
  const at = stampOf(clock)
  const resolved = input.result === 'Resolved'
  const backToRemediation = !resolved && finding.status !== 'remediation'
  authority.commit(ctx.corr, (d) => {
    const f = d.findings.find((x) => x.id === id)!
    f.version = (f.version ?? 1) + 1
    f.retests.push({ at, by: ctx.actor.id, result: input.result, note: input.note.trim(), requestId: input.requestId, version: f.version, evidenceRefs: [...captureIds] })
    f.history.push({ at, by: ctx.actor.id, text: `Retest: ${input.result}`, version: f.version, evidenceRefs: [...captureIds] })
    if (resolved) f.status = 'resolved'
    else if (backToRemediation) { f.status = 'remediation'; f.history.push({ at, by: ctx.actor.id, text: `Sent to remediation: Retest not passed (${input.result}): ${input.note.trim()}` }) }
    f.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Retested', obj: id, projectId: f.projectId, result: 'Success', reason: input.note.trim() })
  })
  return { ok: true, data: authority.snapshot().findings.find((x) => x.id === id)! }
}

/**
 * Mock suggestion disposition, with the server's policy. Each acting user has
 * their own state on the finding, and no comment is shared. A change needs the
 * create gate, a dismissal needs a reason, and a stale expectedVersion is a
 * conflict. A repeated state is a replay that writes nothing. Each change writes
 * one audit row stamped by the injected clock.
 */
export function setFindingSuggestionDisposition(authority: DbAuthority, clock: Clock, ctx: RequestContext, findingId: string, input: { producerRef: string; dismissed: boolean; reason: string; expectedVersion: number }): ServiceResult<FindingSuggestionDisposition> {
  const found = writableFinding(authority.snapshot(), ctx, findingId)
  if (!found.ok) return found
  const { finding, project } = found
  const denied = roleDenied(ctx, project, ['createFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot dismiss or restore AI suggestions.`)
  if (denied) return { ok: false, failure: denied }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return { ok: false, failure: { kind: 'validation', message: 'expectedVersion is required (0 for an unseen suggestion).' } }
  const reason = input.reason.trim()
  if (input.dismissed && (reason === '' || reason.length > 4000)) return { ok: false, failure: { kind: 'validation', message: 'Dismissal requires a reason (1-4000 characters).' } }
  const stored = dispositionOf(finding, ctx.actor)
  const storedReason = input.dismissed ? reason : null
  if (stored && stored.dismissed === input.dismissed && stored.reason === storedReason) return { ok: true, data: { producerRef: input.producerRef, dismissed: stored.dismissed, reason: stored.reason, version: stored.version } }
  const current = stored?.version ?? 0
  if (input.expectedVersion !== current) return { ok: false, failure: { kind: 'conflict', message: 'The suggestion disposition changed. Reload and retry.' } }
  const at = formatDemoInstant(clock.now())
  const version = current + 1
  authority.commit(ctx.corr, (d) => {
    const row = d.findings.find((x) => x.id === findingId)!
    row.suggestionDispositions = { ...row.suggestionDispositions, [ctx.actor.id]: { dismissed: input.dismissed, reason: storedReason, version } }
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], projectId: finding.projectId, action: input.dismissed ? 'Dismissed AI suggestion' : 'Restored AI suggestion', obj: findingId, result: 'Success', reason: storedReason ?? '' })
  })
  return { ok: true, data: { producerRef: input.producerRef, dismissed: input.dismissed, reason: storedReason, version } }
}

/** Review-log entry for opening an original capture, stamped by the injected clock. */
export function recordOriginalView(authority: DbAuthority, clock: Clock, ctx: RequestContext, evidence: { ref: string; projectId: string }): ServiceResult<void> {
  const detail = getEvidence(authority.snapshot(), ctx, evidence.ref)
  if (!detail.ok) return detail
  if (detail.data.evidence.projectId !== evidence.projectId) return { ok: false, failure: { kind: 'not-found', message: 'Evidence is not part of this project.' } }
  if (!detail.data.canViewOriginal) return { ok: false, failure: { kind: 'forbidden', message: 'Your role cannot view the original evidence.' } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], projectId: evidence.projectId, action: 'Viewed original evidence', obj: evidence.ref, result: 'Success', reason: '' })
  })
  return { ok: true, data: undefined }
}

export function addFindingComment(
  authority: DbAuthority,
  clock: Clock,
  ctx: RequestContext,
  id: string,
  text: string,
  expectedVersion: number,
  requestId: string,
): ServiceResult<Finding> {
  const found = writableFinding(authority.snapshot(), ctx, id)
  if (!found.ok) return found
  const { finding, project } = found
  const denied = roleDenied(ctx, project, ['createFinding', 'reviewFinding'], `The ${ROLE_TEXT[ctx.actor.role]} role cannot comment on findings.`)
  if (denied) return { ok: false, failure: denied }
  const comment = text.trim()
  if (!comment || comment.length > 4000) return { ok: false, failure: { kind: 'validation', message: 'A comment (1-4000 characters) is required.' } }
  if (!requestId.trim() || requestId.length > 128) return { ok: false, failure: { kind: 'validation', message: 'A valid comment request ID is required.' } }
  if (finding.status === 'resolved') return { ok: false, failure: { kind: 'conflict', message: 'Resolved findings are immutable and cannot receive new comments.' } }
  const existing = finding.comments.find((item) => item.requestId === requestId)
  if (existing) {
    if (existing.text !== comment) return { ok: false, failure: { kind: 'conflict', message: 'The comment request ID was already used for different content.' } }
    return { ok: true, data: finding }
  }
  const currentVersion = finding.version ?? 1
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== currentVersion) return { ok: false, failure: { kind: 'conflict', message: `The finding moved to version ${currentVersion}; reload before commenting.` } }
  const at = stampOf(clock)
  const version = currentVersion + 1
  authority.commit(ctx.corr, (d) => {
    const current = d.findings.find((item) => item.id === id)!
    current.version = version
    current.updated = at
    current.comments.push({ id: `comment-${requestId}`, requestId, version, by: ctx.actor.id, at, text: comment })
    current.history.push({ at, by: ctx.actor.id, text: 'Comment added', version })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Commented on finding', obj: id, projectId: project.id, result: 'Success', reason: '' })
  })
  return { ok: true, data: authority.snapshot().findings.find((item) => item.id === id)! }
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
    transition: (ctx, id, to, note, expectedVersion) => Promise.resolve(transitionFinding(authority, clock, ctx, id, to, note, expectedVersion)),
    referenceOptions: (ctx) => guard(() => {
      const db = authority.snapshot()
      const project = db.projects.find((item) => item.id === ctx.projectId && projectAccessible(item, ctx.actor))
      if (!project) return { ok: false, failure: { kind: 'not-found', message: 'Finding reference options are not available for this project.' } }
      return { ok: true, data: { engagementId: project.id, assets: db.assets.filter((asset) => asset.projectId === project.id).map((asset) => ({ id: asset.id, label: asset.name })), executions: [], techniqueAvailable: true, truncated: false } }
    }),
    loadActivity: async (ctx, id, kind, _cursor, version) => {
      const detail = getFinding(authority.snapshot(), ctx, id)
      if (!detail.ok) return detail
      if (version > (detail.data.finding.version ?? 1)) return { ok: false, failure: { kind: 'conflict', message: 'The finding version moved forward; reload its activity.' } }
      return { ok: true, data: { engagementId: detail.data.finding.projectId, findingId: id, kind, version, items: [], nextCursor: null } }
    },
    setSuggestionDisposition: (ctx, findingId, input) => Promise.resolve(setFindingSuggestionDisposition(authority, clock, ctx, findingId, input)),
    recordOriginalView: (ctx, evidence) => Promise.resolve(recordOriginalView(authority, clock, ctx, evidence)),
    addComment: (ctx, id, text, expectedVersion, requestId) => Promise.resolve(addFindingComment(authority, clock, ctx, id, text, expectedVersion, requestId)),
    importSuggestion: (ctx, id) => Promise.resolve(transitionFinding(authority, clock, ctx, id, 'draft')),
    attachEvidence: (ctx, findingId, evidenceId) => Promise.resolve(attachFindingEvidence(authority, clock, ctx, findingId, evidenceId)),
    classifyCapture: (ctx, captureId, classification, expectedVersion, reason) => Promise.resolve(classifyFindingEvidence(authority, clock, ctx, captureId, classification, expectedVersion, reason)),
    downloadEvidence: async () => ({ ok: false, failure: { kind: 'unavailable', message: 'The mock evidence store does not contain original capture bytes.' } }),
    readArtifact: async () => ({ ok: false, failure: { kind: 'unavailable', message: 'Demo data has no retained capture bytes to read.' } }),
    reproductionCaptures: async () => ({ ok: true, data: [] }),
    uploadEvidence: (ctx, input) => Promise.resolve(uploadFindingEvidence(authority, clock, ctx, input)),
    importWorkspaceEvidence: async () => ({ ok: false, failure: { kind: 'unavailable', message: 'The mock evidence store has no workspace files to import.' } }),
    recordRetest: (ctx, id, input) => Promise.resolve(recordFindingRetest(authority, clock, ctx, id, input)),
    listEvidence: (ctx, query) => guard(() => listEvidence(authority.snapshot(), ctx, query)),
    getEvidence: (ctx, id) => guard(() => getEvidence(authority.snapshot(), ctx, id)),
  }
}
