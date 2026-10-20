import type { ThreadBindingView } from './ownership.js'
import { isThreadBindingView } from './ownership.js'
import { isPublicStreamPayload, type CustomPayload, type ToolPayload } from './stream-events.js'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'
import type { EngagementStatus, EngagementTargetType } from './engagements.js'
export interface ScopedRunView {
  engagementId: string; threadId: string; runId: string; requestId: string
  rawStatus: string; createdAt: string; updatedAt: string; source: 'runtime'
}
export interface ScopedThreadMessage {
  role: 'user' | 'assistant'; content: string; messageId?: string | null
  /** Thinking trace stowed in `additional_kwargs.reasoning_content` (assistant only, optional). */
  reasoning?: string
}
/**
 * One durable checkpoint transcript entry (W09). Provenance `key` comes from
 * the shared event-identity normalizer; `runId` stays null because checkpoint
 * transcripts accumulate across runs and unattributed history must remain
 * thread-level rather than being assigned to an active run.
 */
export interface ThreadHistoryEvent {
  key: string | null; runId: null; source: 'checkpoint'; truncated: boolean; payload: CustomPayload | ToolPayload
}
export interface ScopedThreadView {
  binding: ThreadBindingView; rawStatus: string | null
  messages: ScopedThreadMessage[]
  messagesTruncated: boolean; historyScope: 'root_messages_only'; source: 'runtime'
  transcripts?: ThreadHistoryEvent[]; transcriptsTruncated?: boolean
  /** Per-conversation tool approval switch; absent means on (the default). */
  hitlEnabled?: boolean
  /** Restored graph-interrupt question (W11): lets the picker survive reloads. */
  pendingQuestion?: PendingInterruptView
  /** Every restorable `ask_user_question` interrupt (parallel tool calls raise several at once). */
  pendingQuestions?: PendingInterruptView[]
}
/** Owner-scoped bound-thread list for the Console selector (W10). */
export interface ScopedThreadListView {
  engagementId: string; threads: ThreadBindingView[]; source: 'runtime'
}
/** One pending `ask_user_question` graph interrupt restored from thread state (W11). */
export interface PendingInterruptView {
  questionId: string; question: string; header: string
  options: { label: string; description: string }[]
  multiSelect: boolean; allowOther: boolean; source: 'runtime'
  /** LangGraph interrupt identity — required to resume when several interrupts are pending at once. */
  interruptId?: string
  /** P10e: the dispatch attempt that asked, when the question came from a running instance. The batch answer still covers every pending question. */
  instance?: { dispatchId: string; attempt: number }
}
/** One workspace-file-backed HITL approval request, public projection (W11). */
export interface ApprovalRequestView {
  engagementId: string; requestId: string; engagementName: string; agentName: string; toolName: string
  toolArgsRedacted: Record<string, unknown>
  matchedRule: { techniqueTag: string | null; toolPattern: string | null; timeoutSeconds: number; defaultOnTimeout: string }
  reason: string
  /** Producer `created_at` in epoch seconds — never mixed with ISO event times. */
  createdAtSeconds: number
  source: 'workspace'
}
export interface ApprovalsView {
  engagementId: string; approvals: ApprovalRequestView[]; source: 'workspace'
}
export function isScopedRunView(v: unknown): v is ScopedRunView {
  return isRecord(v) && ['engagementId', 'threadId', 'runId', 'requestId', 'rawStatus'].every(k => isNonEmptyString(v[k])) && isIsoUtcTimestamp(v.createdAt) && isIsoUtcTimestamp(v.updatedAt) && v.source === 'runtime'
}
export function isScopedThreadView(v: unknown): v is ScopedThreadView {
  if (!isRecord(v) || !isThreadBindingView(v.binding) || (v.rawStatus !== null && !isNonEmptyString(v.rawStatus)) || !Array.isArray(v.messages) || typeof v.messagesTruncated !== 'boolean' || v.historyScope !== 'root_messages_only' || v.source !== 'runtime') return false
  if (!v.messages.every(m => isRecord(m) && typeof m.role === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && (m.reasoning === undefined || typeof m.reasoning === 'string') && (m.messageId === undefined || m.messageId === null || isNonEmptyString(m.messageId)))) return false
  if (v.pendingQuestion !== undefined && !isPendingInterruptView(v.pendingQuestion)) return false
  if (v.pendingQuestions !== undefined && (!Array.isArray(v.pendingQuestions) || !v.pendingQuestions.every(isPendingInterruptView))) return false
  if (v.transcripts === undefined && v.transcriptsTruncated === undefined) return true
  if (!Array.isArray(v.transcripts) || typeof v.transcriptsTruncated !== 'boolean') return false
  return v.transcripts.every(t => isRecord(t) && (t.key === null || isNonEmptyString(t.key)) && t.runId === null && t.source === 'checkpoint' && typeof t.truncated === 'boolean' && isPublicStreamPayload(t.payload))
}
export function isScopedThreadListView(v: unknown): v is ScopedThreadListView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && v.source === 'runtime' && Array.isArray(v.threads) && v.threads.every(isThreadBindingView)
}
export function isPendingInterruptView(v: unknown): v is PendingInterruptView {
  return isRecord(v) && isNonEmptyString(v.questionId) && isNonEmptyString(v.question) && typeof v.header === 'string' && Array.isArray(v.options) && v.options.every(o => isRecord(o) && isNonEmptyString(o.label) && typeof o.description === 'string') && typeof v.multiSelect === 'boolean' && typeof v.allowOther === 'boolean' && v.source === 'runtime' && (v.interruptId === undefined || isNonEmptyString(v.interruptId)) && (v.instance === undefined || isRecord(v.instance) && isNonEmptyString(v.instance.dispatchId) && Number.isSafeInteger(v.instance.attempt) && (v.instance.attempt as number) >= 1)
}
export function isApprovalRequestView(v: unknown): v is ApprovalRequestView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.requestId) || typeof v.engagementName !== 'string' || !isNonEmptyString(v.agentName) || !isNonEmptyString(v.toolName) || !isRecord(v.toolArgsRedacted) || !isRecord(v.matchedRule)) return false
  const rule = v.matchedRule
  if ((rule.techniqueTag !== null && !isNonEmptyString(rule.techniqueTag)) || (rule.toolPattern !== null && !isNonEmptyString(rule.toolPattern)) || typeof rule.timeoutSeconds !== 'number' || !Number.isFinite(rule.timeoutSeconds) || !isNonEmptyString(rule.defaultOnTimeout)) return false
  return isNonEmptyString(v.reason) && typeof v.createdAtSeconds === 'number' && Number.isFinite(v.createdAtSeconds) && v.source === 'workspace'
}
export function isApprovalsView(v: unknown): v is ApprovalsView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && v.source === 'workspace' && Array.isArray(v.approvals) && v.approvals.every(isApprovalRequestView)
}
/** One parsed `FIND-*.md` workspace finding, public projection with parser-quality flags (W12). */
export interface FindingView {
  engagementId: string; id: string; title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational'
  description: string; evidence: string; attackVector: string
  affectedAssets: string[]
  cvssScore?: number; cvssVector?: string; cwe?: string[]; mitre?: string[]; remediation?: string
  quality: { defaultSeverity: boolean; placeholderDescription: boolean; placeholderEvidence: boolean; unreadable: boolean }
  rawSource: string; sizeBytes: number
  source: 'workspace'
}
export interface FindingsView {
  engagementId: string; findings: FindingView[]; truncated: boolean; source: 'workspace'
}
export interface ArtifactsView {
  engagementId: string
  folders: { folder: string; files: { name: string; path: string; sizeBytes: number }[] }[]
  source: 'workspace'
}
export type CaptureClassification = 'unclassified' | 'standard' | 'sensitive'
export interface RetainedCaptureView {
  id: string; engagementId: string; filename: string | null; mediaType: string
  sizeBytes: number; digest: string; producer: string | null; classification: CaptureClassification
  classificationVersion: number; uploadedBy: string; classifiedBy: string | null
  classificationReason: string | null; classifiedAt: string | null; createdAt: string
  canReadOriginal: boolean; canClassify: boolean
}
export interface RetainedCapturesView {
  engagementId: string; captures: RetainedCaptureView[]; source: 'db'
}
export interface WorkspaceEvidenceImportView {
  engagementId: string; captures: RetainedCaptureView[]; skipped: { path: string; reason: string }[]
}
export interface RetainCaptureInput {
  requestId: string; filename: string; mediaType: string; base64: string
}
export interface ClassifyCaptureInput {
  classification: 'standard' | 'sensitive'; expectedVersion: number; reason: string
}
export function isRetainedCaptureView(v: unknown): v is RetainedCaptureView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.engagementId) || (v.filename !== null && typeof v.filename !== 'string')) return false
  if (!isNonEmptyString(v.mediaType) || typeof v.sizeBytes !== 'number' || !Number.isSafeInteger(v.sizeBytes) || v.sizeBytes <= 0) return false
  if (typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest) || !['unclassified', 'standard', 'sensitive'].includes(v.classification as string)) return false
  if (!Number.isSafeInteger(v.classificationVersion) || Number(v.classificationVersion) < 1 || !isNonEmptyString(v.uploadedBy)) return false
  if ((v.producer !== null && typeof v.producer !== 'string') || (v.classifiedBy !== null && typeof v.classifiedBy !== 'string') || (v.classificationReason !== null && typeof v.classificationReason !== 'string')) return false
  return typeof v.canReadOriginal === 'boolean' && typeof v.canClassify === 'boolean' &&
    (v.classifiedAt === null || typeof v.classifiedAt === 'string' && Number.isFinite(Date.parse(v.classifiedAt))) && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt))
}
export function isRetainedCapturesView(v: unknown): v is RetainedCapturesView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.captures) && v.captures.every(capture => isRetainedCaptureView(capture) && capture.engagementId === v.engagementId) && v.source === 'db'
}
export function isWorkspaceEvidenceImportView(v: unknown): v is WorkspaceEvidenceImportView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.captures) && v.captures.every(capture => isRetainedCaptureView(capture) && capture.engagementId === v.engagementId)
    && Array.isArray(v.skipped) && v.skipped.every(item => isRecord(item) && typeof item.path === 'string' && typeof item.reason === 'string')
}
export interface ArtifactContentView {
  engagementId: string; path: string; content: string
  mediaType: 'json' | 'text'; sizeBytes: number; truncated: boolean; source: 'workspace'
}
const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational']
export function isFindingView(v: unknown): v is FindingView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.id) || typeof v.title !== 'string' || !FINDING_SEVERITIES.includes(v.severity as string)) return false
  if (!isNonEmptyString(v.description) || !isNonEmptyString(v.evidence) || typeof v.attackVector !== 'string' || !Array.isArray(v.affectedAssets) || !v.affectedAssets.every(a => typeof a === 'string' && a.length <= 300)) return false
  if (v.cvssScore !== undefined && (typeof v.cvssScore !== 'number' || !Number.isFinite(v.cvssScore))) return false
  if (v.cvssVector !== undefined && typeof v.cvssVector !== 'string') return false
  for (const list of ['cwe', 'mitre'] as const) {
    if (v[list] !== undefined && (!Array.isArray(v[list]) || !(v[list] as unknown[]).every(item => isNonEmptyString(item)))) return false
  }
  if (v.remediation !== undefined && typeof v.remediation !== 'string') return false
  const quality = v.quality
  if (!isRecord(quality) || quality.defaultSeverity !== true && quality.defaultSeverity !== false || typeof quality.placeholderDescription !== 'boolean' || typeof quality.placeholderEvidence !== 'boolean' || typeof quality.unreadable !== 'boolean') return false
  return typeof v.rawSource === 'string' && typeof v.sizeBytes === 'number' && Number.isFinite(v.sizeBytes) && v.source === 'workspace'
}
export function isFindingsView(v: unknown): v is FindingsView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.findings) && v.findings.every(isFindingView) && typeof v.truncated === 'boolean' && v.source === 'workspace'
}
export function isArtifactsView(v: unknown): v is ArtifactsView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !Array.isArray(v.folders) || v.source !== 'workspace') return false
  return v.folders.every(folder => isRecord(folder) && isNonEmptyString(folder.folder) && Array.isArray(folder.files) && folder.files.every(file => isRecord(file) && isNonEmptyString(file.name) && isNonEmptyString(file.path) && typeof file.sizeBytes === 'number' && Number.isFinite(file.sizeBytes)))
}
export function isArtifactContentView(v: unknown): v is ArtifactContentView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && isNonEmptyString(v.path) && typeof v.content === 'string' && (v.mediaType === 'json' || v.mediaType === 'text') && typeof v.sizeBytes === 'number' && Number.isFinite(v.sizeBytes) && typeof v.truncated === 'boolean' && v.source === 'workspace'
}
/** Public graph property value: already whitelisted/redacted server-side. */
export type GraphPropertyValue = string | number | boolean | null
const isGraphPropertyValue = (v: unknown): v is GraphPropertyValue => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
export interface GraphNodeView {
  id: string; labels: string[]
  properties: Record<string, GraphPropertyValue>
}
export interface GraphEdgeView {
  id: string; source: string; target: string; type: string
  properties: Record<string, GraphPropertyValue>
}
/** Engagement-scoped attack-chain graph with server-side redaction applied before the response. */
export interface GraphView {
  engagementId: string; nodes: GraphNodeView[]; edges: GraphEdgeView[]
  truncated: boolean; source: 'graph'
}
export interface AssetSummaryView {
  id: string; type: 'Host' | 'Web' | 'API' | 'Identity' | 'Mobile'; label: string
  hostname?: string; ip?: string; url?: string; os?: string
  ports: string[]; services: string[]
  relatedFindingIds: string[]; source: 'graph'
}
export interface AssetsView {
  engagementId: string; assets: AssetSummaryView[]; truncated: boolean; source: 'graph'
}
export function isGraphNodeView(v: unknown): v is GraphNodeView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !Array.isArray(v.labels) || !v.labels.every(isNonEmptyString) || !isRecord(v.properties)) return false
  return Object.values(v.properties).every(isGraphPropertyValue)
}
export function isGraphEdgeView(v: unknown): v is GraphEdgeView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.source) || !isNonEmptyString(v.target) || !isNonEmptyString(v.type) || !isRecord(v.properties)) return false
  return Object.values(v.properties).every(isGraphPropertyValue)
}
export function isGraphView(v: unknown): v is GraphView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.nodes) && v.nodes.every(isGraphNodeView) && Array.isArray(v.edges) && v.edges.every(isGraphEdgeView) && typeof v.truncated === 'boolean' && v.source === 'graph'
}
const ASSET_TYPES = ['Host', 'Web', 'API', 'Identity', 'Mobile']
export function isAssetSummaryView(v: unknown): v is AssetSummaryView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || (v.type !== 'Host' && v.type !== 'Web' && v.type !== 'API' && v.type !== 'Identity' && v.type !== 'Mobile') || typeof v.label !== 'string') return false
  for (const key of ['hostname', 'ip', 'url', 'os'] as const) {
    if (v[key] !== undefined && !isNonEmptyString(v[key])) return false
  }
  return Array.isArray(v.ports) && v.ports.every(p => isNonEmptyString(p)) && Array.isArray(v.services) && v.services.every(s => isNonEmptyString(s)) && Array.isArray(v.relatedFindingIds) && v.relatedFindingIds.every(f => isNonEmptyString(f)) && v.source === 'graph'
}
export function isAssetsView(v: unknown): v is AssetsView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.assets) && v.assets.every(isAssetSummaryView) && typeof v.truncated === 'boolean' && v.source === 'graph'
}
/** One merged, explicitly-labeled operations-log entry (W14). `at` is ISO 8601. */
export interface TimelineEntryView {
  id: string; at: string
  source: 'runtime' | 'checkpoint' | 'workspace'
  kind: string; label: string
  agent?: string; tool?: string; runId?: string; status?: string
}
/**
 * Merged operations timeline: runtime run states, checkpoint transcripts and
 * workspace artifact-mtime entries keep distinct `source` labels; artifact
 * mtimes are presence markers, never exact tool execution times.
 */
