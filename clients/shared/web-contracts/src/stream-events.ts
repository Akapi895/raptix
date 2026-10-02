import type { NormalizedSubagentEvent } from '@raptix/streaming'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'
export interface StreamScope { engagementId: string; threadId: string; runId: string }
export interface MessagePayload { type: 'message'; messageId: string | null; role: 'user' | 'assistant'; content: string; mode: 'delta' | 'snapshot'; truncated: boolean }
export interface ToolPayload { type: 'tool_call' | 'tool_result'; toolCallId: string | null; name: string; argsPreview?: string; content?: string; status?: string; error?: boolean; cancelled?: boolean; delegation: boolean; truncated: boolean }
export type CustomPayload = Omit<NormalizedSubagentEvent, 'args'> & { argsPreview?: string; truncated: boolean }
export interface InterruptPayload { type: 'interrupt'; interruptId: string | null }
export type PublicStreamPayload = MessagePayload | ToolPayload | CustomPayload | InterruptPayload
export interface PublicStreamEvent {
  version: 1; eventId: string; engagementId: string; threadId: string; streamRunId: string; runId: string | null
  source: 'runtime' | 'checkpoint'; namespace: string[]; upstreamCursor?: string
  occurredAt: string | null; observedAt: string; identity: 'upstream' | 'domain' | 'occurrence'
  payload: PublicStreamPayload
}
const customTypes = ['subagent_start', 'subagent_end', 'subagent_tool_call', 'subagent_tool_result', 'subagent_message', 'ask_user_question', 'engagement_ready', 'background_complete']
export function isPublicStreamEvent(value: unknown): value is PublicStreamEvent {
  if (!isRecord(value) || value.version !== 1 || !['eventId', 'engagementId', 'threadId', 'streamRunId'].every(k => isNonEmptyString(value[k])) || value.runId !== null && !isNonEmptyString(value.runId)) return false
  if (value.source === 'runtime' && value.runId !== value.streamRunId || value.source === 'checkpoint' && value.runId !== null) return false
  if (typeof value.source !== 'string' || !['runtime', 'checkpoint'].includes(value.source) || typeof value.identity !== 'string' || !['upstream', 'domain', 'occurrence'].includes(value.identity) || !Array.isArray(value.namespace) || !value.namespace.every(n => typeof n === 'string')) return false
  if (value.upstreamCursor !== undefined && !isNonEmptyString(value.upstreamCursor) || value.occurredAt !== null && !isIsoUtcTimestamp(value.occurredAt) || !isIsoUtcTimestamp(value.observedAt)) return false
  const p = value.payload
  if (!isRecord(p) || typeof p.type !== 'string') return false
  if (p.type === 'interrupt') return p.interruptId === null || isNonEmptyString(p.interruptId)
  if (typeof p.truncated !== 'boolean') return false
  if (p.type === 'message') return (p.messageId === null || isNonEmptyString(p.messageId)) && typeof p.role === 'string' && ['user', 'assistant'].includes(p.role) && typeof p.content === 'string' && typeof p.mode === 'string' && ['delta', 'snapshot'].includes(p.mode)
  if (p.type === 'tool_call' || p.type === 'tool_result') return (p.toolCallId === null || isNonEmptyString(p.toolCallId)) && isNonEmptyString(p.name) && typeof p.delegation === 'boolean' && (p.argsPreview === undefined || typeof p.argsPreview === 'string') && (p.content === undefined || typeof p.content === 'string') && (p.status === undefined || typeof p.status === 'string') && (p.error === undefined || typeof p.error === 'boolean') && (p.cancelled === undefined || typeof p.cancelled === 'boolean')
  if (!customTypes.includes(String(p.type)) || !isNonEmptyString(p.agent)) return false
  for (const k of ['sessionId', 'createdAt', 'tool', 'content', 'text', 'prompt', 'status', 'question', 'header', 'session', 'command', 'argsPreview']) if (p[k] !== undefined && typeof p[k] !== 'string') return false
  for (const k of ['cancelled', 'error', 'multiSelect', 'allowOther']) if (p[k] !== undefined && typeof p[k] !== 'boolean') return false
  for (const k of ['toolId', 'questionId']) if (p[k] !== undefined && p[k] !== null && typeof p[k] !== 'string') return false
  if (p.elapsedSeconds !== undefined && (typeof p.elapsedSeconds !== 'number' || !Number.isFinite(p.elapsedSeconds))) return false
  if (p.exitCode !== undefined && p.exitCode !== null && (typeof p.exitCode !== 'number' || !Number.isFinite(p.exitCode))) return false
  return p.options === undefined || Array.isArray(p.options) && p.options.every(o => isRecord(o) && typeof o.label === 'string' && typeof o.description === 'string')
}
