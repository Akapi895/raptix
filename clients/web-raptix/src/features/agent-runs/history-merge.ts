import type { CustomPayload, ScopedThreadView, ThreadHistoryEvent } from '@raptix/web-contracts'
import { bounded, type Invocation, type StreamMessage, type StreamState, type StreamTool } from './stream-reducer'

/**
 * W09 history recovery: merge one owned checkpoint snapshot into the stream
 * state. Merge happens by provenance IDs only (messageId, session+toolId,
 * sessionId, questionId); entries without a provable key stay occurrence-keyed
 * and unattributed. History is thread-level (`runId: null`) and never assigns
 * an active run: existing run attribution, live full content and live-only
 * handoff state are never overwritten by capped checkpoint replay.
 */
function toolKey(payload: CustomPayload, fallback: string): string {
  return JSON.stringify([payload.sessionId ?? '', payload.toolId ?? fallback])
}
function mergeTool(old: StreamTool | undefined, payload: CustomPayload, truncated: boolean): StreamTool {
  const downgrade = old?.source === 'runtime' && truncated
  const name = payload.tool ?? 'tool'
  const result = payload.type === 'subagent_tool_result'
  return {
    name: old?.name ?? name,
    content: downgrade ? old!.content : payload.content ?? old?.content,
    argsPreview: downgrade ? old!.argsPreview : payload.argsPreview ?? old?.argsPreview,
    status: payload.status ?? old?.status,
    error: payload.error ?? old?.error,
    cancelled: payload.cancelled ?? old?.cancelled,
    delegation: old?.delegation === true || name === 'task',
    truncated: downgrade ? old!.truncated : truncated,
    source: downgrade ? old!.source : 'checkpoint',
    runId: old?.runId ?? null,
    callSeen: old?.callSeen === true || !result,
    resultSeen: old?.resultSeen === true || result,
  }
}
function invocationStatus(old: Invocation | undefined, payload: CustomPayload): Invocation['status'] {
  if (payload.type !== 'subagent_end') return old?.status ?? 'running'
  if (payload.cancelled === true || payload.status === 'cancelled') return 'cancelled'
  if (payload.error === true || ['error', 'failed'].includes(payload.status ?? '')) return 'error'
  return ['success', 'completed'].includes(payload.status ?? '') ? 'completed' : 'ended'
}
export function mergeThreadHistory(previous: StreamState, snapshot: ScopedThreadView): StreamState {
  if (snapshot.binding.engagementId !== previous.engagementId || snapshot.binding.threadId !== previous.threadId) return previous
  const state: StreamState = { ...previous }
  for (const message of snapshot.messages) {
    if (message.messageId === undefined || message.messageId === null) continue
    const key = JSON.stringify([[], message.messageId])
    const old = previous.messages[key]
    if (old) continue
    const entry: StreamMessage = { type: 'message', messageId: message.messageId, role: message.role, content: message.content, mode: 'snapshot', truncated: message.content.length >= 8000, runId: null, source: 'checkpoint' }
    state.messages = bounded({ ...state.messages, [key]: entry }, 500)
  }
  for (const [index, history] of (snapshot.transcripts ?? []).entries()) mergeHistoryEvent(state, history, index)
  return state
}
function mergeHistoryEvent(state: StreamState, history: ThreadHistoryEvent, index: number): void {
  const payload = history.payload as CustomPayload
  if (payload.type === 'subagent_tool_call' || payload.type === 'subagent_tool_result') {
    const key = toolKey(payload, history.key ?? `history:${index}`)
    state.tools = bounded({ ...state.tools, [key]: mergeTool(state.tools[key], payload, history.truncated) }, 1000)
  } else if (payload.type === 'subagent_start' || payload.type === 'subagent_end' || payload.type === 'subagent_message') {
    const key = payload.sessionId ?? `unattributed:${history.key ?? `history:${index}`}`
    const old: Invocation | undefined = state.invocations[key]
    state.invocations = bounded({ ...state.invocations, [key]: { ...old, agent: payload.agent, ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), status: invocationStatus(old, payload), ...(payload.elapsedSeconds === undefined ? {} : { elapsedSeconds: payload.elapsedSeconds }), ...(payload.error === undefined ? {} : { error: payload.error }), ...(payload.cancelled === undefined ? {} : { cancelled: payload.cancelled }), runId: old?.runId ?? null } }, 500)
  } else if (payload.type === 'ask_user_question') {
    const key = payload.questionId ?? history.key ?? `history:${index}`
    const old = state.questions[key]
    const downgrade = old?.source === 'runtime' && history.truncated
    state.questions = bounded({ ...state.questions, [key]: downgrade ? old! : { ...payload, runId: null, source: 'checkpoint' } }, 100)
  }
}
