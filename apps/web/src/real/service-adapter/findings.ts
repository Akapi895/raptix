import type { Evidence, Finding, FindingStatus, Severity } from '../../domain/entities'
import type {
  EvidenceListRead, EvidenceDetailRead, EvidenceView,
  FindingCategory, FindingDetailRead, FindingListQuery, FindingListRead, FindingSaveInput,
  FindingService, FindingSort, FindingTransitionTarget,
} from '../../features/findings/service'
import {
  createCuratedFinding, fetchCuratedFindings, getEngagement, transitionCuratedFinding, updateCuratedFinding,
  type CuratedFindingsView, type CuratedFindingView,
} from '../api'
import { ApiTransportError } from '../transport'
import { displayTime, guarded, instant } from './shared'
import { REAL_CONTROL_GAPS } from './control-gaps'
import { unavailable, unsupportedControl } from './stub'

const PAGE_SIZE = 10
const SEVERITY_FROM_API: Readonly<Record<string, Severity>> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', informational: 'info' }
const SEVERITY_TO_API: Readonly<Record<Severity, string>> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'informational' }
const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const CATEGORY_STATUSES: Readonly<Record<Exclude<FindingCategory, 'all'>, readonly FindingStatus[]>> = {
  confirmed: ['confirmed'], review: ['review'], ai: ['ai_suggested'], drafts: ['draft', 'returned'], remediation: ['remediation', 'retest', 'resolved'],
}
/** The curated workflow's target set; `returned` maps to the review→draft transition. */
const TRANSITION_TO_API: Readonly<Record<FindingTransitionTarget, string>> = {
  draft: 'draft', review: 'review', confirmed: 'confirmed', returned: 'draft', remediation: 'remediation', retest: 'retest', resolved: 'resolved',
}

/** Maps the curated resource onto the console's Finding entity; fields the curated workflow lacks stay empty. */
function toFinding(view: CuratedFindingView, engagementId: string): Finding {
  const updated = displayTime(view.updatedAt)
  return {
    id: view.id,
    projectId: engagementId,
    title: view.title,
    severity: SEVERITY_FROM_API[view.severity] ?? 'info',
    status: view.status as FindingStatus,
    asset: '',
    op: '',
    technique: '',
    owner: view.createdBy,
    date: updated,
    updated,
    desc: view.body.detail,
    impact: '',
    rec: '',
    evidence: view.evidence.map((item) => item.id),
    comments: [],
    history: [],
    retests: [],
  }
}

function matchesStatus(finding: Finding, status: string): boolean {
  if (!status) return true
  if (status in CATEGORY_STATUSES) return CATEGORY_STATUSES[status as Exclude<FindingCategory, 'all'>].includes(finding.status)
  return finding.status === status
}

function inCategory(finding: Finding, category: Exclude<FindingCategory, 'all'>): boolean {
  return CATEGORY_STATUSES[category].includes(finding.status)
}

function compareFindings(a: Finding, b: Finding, sort: FindingSort | undefined): number {
  if (sort === 'severity') return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || instant(b.updated) - instant(a.updated)
  if (sort === 'id') return a.id.localeCompare(b.id)
  if (sort === 'created') return instant(b.date) - instant(a.date)
  return instant(b.updated) - instant(a.updated)
}

