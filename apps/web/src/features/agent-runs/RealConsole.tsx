/**
 * W10/W11 real Operator Console: the source Console's visual language (timeline,
 * inspector, command bar) bound to the new API only. Every card renders
 * validated public run data — messages, tools, invocations, structured
 * questions — with thread-level history provenance labeled. W11 adds truthful
 * graph-interrupt answering (server-validated scoped resume), file-backed HITL
 * decisions and an interrupt control; synthetic demo phases, OPSEC scores and
 * fabricated approvals are never rendered.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useConsoleSession, type ConsoleSession } from './use-console-session'
import { consoleInspector, consoleTimeline, isTerminalRunStatus, type ConsoleItem } from './console-view'
import { PlanStatusPanel, usePlanningGate } from './planning-gate'
// THROWAWAY PROTOTYPE (remove after UX review): chat-first briefing + hard
// execution gate variants, dev-only, activated by ?consoleVariant=A|B|C.
import { ConsoleGatePrototype, isConsolePrototypeActive, useGateVariant } from './consoleGatePrototype'

const MONO = "'JetBrains Mono', monospace"
const C = { ink: '#0F172A', body: '#334155', muted: '#94A3B8', border: '#E2E8F0', page: '#F8FAFC', red: '#DC2626' }

const PULSE_CSS = `@keyframes raptix-pulse-green { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } } .raptix-pulse-green { animation: raptix-pulse-green 1.4s ease-in-out infinite; }`

function Tag({ bg, color, children }: { bg: string; color: string; children: ReactNode }) {
  return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: bg, color, padding: '2px 7px', borderRadius: 4 }}>{children}</span>
}

function ConnectorDot({ color }: { color: string }) {
  return <div style={{ position: 'absolute', left: -5, top: 16, width: 10, height: 10, borderRadius: '50%', background: color, border: '2px solid #FFFFFF' }} />
}

function TransportChip({ transport, recoveryRequired, hasRun }: { transport: 'connected' | 'disconnected'; recoveryRequired: boolean; hasRun: boolean }) {
  if (!hasRun) return <Tag bg="#F1F5F9" color="#64748B">NO ACTIVE RUN</Tag>
  if (recoveryRequired && transport === 'disconnected') return <Tag bg="#FEF2F2" color={C.red}>RECOVERY REQUIRED</Tag>
  if (transport === 'connected') return (
    <span className="raptix-pulse-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#16A34A', background: '#DCFCE7', padding: '2px 8px', borderRadius: 10 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> LIVE
    </span>
  )
  return <Tag bg="#FEF3C7" color="#D97706">RECONNECTING</Tag>
}

/** W11 answer selection: held by the composer panel so one submit carries every pending question's answer. */
interface QuestionSelection { readonly selected: readonly string[]; readonly other: string }

const emptySelection: QuestionSelection = { selected: [], other: '' }

const questionId = (item: { kind: string; questionId?: string | null }): string | null => item.kind === 'question' && typeof item.questionId === 'string' && item.questionId.length > 0 ? item.questionId : null

const isAnswerableQuestion = (item: ConsoleItem, session: ConsoleSession): boolean => {
  const id = questionId(item)
  return id !== null && !session.answered.includes(id) && session.pendingQuestions.some(question => question.questionId === id)
}

/**
 * opencode-style composer questions: pending questions and their options
 * render directly on the prompt-input area; multiple questions sit side
 * by side with ‹ › navigation (buttons and arrow keys) starting from the
 * FIRST question, and a final CONFIRM step reviews every selection before
 * one submit sends the full answer map (LangGraph resolves every pending
 * interrupt in a single resume, so the submit unlocks once every answerable
 * question has a valid answer). Only server-observed pending questions
 * accept an answer; earlier questions stay browsable on the timeline with
 * their submitted answers.
 */