export interface TimelineView {
  engagementId: string; entries: TimelineEntryView[]
  truncated: boolean
  /** Threads left out because their runtime binding conflicts with persisted state. */
  unavailableThreads: number; source: 'mixed'
}
export function isTimelineEntryView(v: unknown): v is TimelineEntryView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.at) || Number.isNaN(Date.parse(v.at)) || !isNonEmptyString(v.kind) || typeof v.label !== 'string') return false
  if (v.source !== 'runtime' && v.source !== 'checkpoint' && v.source !== 'workspace') return false
  for (const key of ['agent', 'tool', 'runId', 'status'] as const) {
    if (v[key] !== undefined && !isNonEmptyString(v[key])) return false
  }
  return true
}
export function isTimelineView(v: unknown): v is TimelineView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.entries) && v.entries.every(isTimelineEntryView) && typeof v.truncated === 'boolean' && typeof v.unavailableThreads === 'number' && v.source === 'mixed'
}
/**
 * W15 engagement settings: only the fields the new server actually persists
 * today. `name` is the immutable workspace slug; `targetChange` states the
 * lifecycle/lock policy up front instead of failing opaquely on save.
 */
export interface EngagementSettingsView {
  engagementId: string; displayName: string; name: string
  targetType: EngagementTargetType; targetValue: string
  authorizationConfirmed: boolean; lifecycleStatus: EngagementStatus
  targetChange: { allowed: boolean; reason: string | null }
  source: 'db'
}
export function isEngagementSettingsView(v: unknown): v is EngagementSettingsView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || typeof v.displayName !== 'string' || !isNonEmptyString(v.name)) return false
  if (!isNonEmptyString(v.targetType) || !isNonEmptyString(v.targetValue) || typeof v.authorizationConfirmed !== 'boolean') return false
  if (!isNonEmptyString(v.lifecycleStatus) || v.source !== 'db') return false
  if (!isRecord(v.targetChange) || typeof v.targetChange.allowed !== 'boolean') return false
  return v.targetChange.reason === null || isNonEmptyString(v.targetChange.reason)
}
/**
 * W17 vector campaigns: persisted drafts plus truthful provider jobs. The
 * campaign provider is not wired in this build, so every generate/deploy
 * attempt records a durable job whose `status` states the unavailable outcome
 * — a job view never claims generated/delivered, and the campaign stays in
 * draft until a real provider contract exists.
 */
