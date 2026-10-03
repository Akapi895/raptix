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
import type { CSSProperties, ReactNode } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useConsoleSession, type ConsoleSession } from './use-console-session'
import { consoleInspector, consoleTimeline, isTerminalRunStatus, type ConsoleItem } from './console-view'

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

/** W11 answer form: labels are sent verbatim; the producer strips the "(Recommended)" suffix. */
function QuestionAnswerForm({ item, session }: { item: ConsoleItem; session: ConsoleSession }) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const [other, setOther] = useState('')
  const questionId = item.questionId ?? ''
  const options = item.options ?? []
  const toggle = (label: string): void => {
    if (item.multiSelect) setSelected(previous => previous.includes(label) ? previous.filter(value => value !== label) : [...previous, label])
    else setSelected([label])
  }
  const single = !item.multiSelect
  const usingOther = other.trim().length > 0
  const value = item.multiSelect
    ? [...selected, ...(usingOther ? [other.trim()] : [])]
    : usingOther ? other.trim() : selected[0]
  const valid = item.multiSelect ? value.length > 0 : (usingOther || selected.length === 1)
  const disabled = session.answering || session.submitting || !valid
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map(option => {
          const active = selected.includes(option.label)
          return (
            <button key={option.label} onClick={() => toggle(option.label)} disabled={session.answering}
              style={{ textAlign: 'left', background: active ? '#FEF3C7' : '#FFFFFF', border: `1.5px solid ${active ? '#F59E0B' : C.border}`, borderRadius: 6, padding: '8px 10px', cursor: session.answering ? 'default' : 'pointer' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{active ? '● ' : '○ '}{option.label}</div>
              <div style={{ fontSize: 11, color: C.body }}>{option.description}</div>
            </button>
          )
        })}
        {item.allowOther && (
          <input value={other} onChange={event => { setOther(event.target.value); if (single && event.target.value.trim()) setSelected([]) }} disabled={session.answering}
            placeholder="Other — type a custom answer…"
            style={{ fontSize: 12, color: C.ink, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', outline: 'none' }} />
        )}
      </div>
      <button disabled={disabled} onClick={() => { void session.answerQuestion(questionId, value) }}
        style={{ alignSelf: 'flex-start', background: disabled ? '#E2E8F0' : C.red, color: disabled ? '#94A3B8' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}>
        {session.answering ? 'Resuming run…' : 'Send answer & resume run'}
      </button>
      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>The answer is validated server-side against the pending graph interrupt; a successful resume returns a new run identity.</p>
      {session.answerError && <p role="alert" style={{ margin: 0, fontSize: 12, color: C.red }}>{session.answerError}</p>}
    </div>
  )
}

const questionId = (item: { kind: string; questionId?: string | null }): string | null => item.kind === 'question' && typeof item.questionId === 'string' && item.questionId.length > 0 ? item.questionId : null

function Card({ item, session }: { item: ConsoleItem; session: ConsoleSession }) {
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
          <p style={{ margin: 0, fontSize: 13, color: C.ink, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>
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
          {item.argsPreview && <pre style={{ margin: 0, fontSize: 11, fontFamily: MONO, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.argsPreview}</pre>}
          {item.content && <pre style={{ margin: 0, fontSize: 11, fontFamily: MONO, color: '#0F172A', background: '#0B0F19', borderRadius: 6, padding: '10px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto' }}>{item.content}</pre>}
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
    const answerable = questionId(item) !== null && !session.answered.includes(questionId(item)!) && session.pendingQuestion?.questionId === questionId(item)
    const resolved = questionId(item) !== null && session.answered.includes(questionId(item)!)
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
          {answerable ? <QuestionAnswerForm item={item} session={session} /> : (
            <>
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
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{resolved ? 'Answer submitted; the resumed run continues below.' : 'Answering requires the server-observed pending graph interrupt for this thread. It was not restorable from the runtime snapshot.'}</p>
            </>
          )}
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

export default function RealConsole({ project }: { project: ProjectViewModel }) {
  const session = useConsoleSession(project.id)
  const [draft, setDraft] = useState('')
  const timelineEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { if (typeof document !== 'undefined' && !document.getElementById('raptix-console-pulse')) { const style = document.createElement('style'); style.id = 'raptix-console-pulse'; style.textContent = PULSE_CSS; document.head.appendChild(style) } }, [])
  useEffect(() => { timelineEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [session.stream?.events.length])
  const items = useMemo(() => (session.stream ? consoleTimeline(session.stream, session.pendingQuestion) : []), [session.stream, session.pendingQuestion])
  const inspector = useMemo(() => (session.stream ? consoleInspector(session.stream) : null), [session.stream])
  const runActive = session.run !== null && !isTerminalRunStatus(session.run.rawStatus)
  const canSend = session.activeThreadId !== null && !session.submitting && !runActive
  const activeThread = session.threads.find(thread => thread.threadId === session.activeThreadId) ?? null
  const inputStyle: CSSProperties = { flex: 1, fontFamily: MONO, fontSize: 13, color: C.ink, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', outline: 'none' }
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
            <button disabled={session.creating} onClick={() => { void session.createThread('execution') }} style={{ fontSize: 12, fontWeight: 600, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: session.creating ? 'default' : 'pointer' }}>
              New execution chat
            </button>
            <button onClick={session.refresh} aria-label="Refresh console" style={{ fontSize: 12, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>↻</button>
          </div>
        </div>
        {activeThread && <div style={{ padding: '6px 18px', background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, fontFamily: MONO }}>
          {activeThread.kind} thread {activeThread.threadId.slice(0, 18)}… • assistant {activeThread.assistantId} • bound {new Date(activeThread.createdAt).toLocaleString()}
        </div>}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 18px 32px' }}>
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
        </div>
        <div style={{ flexShrink: 0, background: '#FFFFFF', borderTop: `1px solid ${C.border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontFamily: MONO, color: C.red, fontWeight: 700, whiteSpace: 'nowrap' }}>[{activeThread ? activeThread.kind : 'no thread'}] &gt;</span>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && canSend) { void session.send(draft); setDraft('') } }}
            placeholder={session.activeThreadId ? (runActive ? 'A run is already active on this thread…' : 'Send a root message to the bound assistant…') : 'Select or create a thread first…'}
            disabled={!session.activeThreadId}
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
        {(session.submitError || session.error) && <div role="alert" style={{ background: '#FEF2F2', borderTop: `1px solid #FECACA`, padding: '8px 16px', fontSize: 12, color: C.red }}>{session.submitError ?? session.error}</div>}
      </div>
      <div style={{ width: '35%', minWidth: 280, display: 'flex', flexDirection: 'column', background: '#FFFFFF', overflowY: 'auto' }}>
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
