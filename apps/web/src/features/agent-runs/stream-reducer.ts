import type { CustomPayload, MessagePayload, PublicStreamEvent, ScopedRunView, ToolPayload } from '@raptix/web-contracts'

/**
 * Order for entries that never carried a stream position (thread-snapshot
 * history seeded before the stream attaches). It sorts ahead of every
 * clock-ordered card; a later stream occurrence of the same identity replaces
 * it via {@link resolveOrder}.
 */
export const HISTORY_ORDER = Number.MIN_SAFE_INTEGER

export interface StreamMessage extends MessagePayload { runId: string | null; source: 'runtime' | 'checkpoint'; order: number }
export interface StreamTool { name: string; content?: string; argsPreview?: string; status?: string; error?: boolean; cancelled?: boolean; delegation: boolean; truncated: boolean; runId: string | null; source: 'runtime' | 'checkpoint'; callSeen: boolean; resultSeen: boolean; order: number }
export interface Invocation { agent: string; sessionId?: string; status: 'running' | 'ended' | 'completed' | 'error' | 'cancelled'; elapsedSeconds?: number; error?: boolean; cancelled?: boolean; runId: string | null; order: number }
export interface StreamState {
  engagementId: string; threadId: string; events: PublicStreamEvent[]; seen: string[]
  /** Monotonic count of reduced events; the first-seen position of each identity. */
  clock: number
  messages: Record<string, StreamMessage>; tools: Record<string, StreamTool>; invocations: Record<string, Invocation>
  questions: Record<string, CustomPayload & { runId: string | null; source: 'runtime' | 'checkpoint'; order: number }>; handoffPending: boolean
  attempts: Record<string, { cursor?: string; rawStatus?: string }>
  transport: 'connected' | 'disconnected'; recoveryRequired: boolean
}
export function emptyStreamState(engagementId: string, threadId: string): StreamState {
  return { engagementId, threadId, events: [], seen: [], clock: 0, messages: {}, tools: {}, invocations: {}, questions: {}, attempts: {}, handoffPending: false, transport: 'disconnected', recoveryRequired: false }
}
export function bounded<T>(entries: Record<string, T>, limit: number): Record<string, T> { return Object.fromEntries(Object.entries(entries).slice(-limit)) }
/** First occurrence wins; a history seed (HISTORY_ORDER) is upgraded once the stream replays the identity. */
const resolveOrder = (old: number | undefined, clock: number): number => (old === undefined || old === HISTORY_ORDER ? clock : old)
function tool(state: StreamState, event: PublicStreamEvent, payload: ToolPayload | CustomPayload, clock: number): void {
  const custom = payload.type !== 'tool_call' && payload.type !== 'tool_result'
  const session = custom && 'sessionId' in payload && payload.sessionId ? payload.sessionId : event.namespace
  const toolId = custom ? (payload as CustomPayload).toolId : (payload as ToolPayload).toolCallId
  const key = JSON.stringify([session, toolId ?? event.eventId])
  const old = state.tools[key]
  const name = custom ? (payload as CustomPayload).tool ?? 'tool' : (payload as ToolPayload).name
  const result = payload.type === 'tool_result' || payload.type === 'subagent_tool_result'
  const downgrade = old && old.source === 'runtime' && event.source === 'checkpoint' && payload.truncated
  state.tools = bounded({ ...state.tools, [key]: { ...(old ?? {}), name: old?.name ?? name, content: downgrade ? old!.content : payload.content ?? old?.content, argsPreview: downgrade ? old!.argsPreview : payload.argsPreview ?? old?.argsPreview, status: payload.status ?? old?.status, error: payload.error ?? old?.error, cancelled: payload.cancelled ?? old?.cancelled, truncated: downgrade ? old!.truncated : payload.truncated, source: downgrade ? old!.source : event.source, delegation: old?.delegation === true || name === 'task', runId: event.runId ?? old?.runId ?? null, callSeen: old?.callSeen === true || !result, resultSeen: old?.resultSeen === true || result, order: resolveOrder(old?.order, clock) } }, 1000)
}
export function reduceStreamEvent(previous: StreamState, event: PublicStreamEvent): StreamState {
  if (event.engagementId !== previous.engagementId || event.threadId !== previous.threadId || previous.seen.includes(event.eventId)) return previous
  const clock = previous.clock + 1
  const state: StreamState = { ...previous, clock, events: [...previous.events, event].slice(-2000), seen: [...previous.seen, event.eventId].slice(-2000), transport: 'connected' }
  if (event.upstreamCursor) state.attempts = bounded({ ...previous.attempts, [event.streamRunId]: { ...previous.attempts[event.streamRunId], cursor: event.upstreamCursor } }, 100)
  const p = event.payload
  if (p.type === 'message') {
    const key = JSON.stringify([event.namespace, p.messageId ?? event.eventId])
    const old = previous.messages[key]
    const downgrade = old && old.source === 'runtime' && event.source === 'checkpoint' && p.truncated
    const keepOld = downgrade || old?.mode === 'snapshot' && p.mode === 'delta'
    const content = keepOld ? old!.content : p.mode === 'delta' && old ? old.content + p.content : p.content
    // Reasoning follows content's merge semantics: delta fragments append
    // onto the open entry, snapshots replace, history never downgrades live.
    const reasoning = keepOld ? old!.reasoning : p.mode === 'delta' && old ? (old.reasoning ?? '') + (p.reasoning ?? '') : p.reasoning
    state.messages = bounded({ ...previous.messages, [key]: { ...p, ...(downgrade ? old : {}), content: content.slice(0, 32000), ...(reasoning ? { reasoning: reasoning!.slice(0, 32000) } : {}), truncated: downgrade ? old!.truncated : p.truncated || content.length > 32000, mode: old?.mode === 'snapshot' && p.mode === 'delta' ? 'snapshot' : p.mode, runId: event.runId ?? old?.runId ?? null, source: downgrade ? old!.source : event.source, order: resolveOrder(old?.order, clock) } }, 500)
  } else if (p.type === 'tool_call' || p.type === 'tool_result' || p.type === 'subagent_tool_call' || p.type === 'subagent_tool_result') tool(state, event, p, clock)
  else if (p.type === 'subagent_start' || p.type === 'subagent_end' || p.type === 'subagent_message') {
    const key = p.sessionId || `unattributed:${event.eventId}`
    const old = previous.invocations[key]
    const status = p.type !== 'subagent_end' ? old?.status ?? 'running' : p.cancelled || p.status === 'cancelled' ? 'cancelled' : p.error || ['error', 'failed'].includes(p.status ?? '') ? 'error' : ['success', 'completed'].includes(p.status ?? '') ? 'completed' : 'ended'
    state.invocations = bounded({ ...previous.invocations, [key]: { ...old, agent: p.agent, ...(p.sessionId ? { sessionId: p.sessionId } : {}), status, ...(p.elapsedSeconds === undefined ? {} : { elapsedSeconds: p.elapsedSeconds }), ...(p.error === undefined ? {} : { error: p.error }), ...(p.cancelled === undefined ? {} : { cancelled: p.cancelled }), runId: event.runId ?? old?.runId ?? null, order: resolveOrder(old?.order, clock) } }, 500)
  } else if (p.type === 'ask_user_question') {
    const key = p.questionId ?? event.eventId
    state.questions = bounded({ ...previous.questions, [key]: { ...p, runId: event.runId, source: event.source, order: resolveOrder(previous.questions[key]?.order, clock) } }, 100)
  } else if (p.type === 'engagement_ready' && event.source === 'runtime') state.handoffPending = true
  return state
}
export function streamDisconnected(state: StreamState): StreamState { return { ...state, transport: 'disconnected', recoveryRequired: true } }
export function mergeRunObservation(state: StreamState, run: ScopedRunView): StreamState {
  if (run.engagementId !== state.engagementId || run.threadId !== state.threadId) return state
  return { ...state, attempts: bounded({ ...state.attempts, [run.runId]: { ...state.attempts[run.runId], rawStatus: run.rawStatus } }, 100), recoveryRequired: !['success', 'error', 'timeout', 'interrupted'].includes(run.rawStatus) }
}
export function observedExecutionCount(state: StreamState): number { return Object.values(state.tools).filter(t => !t.delegation).length }
