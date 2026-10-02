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
}
export function isScopedRunView(v: unknown): v is ScopedRunView {
  return isRecord(v) && ['engagementId', 'threadId', 'runId', 'requestId', 'rawStatus'].every(k => isNonEmptyString(v[k])) && isIsoUtcTimestamp(v.createdAt) && isIsoUtcTimestamp(v.updatedAt) && v.source === 'runtime'
}
export function isScopedThreadView(v: unknown): v is ScopedThreadView {
  if (!isRecord(v) || !isThreadBindingView(v.binding) || (v.rawStatus !== null && !isNonEmptyString(v.rawStatus)) || !Array.isArray(v.messages) || typeof v.messagesTruncated !== 'boolean' || v.historyScope !== 'root_messages_only' || v.source !== 'runtime') return false
  if (!v.messages.every(m => isRecord(m) && typeof m.role === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && (m.messageId === undefined || m.messageId === null || isNonEmptyString(m.messageId)))) return false
  if (v.transcripts === undefined && v.transcriptsTruncated === undefined) return true
  if (!Array.isArray(v.transcripts) || typeof v.transcriptsTruncated !== 'boolean') return false
  return v.transcripts.every(t => isRecord(t) && (t.key === null || isNonEmptyString(t.key)) && t.runId === null && t.source === 'checkpoint' && typeof t.truncated === 'boolean' && isPublicStreamPayload(t.payload))
}