export type CampaignVector = 'phishing' | 'web' | 'mobile'
export interface CampaignProviderCapabilities {
  engagementId: string; source: 'configuration'; draftPersistence: true
  providers: Array<{ provider: 'gophish' | 'evilginx2'; generateConfigured: boolean; deployConfigured: boolean; deploymentScope: 'isolated-lab' }>
}
export function isCampaignProviderCapabilities(v: unknown): v is CampaignProviderCapabilities {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || v.source !== 'configuration' || v.draftPersistence !== true || !Array.isArray(v.providers) || v.providers.length !== 2) return false
  return new Set(v.providers.map(provider => isRecord(provider) ? provider.provider : null)).size === 2 && v.providers.every(provider =>
    isRecord(provider) && ['gophish', 'evilginx2'].includes(String(provider.provider)) && typeof provider.generateConfigured === 'boolean' && typeof provider.deployConfigured === 'boolean' && provider.deploymentScope === 'isolated-lab')
}
export interface CampaignJobView {
  id: string; campaignId: string
  kind: 'generate' | 'deploy'
  status: string
  provider: string | null; error: string | null
  requestId?: string | null
  providerId?: string | null; providerStatus?: string | null
  summary?: { total: number; sent: number; errors: number } | null
  createdAt: string
}
export interface CampaignView {
  id: string; engagementId: string; name: string
  vector: CampaignVector
  status: string; version: number
  spec: Record<string, unknown>
  jobs: CampaignJobView[]
  createdAt: string; updatedAt: string
}
export interface CampaignsView {
  engagementId: string; campaigns: CampaignView[]
  truncated: boolean
}
export function isCampaignJobView(v: unknown): v is CampaignJobView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.campaignId)) return false
  if (v.kind !== 'generate' && v.kind !== 'deploy') return false
  if (!isNonEmptyString(v.status)) return false
  if (v.provider !== null && !isNonEmptyString(v.provider)) return false
  if (v.error !== null && !isNonEmptyString(v.error)) return false
  if (v.requestId !== undefined && v.requestId !== null && !isNonEmptyString(v.requestId)) return false
  if (['providerId', 'providerStatus'].some(key => v[key] !== undefined && v[key] !== null && !isNonEmptyString(v[key]))) return false
  if (v.summary !== undefined && v.summary !== null && (!isRecord(v.summary) || !['total', 'sent', 'errors'].every(key => {
    const count = (v.summary as Record<string, unknown>)[key]; return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
  }))) return false
  return isNonEmptyString(v.createdAt) && !Number.isNaN(Date.parse(v.createdAt))
}
export function isCampaignView(v: unknown): v is CampaignView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.name)) return false
  if (v.vector !== 'phishing' && v.vector !== 'web' && v.vector !== 'mobile') return false
  if (!isNonEmptyString(v.status) || typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) return false
  if (!isRecord(v.spec)) return false
  if (!Array.isArray(v.jobs) || !v.jobs.every(isCampaignJobView)) return false
  return isNonEmptyString(v.createdAt) && isNonEmptyString(v.updatedAt) && !Number.isNaN(Date.parse(v.createdAt)) && !Number.isNaN(Date.parse(v.updatedAt))
}
export function isCampaignsView(v: unknown): v is CampaignsView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.campaigns) && v.campaigns.every(isCampaignView) && typeof v.truncated === 'boolean'
}
/**
 * W18 credentials vault: redacted metadata by default (kind/label/provenance
 * plus the reveal audit state) and a dedicated authorized reveal response.
 * The metadata view never carries a plaintext secret, and the reveal view is
 * only produced by the explicit reveal endpoint.
 */
