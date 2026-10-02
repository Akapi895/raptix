import type { ThreadBindingView } from './ownership.js'
import { isThreadBindingView } from './ownership.js'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'
export interface ScopedRunView {
  engagementId: string; threadId: string; runId: string; requestId: string
  rawStatus: string; createdAt: string; updatedAt: string; source: 'runtime'
}
export interface ScopedThreadView {
  binding: ThreadBindingView; rawStatus: string | null
  messages: { role: 'user' | 'assistant'; content: string }[]
  messagesTruncated: boolean; historyScope: 'root_messages_only'; source: 'runtime'
}
export function isScopedRunView(v: unknown): v is ScopedRunView {
  return isRecord(v) && ['engagementId', 'threadId', 'runId', 'requestId', 'rawStatus'].every(k => isNonEmptyString(v[k])) && isIsoUtcTimestamp(v.createdAt) && isIsoUtcTimestamp(v.updatedAt) && v.source === 'runtime'
}
export function isScopedThreadView(v: unknown): v is ScopedThreadView {
  return isRecord(v) && isThreadBindingView(v.binding) && (v.rawStatus === null || isNonEmptyString(v.rawStatus)) && Array.isArray(v.messages) && v.messages.every(m => isRecord(m) && typeof m.role === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string') && typeof v.messagesTruncated === 'boolean' && v.historyScope === 'root_messages_only' && v.source === 'runtime'
}
