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
 * the severity breakdown. Reads are pure projections — mutations stay with
 * the legacy actions until ticket 32 migrates them.
 */
import { projectAccessible, can as policyCan } from '../../auth/policy'
import { TECHNIQUES, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Finding, FindingStatus, Severity } from '../../domain/entities'
import type { EvidenceReference } from '../../domain/evidence'
import type { RequestContext, ServiceResult } from '../../domain/service'

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

/** Builds the typed findings service; `guard` is the factory's superseded-scope read guard. */
export function createFindingService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): FindingService {
  return {
    list: (ctx, query) => guard(() => listFindings(authority.snapshot(), ctx, query)),
    get: (ctx, id) => guard(() => getFinding(authority.snapshot(), ctx, id)),
  }
}
