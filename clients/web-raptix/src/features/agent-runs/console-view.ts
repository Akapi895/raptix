/**
 * W10 real Console view model: pure mapping from the W08/W09 stream state to
 * ordered timeline items and inspector summary. No React, no fetch — safe for
 * unit tests. Live events render chronologically; checkpoint history merged by
 * {@link mergeThreadHistory} has no stream events, so history-only entries are
 * appended (messages, then invocations, tools, questions in snapshot order)
 * with thread-level provenance, deduped by provenance identity against the
 * live event set so reconnects never duplicate cards.
 */
import type { ScopedRunView } from '@raptix/web-contracts'
import type { StreamState } from './stream-reducer'

export type ConsoleItemKind = 'operator' | 'agent' | 'tool' | 'invocation' | 'question' | 'interrupt' | 'handoff'

export interface ConsoleItem {
  id: string
  kind: ConsoleItemKind
  /** Provenance label: acknowledged run, or thread-level history. */
  runId: string | null
  source: 'runtime' | 'checkpoint'
  truncated?: boolean
  /* message/invocation */
  text?: string
  agent?: string
  messageId?: string | null
  /* tool */
  tool?: string
  toolId?: string | null
  content?: string
  argsPreview?: string
  status?: string
  error?: boolean
  cancelled?: boolean
  delegation?: boolean
  /* invocation */
  sessionId?: string
  elapsedSeconds?: number
  /* question (read-only until W11 HITL) */
  question?: string
  header?: string
  options?: { label: string; description: string }[]
  questionId?: string | null
  /* interrupt */
  interruptId?: string | null
}

export const TERMINAL_RUN_STATUSES = ['success', 'error', 'timeout', 'interrupted'] as const

export function isTerminalRunStatus(status: string | undefined | null): boolean {
  return status !== undefined && status !== null && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status)
}

const invocationKey = (sessionId: string | undefined, fallback: string): string => sessionId ?? `unattributed:${fallback}`

function liveItems(state: StreamState): ConsoleItem[] {
  const items: ConsoleItem[] = []
  for (const event of state.events) {
    const p = event.payload
    const base = { id: event.eventId, runId: event.runId, source: event.source }
    if (p.type === 'message') items.push({ ...base, kind: p.role === 'user' ? 'operator' : 'agent', text: p.content, messageId: p.messageId, truncated: p.truncated })
    else if (p.type === 'tool_call' || p.type === 'tool_result') items.push({ ...base, kind: 'tool', tool: p.name, toolId: p.toolCallId, sessionId: undefined, argsPreview: p.argsPreview, content: p.content, status: p.status, error: p.error, cancelled: p.cancelled, delegation: p.delegation, truncated: p.truncated })
    else if (p.type === 'subagent_tool_call' || p.type === 'subagent_tool_result') items.push({ ...base, kind: 'tool', tool: p.tool ?? 'tool', toolId: p.toolId ?? null, sessionId: p.sessionId, argsPreview: p.argsPreview, content: p.content, status: p.status, error: p.error, cancelled: p.cancelled, delegation: p.tool === 'task', truncated: p.truncated })
    else if (p.type === 'subagent_start' || p.type === 'subagent_message' || p.type === 'subagent_end') items.push({ ...base, kind: 'invocation', agent: p.agent, sessionId: p.sessionId, text: p.type === 'subagent_message' ? p.text : p.type === 'subagent_start' ? p.prompt : undefined, status: p.status, error: p.error, cancelled: p.cancelled, elapsedSeconds: p.elapsedSeconds })
    else if (p.type === 'ask_user_question') items.push({ ...base, kind: 'question', question: p.question, header: p.header, options: p.options, questionId: p.questionId })
    else if (p.type === 'interrupt') items.push({ ...base, kind: 'interrupt', interruptId: p.interruptId })
    else if (p.type === 'engagement_ready') items.push({ ...base, kind: 'handoff', agent: p.agent })
  }
  return items
}

