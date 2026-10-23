/** Versioned curated-finding workflow records, references and bounded activity pages. */
export type FindingActivityKind = 'comments' | 'history' | 'retests'
export interface FindingReferences { assetId: string | null; bindingId: string | null; threadId: string | null; runId: string | null; techniqueId: string | null }
export interface FindingReferenceOptions {
  engagementId: string; assets: { id: string; label: string }[];
  executions: { threadId: string; runId: string | null; bindingId: string | null }[];
  techniqueAvailable: boolean; truncated: boolean;
}
export interface FindingActivityItem {
  id: string; actorId: string; createdAt: string; findingVersion: number; text: string; action: string;
  reason: string | null; fromStatus: string | null; toStatus: string | null;
  result: string | null; note: string | null; evidenceRefs: string[];
}
export interface FindingActivityPage { engagementId: string; findingId: string; kind: FindingActivityKind; version: number; items: FindingActivityItem[]; nextCursor: string | null }
export interface FindingSuggestionDisposition { producerRef: string; dismissed: boolean; reason: string | null; version: number }
export interface FindingSuggestionDispositionsView { engagementId: string; dispositions: FindingSuggestionDisposition[] }
export interface FindingSuggestionDispositionResult { engagementId: string; disposition: FindingSuggestionDisposition }
export interface FindingReviewDecision { action: 'confirmed' | 'returned'; actorId: string; createdAt: string; reason: string | null; version: number }
export interface FindingEvidenceLink {
  id: string; engagementId: string; captureId: string | null; kind: 'artifact' | 'digest';
  artifactPath: string | null; digest: string | null; producer: string | null; createdAt: string;
}
export interface FindingCommentRecord { id: string; actorId: string; createdAt: string; text: string; findingVersion: number }
export interface FindingHistoryRecord {
  id: string; actorId: string; createdAt: string; action: string; reason: string | null;
  fromStatus: string | null; toStatus: string | null; version: number; evidenceRefs: string[];
}
export interface FindingRetestRecord { id: string; actorId: string; createdAt: string; result: 'Resolved' | 'Persists' | 'Partial'; note: string; findingVersion: number; evidenceRefs: string[] }
/**
 * A retained capture that carries a finding's reproduction, identified by capture id and the digest recorded when it was linked.
 * Name, classification and read rights are resolved on every read against the capture's current state: `filename` is null when the
 * caller may not see it, `classification` is null when the capture is no longer retained, and `canReadOriginal` says whether the
 * original bytes can be read by this caller.
 */
export interface FindingReproductionArtifact {
  captureId: string
  filename: string | null
  mediaType: string
  digest: string
  sizeBytes: number
  classification: 'unclassified' | 'standard' | 'sensitive' | null
  canReadOriginal: boolean
}
/**
 * Reproduction package of a curated finding. A finding that predates the package carries no `reproduction` key;
 * callers render that as missing and never infer one from the description or the producer source.
 */
export interface FindingReproduction {
  prerequisites: string
  inputs: string
  steps: string[]
  expectedObservation: string
  limitations: string
  artifact: FindingReproductionArtifact | null
  /** Recorded verification. Only `not_recorded` exists until a re-run ships as a separate execution. */
  verification: 'not_recorded'
}
/** Write shape. The artifact is named by capture id and digest; the server resolves its name and size. */
export interface FindingReproductionInput {
  prerequisites: string
  inputs: string
  steps: string[]
  expectedObservation: string
  limitations: string
  artifact: { captureId: string; digest: string } | null
}
export interface CuratedFindingView {
  id: string; engagementId: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  status: 'draft' | 'review' | 'returned' | 'confirmed' | 'remediation' | 'retest' | 'resolved';
  body: { detail: string; impact?: string; recommendation?: string; severityRationale?: string; scopeNote?: string; reproduction?: FindingReproduction };
  expectedVersion: number; sourceType: 'authored' | 'imported'; producerRef: string | null; producerDigest: string | null;
  producerResolved?: boolean; createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string;
  evidence: FindingEvidenceLink[]; references: FindingReferences;
  activityCursors: Record<FindingActivityKind, string | null>; lastReviewDecision: FindingReviewDecision | null;
  comments: FindingCommentRecord[]; history: FindingHistoryRecord[]; retests: FindingRetestRecord[];
}
export interface CuratedFindingsView { engagementId: string; findings: CuratedFindingView[]; transitions: Readonly<Record<string, readonly string[]>>; source: 'db' }
/**
 * One finding in the cross-project list: the row fields and the project it belongs to, no activity or evidence. A
 * `producer` row is an unverified runtime claim (status `ai_suggested`) that no curated record imports; it has no
 * timestamps because the workspace file records none.
 */
