/**
 * W10 real Console view model: pure mapping from the W08/W09 stream state to
 * ordered timeline items and inspector summary. No React, no fetch — safe for
 * unit tests.
 *
 * Every card is read from the identity-deduped reducer maps (never from the raw
 * event log, which repeats whole runs on every reconnect / stream-mode replay)
 * and ordered by each identity's first-seen clock position. This keeps the
 * timeline consistent: one card per message / tool call / invocation / question,
 * no empty reasoning-only AGENT cards, no `ask_user_question` tool card beside
 * its PLANNING QUESTION card, and checkpoint history interleaved with live
 * events instead of grouped by card kind.
 */
import type { PendingInterruptView, ScopedRunView } from '@raptix/web-contracts'
import type { StreamState } from './stream-reducer'

export type ConsoleItemKind = 'operator' | 'agent' | 'tool' | 'tools' | 'invocation' | 'question' | 'interrupt' | 'handoff'

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
  /** Model thinking trace (assistant messages only; rendered collapsed). */
  reasoning?: string
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
  /* question (answerable when the server restored/pends this exact interrupt) */
  question?: string
  header?: string
  options?: { label: string; description: string }[]
  questionId?: string | null
  multiSelect?: boolean
  allowOther?: boolean
  /** Submitted answer recovered from the matching ask_user_question tool result. */
  answer?: string
  /* interrupt */
  interruptId?: string | null
  /** Consecutive tool calls collapsed into one activity group (kind 'tools'). */
  tools?: ConsoleItem[]
}

export const TERMINAL_RUN_STATUSES = ['success', 'error', 'timeout', 'interrupted'] as const

export function isTerminalRunStatus(status: string | undefined | null): boolean {
  return status !== undefined && status !== null && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status)
}

interface Ordered { order: number; item: ConsoleItem }

/**
 * One card per message line, read from the reduced message map in clock order:
 * keyed entries are already deltas-merged, and consecutive anonymous (null-id)
 * delta entries accumulate into a single card. Empty content — reasoning-only
 * chunks and the empty assistant snapshot a tool-only turn leaves behind — never
 * creates a card. An id-carrying entry adopts the open anonymous card instead of
 * forking a second one.
 */
function messageItems(state: StreamState): Ordered[] {
  const items: Ordered[] = []
  const byMessageId = new Map<string, Ordered>()
  let open: Ordered | null = null
  for (const m of Object.values(state.messages).sort((a, b) => a.order - b.order)) {
    if (m.content === '' && !m.reasoning) continue
    const mid = m.messageId
    const existing = mid !== null ? byMessageId.get(mid) : undefined
    if (existing !== undefined) {
      existing.item.text = m.content
      existing.item.reasoning = m.reasoning
      existing.item.truncated = m.truncated
      existing.order = Math.min(existing.order, m.order)
      open = existing
      continue
    }
    if (open !== null && open.item.messageId === null) {
      open.item.messageId = mid
      open.item.text = mid === null ? `${open.item.text ?? ''}${m.content}` : m.content
      open.item.reasoning = m.reasoning ?? open.item.reasoning
      open.item.truncated = open.item.truncated || m.truncated
      open.order = Math.min(open.order, m.order)
      open.item.source = m.source
      open.item.runId = m.runId ?? open.item.runId
      if (mid !== null) byMessageId.set(mid, open)
      continue
    }
    const card: Ordered = { order: m.order, item: { id: mid === null ? `msg-anon:${m.order}` : `msg:${mid}`, runId: m.runId, source: m.source, kind: m.role === 'user' ? 'operator' : 'agent', text: m.content, messageId: mid, ...(m.reasoning ? { reasoning: m.reasoning } : {}), truncated: m.truncated } }
    if (mid !== null) byMessageId.set(mid, card)
    items.push(card)
    open = card
  }
  return items
}

/**
 * Tools come from the identity-deduped `state.tools` map — one card per logical
 * call (the reducer folds a call and its result by tool id), so replayed runs
 * never stack duplicate ACTION cards. The middleware `ask_user_question` call is
 * skipped: its PLANNING QUESTION card is the single representation.
 */
function toolItems(state: StreamState): Ordered[] {
  const items: Ordered[] = []
  for (const [key, tool] of Object.entries(state.tools)) {
    if (tool.name === 'ask_user_question') continue
    let rawToolId: string | null = null
    try {
      const parsed = JSON.parse(key) as [string, string | null]
      if (typeof parsed[1] === 'string') rawToolId = parsed[1]
    } catch { /* malformed key: leave the tool id unknown */ }
    items.push({ order: tool.order, item: { id: `tool:${key}`, kind: 'tool', tool: tool.name, toolId: rawToolId, sessionId: undefined, runId: tool.runId, source: tool.source, argsPreview: tool.argsPreview, content: tool.content, status: tool.status, error: tool.error, cancelled: tool.cancelled, delegation: tool.delegation, truncated: tool.truncated } })
  }
  return items
}