export function consoleTimeline(state: StreamState): ConsoleItem[] {
  const items = liveItems(state)
  const seenMessages = new Set(items.map(item => item.messageId).filter((id): id is string => typeof id === 'string'))
  const seenTools = new Set(items.filter(item => item.kind === 'tool').map(item => JSON.stringify([item.sessionId ?? '', item.toolId ?? item.id])))
  const seenInvocations = new Set(items.filter(item => item.kind === 'invocation').map(item => invocationKey(item.sessionId, item.id)))
  const seenQuestions = new Set(items.filter(item => item.kind === 'question').map(item => item.questionId ?? item.id))
  for (const entry of Object.values(state.messages)) {
    if (entry.source !== 'checkpoint' || entry.messageId === null || seenMessages.has(entry.messageId)) continue
    seenMessages.add(entry.messageId)
    items.push({ id: `history-message:${entry.messageId}`, kind: entry.role === 'user' ? 'operator' : 'agent', runId: null, source: 'checkpoint', text: entry.content, messageId: entry.messageId, truncated: entry.truncated })
  }
  for (const [key, invocation] of Object.entries(state.invocations)) {
    if (seenInvocations.has(key)) continue
    seenInvocations.add(key)
    items.push({ id: `history-invocation:${key}`, kind: 'invocation', agent: invocation.agent, sessionId: invocation.sessionId, runId: null, source: 'checkpoint', status: invocation.status, ...(invocation.elapsedSeconds === undefined ? {} : { elapsedSeconds: invocation.elapsedSeconds }) })
  }
  for (const [key, tool] of Object.entries(state.tools)) {
    if (tool.source !== 'checkpoint' || seenTools.has(key)) continue
    seenTools.add(key)
    items.push({ id: `history-tool:${key}`, kind: 'tool', tool: tool.name, runId: null, source: 'checkpoint', content: tool.content, argsPreview: tool.argsPreview, status: tool.status, error: tool.error, cancelled: tool.cancelled, delegation: tool.delegation, truncated: tool.truncated })
  }
  for (const [key, question] of Object.entries(state.questions)) {
    const domain = question.questionId ?? key
    if (seenQuestions.has(domain)) continue
    seenQuestions.add(domain)
    items.push({ id: `history-question:${key}`, kind: 'question', runId: null, source: question.source, question: question.question, header: question.header, options: question.options, questionId: question.questionId ?? null })
  }
  return items
}

export interface ConsoleInspector {
  invocations: { key: string; agent: string; sessionId?: string; status: string; elapsedSeconds?: number; runId: string | null }[]
  tools: { key: string; name: string; status?: string; error?: boolean; cancelled?: boolean; delegation: boolean; truncated: boolean; runId: string | null; source: string }[]
  questions: number
}

export function consoleInspector(state: StreamState): ConsoleInspector {
  return {
    invocations: Object.entries(state.invocations).map(([key, invocation]) => ({ key, agent: invocation.agent, ...(invocation.sessionId ? { sessionId: invocation.sessionId } : {}), status: invocation.status, ...(invocation.elapsedSeconds === undefined ? {} : { elapsedSeconds: invocation.elapsedSeconds }), runId: invocation.runId })),
    tools: Object.entries(state.tools).map(([key, tool]) => ({ key, name: tool.name, ...(tool.status === undefined ? {} : { status: tool.status }), ...(tool.error === undefined ? {} : { error: tool.error }), ...(tool.cancelled === undefined ? {} : { cancelled: tool.cancelled }), delegation: tool.delegation, truncated: tool.truncated, runId: tool.runId, source: tool.source })),
    questions: Object.keys(state.questions).length,
  }
}

/** Latest non-terminal run to observe, or null when the thread only has history. */
export function activeRunFromPage(runs: readonly ScopedRunView[]): ScopedRunView | null {
  for (const run of runs) if (!isTerminalRunStatus(run.rawStatus)) return run
  return null
}