export interface AccessibleFindingRow {
  id: string; engagementId: string; projectName: string; targetValue: string | null; title: string;
  severity: CuratedFindingView['severity']; status: CuratedFindingView['status'] | 'ai_suggested'; sourceType: 'authored' | 'imported' | 'producer';
  /** The finding's detail text, or null where the record has none. */
  description: string | null;
  techniqueId: string | null; createdAt: string | null; updatedAt: string | null;
}
/** Curated findings across every project the actor can read as a viewer; `truncated` means the row cap cut the list. */
export interface AccessibleFindingsView { findings: AccessibleFindingRow[]; truncated: boolean; source: 'db' }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256
const text = (value: unknown): value is string => typeof value === 'string'
const nullableText = (value: unknown): value is string | null => value === null || text(value)
const nullableId = (value: unknown): value is string | null => value === null || identity(value)
const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const timestamp = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))

export function isFindingReferences(value: unknown): value is FindingReferences {
  return record(value) && ['assetId', 'bindingId', 'threadId', 'runId', 'techniqueId'].every((key) => nullableId(value[key]))
    && (!(value.runId || value.bindingId) || identity(value.threadId))
}
export function isFindingReferenceOptions(value: unknown): value is FindingReferenceOptions {
  return record(value) && identity(value.engagementId) && typeof value.techniqueAvailable === 'boolean' && typeof value.truncated === 'boolean'
    && Array.isArray(value.assets) && value.assets.length <= 200 && value.assets.every((asset) => record(asset) && identity(asset.id) && text(asset.label))
    && Array.isArray(value.executions) && value.executions.length <= 600 && value.executions.every((execution) => record(execution) && identity(execution.threadId) && nullableId(execution.runId) && nullableId(execution.bindingId))
}
export function isFindingActivityItem(value: unknown): value is FindingActivityItem {
  return record(value) && identity(value.id) && identity(value.actorId) && timestamp(value.createdAt) && version(value.findingVersion)
    && text(value.text) && text(value.action) && nullableText(value.reason) && nullableText(value.fromStatus) && nullableText(value.toStatus)
    && (value.result === null || ['Resolved', 'Persists', 'Partial'].includes(String(value.result))) && nullableText(value.note)
    && Array.isArray(value.evidenceRefs) && value.evidenceRefs.length <= 20 && value.evidenceRefs.every(identity)
}
export function isFindingActivityPage(value: unknown): value is FindingActivityPage {
  return record(value) && identity(value.engagementId) && identity(value.findingId) && ['comments', 'history', 'retests'].includes(String(value.kind))
    && version(value.version) && nullableId(value.nextCursor) && Array.isArray(value.items) && value.items.length <= 100
    && value.items.every((item) => isFindingActivityItem(item) && item.findingVersion <= Number(value.version))
}
export function isFindingSuggestionDisposition(value: unknown): value is FindingSuggestionDisposition {
  return record(value) && text(value.producerRef) && value.producerRef.length <= 256 && /^findings\/[A-Za-z0-9._-]+\.md$/.test(value.producerRef)
    && typeof value.dismissed === 'boolean' && nullableText(value.reason) && version(value.version)
}
export function isFindingSuggestionDispositionsView(value: unknown): value is FindingSuggestionDispositionsView {
  return record(value) && identity(value.engagementId) && Array.isArray(value.dispositions) && value.dispositions.every(isFindingSuggestionDisposition)
}
export function isFindingSuggestionDispositionResult(value: unknown): value is FindingSuggestionDispositionResult {
  return record(value) && identity(value.engagementId) && isFindingSuggestionDisposition(value.disposition)
}
export function isFindingReviewDecision(value: unknown): value is FindingReviewDecision {
  return record(value) && ['confirmed', 'returned'].includes(String(value.action)) && identity(value.actorId) && timestamp(value.createdAt) && nullableText(value.reason) && version(value.version)
}
export function isFindingEvidenceLink(value: unknown): value is FindingEvidenceLink {
  return record(value) && identity(value.id) && identity(value.engagementId) && nullableId(value.captureId)
    && ['artifact', 'digest'].includes(String(value.kind)) && nullableText(value.artifactPath) && nullableText(value.digest)
    && nullableText(value.producer) && timestamp(value.createdAt)
}
export function isFindingReproduction(value: unknown): value is FindingReproduction {
  return record(value) && text(value.prerequisites) && text(value.inputs) && text(value.expectedObservation) && text(value.limitations)
    && Array.isArray(value.steps) && value.steps.every(text)
    && (value.artifact === null || (record(value.artifact) && text(value.artifact.captureId) && (value.artifact.filename === null || text(value.artifact.filename))
      && text(value.artifact.mediaType) && text(value.artifact.digest) && typeof value.artifact.sizeBytes === 'number'
      && [null, 'unclassified', 'standard', 'sensitive'].includes(value.artifact.classification as string | null)
      && typeof value.artifact.canReadOriginal === 'boolean'))
    && value.verification === 'not_recorded'
}