function invocationItems(state: StreamState): Ordered[] {
  return Object.entries(state.invocations).map(([key, invocation]) => ({ order: invocation.order, item: { id: `invocation:${key}`, kind: 'invocation' as const, agent: invocation.agent, sessionId: invocation.sessionId, runId: invocation.runId, source: invocation.runId === null ? 'checkpoint' as const : 'runtime' as const, status: invocation.status, ...(invocation.elapsedSeconds === undefined ? {} : { elapsedSeconds: invocation.elapsedSeconds }), ...(invocation.error === undefined ? {} : { error: invocation.error }), ...(invocation.cancelled === undefined ? {} : { cancelled: invocation.cancelled }) } }))
}

/** Question parsed out of an `ask_user_question` tool call's args. */
interface QuestionArgs { questionId?: string; question?: string; header?: string; options?: { label: string; description: string }[]; multiSelect?: boolean; allowOther?: boolean }

/**
 * Questions render from the identity-deduped `ask_user_question` tool map: the
 * call args carry the full question payload and the result carries the answer,
 * so one card per question survives the capped event log with its answer intact.
 * Custom `ask_user_question` events without a matching tool call are a fallback;
 * the server-observed pending interrupt always sorts last.
 */
function questionItems(state: StreamState, pendingQuestions?: readonly PendingInterruptView[] | null): Ordered[] {
  const items: Ordered[] = []
  const seenIds = new Set<string>()
  const seenTexts = new Set<string>()
  // Match on questionId OR the question text so the tool-call copy and a custom
  // event copy of the same question (one carries a questionId, the other does
  // not) collapse instead of both rendering.
  const fresh = (questionId: string | null | undefined, header: string | undefined, question: string | undefined): boolean => {
    const textKey = `${header ?? ''}|${question ?? ''}`
    if (questionId && seenIds.has(questionId)) return false
    if (seenTexts.has(textKey)) return false
    if (questionId) seenIds.add(questionId)
    seenTexts.add(textKey)
    return true
  }
  for (const [key, tool] of Object.entries(state.tools)) {
    if (tool.name !== 'ask_user_question') continue
    let parsed: QuestionArgs
    try { parsed = JSON.parse(tool.argsPreview ?? '') as QuestionArgs } catch { continue }
    if (!parsed.question || !fresh(parsed.questionId, parsed.header, parsed.question)) continue
    items.push({ order: tool.order, item: { id: `question:${key}`, kind: 'question', runId: tool.runId, source: tool.source, question: parsed.question, header: parsed.header, options: parsed.options, questionId: parsed.questionId ?? null, multiSelect: parsed.multiSelect === true, allowOther: parsed.allowOther === true, ...(tool.content ? { answer: tool.content } : {}) } })
  }
  for (const [key, question] of Object.entries(state.questions)) {
    if (!fresh(question.questionId, question.header, question.question)) continue
    items.push({ order: question.order, item: { id: `question-event:${key}`, kind: 'question', runId: question.runId, source: question.source, question: question.question, header: question.header, options: question.options, questionId: question.questionId ?? null, multiSelect: question.multiSelect === true, allowOther: question.allowOther === true } })
  }
  // Some LangGraph runtimes expose live interrupts only in tasks[].interrupts;
  // the server validates and projects them into the thread snapshot, while
  // neither the stream nor checkpoint transcript has a card. They always sort
  // last, in snapshot order.
  for (const pendingQuestion of pendingQuestions ?? []) {
    if (!fresh(pendingQuestion.questionId, pendingQuestion.header, pendingQuestion.question)) continue
    items.push({ order: Number.MAX_SAFE_INTEGER, item: { id: `pending-question:${pendingQuestion.questionId}`, kind: 'question', runId: null, source: pendingQuestion.source, question: pendingQuestion.question, header: pendingQuestion.header, options: pendingQuestion.options, questionId: pendingQuestion.questionId, multiSelect: pendingQuestion.multiSelect, allowOther: pendingQuestion.allowOther } })
  }
  return items
}

export function consoleTimeline(state: StreamState, pendingQuestions?: readonly PendingInterruptView[] | null): ConsoleItem[] {
  const items: Ordered[] = [...messageItems(state), ...toolItems(state), ...invocationItems(state), ...questionItems(state, pendingQuestions)]
  // Interrupt / handoff are event-only signals with no reducer map; they trail
  // every clock-ordered card in arrival order.
  state.events.forEach((event, index) => {
    const p = event.payload
    if (p.type === 'interrupt') items.push({ order: state.clock + index, item: { id: event.eventId, kind: 'interrupt', runId: event.runId, source: event.source, interruptId: p.interruptId } })
    else if (p.type === 'engagement_ready') items.push({ order: state.clock + index, item: { id: event.eventId, kind: 'handoff', runId: event.runId, source: event.source, agent: p.agent } })
  })
  items.sort((a, b) => a.order - b.order)
  return groupToolRuns(items.map(entry => entry.item))
}

/** GPT-style activity groups: consecutive tool calls render as ONE collapsible
 * block instead of a wall of per-tool cards; any non-tool card breaks a run. */
export function groupToolRuns(items: ConsoleItem[]): ConsoleItem[] {
  const grouped: ConsoleItem[] = []
  for (const item of items) {
    const last = grouped[grouped.length - 1]
    if (item.kind === 'tool' && last?.kind === 'tools') last.tools?.push(item)
    else if (item.kind === 'tool') grouped.push({ ...item, id: `tools:${item.id}`, kind: 'tools', tools: [item] })
    else grouped.push(item)
  }
  return grouped
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
