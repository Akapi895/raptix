import type { Evidence, Finding, FindingStatus, Severity } from '../../domain/entities'
import type {
  EvidenceListRead, EvidenceDetailRead, EvidenceView,
  FindingActivityPage, FindingCategory, FindingDetailRead, FindingListQuery, FindingListRead, FindingReferenceOptions, FindingSaveInput,
  FindingService, FindingSort, FindingSuggestionDisposition, FindingTransitionTarget, WorkspaceEvidenceImport,
} from './'
import { addCuratedFindingComment, attachEvidence as attachEvidenceApi, classifyCapture as classifyCaptureApi, createCuratedFinding, downloadCapture, fetchAccessibleFindings, fetchCuratedFindings, fetchFindings, fetchFindingActivity, fetchFindingReferenceOptions, fetchFindingSuggestionDispositions, fetchRetainedCaptures, importCuratedFinding, importWorkspaceEvidence, recordCuratedFindingRetest, setFindingSuggestionDisposition as setSuggestionDispositionApi, transitionCuratedFinding, updateCuratedFinding, uploadCapture } from './api';
import { getEngagement } from '../projects/remote';
import type { AccessibleFindingRow, CuratedFindingsView, CuratedFindingView } from '@raptix/web-contracts';
import type { FindingView } from '@raptix/web-contracts'
import type { ServiceResult } from '../../domain/service'
import { summarizeFindings } from './service'
import { ApiTransportError } from '../../platform/transport'
import { displayTime, guarded, instant } from '../../platform/adapter-shared'
import { unavailable, unsupportedControl } from '../../platform/adapter-stub'

const PAGE_SIZE = 10
const SEVERITY_FROM_API: Readonly<Record<string, Severity>> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', informational: 'info' }
const SEVERITY_TO_API: Readonly<Record<Severity, string>> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'informational' }
const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const CATEGORY_STATUSES: Readonly<Record<Exclude<FindingCategory, 'all'>, readonly FindingStatus[]>> = {
  confirmed: ['confirmed'], review: ['review'], ai: ['ai_suggested'], drafts: ['draft', 'returned'], remediation: ['remediation', 'retest', 'resolved'],
}
/** The server persists returned as a distinct reviewer decision. */
const TRANSITION_TO_API: Readonly<Record<FindingTransitionTarget, string>> = {
  draft: 'draft', review: 'review', confirmed: 'confirmed', returned: 'returned', remediation: 'remediation', retest: 'retest', resolved: 'resolved',
}

function historyText(event: NonNullable<CuratedFindingView['history']>[number]): string {
  const label: Readonly<Record<string, string>> = {
    created: 'Draft created', imported: 'Imported producer finding as a draft', review: 'Submitted for review',
    confirmed: 'Confirmed', returned: 'Returned for changes', remediation: 'Sent to remediation', retest: 'Retest recorded',
    resolved: 'Resolved', updated: 'Content updated', commented: 'Comment added', evidence_attached: 'Evidence attached',
    retested: 'Retest recorded',
  }
  const text = label[event.action] ?? event.action
  return event.reason ? `${text}: ${event.reason}` : text
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
    asset: view.references.assetId ?? '',
    op: view.references.runId ?? view.references.bindingId ?? view.references.threadId ?? '',
    technique: view.references.techniqueId ?? '',
    owner: view.createdBy,
    date: displayTime(view.createdAt ?? view.updatedAt),
    updated,
    desc: view.body.detail,
    impact: view.body.impact ?? '',
    rec: view.body.recommendation ?? '',
    severityRationale: view.body.severityRationale ?? '',
    scopeNote: view.body.scopeNote ?? '',
    evidence: view.evidence.map((item) => item.id),
    comments: (view.comments ?? []).map((item) => ({ id: item.id, version: item.findingVersion, by: item.actorId, at: displayTime(item.createdAt), text: item.text })),
    history: (view.history ?? []).map((item) => ({ id: item.id, version: item.version, evidenceRefs: item.evidenceRefs, at: displayTime(item.createdAt), by: item.actorId, text: historyText(item) })),
    retests: (view.retests ?? []).map((item) => ({ id: item.id, version: item.findingVersion, evidenceRefs: item.evidenceRefs, at: displayTime(item.createdAt), by: item.actorId, result: item.result, note: item.note })),
    version: view.expectedVersion,
    references: view.references,
    activityCursors: view.activityCursors,
    lastReviewDecision: view.lastReviewDecision,
    ...(view.sourceType === 'imported' && view.producerRef ? { producer: { path: view.producerRef, digest: view.producerDigest } } : {}),
    ...(view.body.reproduction ? { reproduction: view.body.reproduction } : {}),
  }
}

