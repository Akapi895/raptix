import { useState, useRef, useEffect } from 'react'
import type { Project } from '../types'
import {
  createThread, selectThread, submitMessage, decideApproval, setRunState, useRunSnapshot,
} from '../features/agent-runs/store'
import type { RunThread } from '../features/agent-runs/model'
import { STATUS_STYLES } from '../features/agent-runs/model'
import AgentDetailPanel from '../features/agent-runs/AgentDetailPanel'
import MessageContent from '../features/agent-runs/MessageContent'
import { useNarrowViewport } from '../shared/hooks/useNarrowViewport'
import {
  SendIcon, BotIcon, UserIcon, ChevronDownIcon, ChevronRightIcon,
  TerminalIcon, AlertTriangleIcon, PlusIcon, MessageIcon,
  PlayIcon, PauseIcon, StopIcon, XIcon,
} from '../components/Icons'

interface Props {
  project: Project
  threadId?: string
  onThreadSelect?: (threadId: string) => void
}

const MOCK_SOURCE_TITLE = 'Demo data — fixtures from src/mocks/fixtures/agent-runs.ts (in-memory, not a live runtime)'
const PAUSE_DISABLED_TITLE = 'Pause requires a live agent runtime — not available in demo mode'

export default function AgentRun({ project, threadId, onThreadSelect }: Props) {
  const snap = useRunSnapshot(project.id)
  const narrow = useNarrowViewport()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('exploit-1')
  const [showPanel, setShowPanel] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const urlThread: RunThread | null = threadId
    ? snap.threads.find(t => t.id === threadId) ?? null
    : null
  const activeThread: RunThread | null =
    urlThread ?? snap.threads.find(t => t.id === snap.activeThreadId) ?? snap.threads[0] ?? null
  const activeThreadId = activeThread?.id ?? null
  const messageCount = activeThread?.messages.length ?? 0
  const pendingReply = activeThreadId !== null && snap.pendingThreadIds.includes(activeThreadId)

  // Draft is scoped per thread (and project) so switching sessions keeps
  // each conversation's unsent message.
  const draftKey = activeThreadId !== null ? `${project.id}:${activeThreadId}` : null
  const input = draftKey !== null ? drafts[draftKey] ?? '' : ''
  const setInput = (value: string) => {
    if (draftKey === null) return
    setDrafts(prev => ({ ...prev, [draftKey]: value }))
  }

  const rootAgent = snap.agents[0]
  const subAgents = snap.agents.slice(1)
  const selectedAgent = selectedAgentId
    ? snap.agents.find(a => a.id === selectedAgentId) ?? null
    : null
  const runningCount = snap.agents.filter(a => a.status === 'running').length
  const stopped = snap.runState === 'stopped'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeThreadId, messageCount])

  useEffect(() => {
    if (threadId && urlThread && threadId !== snap.activeThreadId) {
      selectThread(project.id, threadId)
    }
  }, [project.id, threadId, urlThread, snap.activeThreadId])

  if (threadId && !urlThread) {
    const latest = snap.threads[0]
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: '100%', backgroundColor: '#F8FAFC' }}
      >
        <div
          className="text-center px-6 py-8 rounded-xl mx-4"
          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', maxWidth: 440 }}
        >
          <div
            className="w-10 h-10 mx-auto mb-3 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}
          >
            <AlertTriangleIcon size={18} style={{ color: '#DC2626' }} />
          </div>
          <p className="text-[13px] font-semibold" style={{ color: '#0F172A' }}>
            Thread not found
          </p>
          <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#64748B' }}>
            No agent thread with ID <span className="font-mono">{threadId}</span> exists for{' '}
            <span className="font-semibold">{project.name}</span>. Threads created here are saved
            in this browser, so the link may be stale or the thread was removed.
          </p>
          {latest && (
            <button
              onClick={() => {
                selectThread(project.id, latest.id)
                onThreadSelect?.(latest.id)
              }}
              className="mt-4 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white"
              style={{ backgroundColor: '#DC2626' }}
            >
              Open latest thread
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!activeThread || !rootAgent) return null

  const newChat = () => {
    const id = createThread(project.id)
    onThreadSelect?.(id)
  }

  const selectSession = (id: string) => {
    selectThread(project.id, id)
    if (id !== threadId) onThreadSelect?.(id)
  }

  const send = () => {
    if (!input.trim() || stopped || pendingReply) return
    if (submitMessage(project.id, activeThread.id, input)) setInput('')
  }

  const toggleExpand = (id: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    if (narrow) {
      setMobileSessionsOpen(false)
      setMobileDetailOpen(true)
    }
  }

  const leftPanel = (
    <>
      {/* New Chat button */}
      <div className="p-3 shrink-0" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <button
            onClick={newChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold text-white transition-colors"
            style={{ backgroundColor: '#DC2626', boxShadow: '0 2px 8px rgba(220,38,38,0.25)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B91C1C'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#DC2626'
            }}
          >
            <PlusIcon size={13} />
            New Chat
          </button>
        </div>

        {/* Chat session list */}
        <div className="overflow-y-auto" style={{ maxHeight: '45%', borderBottom: '1px solid #E2E8F0' }}>
          <div className="py-1">
            {snap.threads.map(s => {
              const isActive = s.id === activeThreadId
              return (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className="w-full text-left px-3 py-2.5 transition-colors"
                  style={{
                    backgroundColor: isActive ? '#FEF2F2' : 'transparent',
                    borderRight: isActive ? '2px solid #DC2626' : '2px solid transparent',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8FAFC'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  <div className="flex items-start gap-2">
                    <MessageIcon
                      size={12}
                      className="mt-0.5 shrink-0"
                      style={{ color: isActive ? '#DC2626' : '#94A3B8' }}
                    />
                    <div className="min-w-0">
                      <div
                        className="text-[12px] font-semibold truncate leading-snug"
                        style={{ color: isActive ? '#DC2626' : '#0F172A' }}
                      >
                        {s.title}
                      </div>
                      <div
                        className="text-[10px] truncate mt-0.5 leading-snug"
                        style={{ color: '#94A3B8' }}
                      >
                        {s.preview}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                        {s.timestamp}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Agent Tree section */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 shrink-0">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: '#94A3B8' }}
            >
              Agent Tree
            </span>
          </div>

          {/* Root Agent node */}
          <button
            onClick={() => selectAgent(rootAgent.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 transition-colors"
            style={{
              backgroundColor:
                selectedAgentId === rootAgent.id ? '#FEF2F2' : 'transparent',
            }}
            onMouseEnter={e => {
              if (selectedAgentId !== rootAgent.id) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8FAFC'
              }
            }}
            onMouseLeave={e => {
              if (selectedAgentId !== rootAgent.id) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              }
            }}
          >
            <div
              className="w-4 h-4 rounded flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
            >
              <BotIcon size={9} style={{ color: '#475569' }} />
            </div>
            <span
              className="text-[11px] font-semibold flex-1 text-left truncate"
              style={{ color: selectedAgentId === rootAgent.id ? '#DC2626' : '#0F172A' }}
            >
              {rootAgent.name}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${!stopped && rootAgent.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: STATUS_STYLES[rootAgent.status].dot }}
            />
          </button>

          {/* Subagent nodes */}
          {subAgents.map(agent => {
            const hasChildren = (agent.children?.length ?? 0) > 0
            const expanded = expandedAgents.has(agent.id)
            const isSelected = selectedAgentId === agent.id
            const ss = STATUS_STYLES[agent.status]
            return (
              <div
                key={agent.id}
                className="flex items-center gap-1 pr-3 transition-colors"
                style={{
                  paddingLeft: '16px',
                  backgroundColor: isSelected ? '#FEF2F2' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = '#F8FAFC'
                  }
                }}
                onMouseLeave={e => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
                  }
                }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${agent.name}`}
                    onClick={() => toggleExpand(agent.id)}
                    className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors"
                    style={{ color: '#94A3B8' }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E2E8F0'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    {expanded ? <ChevronDownIcon size={9} /> : <ChevronRightIcon size={9} />}
                  </button>
                ) : (
                  <span
                    className="w-2 h-px shrink-0"
                    style={{ backgroundColor: '#E2E8F0', display: 'block' }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => selectAgent(agent.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left transition-colors"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: ss.dot }}
                  />
                  <span
                    className="text-[11px] truncate flex-1 text-left"
                    style={{
                      color: isSelected ? '#DC2626' : '#475569',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {agent.name}
                  </span>
                  {agent.status === 'blocked' && (
                    <AlertTriangleIcon
                      size={10}
                      style={{ color: '#DC2626' }}
                      className="shrink-0"
                    />
                  )}
                </button>
                {expanded &&
                  agent.children?.map(child => {
                    const css = STATUS_STYLES[child.status]
                    return (
                      <button
                        key={child.id}
                        onClick={() => selectAgent(child.id)}
                        className="w-full flex items-center gap-2 py-1 transition-colors"
                        style={{ paddingLeft: '40px', paddingRight: '12px' }}
                      >
                        <span
                          className="w-1.5 h-px shrink-0"
                          style={{ backgroundColor: '#E2E8F0', display: 'block' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: css.dot }}
                        />
                        <span className="text-[10px] truncate" style={{ color: '#94A3B8' }}>
                          {child.name}
                        </span>
                      </button>
                    )
                  })}
              </div>
            )
          })}
        </div>
    </>
  )

  const rightPanel = selectedAgent ? (
    <AgentDetailPanel
      agent={selectedAgent}
      decision={snap.approvals[selectedAgent.id]}
      onDecide={decision =>
        decideApproval(project.id, { agentId: selectedAgent.id, decision })
      }
    />
  ) : (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-[12px]" style={{ color: '#94A3B8' }}>
        Select an agent
      </p>
    </div>
  )

  return (
    <div className="flex" style={{ height: '100%', backgroundColor: '#F8FAFC' }}>

      {/* ── Sessions + Agent Tree: desktop rail, mobile drawer ─── */}
      {!narrow && (
        <div
          className="w-[220px] shrink-0 flex flex-col overflow-hidden"
          style={{ backgroundColor: '#FFFFFF', borderRight: '1px solid #E2E8F0' }}
        >
          {leftPanel}
        </div>
      )}

      {/* ── Main Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: '#F8FAFC' }}>

        {/* Control bar */}
        <div
          className="px-4 py-2.5 flex items-center gap-3 shrink-0"
          style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
            >
              <BotIcon size={12} style={{ color: '#475569' }} />
            </div>
            <div className="min-w-0">
              <span
                className="text-[12px] font-semibold truncate block"
                style={{ color: '#0F172A' }}
              >
                {activeThread.title}
              </span>
              <span className="text-[10px]" style={{ color: '#94A3B8' }}>
                {project.name}
              </span>
            </div>
          </div>

          {/* Run / Pause / Stop */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setRunState(project.id, 'running')}
              title={stopped ? 'Run — resume the demo session' : 'Running (demo)'}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{
                backgroundColor:
                  !stopped ? 'rgba(34,197,94,0.15)' : 'transparent',
                border: '1px solid',
                borderColor:
                  !stopped ? 'rgba(34,197,94,0.3)' : '#E2E8F0',
                color: !stopped ? '#16A34A' : '#94A3B8',
              }}
            >
              <PlayIcon size={11} />
            </button>
            <button
              disabled
              aria-disabled="true"
              title={PAUSE_DISABLED_TITLE}
              className="w-7 h-7 rounded-md flex items-center justify-center cursor-not-allowed"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #E2E8F0',
                color: '#CBD5E1',
              }}
            >
              <PauseIcon size={11} />
            </button>
            <button
              onClick={() => setRunState(project.id, 'stopped')}
              title={stopped ? 'Stopped — demo session ended' : 'Stop — end the demo session and discard pending replies'}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{
                backgroundColor:
                  stopped ? '#FEF2F2' : 'transparent',
                border: '1px solid',
                borderColor:
                  stopped ? '#FECACA' : '#E2E8F0',
                color: stopped ? '#DC2626' : '#94A3B8',
              }}
            >
              <StopIcon size={11} />
            </button>
          </div>

          {/* Sessions + detail toggles (mobile drawers) */}
          {narrow && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setMobileSessionsOpen(v => !v)}
                aria-expanded={mobileSessionsOpen}
                className="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  backgroundColor: mobileSessionsOpen ? '#FEF2F2' : '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  color: mobileSessionsOpen ? '#DC2626' : '#475569',
                }}
              >
                Sessions
              </button>
              <button
                type="button"
                onClick={() => setMobileDetailOpen(v => !v)}
                aria-expanded={mobileDetailOpen}
                className="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  backgroundColor: mobileDetailOpen ? '#FEF2F2' : '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  color: mobileDetailOpen ? '#DC2626' : '#475569',
                }}
              >
                Agent
              </button>
            </div>
          )}

          {/* Agent count badge */}
          {!narrow && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md shrink-0"
              style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${!stopped && runningCount > 0 ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: runningCount > 0 ? '#22C55E' : '#94A3B8' }}
              />
              <span className="text-[10px] font-semibold" style={{ color: '#475569' }}>
                {runningCount} active
              </span>
            </div>
          )}

          {/* Mock source label */}
          <div
            title={MOCK_SOURCE_TITLE}
            className="hidden md:flex items-center px-2 py-1 rounded-md shrink-0"
            style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}
          >
            <span
              className="text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: '#B45309' }}
            >
              Demo data
            </span>
          </div>

          {/* Hide/Show panel (desktop rail only) */}
          {!narrow && (
            <button
              onClick={() => setShowPanel(v => !v)}
              className="text-[11px] font-medium transition-colors shrink-0"
              style={{ color: '#94A3B8' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = '#475569'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8'
              }}
            >
              {showPanel ? 'Hide panel' : 'Show panel'}
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5" style={{ backgroundColor: '#F8FAFC' }}>
          {activeThread.messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className="shrink-0">
                {msg.role === 'agent' ? (
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor: '#F1F5F9',
                      border: '1px solid #E2E8F0',
                    }}
                  >
                    <BotIcon size={13} style={{ color: '#475569' }} />
                  </div>
                ) : (
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: '#DC2626' }}
                  >
                    <UserIcon size={13} style={{ color: '#fff' }} />
                  </div>
                )}
              </div>

              <div
                className={`max-w-[74%] flex flex-col gap-1 ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                {msg.role === 'agent' && (
                  <span
                    className="text-[10px] font-semibold ml-1"
                    style={{ color: '#94A3B8' }}
                  >
                    {msg.agentName}
                  </span>
                )}
                <div
                  className="px-4 py-3 rounded-2xl text-[12.5px] leading-relaxed"
                  style={
                    msg.role === 'user'
                      ? {
                          backgroundColor: '#FEF2F2',
                          color: '#0F172A',
                          border: '1px solid #FECACA',
                          borderTopRightRadius: '4px',
                        }
                      : {
                          backgroundColor: '#FFFFFF',
                          color: '#475569',
                          border: '1px solid #E2E8F0',
                          borderTopLeftRadius: '4px',
                        }
                  }
                >
                  <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                </div>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1 mt-0.5 w-full">
                    {msg.toolCalls.map((tc, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                        style={{
                          backgroundColor: '#F1F5F9',
                          border: '1px solid #E2E8F0',
                        }}
                      >
                        <TerminalIcon size={10} style={{ color: '#94A3B8' }} />
                        <span
                          className="font-mono text-[10px] font-medium"
                          style={{ color: '#DC2626' }}
                        >
                          {tc.name}
                        </span>
                        <span className="text-[10px]" style={{ color: '#94A3B8' }}>
                          → {tc.result}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="text-[10px] mx-1" style={{ color: '#94A3B8' }}>
                  {msg.timestamp}
                </span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div
          className="px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}
        >
          <div
            className="flex items-end gap-3 rounded-xl px-3 py-2.5"
            style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
          >
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              disabled={stopped}
              placeholder={
                stopped
                  ? 'Run stopped — press Run to resume the demo session before messaging…'
                  : 'Message the root agent… (Enter to send, Shift+Enter for newline)'
              }
              rows={1}
              className="flex-1 bg-transparent text-[12.5px] outline-none resize-none leading-relaxed placeholder:text-[#94A3B8] disabled:opacity-60"
              style={{ color: '#0F172A' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || stopped || pendingReply}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0"
              style={{
                backgroundColor: input.trim() && !stopped && !pendingReply ? '#DC2626' : '#E2E8F0',
              }}
            >
              <SendIcon
                size={12}
                style={{ color: input.trim() && !stopped && !pendingReply ? '#fff' : '#94A3B8' }}
              />
            </button>
          </div>
          <p className="text-[10px] mt-1.5 text-center" style={{ color: '#94A3B8' }}>
            {stopped
              ? 'Run stopped — press Run to resume the demo session.'
              : pendingReply
                ? 'Root Agent is responding (demo) — wait for the reply before sending again.'
                : `Root Agent is orchestrating ${subAgents.length} subagents · Shift+Enter for newline`}
          </p>
        </div>
      </div>

      {/* ── Agent Detail: desktop rail, mobile drawer ──────────── */}
      {!narrow && showPanel && (
        <div
          className="w-[272px] shrink-0 flex flex-col overflow-hidden"
          style={{ backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0' }}
        >
          {rightPanel}
        </div>
      )}

      {/* ── Mobile drawers ─────────────────────────────────────── */}
      {narrow && (
        <>
          <MobileDrawer
            side="left"
            open={mobileSessionsOpen}
            title="Sessions & agents"
            onClose={() => setMobileSessionsOpen(false)}
          >
            {leftPanel}
          </MobileDrawer>
          <MobileDrawer
            side="right"
            open={mobileDetailOpen}
            title="Agent details"
            onClose={() => setMobileDetailOpen(false)}
          >
            {rightPanel}
          </MobileDrawer>
        </>
      )}
    </div>
  )
}

/** Overlay drawer for narrow viewports (≤900px) — keeps sessions, the
    agent tree and agent detail reachable without squeezing the chat. */
function MobileDrawer({ side, open, title, onClose, children }: {
  side: 'left' | 'right'
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          left: side === 'left' ? 0 : undefined,
          right: side === 'right' ? 0 : undefined,
          width: side === 'left' ? 'min(85vw, 300px)' : 'min(92vw, 360px)',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2.5 shrink-0"
          style={{ borderBottom: '1px solid #E2E8F0' }}
        >
          <span className="text-[12px] font-semibold" style={{ color: '#0F172A' }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ border: '1px solid #E2E8F0', color: '#64748B' }}
          >
            <XIcon size={12} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </>
  )
}