export interface VaultSecretView {
  id: string; engagementId: string
  kind: string; label: string
  createdBy: string
  revealCount: number; lastRevealedAt: string | null
  createdAt: string; updatedAt: string
}
export interface VaultView {
  engagementId: string; secrets: VaultSecretView[]
  truncated: boolean; source: 'db'
}
export interface VaultRevealView {
  secretId: string; engagementId: string
  plaintext: string; revealedAt: string
}
export function isVaultSecretView(v: unknown): v is VaultSecretView {
  if (!isRecord(v) || !isNonEmptyString(v.id) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.kind) || !isNonEmptyString(v.label)) return false
  if (!isNonEmptyString(v.createdBy) || typeof v.revealCount !== 'number' || !Number.isInteger(v.revealCount) || v.revealCount < 0) return false
  if (v.lastRevealedAt !== null && (!isNonEmptyString(v.lastRevealedAt) || Number.isNaN(Date.parse(v.lastRevealedAt)))) return false
  return isNonEmptyString(v.createdAt) && isNonEmptyString(v.updatedAt) && !Number.isNaN(Date.parse(v.createdAt)) && !Number.isNaN(Date.parse(v.updatedAt))
}
export function isVaultView(v: unknown): v is VaultView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.secrets) && v.secrets.every(isVaultSecretView) && typeof v.truncated === 'boolean' && v.source === 'db'
}
export function isVaultRevealView(v: unknown): v is VaultRevealView {
  if (!isRecord(v) || !isNonEmptyString(v.secretId) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.plaintext)) return false
  return isNonEmptyString(v.revealedAt) && !Number.isNaN(Date.parse(v.revealedAt))
}
/**
 * W19 members, extended by integration ticket 07: the local single-user
 * topology stays truthful (single operator, invites unsupported); multi-user
 * deployments (RAPTIX_WEB_AUTH_MODE=multi) report persisted memberships with
 * invite/role APIs backed by session-authenticated, server-side checks.
 */