export function ComposerQuestionPanel({ questions, index, setIndex, session }: { questions: ConsoleItem[]; index: number; setIndex: (update: (value: number) => number) => void; session: ConsoleSession }) {
  // Steps: one per question plus a final CONFIRM review; the submit button
  // lives only on the confirm step.
  const steps = questions.length + 1
  const safeIndex = Math.min(Math.max(index, 0), steps - 1)
  const activeQuestion = questions[safeIndex]
  const isConfirm = activeQuestion === undefined
  const [selections, setSelections] = useState<Record<string, QuestionSelection>>({})
  const answerables = questions.filter(candidate => isAnswerableQuestion(candidate, session))
  const answerOf = (question: ConsoleItem): string | string[] | null => {
    const id = questionId(question)
    if (id === null) return null
    const selection = selections[id]
    if (selection === undefined) return null
    const usingOther = selection.other.trim().length > 0
    if (question.multiSelect) {
      const value = [...selection.selected, ...(usingOther ? [selection.other.trim()] : [])]
      return value.length > 0 ? value : null
    }
    return usingOther ? selection.other.trim() : selection.selected.length === 1 ? selection.selected[0]! : null
  }
  const readyCount = answerables.filter(question => answerOf(question) !== null).length
  const canSubmit = !session.answering && !session.submitting && answerables.length > 0 && readyCount === answerables.length
  const submit = (): void => {
    const answers: { questionId: string; value: string | string[] }[] = []
    for (const question of answerables) {
      const value = answerOf(question)
      if (value === null) return
      answers.push({ questionId: questionId(question)!, value })
    }
    void session.answerQuestion(answers)
  }
  const toggle = (question: ConsoleItem, label: string): void => {
    const id = questionId(question)
    if (id === null) return
    setSelections(previous => {
      const current = previous[id] ?? emptySelection
      const selected = question.multiSelect
        ? current.selected.includes(label) ? current.selected.filter(value => value !== label) : [...current.selected, label]
        : [label]
      return { ...previous, [id]: { selected, other: current.other } }
    })
  }
  const chooseOther = (question: ConsoleItem, other: string): void => {
    const id = questionId(question)
    if (id === null) return
    setSelections(previous => ({ ...previous, [id]: { selected: !question.multiSelect && other.trim() !== '' ? [] : previous[id]?.selected ?? [], other } }))
  }
  const move = (delta: number): void => setIndex(value => Math.min(Math.max(value + delta, 0), steps - 1))
  const onKeyDown = (event: ReactKeyboardEvent): void => {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
  }
  const answerable = activeQuestion !== undefined && isAnswerableQuestion(activeQuestion, session)
  const selection = activeQuestion !== undefined ? selections[questionId(activeQuestion) ?? ''] ?? emptySelection : emptySelection
  return (
    <div tabIndex={0} onKeyDown={onKeyDown} role="group" aria-label={`Question ${safeIndex + 1} of ${steps}`}
      style={{ background: '#FFFBEB', borderBottom: '1px solid #F59E0B', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, outline: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => move(-1)} disabled={safeIndex <= 0} aria-label="Previous question"
          style={{ fontSize: 14, lineHeight: 1, color: safeIndex <= 0 ? '#CBD5E1' : '#92400E', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 9px', cursor: safeIndex <= 0 ? 'default' : 'pointer' }}>‹</button>
        {isConfirm ? (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: readyCount === answerables.length && answerables.length > 0 ? '#DCFCE7' : '#FDE68A', color: readyCount === answerables.length && answerables.length > 0 ? '#15803D' : '#92400E', padding: '2px 7px', borderRadius: 4 }}>CONFIRM</span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: '#FDE68A', color: '#92400E', padding: '2px 7px', borderRadius: 4 }}>QUESTION {safeIndex + 1}/{questions.length}</span>
        )}
        {activeQuestion?.header && <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>{activeQuestion.header}</span>}
        {isConfirm ? (
          <span className={readyCount === answerables.length && answerables.length > 0 ? 'raptix-pulse-green' : undefined} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: readyCount === answerables.length && answerables.length > 0 ? '#15803D' : '#B45309' }}>
            ● {readyCount}/{answerables.length} ANSWERED{readyCount === answerables.length && answerables.length > 0 ? ' — READY TO SEND' : ''}
          </span>
        ) : (
          answerable && <span className="raptix-pulse-green" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#B45309' }}>● NEEDS YOUR ANSWER</span>
        )}
        <button onClick={() => move(1)} disabled={safeIndex >= steps - 1} aria-label="Next question"
          style={{ fontSize: 14, lineHeight: 1, color: safeIndex >= steps - 1 ? '#CBD5E1' : '#92400E', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 9px', cursor: safeIndex >= steps - 1 ? 'default' : 'pointer' }}>{isConfirm ? '↵' : '›'}</button>
      </div>
      {isConfirm ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.body }}>Review your answers, then send. Click a question to go back and edit it.</p>
          {questions.map((question, questionIndex) => {
            const value = answerOf(question)
            return (
              <button key={questionId(question) ?? questionIndex} onClick={() => setIndex(() => questionIndex)} disabled={session.answering}
                style={{ textAlign: 'left', background: '#FFFFFF', border: `1.5px solid ${value === null ? '#F59E0B' : '#A7F3D0'}`, borderRadius: 6, padding: '8px 10px', cursor: session.answering ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: value === null ? '#B45309' : '#047857' }}>
                  {questionIndex + 1}/{questions.length} {question.header ?? ''} — {value === null ? 'NOT ANSWERED YET' : 'ANSWERED'}
                </span>
                <span style={{ fontSize: 12, color: C.ink }}>{question.question}</span>
                {value !== null && <span style={{ fontSize: 11, fontWeight: 600, color: '#047857' }}>→ {Array.isArray(value) ? value.join(', ') : value}</span>}
              </button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button disabled={!canSubmit} onClick={submit}
              style={{ alignSelf: 'flex-start', background: canSubmit ? C.red : '#E2E8F0', color: canSubmit ? '#FFFFFF' : '#94A3B8', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default' }}>
              {session.answering ? 'Resuming run…' : 'Send answers & resume run'}
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: readyCount === answerables.length ? '#16A34A' : '#B45309' }}>
              {readyCount}/{answerables.length} questions answered — one submit answers every pending question.
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: C.muted }}>The answers are validated server-side against every pending graph interrupt; a successful resume returns a new run identity.</p>
        </div>
      ) : activeQuestion !== undefined ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{activeQuestion.question}</p>
          {answerable ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(activeQuestion.options ?? []).map(option => {
                  const active = selection.selected.includes(option.label)
                  return (
                    <button key={option.label} onClick={() => toggle(activeQuestion, option.label)} disabled={session.answering}
                      style={{ textAlign: 'left', background: active ? '#FEF3C7' : '#FFFFFF', border: `1.5px solid ${active ? '#F59E0B' : C.border}`, borderRadius: 6, padding: '8px 10px', cursor: session.answering ? 'default' : 'pointer' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{active ? '● ' : '○ '}{option.label}</div>
                      <div style={{ fontSize: 11, color: C.body }}>{option.description}</div>
                    </button>
                  )
                })}
                {activeQuestion.allowOther && (
                  <input value={selection.other} onChange={event => chooseOther(activeQuestion, event.target.value)} disabled={session.answering}
                    placeholder="Other — type a custom answer…"
                    style={{ fontSize: 12, color: C.ink, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', outline: 'none' }} />
                )}
              </div>
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Use ‹ › to move between questions — answers are sent together from the CONFIRM step.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeQuestion.answer && (
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#047857' }}>ANSWER</div>
                  <div style={{ fontSize: 12, color: C.ink, whiteSpace: 'pre-wrap' }}>{activeQuestion.answer}</div>
                </div>
              )}
              {activeQuestion.options?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {activeQuestion.options.map(option => (
                    <div key={option.label} style={{ background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{option.label}</div>
                      <div style={{ fontSize: 11, color: C.body }}>{option.description}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {!activeQuestion.answer && <p style={{ margin: 0, fontSize: 11, color: C.muted }}>This question is no longer answerable — its graph interrupt is not the server-observed pending one.</p>}
            </div>
          )}
        </>
      ) : null}
      {session.answerError && <p role="alert" style={{ margin: 0, fontSize: 12, color: C.red }}>{session.answerError}</p>}
    </div>
  )
}

/**
 * Collapsible detail frame shared by the model thinking trace and tool-call
 * args/output: collapsed by default with a one-click toggle; the expanded
 * body scrolls inside a fixed-height frame so long content never stretches
 * the timeline card. `cap={false}` renders structured children without the
 * height cap (used by the grouped activity block).
 */
function CollapseFrame({ label, color, meta, dark, cap = true, mono = true, children }: { label: string; color: string; meta?: string; dark?: boolean; cap?: boolean; mono?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: '#FFFFFF', overflow: 'hidden' }}>
      <button onClick={() => setOpen(value => !value)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '6px 10px', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 10, color: C.muted }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color }}>{label}</span>
        {meta && <span style={{ fontSize: 10, color: C.muted }}>{meta}</span>}
      </button>
      {open && (cap ? (
        <div style={{ maxHeight: 240, overflowY: 'auto', borderTop: `1px solid ${C.border}` }}>
          <pre style={{ margin: 0, padding: '8px 12px', fontSize: 11, fontFamily: mono ? MONO : undefined, color: dark ? '#0F172A' : '#475569', background: dark ? '#0B0F19' : undefined, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</pre>
        </div>
      ) : (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      ))}
    </div>
  )
}

export function ThinkingBlock({ reasoning }: { reasoning: string }) {
  return <CollapseFrame label="THINKING" color="#7C3AED" meta={`${reasoning.length.toLocaleString()} chars`}>{reasoning}</CollapseFrame>
}

/** GPT-style markdown body for assistant messages (GFM tables, code, lists). */
const markdownComponents: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  h1: ({ children }) => <h1 style={{ margin: '10px 0 6px', fontSize: 16, color: C.ink }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: '10px 0 6px', fontSize: 15, color: C.ink }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: '8px 0 4px', fontSize: 14, color: C.ink }}>{children}</h3>,
  ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  a: ({ children, href }) => <a href={href} style={{ color: '#2563EB' }}>{children}</a>,
  blockquote: ({ children }) => <blockquote style={{ margin: '0 0 8px', padding: '4px 12px', borderLeft: `3px solid ${C.border}`, color: C.body }}>{children}</blockquote>,
  table: ({ children }) => <div style={{ overflowX: 'auto', margin: '0 0 8px' }}><table style={{ borderCollapse: 'collapse', fontSize: 12 }}>{children}</table></div>,
  th: ({ children }) => <th style={{ border: `1px solid ${C.border}`, background: '#F1F5F9', padding: '5px 9px', textAlign: 'left', fontWeight: 700, color: C.ink }}>{children}</th>,
  td: ({ children }) => <td style={{ border: `1px solid ${C.border}`, padding: '5px 9px', color: C.ink }}>{children}</td>,
  pre: ({ children }) => <pre style={{ margin: '0 0 8px', background: '#0B0F19', color: '#E2E8F0', borderRadius: 6, padding: '10px 12px', overflowX: 'auto', fontSize: 11, fontFamily: MONO }}>{children}</pre>,
  code: ({ className, children }) => String(className ?? '').includes('language-')
    ? <code className={className} style={{ fontFamily: MONO }}>{children}</code>
    : <code style={{ background: '#F1F5F9', borderRadius: 4, padding: '1px 5px', fontFamily: MONO, fontSize: 12, color: '#0F172A' }}>{children}</code>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '10px 0' }} />,
}