export function isCuratedFindingView(value: unknown): value is CuratedFindingView {
  if (!record(value) || !record(value.body) || !record(value.activityCursors)) return false
  const { activityCursors, expectedVersion } = value
  if (!version(expectedVersion)) return false
  const statuses = ['draft', 'review', 'returned', 'confirmed', 'remediation', 'retest', 'resolved']
  const body = value.body
  return identity(value.id) && identity(value.engagementId) && identity(value.title)
    && ['critical', 'high', 'medium', 'low', 'informational'].includes(String(value.severity)) && statuses.includes(String(value.status))
    && text(body.detail) && [body.impact, body.recommendation, body.severityRationale, body.scopeNote].every((field) => field === undefined || text(field))
    && (body.reproduction === undefined || isFindingReproduction(body.reproduction))
    && ['authored', 'imported'].includes(String(value.sourceType)) && nullableText(value.producerRef)
    && nullableText(value.producerDigest) && identity(value.createdBy) && nullableText(value.updatedBy) && timestamp(value.createdAt) && timestamp(value.updatedAt)
    && Array.isArray(value.evidence) && value.evidence.every(isFindingEvidenceLink)
    && isFindingReferences(value.references)
    && ['comments', 'history', 'retests'].every((key) => nullableId(activityCursors[key]))
    && (value.lastReviewDecision === null || isFindingReviewDecision(value.lastReviewDecision))
    && Array.isArray(value.comments) && value.comments.every((comment) => record(comment) && identity(comment.id) && identity(comment.actorId) && timestamp(comment.createdAt) && text(comment.text) && version(comment.findingVersion) && comment.findingVersion <= expectedVersion)
    && Array.isArray(value.history) && value.history.every((event) => record(event) && identity(event.id) && identity(event.actorId) && timestamp(event.createdAt) && text(event.action) && nullableText(event.reason) && nullableText(event.fromStatus) && nullableText(event.toStatus) && version(event.version) && event.version <= expectedVersion && Array.isArray(event.evidenceRefs) && event.evidenceRefs.every(identity))
    && Array.isArray(value.retests) && value.retests.every((event) => record(event) && identity(event.id) && identity(event.actorId) && timestamp(event.createdAt) && ['Resolved', 'Persists', 'Partial'].includes(String(event.result)) && text(event.note) && version(event.findingVersion) && event.findingVersion <= expectedVersion && Array.isArray(event.evidenceRefs) && event.evidenceRefs.every(identity))
    && (value.producerResolved === undefined || typeof value.producerResolved === 'boolean')
}
export function isCuratedFindingsView(value: unknown): value is CuratedFindingsView {
  return record(value) && identity(value.engagementId) && value.source === 'db' && record(value.transitions)
    && Array.isArray(value.findings) && value.findings.every((finding) => isCuratedFindingView(finding) && finding.engagementId === value.engagementId)
    && Object.entries(value.transitions).every(([status, targets]) => ['draft', 'review', 'returned', 'confirmed', 'remediation', 'retest', 'resolved'].includes(status) && Array.isArray(targets) && targets.every((target) => typeof target === 'string'))
}
export function isAccessibleFindingsView(value: unknown): value is AccessibleFindingsView {
  return record(value) && value.source === 'db' && typeof value.truncated === 'boolean' && Array.isArray(value.findings)
    && value.findings.every((row) => record(row) && identity(row.id) && identity(row.engagementId) && text(row.projectName)
      && nullableText(row.targetValue) && text(row.title)
      && ['critical', 'high', 'medium', 'low', 'informational'].includes(String(row.severity))
      && ['draft', 'review', 'returned', 'confirmed', 'remediation', 'retest', 'resolved', 'ai_suggested'].includes(String(row.status))
      && (row.sourceType === 'authored' || row.sourceType === 'imported' || row.sourceType === 'producer')
      && nullableText(row.description) && nullableText(row.techniqueId) && nullableText(row.createdAt) && nullableText(row.updatedAt))
}