function buildList(findings: Finding[], query: FindingListQuery): FindingListRead {
  const needle = query.q?.trim().toLowerCase() ?? ''
  const base = findings.filter((f) =>
    (!needle || f.id.toLowerCase().includes(needle) || f.title.toLowerCase().includes(needle))
    && (!query.owner || f.owner === query.owner))
  const severities = Object.keys(SEVERITY_RANK) as Severity[]
  const filtered = base
    .filter((f) => matchesStatus(f, query.status ?? ''))
    .filter((f) => !query.severity || f.severity === query.severity)
    .sort((a, b) => compareFindings(a, b, query.sort))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
  const verified = base.filter((f) => f.status !== 'ai_suggested')
  const severity = Object.fromEntries(severities.map((s) => [s, verified.filter((f) => f.severity === s).length])) as Record<Severity, number>
  const counts = {
    all: base.length,
    confirmed: base.filter((f) => inCategory(f, 'confirmed')).length,
    review: base.filter((f) => inCategory(f, 'review')).length,
    ai: base.filter((f) => inCategory(f, 'ai')).length,
    drafts: base.filter((f) => inCategory(f, 'drafts')).length,
    remediation: base.filter((f) => inCategory(f, 'remediation')).length,
  } satisfies Record<FindingCategory, number>
  return {
    items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((finding) => ({ finding })),
    page,
    pageSize: PAGE_SIZE,
    total: filtered.length,
    counts,
    severity,
    awaitingReview: base.filter((f) => f.status === 'review').length,
    resolved: base.filter((f) => f.status === 'resolved').length,
    owners: [...new Set(base.map((f) => f.owner).filter(Boolean))].sort(),
    assets: [],
    ops: [],
    projects: [],
  }
}

async function readCurated(engagementId: string, id: string): Promise<CuratedFindingView> {
  const view = await fetchCuratedFindings(engagementId)
  const found = view.findings.find((f) => f.id === id)
  if (!found) throw new ApiTransportError(404, 'not_found', `Finding ${id} was not found.`)
  return found
}

/**
 * Last version each finding was read or written at, per adapter instance. Writes
 * use this version rather than re-reading, so an edit made against a stale view
 * is refused by the server (expectedVersion) instead of silently overwriting.
 */
function versionTracker() {
  const seen = new Map<string, number>()
  return {
    observe(view: CuratedFindingView | CuratedFindingView[]) {
      for (const item of Array.isArray(view) ? view : [view]) seen.set(item.id, item.expectedVersion)
    },
    async expected(engagementId: string, id: string): Promise<number> {
      const known = seen.get(id)
      if (known !== undefined) return known
      const fresh = await readCurated(engagementId, id)
      seen.set(id, fresh.expectedVersion)
      return fresh.expectedVersion
    },
  }
}

type CuratedEvidenceRow = CuratedFindingView['evidence'][number]

function evidenceName(row: CuratedEvidenceRow): string {
  if (row.artifactPath) return row.artifactPath.split('/').pop() ?? row.artifactPath
  return row.digest ? `digest ${row.digest.slice(0, 12)}` : row.id
}

/** Evidence rows linked into the engagement's curated findings; each row is one finding's reference. */
function evidenceRows(view: CuratedFindingsView, engagementId: string): EvidenceView[] {
  return view.findings.flatMap((finding) => finding.evidence.map((row) => ({
    ref: row.id,
    name: evidenceName(row),
    masked: false,
    kind: row.kind,
    source: row.producer ?? '',
    at: displayTime(row.createdAt),
    by: '',
    projectId: engagementId,
    findingId: finding.id,
    sensitive: false,
  })))
}

/** Unsupported unless the request carries no field the curated workflow would silently drop. */
function unsupportedSaveField(input: FindingSaveInput): string | null {
  if (input.severityReason) return 'finding.severityRationale'
  if (input.scopeNote) return 'finding.scopeNote'
  if (input.impact) return 'finding.impact'
  if (input.rec) return 'finding.recommendation'
  if (input.asset) return 'finding.assetLink'
  if (input.op) return 'finding.operationLink'
  if (input.technique) return 'finding.techniqueLink'
  if (input.evidence.length > 0) return 'finding.evidenceLink'
  return null
}

/**
 * Real FindingService over the curated-findings resource (ADR-0084). Reads are
 * per engagement (the aggregate scope has no client-side fan-out). Writes
 * carry the server's expectedVersion; a stale write surfaces as `conflict`.
 * Operations without a backend concept resolve to registered control gaps.
 */