function MarkdownView({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</Markdown>
    </div>
  )
}

/** One tool call inside an activity group: status chips + collapsible ARGS/OUTPUT. */
function ToolRow({ row }: { row: ConsoleItem }) {
  const ended = row.status !== undefined || row.content !== undefined
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', background: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#92400E', background: '#FDE68A', padding: '2px 8px', borderRadius: 4, fontFamily: MONO }}>Tool: {row.tool}</span>
        {row.delegation && <Tag bg="#EDE9FE" color="#7C3AED">DELEGATION</Tag>}
        {row.cancelled && <Tag bg="#F1F5F9" color="#64748B">CANCELLED</Tag>}
        {row.error && <Tag bg="#FEE2E2" color={C.red}>ERROR</Tag>}
        {row.truncated && <Tag bg="#FEF3C7" color="#D97706">TRUNCATED</Tag>}
        <span style={{ marginLeft: 'auto' }}>{ended
          ? <span style={{ display: 'inline-flex', width: 14, height: 14, borderRadius: '50%', background: row.error ? '#FEE2E2' : '#DCFCE7', color: row.error ? C.red : '#16A34A', fontSize: 9, alignItems: 'center', justifyContent: 'center' }}>{row.error ? '×' : '✓'}</span>
          : <span className="raptix-pulse-green" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />}</span>
      </div>
      {row.argsPreview && <CollapseFrame label="ARGS" color="#92400E" meta={`${row.argsPreview.length.toLocaleString()} chars`}>{row.argsPreview}</CollapseFrame>}
      {row.content && <CollapseFrame label="OUTPUT" color="#92400E" meta={`${row.content.length.toLocaleString()} chars`} dark>{row.content}</CollapseFrame>}
    </div>
  )
}

