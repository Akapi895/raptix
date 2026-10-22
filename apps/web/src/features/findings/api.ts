import { isCuratedFindingView, isCuratedFindingsView, isFindingActivityPage, isFindingReferenceOptions, isFindingSuggestionDispositionsView, isFindingSuggestionDispositionResult, type CuratedFindingView, type CuratedFindingsView, type FindingActivityPage, type FindingReferenceOptions, type FindingSuggestionDispositionsView, type FindingSuggestionDispositionResult, isFindingsView, isArtifactsView, isArtifactContentView, isRetainedCaptureView, isRetainedCapturesView, isWorkspaceEvidenceImportView, type FindingsView, type ArtifactsView, type ArtifactContentView, type ClassifyCaptureInput, type RetainCaptureInput, type RetainedCaptureView, type WorkspaceEvidenceImportView, type RetainedCapturesView, type FindingReproductionInput } from '@raptix/web-contracts';
import { apiFetch, apiFetchBytes, type BinaryApiResponse } from '../../platform/transport';
import { owned } from '../../platform/ownership';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Observed results (ticket 06, read-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export function fetchFindings(engagementId: string): Promise<FindingsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/findings`, (v): v is FindingsView => isFindingsView(v) && v.engagementId === engagementId && v.findings.every(f => f.engagementId === engagementId))
}

export function fetchArtifacts(engagementId: string): Promise<ArtifactsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts`, owned(engagementId, isArtifactsView))
}

export function fetchArtifactContent(engagementId: string, path: string): Promise<ArtifactContentView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/artifacts/content?path=${encodeURIComponent(path)}`,
    (v): v is ArtifactContentView => isArtifactContentView(v) && v.engagementId === engagementId && v.path === path,
  )
}

export function fetchRetainedCaptures(engagementId: string): Promise<RetainedCapturesView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts/captures`, owned(engagementId, isRetainedCapturesView))
}

export function uploadCapture(engagementId: string, input: RetainCaptureInput): Promise<RetainedCaptureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts/captures`, owned(engagementId, isRetainedCaptureView), { method: 'POST', body: input })
}

export function importWorkspaceEvidence(engagementId: string): Promise<WorkspaceEvidenceImportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts/workspace-evidence/import`, owned(engagementId, isWorkspaceEvidenceImportView), { method: 'POST' })
}

export function classifyCapture(engagementId: string, captureId: string, input: ClassifyCaptureInput): Promise<RetainedCaptureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts/captures/${encodeURIComponent(captureId)}/classification`, owned(engagementId, isRetainedCaptureView), { method: 'PATCH', body: input })
}

export function downloadCapture(engagementId: string, captureId: string): Promise<BinaryApiResponse> {
  return apiFetchBytes(`/engagements/${encodeURIComponent(engagementId)}/artifacts/captures/${encodeURIComponent(captureId)}/content`)
}

/* ───────────── Curated findings/evidence (integration ticket 10) ───────────── */
export function fetchCuratedFindings(engagementId: string): Promise<CuratedFindingsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings`, owned(engagementId, isCuratedFindingsView))
}

export function fetchFindingReferenceOptions(engagementId: string): Promise<FindingReferenceOptions> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/options`, owned(engagementId, isFindingReferenceOptions))
}

export function fetchFindingActivity(engagementId: string, findingId: string, kind: FindingActivityPage['kind'], cursor: string, version: number): Promise<FindingActivityPage> {
  const query = new URLSearchParams({ kind, cursor, version: String(version), limit: '20' })
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/activity?${query}`, (value): value is FindingActivityPage => {
    return isFindingActivityPage(value) && value.engagementId === engagementId && value.findingId === findingId && value.kind === kind && value.version === version
  })
}

export function fetchFindingSuggestionDispositions(engagementId: string): Promise<FindingSuggestionDispositionsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/suggestions`, owned(engagementId, isFindingSuggestionDispositionsView))
}

export function setFindingSuggestionDisposition(engagementId: string, input: { producerRef: string; dismissed: boolean; reason: string; expectedVersion: number }): Promise<FindingSuggestionDispositionResult> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/suggestions`, (value): value is FindingSuggestionDispositionResult => {
    return isFindingSuggestionDispositionResult(value) && value.engagementId === engagementId && value.disposition.producerRef === input.producerRef && value.disposition.dismissed === input.dismissed
  }, { method: 'POST', body: input })
}

export function createCuratedFinding(engagementId: string, input: { title: string; severity: string; detail: string; impact?: string; recommendation?: string; severityRationale?: string; scopeNote?: string; references?: CuratedFindingView['references']; reproduction?: FindingReproductionInput | null }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings`, owned(engagementId, (v): v is CuratedFindingView =>
    isCuratedFindingView(v) && v.status === 'draft'),
  { method: 'POST', body: input })
}

export function importCuratedFinding(engagementId: string, input: { title: string; severity: string; detail: string; producerRef: string }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/import`, owned(engagementId, (v): v is CuratedFindingView =>
    isCuratedFindingView(v) && v.sourceType === 'imported' && v.producerRef === input.producerRef),
  { method: 'POST', body: input })
}

export function updateCuratedFinding(engagementId: string, findingId: string, input: { expectedVersion: number; title: string; severity: string; detail: string; impact?: string; recommendation?: string; severityRationale?: string; scopeNote?: string; references?: CuratedFindingView['references']; reproduction?: FindingReproductionInput | null; submit?: boolean }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}`, owned(engagementId, (v): v is CuratedFindingView => isCuratedFindingView(v) && v.id === findingId), { method: 'PATCH', body: input })
}

export function transitionCuratedFinding(engagementId: string, findingId: string, to: string, expectedVersion: number, note?: string): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/transition`, owned(engagementId, (v): v is CuratedFindingView =>
    isCuratedFindingView(v) && v.id === findingId && v.status === to),
  { method: 'POST', body: { to, expectedVersion, ...(note === undefined ? {} : { note }) } })
}

export function addCuratedFindingComment(engagementId: string, findingId: string, input: { text: string; expectedVersion: number; requestId: string }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/comments`, owned(engagementId, (v): v is CuratedFindingView => isCuratedFindingView(v) && v.id === findingId), { method: 'POST', body: input })
}

export function recordCuratedFindingRetest(engagementId: string, findingId: string, input: { result: string; note: string; expectedVersion: number; requestId: string; captureIds?: string[] }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/retests`, owned(engagementId, (v): v is CuratedFindingView => isCuratedFindingView(v) && v.id === findingId), { method: 'POST', body: input })
}

export interface EvidenceLinkView { id: string; engagementId: string; captureId: string | null; kind: 'artifact' | 'digest'; artifactPath: string | null; digest: string | null; producer: string | null; createdAt: string }

export function attachEvidence(engagementId: string, findingId: string, input: { kind: 'artifact' | 'digest'; expectedVersion: number; captureId?: string; artifactPath?: string; digest?: string; producer?: string }): Promise<EvidenceLinkView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/evidence`, (v): v is EvidenceLinkView =>
    typeof v === 'object' && v !== null && typeof (v as EvidenceLinkView).id === 'string' && (v as EvidenceLinkView).engagementId === engagementId,
  { method: 'POST', body: input })
}
