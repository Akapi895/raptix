import type { ThreadBindingView } from './ownership.js'
import { isThreadBindingView } from './ownership.js'
import { isPublicStreamPayload, type CustomPayload } from './stream-events.js'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'
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
