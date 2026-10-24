import type { RequestContext, ServiceResult } from '../../domain/service'
import type { Evidence, Finding, FindingStatus, Severity } from '../../domain/entities'
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
export const SEVS: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

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
