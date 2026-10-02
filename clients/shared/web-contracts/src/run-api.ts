import type { ThreadBindingView } from './ownership.js'
import { isThreadBindingView } from './ownership.js'
import { isPublicStreamPayload, type CustomPayload } from './stream-events.js'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'
import type { EngagementStatus, EngagementTargetType } from './engagements.js'
export interface ScopedRunView {
  engagementId: string; threadId: string; runId: string; requestId: string
  rawStatus: string; createdAt: string; updatedAt: string; source: 'runtime'
}
export interface ScopedThreadMessage {
  role: 'user' | 'assistant'; content: string; messageId?: string | null
}
/**
 * One durable checkpoint transcript entry (W09). Provenance `key` comes from
 * the shared event-identity normalizer; `runId` stays null because checkpoint
 * transcripts accumulate across runs and unattributed history must remain
 * thread-level rather than being assigned to an active run.
 */
export interface ThreadHistoryEvent {
  key: string | null; runId: null; source: 'checkpoint'; truncated: boolean; payload: CustomPayload
}
export interface ScopedThreadView {
  binding: ThreadBindingView; rawStatus: string | null
  messages: ScopedThreadMessage[]
  messagesTruncated: boolean; historyScope: 'root_messages_only'; source: 'runtime'
  transcripts?: ThreadHistoryEvent[]; transcriptsTruncated?: boolean
  /** Restored graph-interrupt question (W11): lets the picker survive reloads. */
  pendingQuestion?: PendingInterruptView
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
  if (!v.messages.every(m => isRecord(m) && typeof m.role === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && (m.messageId === undefined || m.messageId === null || isNonEmptyString(m.messageId)))) return false
  if (v.pendingQuestion !== undefined && !isPendingInterruptView(v.pendingQuestion)) return false
  if (v.transcripts === undefined && v.transcriptsTruncated === undefined) return true
  if (!Array.isArray(v.transcripts) || typeof v.transcriptsTruncated !== 'boolean') return false
  return v.transcripts.every(t => isRecord(t) && (t.key === null || isNonEmptyString(t.key)) && t.runId === null && t.source === 'checkpoint' && typeof t.truncated === 'boolean' && isPublicStreamPayload(t.payload))
}
export function isScopedThreadListView(v: unknown): v is ScopedThreadListView {
  return isRecord(v) && isNonEmptyString(v.engagementId) && v.source === 'runtime' && Array.isArray(v.threads) && v.threads.every(isThreadBindingView)
}
export function isPendingInterruptView(v: unknown): v is PendingInterruptView {
  return isRecord(v) && isNonEmptyString(v.questionId) && isNonEmptyString(v.question) && typeof v.header === 'string' && Array.isArray(v.options) && v.options.every(o => isRecord(o) && isNonEmptyString(o.label) && typeof o.description === 'string') && typeof v.multiSelect === 'boolean' && typeof v.allowOther === 'boolean' && v.source === 'runtime'
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
  truncated: boolean; source: 'mixed'
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
  return isRecord(v) && isNonEmptyString(v.engagementId) && Array.isArray(v.entries) && v.entries.every(isTimelineEntryView) && typeof v.truncated === 'boolean' && v.source === 'mixed'
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