export function Card({ item, session }: { item: ConsoleItem; session: ConsoleSession }) {
  const provenance = item.source === 'checkpoint' || item.runId === null
    ? <Tag bg="#F1F5F9" color="#64748B">{item.source === 'checkpoint' ? 'HISTORY' : 'UNATTRIBUTED'}</Tag>
    : null
  if (item.kind === 'operator' || item.kind === 'agent') {
    const isOperator = item.kind === 'operator'
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color={isOperator ? '#2563EB' : '#7C3AED'} />
        <div style={{ background: isOperator ? '#EFF6FF' : '#EDE9FE', borderLeft: `3px solid ${isOperator ? '#2563EB' : '#7C3AED'}`, borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg={isOperator ? '#DBEAFE' : '#DDD6FE'} color={isOperator ? '#2563EB' : '#7C3AED'}>{isOperator ? 'OPERATOR' : 'AGENT'}</Tag>
            {item.agent && <Tag bg="#F1F5F9" color="#475569">{item.agent}</Tag>}
            {item.truncated && <Tag bg="#FEF3C7" color="#D97706">TRUNCATED</Tag>}
            {provenance}
          </div>
          {item.reasoning && <ThinkingBlock reasoning={item.reasoning} />}
          {item.text && <MarkdownView text={item.text} />}
        </div>
      </div>
    )
  }
  if (item.kind === 'tools') {
    const rows = item.tools ?? []
    const running = rows.some(row => row.status === undefined && row.content === undefined)
    const nameCounts = new Map<string, number>()
    for (const row of rows) if (row.tool) nameCounts.set(row.tool, (nameCounts.get(row.tool) ?? 0) + 1)
    const summary = [...nameCounts.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(' · ')
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#D97706" />
        <div style={{ background: '#FFFBEB', borderLeft: '3px solid #D97706', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg="#FEF3C7" color="#D97706">ACTION</Tag>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>{rows.length} tool call{rows.length === 1 ? '' : 's'}{summary ? ` — ${summary}` : ''}</span>
            <span style={{ marginLeft: 'auto' }}>{running
              ? <span className="raptix-pulse-green" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
              : <span style={{ display: 'inline-flex', width: 14, height: 14, borderRadius: '50%', background: '#DCFCE7', color: '#16A34A', fontSize: 9, alignItems: 'center', justifyContent: 'center' }}>✓</span>}</span>
            {provenance}
          </div>
          <CollapseFrame label="TOOL CALLS" color="#92400E" meta={`${rows.length}`} cap={false} mono={false}>
            {rows.map(row => <ToolRow key={row.id} row={row} />)}
          </CollapseFrame>
        </div>
      </div>
    )
  }
  if (item.kind === 'tool') {
    const ended = item.status !== undefined || item.content !== undefined
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#D97706" />
        <div style={{ background: '#FFFBEB', borderLeft: '3px solid #D97706', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg="#FEF3C7" color="#D97706">ACTION</Tag>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#92400E', background: '#FDE68A', padding: '2px 8px', borderRadius: 4, fontFamily: MONO }}>Tool: {item.tool}</span>
            {item.delegation && <Tag bg="#EDE9FE" color="#7C3AED">DELEGATION</Tag>}
            {item.cancelled && <Tag bg="#F1F5F9" color="#64748B">CANCELLED</Tag>}
            {item.error && <Tag bg="#FEE2E2" color={C.red}>ERROR</Tag>}
            {item.truncated && <Tag bg="#FEF3C7" color="#D97706">TRUNCATED</Tag>}
            <span style={{ marginLeft: 'auto' }}>{ended
              ? <span style={{ display: 'inline-flex', width: 14, height: 14, borderRadius: '50%', background: item.error ? '#FEE2E2' : '#DCFCE7', color: item.error ? C.red : '#16A34A', fontSize: 9, alignItems: 'center', justifyContent: 'center' }}>{item.error ? '×' : '✓'}</span>
              : <span className="raptix-pulse-green" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />}</span>
            {provenance}
          </div>
          {item.argsPreview && <CollapseFrame label="ARGS" color="#92400E" meta={`${item.argsPreview.length.toLocaleString()} chars`}>{item.argsPreview}</CollapseFrame>}
          {item.content && <CollapseFrame label="OUTPUT" color="#92400E" meta={`${item.content.length.toLocaleString()} chars`} dark>{item.content}</CollapseFrame>}
        </div>
      </div>
    )
  }
  if (item.kind === 'invocation') {
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#0EA5E9" />
        <div style={{ background: '#F0F9FF', borderLeft: '3px solid #0EA5E9', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg="#E0F2FE" color="#0369A1">{item.agent}</Tag>
            {item.sessionId && <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>{item.sessionId.slice(0, 24)}</span>}
            {item.status && <Tag bg="#F1F5F9" color="#475569">{item.status.toUpperCase()}</Tag>}
            {item.elapsedSeconds !== undefined && <Tag bg="#F1F5F9" color="#475569">{item.elapsedSeconds.toFixed(1)}s</Tag>}
            {item.cancelled && <Tag bg="#FEE2E2" color={C.red}>CANCELLED</Tag>}
            {item.error && <Tag bg="#FEE2E2" color={C.red}>ERROR</Tag>}
            {provenance}
          </div>
          {item.text && <p style={{ margin: 0, fontSize: 12, color: C.body, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>}
        </div>
      </div>
    )
  }
  if (item.kind === 'question') {
    const resolved = (questionId(item) !== null && session.answered.includes(questionId(item)!)) || item.answer !== undefined
    const pending = questionId(item) !== null && session.pendingQuestions.some(question => question.questionId === questionId(item)) && !resolved
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#F59E0B" />
        <div style={{ background: '#FFFBEB', border: `1px solid ${resolved ? '#FCD34D' : '#F59E0B'}`, borderLeft: '4px solid #F59E0B', borderRadius: '0 8px 8px 0', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg="#FDE68A" color="#92400E">{resolved ? 'PLANNING QUESTION — ANSWERED' : 'PLANNING QUESTION'}</Tag>
            {item.header && <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>{item.header}</span>}
            {item.multiSelect && <Tag bg="#FFFFFF" color="#92400E">MULTI-SELECT</Tag>}
            {provenance}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: C.ink, lineHeight: 1.55 }}>{item.question}</p>
          {item.answer && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#047857' }}>ANSWER</div>
              <div style={{ fontSize: 12, color: C.ink, whiteSpace: 'pre-wrap' }}>{item.answer}</div>
            </div>
          )}
          {item.options?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {item.options.map(option => (
                <div key={option.label} style={{ background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{option.label}</div>
                  <div style={{ fontSize: 11, color: C.body }}>{option.description}</div>
                </div>
              ))}
            </div>
          ) : null}
          <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{resolved ? 'Answer submitted; the resumed run continues below.' : pending ? 'Waiting for your answer — answer it in the question panel above the prompt input.' : 'Answering requires the server-observed pending graph interrupt for this thread. It was not restorable from the runtime snapshot.'}</p>
        </div>
      </div>
    )
  }
  if (item.kind === 'interrupt') {
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color={C.red} />
        <div style={{ background: '#FEF2F2', borderLeft: '3px solid #EF4444', borderRadius: '0 8px 8px 0', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag bg="#FEE2E2" color={C.red}>GRAPH INTERRUPT</Tag>
            {item.interruptId && <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>{item.interruptId.slice(0, 24)}</span>}
            {provenance}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: C.body }}>The thread is paused at a graph interrupt. Answer the server-observed pending question to resume.</p>
        </div>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#16A34A" />
      <div style={{ background: '#F0FDF4', borderLeft: '3px solid #16A34A', borderRadius: '0 8px 8px 0', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag bg="#DCFCE7" color="#15803D">ENGAGEMENT READY</Tag>
          {item.agent && <Tag bg="#F1F5F9" color="#475569">{item.agent}</Tag>}
          {provenance}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: C.body }}>Planning handoff signal observed. Charter documents refresh from the API; execution threads are created from the selector above.</p>
      </div>
    </div>
  )
}

/** Briefing-first composer prefill: the stored brief becomes the planning prompt. */
function buildBriefPrompt(project: ProjectViewModel): string {
  return `Briefing for "${project.displayName}" (target ${project.targetType}: ${project.targetValue}):\n\n${project.brief ?? ''}\n\nSoundwave, validate this brief against the engagement metadata and draft the planning bundle (RoE, CONOPS, deconfliction) from it.`
}

export default function RealConsole({ project }: { project: ProjectViewModel }) {
  const [gateVariant, setGateVariant] = useGateVariant()
  const gate = usePlanningGate(project)
  const session = useConsoleSession(project.id)
  const [draft, setDraft] = useState('')
  const timelineEnd = useRef<HTMLDivElement>(null)
  const timelineScroll = useRef<HTMLDivElement>(null)
  const briefPrefilledFor = useRef<string | null>(null)
  // Sticky-bottom auto-scroll: follow new events only while the operator is
  // already near the bottom — scrolling up to read history is never yanked
  // back by a streaming run; a jump button returns to the latest card.
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  const onTimelineScroll = (): void => {
    const el = timelineScroll.current
    if (!el) return
    setPinnedToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  useEffect(() => { if (typeof document !== 'undefined' && !document.getElementById('raptix-console-pulse')) { const style = document.createElement('style'); style.id = 'raptix-console-pulse'; style.textContent = PULSE_CSS; document.head.appendChild(style) } }, [])
  useEffect(() => { if (pinnedToBottom) timelineEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [session.stream?.events.length, pinnedToBottom])
  const items = useMemo(() => (session.stream ? consoleTimeline(session.stream, session.pendingQuestions) : []), [session.stream, session.pendingQuestions])
  const inspector = useMemo(() => (session.stream ? consoleInspector(session.stream) : null), [session.stream])
  // opencode behavior: the composer panel only surfaces questions that still
  // need an answer; submitted questions leave the panel and stay on the
  // timeline as ANSWER records.
  const questionCards = useMemo(() => items.filter(item => item.kind === 'question' && isAnswerableQuestion(item, session)), [items, session])
  // Active composer question: a newly arrived batch always opens on the
  // FIRST question; the CONFIRM step is the last position.
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const seenQuestionCount = useRef(0)
  useEffect(() => {
    if (questionCards.length > seenQuestionCount.current) setActiveQuestionIndex(0)
    seenQuestionCount.current = questionCards.length
    setActiveQuestionIndex(value => Math.min(Math.max(value, 0), questionCards.length - 1))
  }, [questionCards.length])
  const runActive = session.run !== null && !isTerminalRunStatus(session.run.rawStatus)
  const activeThread = session.threads.find(thread => thread.threadId === session.activeThreadId) ?? null
  const executionLocked = activeThread !== null && activeThread.kind === 'execution' && !gate.executionArmed
  const canSend = session.activeThreadId !== null && !session.submitting && !runActive && !executionLocked
  // Briefing-first one-click start: no bound thread yet and a briefing (or
  // any first message) is already loaded in the composer.
  const briefingPending = session.status === 'ready' && session.threads.length === 0 && session.activeThreadId === null && draft.trim().length > 0
  const startPlanning = (): void => {
    const text = draft
    void session.createThread('planning', text).then(created => { if (created) setDraft('') })
  }
  // Revalidate planning readiness once a run reaches a terminal status.
  const lastRunStatus = session.run?.rawStatus ?? null
  useEffect(() => { if (lastRunStatus !== null && isTerminalRunStatus(lastRunStatus)) gate.refreshReadiness() }, [lastRunStatus, gate.refreshReadiness])
  // Briefing-first prefill: on a fresh project, load the stored brief as the
  // planning prompt so the first send briefs Soundwave directly.
  useEffect(() => {
    if (briefPrefilledFor.current === project.id) return
    if (session.status === 'loading') return
    briefPrefilledFor.current = project.id
    if (session.threads.length === 0 && project.brief && draft === '') setDraft(buildBriefPrompt(project))
  }, [session.status, session.threads.length, project, draft])
  const inputStyle: CSSProperties = { flex: 1, fontFamily: MONO, fontSize: 13, color: C.ink, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', outline: 'none' }
  if (isConsolePrototypeActive()) {
    return <div style={{ background: C.page, height: '100vh' }}><ConsoleGatePrototype project={project} rawVariant={gateVariant} setVariant={setGateVariant} /></div>
  }
  if (session.status === 'loading') return <div style={{ background: C.page, minHeight: '100%', padding: 24 }}><p role="status" style={{ fontSize: 13, color: C.body }}>Loading bound threads…</p></div>
  if (session.status === 'error') {
    return (
      <div style={{ background: C.page, minHeight: '100%', padding: 24 }}>
        <div role="alert" style={{ background: '#FEF2F2', border: `1.5px solid ${C.red}`, borderRadius: 10, padding: '20px 24px', maxWidth: 640 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Console API unavailable</div>
          <div style={{ fontSize: 13, color: C.body, marginTop: 4 }}>{session.error}</div>
          <button onClick={session.refresh} style={{ marginTop: 12, background: C.red, color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: C.page, overflow: 'hidden' }}>
      <div style={{ width: '65%', minWidth: 360, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, padding: '10px 18px', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Execution Timeline</span>
          <TransportChip transport={session.transport} recoveryRequired={session.recoveryRequired} hasRun={session.run !== null} />
          {session.run && <Tag bg="#F1F5F9" color="#475569">RUN {session.run.rawStatus.toUpperCase()}</Tag>}
          {session.run && !isTerminalRunStatus(session.run.rawStatus) && (
            <button disabled={session.cancelling} onClick={() => { void session.cancelRun() }}
              title="Server interrupt: pauses at a checkpoint and keeps the thread resumable; external side effects are not undone."
              style={{ fontSize: 11, fontWeight: 600, color: session.cancelling ? '#94A3B8' : C.red, background: '#FFFFFF', border: `1px solid ${C.red}`, borderRadius: 6, padding: '4px 10px', cursor: session.cancelling ? 'default' : 'pointer' }}>
              {session.cancelling ? 'Interrupting…' : 'Interrupt run'}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              aria-label="Bound thread"
              value={session.activeThreadId ?? ''}
              onChange={event => { if (event.target.value) session.selectThread(event.target.value) }}
              style={{ fontSize: 12, color: C.ink, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', maxWidth: 220 }}
            >
              <option value="" disabled>{session.threads.length ? 'Select a thread…' : 'No bound threads yet'}</option>
              {session.threads.map(thread => <option key={thread.threadId} value={thread.threadId}>{thread.kind} • {new Date(thread.updatedAt).toLocaleString()}</option>)}
            </select>
            <button disabled={session.creating} onClick={() => { void session.createThread('planning') }} style={{ fontSize: 12, fontWeight: 600, color: '#FFFFFF', background: session.creating ? '#FCA5A5' : C.red, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: session.creating ? 'default' : 'pointer' }}>
              {session.creating ? 'Creating…' : 'New planning chat'}
            </button>
            <button disabled={session.creating || !gate.executionArmed} onClick={() => { void session.createThread('execution') }} title={gate.executionArmed ? undefined : 'Execution is locked until the planning bundle validates and the handoff is confirmed (Plan status panel).'} style={{ fontSize: 12, fontWeight: 600, color: gate.executionArmed ? '#475569' : C.muted, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: gate.executionArmed ? 'pointer' : 'default' }}>
              {gate.executionArmed ? 'New execution chat' : 'New execution chat 🔒'}
            </button>
            <button onClick={session.refresh} aria-label="Refresh console" style={{ fontSize: 12, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>↻</button>
          </div>
        </div>
        {activeThread && <div style={{ padding: '6px 18px', background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, fontFamily: MONO }}>
          {activeThread.kind} thread {activeThread.threadId.slice(0, 18)}… • assistant {activeThread.assistantId} • bound {new Date(activeThread.createdAt).toLocaleString()}
        </div>}
        <div ref={timelineScroll} onScroll={onTimelineScroll} style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '18px 24px 18px 32px' }}>
          {briefingPending && (
            <div role="status" style={{ maxWidth: 720, margin: '0 auto 16px', border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.red}`, background: '#FFFFFF', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.ink }}>Briefing loaded</p>
                <p style={{ margin: 0, fontSize: 12, color: C.body, lineHeight: 1.5 }}>One click starts the planning chat and sends your brief — Soundwave will draft the RoE & scope from it. Live thinking appears on the timeline once the run starts.</p>
              </div>
              <button
                onClick={startPlanning}
                disabled={session.creating || session.submitting}
                style={{ flexShrink: 0, background: session.creating || session.submitting ? '#FCA5A5' : C.red, color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: session.creating || session.submitting ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {session.creating ? 'Creating…' : session.submitting ? 'Submitting…' : 'Start planning chat →'}
              </button>
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 1, background: C.border }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(item => <Card key={item.id} item={item} session={session} />)}
              {session.activeThreadId && items.length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No run events recorded for this thread yet. Send a root message below; history appears after the first acknowledged run.</p>
              )}
              {!session.activeThreadId && (
                <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Select a bound thread or create a new planning chat. The console shows only server-acknowledged runs and owned checkpoint history.</p>
              )}
              <div ref={timelineEnd} />
            </div>
          </div>
          {!pinnedToBottom && (
            <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
              <button onClick={() => { setPinnedToBottom(true); timelineEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }}
                style={{ pointerEvents: 'auto', fontSize: 11, fontWeight: 700, color: '#FFFFFF', background: '#334155', border: 'none', borderRadius: 10, padding: '5px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,23,42,0.25)' }}>
                ↓ Jump to latest
              </button>
            </div>
          )}
        </div>
        {questionCards.length > 0 && (
          <ComposerQuestionPanel questions={questionCards} index={activeQuestionIndex} setIndex={setActiveQuestionIndex} session={session} />
        )}
        {questionCards.length === 0 && (
        <div style={{ flexShrink: 0, background: '#FFFFFF', borderTop: `1px solid ${C.border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontFamily: MONO, color: C.red, fontWeight: 700, whiteSpace: 'nowrap' }}>[{activeThread ? activeThread.kind : 'no thread'}] &gt;</span>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && canSend) { void session.send(draft); setDraft('') } }}
            placeholder={executionLocked
              ? 'Execution is locked — confirm the planning handoff first (Plan status panel)…'
              : session.activeThreadId ? (runActive ? 'A run is already active on this thread…' : 'Send a root message to the bound assistant…') : 'Select or create a thread first…'}
            disabled={!session.activeThreadId || executionLocked}
            style={inputStyle}
          />
          <button
            disabled={!canSend || draft.trim().length === 0}
            onClick={() => { void session.send(draft); setDraft('') }}
            style={{ background: canSend && draft.trim().length > 0 ? C.red : '#E2E8F0', color: canSend && draft.trim().length > 0 ? '#FFFFFF' : '#94A3B8', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: canSend && draft.trim().length > 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {session.submitting ? 'Submitting…' : 'Send'}
          </button>
        </div>
        )}
        {(session.submitError || session.error) && <div role="alert" style={{ background: '#FEF2F2', borderTop: `1px solid #FECACA`, padding: '8px 16px', fontSize: 12, color: C.red }}>{session.submitError ?? session.error}</div>}
      </div>
      <div style={{ width: '35%', minWidth: 280, display: 'flex', flexDirection: 'column', background: '#FFFFFF', overflowY: 'auto' }}>
        <PlanStatusPanel gate={gate} projectName={project.displayName} />
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Agent Inspector</span>
            {inspector && <>
              <Tag bg="#F1F5F9" color="#475569">SESSIONS {inspector.invocations.length}</Tag>
              <Tag bg="#F1F5F9" color="#475569">TOOLS {inspector.tools.length}</Tag>
              {inspector.questions > 0 && <Tag bg="#FDE68A" color="#92400E">QUESTIONS {inspector.questions}</Tag>}
            </>}
          </div>
        </div>
        <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!inspector && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Select a thread to inspect its runtime sessions.</p>}
          {inspector && inspector.invocations.length === 0 && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>No subagent sessions recorded for this thread.</p>}
          {inspector?.invocations.map(invocation => (
            <div key={invocation.key} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{invocation.agent}</span>
                <Tag bg={invocation.status === 'running' ? '#DCFCE7' : '#F1F5F9'} color={invocation.status === 'running' ? '#16A34A' : '#475569'}>{invocation.status.toUpperCase()}</Tag>
                {invocation.elapsedSeconds !== undefined && <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>{invocation.elapsedSeconds.toFixed(1)}s</span>}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, overflowWrap: 'anywhere' }}>
                {invocation.sessionId ? `session ${invocation.sessionId}` : 'session unknown'} • {invocation.runId === null ? 'thread-level history' : `run ${invocation.runId.slice(0, 18)}…`}
              </div>
            </div>
          ))}
          {session.cancelError && <p role="alert" style={{ margin: 0, fontSize: 12, color: C.red }}>{session.cancelError}</p>}
          {inspector && inspector.tools.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Tool activity</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {inspector.tools.slice(-12).reverse().map(tool => (
                  <div key={tool.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: MONO }}>
                    <span style={{ color: C.ink, fontWeight: 600 }}>{tool.name}</span>
                    <span style={{ color: tool.error ? C.red : tool.cancelled ? C.muted : '#16A34A' }}>{tool.error ? 'error' : tool.cancelled ? 'cancelled' : tool.status ?? 'observed'}</span>
                    {tool.delegation && <span style={{ color: '#7C3AED' }}>delegation</span>}
                    {tool.runId === null && <span style={{ color: C.muted }}>history</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>HITL approvals</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {session.approvals.loading && <span style={{ fontSize: 10, color: C.muted }}>loading…</span>}
                <button onClick={session.refreshApprovals} aria-label="Refresh approvals" style={{ fontSize: 11, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 7px', cursor: 'pointer' }}>↻</button>
              </span>
            </div>
            {session.approvals.list.length === 0 && <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{session.approvals.error ?? 'No pending file-backed approval requests for this engagement.'}</p>}
            {session.approvals.list.map(approval => {
              const inFlight = session.approvals.decidingId === approval.requestId
              return (
                <div key={approval.requestId} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: MONO }}>{approval.toolName}</span>
                    <Tag bg="#F1F5F9" color="#475569">{approval.agentName}</Tag>
                    {approval.matchedRule.techniqueTag && <Tag bg="#FEE2E2" color={C.red}>{approval.matchedRule.techniqueTag}</Tag>}
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: C.body, lineHeight: 1.45 }}>{approval.reason}</p>
                  <pre style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: '#475569', background: C.page, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 80, overflowY: 'auto' }}>{JSON.stringify(approval.toolArgsRedacted, null, 1)}</pre>
                  <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>requested {new Date(approval.createdAtSeconds * 1000).toLocaleString()} • timeout {Math.round(approval.matchedRule.timeoutSeconds)}s → {approval.matchedRule.defaultOnTimeout}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={inFlight || session.approvals.decidingId !== null} onClick={() => { void session.decideApproval(approval.requestId, 'allow') }}
                      style={{ background: inFlight ? '#FCA5A5' : C.red, color: '#FFFFFF', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: inFlight ? 'default' : 'pointer' }}>
                      {inFlight ? 'Deciding…' : 'Approve'}
                    </button>
                    <button disabled={session.approvals.decidingId !== null} onClick={() => { void session.decideApproval(approval.requestId, 'deny') }}
                      style={{ background: '#FFFFFF', color: '#475569', border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: session.approvals.decidingId !== null ? 'default' : 'pointer' }}>
                      Reject
                    </button>
                  </div>
                </div>
              )
            })}
            {session.approvals.decideError && <p role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: C.red }}>{session.approvals.decideError}</p>}
          </div>
          <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            Inspector shows only observed runtime instances. Approvals are engagement-scoped file-backed requests; a decision is only recorded after server acknowledgement.
          </p>
        </div>
      </div>
    </div>
  )
}