/** A producer claim stays an unverified AI suggestion until a human imports it as a draft. */
function toProducerFinding(view: FindingView, disposition?: FindingSuggestionDisposition): Finding {
  const updated = ''
  return {
    id: view.id,
    projectId: view.engagementId,
    title: view.title,
    severity: SEVERITY_FROM_API[view.severity] ?? 'info',
    status: 'ai_suggested',
    asset: view.affectedAssets.join(', '),
    op: '',
    technique: view.mitre?.join(', ') ?? '',
    owner: 'Runtime producer',
    date: updated,
    updated,
    desc: view.description,
    impact: '',
    rec: view.remediation ?? '',
    evidence: [],
    comments: [],
    history: [],
    retests: [],
    producer: { path: `findings/${view.id}.md`, sizeBytes: view.sizeBytes, quality: view.quality },
    suggestionDisposition: disposition ? { dismissed: disposition.dismissed, reason: disposition.reason, version: disposition.version } : undefined,
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

function buildList(findings: Finding[], query: FindingListQuery, dismissedCount = 0): FindingListRead {
  const needle = query.q?.trim().toLowerCase() ?? ''
  const base = findings.filter((f) =>
    (!needle || f.id.toLowerCase().includes(needle) || f.title.toLowerCase().includes(needle))
    && (!query.owner || f.owner === query.owner) && (!query.asset || f.asset === query.asset) && (!query.op || f.op === query.op))
  const severities = Object.keys(SEVERITY_RANK) as Severity[]
  const isHiddenDismissed = (finding: Finding) => finding.suggestionDisposition?.dismissed === true
  const filtered = base
    .filter((f) => matchesStatus(f, query.status ?? '') && (query.status !== 'ai' || query.showDismissed || !isHiddenDismissed(f)))
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
    ai: base.filter((f) => inCategory(f, 'ai') && (query.showDismissed || !isHiddenDismissed(f))).length,
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
    dismissedCount,
    owners: [...new Set(base.map((f) => f.owner).filter(Boolean))].sort(),
    assets: [...new Set(findings.map((finding) => finding.asset).filter(Boolean))],
    ops: [...new Set(findings.map((finding) => finding.op).filter(Boolean))],
    projects: [...new Set(findings.map((finding) => finding.projectId))],
    projectLabels: {},
    summary: summarizeFindings(findings),
  }
}

/** A curated finding in the cross-project list: the row fields only; the detail is read when the finding is opened. */
function toAccessibleFinding(row: AccessibleFindingRow): Finding {
  return {
    id: row.id, projectId: row.engagementId, title: row.title, severity: SEVERITY_FROM_API[row.severity] ?? 'info', status: row.status,
    asset: '', op: '', technique: row.techniqueId ?? '', owner: row.sourceType === 'producer' ? 'Runtime producer' : '',
    date: row.createdAt === null ? '' : displayTime(row.createdAt), updated: row.updatedAt === null ? '' : displayTime(row.updatedAt),
    desc: row.description ?? '', impact: '', rec: '', evidence: [], comments: [], history: [], retests: [],
  }
}

/** The all-projects list: curated findings of every project the actor can read, filtered and paged like a project list. */
async function listAccessible(query: FindingListQuery): Promise<ServiceResult<FindingListRead>> {
  const view = await fetchAccessibleFindings()
  const projects = new Map(view.findings.map((row) => [row.engagementId, row]))
  const read = buildList(view.findings.map(toAccessibleFinding), query)
  return {
    ok: true,
    data: {
      ...read,
      truncated: view.truncated,
      items: read.items.map((item) => {
        const row = view.findings.find((candidate) => candidate.id === item.finding.id)
        return { finding: item.finding, projectName: row?.projectName, target: row?.targetValue ?? null }
      }),
      projectLabels: Object.fromEntries([...projects.values()].map((row) => [row.engagementId, row.projectName])),
    },
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

function captureEvidence(capture: import('@raptix/web-contracts').RetainedCaptureView, engagementId: string, findingId?: string): EvidenceView {
  return {
    ref: capture.id,
    captureId: capture.id,
    name: capture.filename ?? undefined,
    masked: capture.filename === null,
    kind: capture.mediaType,
    source: capture.producer ?? '',
    at: displayTime(capture.createdAt),
    by: capture.uploadedBy,
    projectId: engagementId,
    findingId,
    sensitive: capture.classification === 'sensitive',
    digest: capture.digest,
    sizeBytes: capture.sizeBytes,
    classification: capture.classification,
    classificationVersion: capture.classificationVersion,
    mediaType: capture.mediaType,
    canClassify: capture.canClassify,
    canViewOriginal: capture.canReadOriginal,
  }
}

function mapCapture(capture: import('@raptix/web-contracts').RetainedCaptureView, engagementId: string): Evidence {
  return {
    id: capture.id,
    name: capture.filename ?? capture.id,
    kind: capture.mediaType,
    source: capture.producer ?? 'Web upload',
    at: displayTime(capture.createdAt),
    by: capture.uploadedBy,
    projectId: engagementId,
    sensitive: capture.classification === 'sensitive',
    captureId: capture.id,
    digest: capture.digest,
    sizeBytes: capture.sizeBytes,
    classification: capture.classification,
    classificationVersion: capture.classificationVersion,
    mediaType: capture.mediaType,
    canClassify: capture.canClassify,
    canViewOriginal: capture.canReadOriginal,
  }
}

/** Evidence links retain their own identity; retained captures supply classification and byte metadata. */
function evidenceRows(view: CuratedFindingsView, engagementId: string, captures: import('@raptix/web-contracts').RetainedCaptureView[]): EvidenceView[] {
  const byCaptureId = new Map(captures.map((capture) => [capture.id, capture]))
  return view.findings.flatMap((finding) => finding.evidence.map((row) => {
    const capture = row.captureId ? byCaptureId.get(row.captureId) : undefined
    return {
    ref: row.id,
    captureId: row.captureId ?? undefined,
    name: capture ? capture.filename ?? undefined : evidenceName(row),
    masked: capture ? capture.filename === null : false,
    kind: capture?.mediaType ?? row.kind,
    source: row.producer ?? '',
    at: displayTime(row.createdAt),
    by: '',
    projectId: engagementId,
    findingId: finding.id,
    sensitive: capture?.classification === 'sensitive',
    ...(capture ? {
      digest: capture.digest,
      sizeBytes: capture.sizeBytes,
      classification: capture.classification,
      classificationVersion: capture.classificationVersion,
      mediaType: capture.mediaType,
      canClassify: capture.canClassify,
      canViewOriginal: capture.canReadOriginal,
    } : {}),
  }
  }))
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Legacy display labels cannot stand in for owned reference identities. */
/** SHA-256 of the bytes as lowercase hex, the form the server records as a capture digest. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** UTF-8 text of the bytes, byte-preserving (the BOM is kept); null when they are not valid UTF-8, so Copy refuses rather than guesses. */
function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function unsupportedSaveField(input: FindingSaveInput): string | null {
  if (input.asset && !input.references?.assetId) return 'Select a managed asset identity before saving this asset link.'
  if (input.op && !input.references?.bindingId && !input.references?.runId && !input.references?.threadId) return 'Select an owned execution identity before saving this execution link.'
  if (input.technique && !input.references?.techniqueId) return 'Select a canonical technique identity before saving this technique link.'
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
      if (ctx.projectId === 'all') return listAccessible(query)
      if (!ctx.projectId) return unavailable<FindingListRead>('Select an engagement to read its curated findings.')
      const [curated, producer, dispositions] = await Promise.all([fetchCuratedFindings(ctx.projectId), fetchFindings(ctx.projectId), fetchFindingSuggestionDispositions(ctx.projectId)])
      versions.observe(curated.findings)
      const imported = new Set(curated.findings.filter((finding) => finding.sourceType === 'imported' && finding.producerRef).map((finding) => finding.producerRef!))
      const dispositionByPath = new Map(dispositions.dispositions.map((disposition) => [disposition.producerRef, disposition]))
      const producerClaims = producer.findings
        .filter((finding) => !imported.has(`findings/${finding.id}.md`))
        .map((finding) => toProducerFinding(finding, dispositionByPath.get(`findings/${finding.id}.md`)))
      return { ok: true, data: { ...buildList([...curated.findings.map((finding) => toFinding(finding, ctx.projectId)), ...producerClaims], query, dispositions.dispositions.filter((row) => row.dismissed).length), truncated: producer.truncated } }
    }),

    get: (ctx, id) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<FindingDetailRead>('Select an engagement to read finding details.')
      const [curated, captures, dispositions] = await Promise.all([fetchCuratedFindings(ctx.projectId), fetchRetainedCaptures(ctx.projectId), fetchFindingSuggestionDispositions(ctx.projectId)])
      const view = curated.findings.find((finding) => finding.id === id)
      const engagement = await getEngagement(ctx.projectId)
      if (!view) {
        const producer = (await fetchFindings(ctx.projectId)).findings.find((finding) => finding.id === id)
        if (!producer) return { ok: false, failure: { kind: 'not-found', message: `Finding ${id} was not found.` } }
        return {
          ok: true,
          data: {
            finding: toProducerFinding(producer, dispositions.dispositions.find((row) => row.producerRef === `findings/${producer.id}.md`)),
            evidence: [],
            project: { id: ctx.projectId, name: engagement.displayName, client: '' },
            inReports: [],
            canViewSensitive: false,
            producer: {
              path: `findings/${producer.id}.md`,
              evidence: producer.evidence,
              attackVector: producer.attackVector,
              quality: producer.quality,
              sizeBytes: producer.sizeBytes,
            },
          },
        }
      }
      versions.observe(view)
      const detail: FindingDetailRead = {
        finding: toFinding(view, ctx.projectId),
        evidence: evidenceRows({ ...curated, findings: [view] }, ctx.projectId, captures.captures),
        project: { id: ctx.projectId, name: engagement.displayName, client: '' },
        ...(view.references.assetId ? { assetId: view.references.assetId } : {}),
        inReports: [],
        canViewSensitive: false,
        ...(view.sourceType === 'imported' && view.producerRef ? {
          producer: { path: view.producerRef, resolved: view.producerResolved, digest: view.producerDigest },
        } : {}),
      }
      return { ok: true, data: detail }
    }),

    save: (ctx, id, input) => guarded(async () => {
      if (id === null && input.submit) return { ok: false, failure: { kind: 'validation', message: 'Save a draft, then attach evidence before submitting for review.' } }
      const gap = unsupportedSaveField(input)
      if (gap) return { ok: false, failure: { kind: 'validation', message: gap } }
      const expectedVersion = id === null ? undefined : input.expectedVersion ?? await versions.expected(ctx.projectId, id)
      const linked = id === null ? [] : (await readCurated(ctx.projectId, id)).evidence.map((item) => item.id)
      if (linked.length !== input.evidence.length || input.evidence.some((ref) => !linked.includes(ref))) return { ok: false, failure: { kind: 'validation', message: 'Evidence is linked from the Evidence tab, not the finding form. Save the draft without changing its evidence list.' } }
      const body = {
        title: input.title,
        severity: SEVERITY_TO_API[input.severity],
        detail: input.desc,
        impact: input.impact,
        recommendation: input.rec,
        severityRationale: input.severityReason,
        scopeNote: input.scopeNote,
        references: input.references,
        reproduction: input.reproduction,
      }
      const saved = id === null
        ? await createCuratedFinding(ctx.projectId, body)
        : await updateCuratedFinding(ctx.projectId, id, { ...body, expectedVersion: expectedVersion!, ...(input.submit ? { submit: true } : {}) })
      versions.observe(saved)
      return { ok: true, data: toFinding(saved, ctx.projectId) }
    }),

    transition: (ctx, id, to, note, expectedVersion) => guarded(async () => {
      const moved = await transitionCuratedFinding(ctx.projectId, id, TRANSITION_TO_API[to], expectedVersion ?? await versions.expected(ctx.projectId, id), note)
      versions.observe(moved)
      return { ok: true, data: toFinding(moved, ctx.projectId) }
    }),

    referenceOptions: (ctx) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<FindingReferenceOptions>('Select an engagement before loading finding reference options.')
      return { ok: true, data: await fetchFindingReferenceOptions(ctx.projectId) }
    }),

    loadActivity: (ctx, id, kind, cursor, version) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<FindingActivityPage>('Select an engagement before paging finding activity.')
      return { ok: true, data: await fetchFindingActivity(ctx.projectId, id, kind, cursor, version) }
    }),

    setSuggestionDisposition: (ctx, _findingId, input) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<FindingSuggestionDisposition>('Select an engagement before changing a suggestion disposition.')
      const disposition = await setSuggestionDispositionApi(ctx.projectId, input)
      return { ok: true, data: disposition.disposition }
    }),

    recordOriginalView: async () => ({ ok: true as const, data: undefined }),
    addComment: (ctx, id, text, expectedVersion, requestId) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Finding>('Select an engagement before commenting on a finding.')
      const updated = await addCuratedFindingComment(ctx.projectId, id, { text, expectedVersion, requestId })
      versions.observe(updated)
      return { ok: true, data: toFinding(updated, ctx.projectId) }
    }),

    importSuggestion: (ctx, id) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Finding>('Select an engagement before importing a producer finding.')
      const producer = (await fetchFindings(ctx.projectId)).findings.find((finding) => finding.id === id)
      if (!producer) return { ok: false, failure: { kind: 'not-found', message: `Producer finding ${id} is not available in this engagement.` } }
      const imported = await importCuratedFinding(ctx.projectId, {
        title: producer.title,
        severity: producer.severity,
        detail: producer.description,
        producerRef: `findings/${producer.id}.md`,
        ...(producer.remediation ? { recommendation: producer.remediation } : {}),
      })
      versions.observe(imported)
      return { ok: true, data: toFinding(imported, ctx.projectId) }
    }),
    attachEvidence: (ctx, findingId, evidenceId) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Finding>('Select an engagement before linking evidence.')
      const captures = await fetchRetainedCaptures(ctx.projectId)
      const capture = captures.captures.find((item) => item.id === evidenceId)
      if (!capture) return unavailable<Finding>('That capture is not in this engagement\'s retained evidence. Refresh the evidence list and try again.')
      // An unclassified capture can be linked; its original bytes stay locked on the server until an owner or reviewer classifies it.
      await attachEvidenceApi(ctx.projectId, findingId, { kind: 'artifact', captureId: capture.id, expectedVersion: await versions.expected(ctx.projectId, findingId) })
      const finding = await readCurated(ctx.projectId, findingId)
      versions.observe(finding)
      return { ok: true, data: toFinding(finding, ctx.projectId) }
    }),
    classifyCapture: (ctx, captureId, classification, expectedVersion, reason) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<EvidenceView>('Select an engagement to classify a capture.')
      const capture = await classifyCaptureApi(ctx.projectId, captureId, { classification, expectedVersion, reason })
      return { ok: true, data: captureEvidence(capture, ctx.projectId) }
    }),
    readArtifact: (ctx, artifact) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable('Select an engagement before reading an artifact.')
      // Refused here, before any request, with the reason the server would give: the server stays the gate.
      if (artifact.classification === null) return unavailable('This capture is no longer retained, so its original bytes cannot be read.')
      if (artifact.classification === 'unclassified') return unavailable('Classify this capture to read its original bytes.')
      if (!artifact.canReadOriginal) return unavailable('Your role cannot read the original bytes of this capture.')
      const original = await downloadCapture(ctx.projectId, artifact.captureId)
      if (await sha256Hex(original.bytes) !== artifact.digest) {
        return { ok: false, failure: { kind: 'conflict', message: 'The retained capture no longer matches the digest recorded in this reproduction. Nothing was copied or downloaded.' } }
      }
      return { ok: true, data: { captureId: artifact.captureId, filename: artifact.filename ?? artifact.captureId, bytes: original.bytes, text: decodeText(original.bytes) } }
    }),
    reproductionCaptures: (ctx) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable('Select a specific project before linking a capture.')
      const captures = await fetchRetainedCaptures(ctx.projectId)
      return { ok: true, data: captures.captures.map((capture) => ({ captureId: capture.id, filename: capture.filename, mediaType: capture.mediaType, digest: capture.digest, sizeBytes: capture.sizeBytes, classification: capture.classification, canReadOriginal: capture.canReadOriginal })) }
    }),
    downloadEvidence: (ctx, evidenceId) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable('Select an engagement before downloading evidence.')
      const [curated, captures] = await Promise.all([fetchCuratedFindings(ctx.projectId), fetchRetainedCaptures(ctx.projectId)])
      const link = curated.findings.flatMap((finding) => finding.evidence).find((item) => item.id === evidenceId)
      const captureId = captures.captures.find((item) => item.id === evidenceId)?.id ?? link?.captureId ?? null
      if (!captureId) return unsupportedControl('evidence.original')
      const capture = captures.captures.find((item) => item.id === captureId)
      if (!capture) return { ok: false, failure: { kind: 'not-found', message: 'The retained capture is not available in this engagement.' } }
      if (!capture.canReadOriginal) return { ok: false, failure: { kind: 'forbidden', message: 'The current classification does not permit this actor to read the original bytes.' } }
      const file = await downloadCapture(ctx.projectId, captureId)
      if (file.digest !== capture.digest || await sha256(file.bytes) !== capture.digest) return { ok: false, failure: { kind: 'conflict', message: 'Downloaded bytes do not match the retained capture digest.' } }
      return { ok: true, data: { bytes: file.bytes, filename: file.filename, mediaType: capture.mediaType, digest: capture.digest } }
    }),
    uploadEvidence: (ctx, input) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Evidence>('Select an engagement before uploading evidence.')
      if (!input.bytes || input.bytes.length === 0) return { ok: false, failure: { kind: 'validation', message: 'Select the original file bytes to upload.' } }
      if (input.sensitive) return { ok: false, failure: { kind: 'validation', message: 'Sensitivity is assigned by an owner or reviewer after upload.' } }
      const capture = await uploadCapture(ctx.projectId, {
        requestId: input.requestId ?? crypto.randomUUID(), filename: input.name,
        mediaType: input.mediaType ?? 'application/octet-stream', base64: bytesToBase64(input.bytes),
      })
      return { ok: true, data: mapCapture(capture, ctx.projectId) }
    }),
    importWorkspaceEvidence: (ctx) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<WorkspaceEvidenceImport>('Select an engagement before importing evidence.')
      const result = await importWorkspaceEvidence(ctx.projectId)
      return { ok: true, data: { files: result.captures.length, skipped: result.skipped } }
    }),
    recordRetest: (ctx, id, input) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<Finding>('Select an engagement before recording a retest.')
      const updated = await recordCuratedFindingRetest(ctx.projectId, id, { ...input, requestId: input.requestId ?? crypto.randomUUID(), expectedVersion: input.expectedVersion ?? await versions.expected(ctx.projectId, id) })
      versions.observe(updated)
      return { ok: true, data: toFinding(updated, ctx.projectId) }
    }),
    listEvidence: (ctx, query = {}) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<EvidenceListRead>('Select an engagement to read its evidence.')
      const [view, retained] = await Promise.all([fetchCuratedFindings(ctx.projectId), fetchRetainedCaptures(ctx.projectId)])
      const linked = evidenceRows(view, ctx.projectId, retained.captures)
      const linkedCaptureIds = new Set(linked.map((item) => item.captureId).filter((id): id is string => id !== undefined))
      const all = [...linked, ...retained.captures.filter((capture) => !linkedCaptureIds.has(capture.id)).map((capture) => captureEvidence(capture, ctx.projectId))]
      const needle = query.q?.trim().toLowerCase() ?? ''
      const items = all.filter((e) =>
        (!needle || [e.ref, e.name ?? '', e.kind, e.source].some((field) => field.toLowerCase().includes(needle)))
        && (!query.kind || e.kind === query.kind))
      return { ok: true, data: { items, kinds: [...new Set(all.map((e) => e.kind))].sort() } }
    }),

    getEvidence: (ctx, id) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return unavailable<EvidenceDetailRead>('Select an engagement to inspect evidence.')
      const [view, engagement, captures] = await Promise.all([fetchCuratedFindings(ctx.projectId), getEngagement(ctx.projectId), fetchRetainedCaptures(ctx.projectId)])
      const linked = evidenceRows(view, ctx.projectId, captures.captures)
      const evidence = linked.find((item) => item.ref === id || item.captureId === id) ?? (() => {
        const capture = captures.captures.find((item) => item.id === id)
        return capture ? captureEvidence(capture, ctx.projectId) : undefined
      })()
      if (!evidence) return { ok: false, failure: { kind: 'not-found', message: `ID ${id} does not exist or is not available for your account.` } }
      const capture = evidence.captureId ? captures.captures.find((item) => item.id === evidence.captureId) : undefined
      const detail: EvidenceDetailRead = {
        evidence,
        project: { id: ctx.projectId, name: engagement.displayName, client: '' },
        integrity: { status: 'unverified', ...(capture ? { digest: capture.digest } : {}) },
        findings: view.findings
          .filter((finding) => finding.evidence.some((row) => row.id === id || capture && row.captureId === capture.id))
          .map((f) => ({ id: f.id, status: f.status as FindingStatus, updated: displayTime(f.updatedAt) })),
        canViewSensitive: capture?.canReadOriginal ?? false,
        canViewOriginal: capture?.canReadOriginal ?? false,
      }
      return { ok: true, data: detail }
    }),
  }
}