export function createRealFindingService(): FindingService {
  const versions = versionTracker()
  return {
    list: (ctx, query = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<FindingListRead>('Select an engagement to read its curated findings.')
      const view = await fetchCuratedFindings(ctx.projectId)
      versions.observe(view.findings)
      return { ok: true, data: buildList(view.findings.map((f) => toFinding(f, ctx.projectId)), query) }
    }),

    get: (ctx, id) => guarded(async () => {
      const [view, engagement] = await Promise.all([readCurated(ctx.projectId, id), getEngagement(ctx.projectId)])
      versions.observe(view)
      const detail: FindingDetailRead = {
        finding: toFinding(view, ctx.projectId),
        evidence: view.evidence.map((item) => ({
          ref: item.id,
          name: item.artifactPath ?? undefined,
          masked: false,
          kind: item.kind,
          source: item.producer ?? '',
          at: displayTime(item.createdAt),
          by: '',
          projectId: ctx.projectId,
          findingId: view.id,
          sensitive: false,
        })),
        project: { id: ctx.projectId, name: engagement.displayName, client: '' },
        inReports: [],
        canViewSensitive: false,
      }
      return { ok: true, data: detail }
    }),

    save: (ctx, id, input) => guarded(async () => {
      const gap = unsupportedSaveField(input)
      if (gap) return { ok: false, failure: { kind: 'validation', message: REAL_CONTROL_GAPS[gap] } }
      const body = { title: input.title, severity: SEVERITY_TO_API[input.severity], detail: input.desc }
      const saved = id === null
        ? await createCuratedFinding(ctx.projectId, body)
        : await updateCuratedFinding(ctx.projectId, id, { ...body, expectedVersion: await versions.expected(ctx.projectId, id) })
      versions.observe(saved)
      const finalView = input.submit
        ? await transitionCuratedFinding(ctx.projectId, saved.id, 'review', saved.expectedVersion)
        : saved
      versions.observe(finalView)
      return { ok: true, data: toFinding(finalView, ctx.projectId) }
    }),

    transition: (ctx, id, to, note) => guarded(async () => {
      if (note) return { ok: false, failure: { kind: 'validation', message: REAL_CONTROL_GAPS['finding.transitionNote'] } }
      const moved = await transitionCuratedFinding(ctx.projectId, id, TRANSITION_TO_API[to], await versions.expected(ctx.projectId, id))
      versions.observe(moved)
      return { ok: true, data: toFinding(moved, ctx.projectId) }
    }),

    importSuggestion: () => unsupportedControl<Finding>('finding.aiSuggestion'),
    attachEvidence: () => unsupportedControl<Finding>('finding.evidenceLink'),
    uploadEvidence: () => unsupportedControl<Evidence>('finding.evidenceUpload'),
    recordRetest: () => unsupportedControl<Finding>('finding.retestRecord'),
    listEvidence: (ctx, query = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<EvidenceListRead>('Select an engagement to read its evidence.')
      const view = await fetchCuratedFindings(ctx.projectId)
      const all = evidenceRows(view, ctx.projectId)
      const needle = query.q?.trim().toLowerCase() ?? ''
      const items = all.filter((e) =>
        (!needle || [e.ref, e.name ?? '', e.kind, e.source].some((field) => field.toLowerCase().includes(needle)))
        && (!query.kind || e.kind === query.kind))
      return { ok: true, data: { items, kinds: [...new Set(all.map((e) => e.kind))].sort() } }
    }),

    getEvidence: (ctx, id) => guarded(async () => {
      const [view, engagement] = await Promise.all([fetchCuratedFindings(ctx.projectId), getEngagement(ctx.projectId)])
      const evidence = evidenceRows(view, ctx.projectId).find((e) => e.ref === id)
      if (!evidence) return { ok: false, failure: { kind: 'not-found', message: `ID ${id} does not exist or is not available for your account.` } }
      const detail: EvidenceDetailRead = {
        evidence,
        project: { id: ctx.projectId, name: engagement.displayName, client: '' },
        integrity: { status: 'unverified' },
        findings: view.findings
          .filter((f) => f.evidence.some((row) => row.id === id))
          .map((f) => ({ id: f.id, status: f.status as FindingStatus, updated: displayTime(f.updatedAt) })),
        canViewSensitive: false,
        canViewOriginal: false,
      }
      return { ok: true, data: detail }
    }),
  }
}