export interface MemberView {
  id: string; label: string; role: string; source: 'local' | 'membership'
}
/** P11: the operation lifecycle the runtime reports for one execution thread. `state` is the server's word. */
export interface OperationView {
  engagementId: string; threadId: string; state: string
  latestRunId: string | null; latestRunStatus: string | null; source: 'runtime'
}
export function isOperationView(v: unknown): v is OperationView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && isNonEmptyString(v.threadId) && isNonEmptyString(v.state)
    && (v.latestRunId === null || isNonEmptyString(v.latestRunId)) && (v.latestRunStatus === null || isNonEmptyString(v.latestRunStatus))
    && v.source === 'runtime'
}
export interface MembersView {
  engagementId: string; mode: 'local-single-user' | 'multi-user'
  members: MemberView[]
  /** True only when the signed-in actor is the engagement owner; the server decides, the console only shows it. */
  canManage: boolean
  inviteSupported: boolean; reason: string | null
  source: 'db'
}
export function isMemberView(v: unknown): v is MemberView {
  return isRecord(v) && isNonEmptyString(v.id) && isNonEmptyString(v.label) && isNonEmptyString(v.role) && (v.source === 'local' || v.source === 'membership')
}
export function isMembersView(v: unknown): v is MembersView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId)) return false
  if (v.mode !== 'local-single-user' && v.mode !== 'multi-user') return false
  if (!Array.isArray(v.members) || !v.members.every(isMemberView)) return false
  // In the local single-user topology invites can never be supported; a view
  // claiming otherwise would be a fake membership hierarchy.
  if (v.mode === 'local-single-user' && v.inviteSupported !== false) return false
  if (typeof v.canManage !== 'boolean' || (v.mode === 'local-single-user' && v.canManage)) return false
  if (v.source !== 'db') return false
  return v.reason === null || isNonEmptyString(v.reason)
}
