import { useState, useRef, useEffect } from 'react'
import type { Project } from '../types'
import {
  SendIcon, BotIcon, UserIcon, ChevronDownIcon, ChevronRightIcon,
  TerminalIcon, AlertTriangleIcon, PlusIcon, MessageIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type AgentStatus = 'running' | 'idle' | 'done' | 'blocked'

interface SubAgent {
  id: string
  name: string
  task: string
  status: AgentStatus
  lastActivity: string
  skills: string[]
  tools: string[]
  children?: SubAgent[]
}

type Message = {
  id: string
  role: 'user' | 'agent'
  agentName?: string
  content: string
  timestamp: string
  toolCalls?: { name: string; result: string }[]
}

interface ChatSession {
  id: string
  title: string
  preview: string
  timestamp: string
  messages: Message[]
}

const subagents: SubAgent[] = [
  {
    id: 'recon-1',
    name: 'ReconAgent-1',
    task: 'DNS enumeration & subdomain discovery',
    status: 'done',
    lastActivity: '14:15',
    skills: ['dns-enum', 'subdomain-brute'],
    tools: ['dig', 'subfinder', 'amass'],
    children: [
      {
        id: 'dns-scan-1',
        name: 'DNS Scanner',
        task: 'Brute-force subdomains',
        status: 'done',
        lastActivity: '13:58',
        skills: ['dns-enum'],
        tools: ['subfinder'],
      },
    ],
  },
  {
    id: 'recon-2',
    name: 'ReconAgent-2',
    task: 'Port scanning & service fingerprinting',
    status: 'running',
    lastActivity: 'now',
    skills: ['port-scan', 'banner-grab'],
    tools: ['nmap', 'masscan'],
    children: [],
  },
  {
    id: 'vuln-1',
    name: 'VulnScanner-1',
    task: 'Vulnerability assessment on identified services',
    status: 'idle',
    lastActivity: '13:22',
    skills: ['vuln-scan', 'cve-lookup'],
    tools: ['nikto', 'nuclei', 'metasploit'],
    children: [],
  },
  {
    id: 'exploit-1',
    name: 'ExploitAgent-1',
    task: 'CVE-2024-49113 on admin.acme-staging.io:8080',
    status: 'blocked',
    lastActivity: '13:55',
    skills: ['exploit-dev', 'post-exploit'],
    tools: ['metasploit', 'msfvenom'],
    children: [],
  },
]

const statusStyles: Record<AgentStatus, { bg: string; text: string; dot: string; label: string }> = {
  running: { bg: '#DCFCE7', text: '#15803D', dot: '#16A34A', label: 'Running' },
  idle:    { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF', label: 'Idle' },
  done:    { bg: '#F3F4F6', text: '#374151', dot: '#6B7280', label: 'Done' },
  blocked: { bg: '#FFF1F3', text: '#EE0033', dot: '#EE0033', label: 'Blocked' },
}

const INITIAL_SESSIONS: ChatSession[] = [
  {
    id: 'chat-1',
    title: 'Recon & vuln summary',
    preview: 'Critical: CVE-2024-49113 RCE confirmed on admin.acme-staging…',
    timestamp: '14:32',
    messages: [
      {
        id: '1',
        role: 'agent',
        agentName: 'Root Agent',
        content: "Hello! I'm your root orchestrator for **Acme Corp External Assessment**. I have full situational awareness of the engagement. I've already spawned recon and vulnerability scanning subagents.\n\nCurrent status:\n- ReconAgent-1: DNS enumeration complete (134 assets)\n- ReconAgent-2: Port scanning in progress\n- VulnScanner-1: Idle, awaiting port scan results\n- ExploitAgent-1: **Blocked — awaiting your HITL approval** for CVE-2024-49113\n\nWhat would you like to prioritize?",
        timestamp: '14:30',
      },
      {
        id: '2',
        role: 'user',
        content: 'Give me a summary of the most critical findings so far.',
        timestamp: '14:31',
      },
      {
        id: '3',
        role: 'agent',
        agentName: 'Root Agent',
        content: "Here's a consolidated summary of critical findings:\n\n**🔴 CRITICAL**\n- CVE-2024-49113 — Unauthenticated RCE on `admin.acme-staging.io:8080` (AdminLite v2.3.1)\n- Exposed `.env` file with plaintext DB credentials on `api.acme.com`\n\n**🟠 HIGH**\n- SQL injection on `login.acme.com/api/auth` (POST body, `username` param)\n- Outdated Apache 2.4.49 with path traversal (CVE-2021-41773)\n- Admin panel accessible without auth from external IP range\n\n**Recommended immediate action:** Approve ExploitAgent-1 to confirm RCE exploitability, then chain with lateral movement simulation.",
        timestamp: '14:32',
        toolCalls: [
          { name: 'findings.query', result: '12 findings loaded from evidence store' },
          { name: 'agent.sync', result: 'VulnScanner-1, ReconAgent-2 state pulled' },
        ],
      },
    ],
  },
  {
    id: 'chat-2',
    title: 'Exploit chain planning',
    preview: "What's the best lateral movement path after initial RCE?",
    timestamp: '13:10',
    messages: [
      {
        id: 'c2-1',
        role: 'user',
        content: "What's the best lateral movement path after initial RCE?",
        timestamp: '13:05',
      },
      {
        id: 'c2-2',
        role: 'agent',
        agentName: 'Root Agent',
        content: "Given the RCE on `admin.acme-staging.io:8080`, the most promising lateral movement path is:\n\n1. **Credential dump** from the exposed `.env` file\n2. **Spray credentials** against internal VPN and SSH endpoints\n3. **Pivot** through the staging network via `10.0.1.0/24`\n\nI'll need HITL approval before executing steps 2 and 3.",
        timestamp: '13:10',
        toolCalls: [
          { name: 'network.map', result: 'Internal range 10.0.1.0/24 mapped, 14 hosts' },
        ],
      },
    ],
  },
  {
    id: 'chat-3',
    title: 'Asset inventory review',
    preview: 'List all externally exposed services on port 443…',
    timestamp: 'Yesterday',
    messages: [
      {
        id: 'c3-1',
        role: 'user',
        content: 'List all externally exposed services on port 443.',
        timestamp: '09:22',
      },
      {
        id: 'c3-2',
        role: 'agent',
        agentName: 'Root Agent',
        content: "ReconAgent-1 identified **23 hosts** with port 443 open:\n\n- `acme.com` — Nginx 1.21.3\n- `api.acme.com` — Express.js (Node 18)\n- `admin.acme-staging.io` — AdminLite v2.3.1 (**vulnerable**)\n- `login.acme.com` — Custom PHP auth portal\n- +19 more hosts in the evidence store",
        timestamp: '09:25',
        toolCalls: [
          { name: 'assets.query', result: '134 assets, filtered to 23 on :443' },
        ],
      },
    ],
  },
]

let sessionCounter = INITIAL_SESSIONS.length + 1

export default function Chat({ project }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>(INITIAL_SESSIONS)
  const [activeId, setActiveId] = useState<string>(INITIAL_SESSIONS[0].id)
  const [input, setInput] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<SubAgent | null>(subagents[0])
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set(['recon-1']))
  const [showPanel, setShowPanel] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeId, activeSession.messages.length])

  const newChat = () => {
    const id = `chat-${++sessionCounter}`
    const session: ChatSession = {
      id,
      title: 'New chat',
      preview: 'Start a conversation with the root agent…',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messages: [
        {
          id: 'init',
          role: 'agent',
          agentName: 'Root Agent',
          content: `Ready for your instructions on **${project.name}**. What would you like to do?`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ],
    }
    setSessions(prev => [session, ...prev])
    setActiveId(id)
    setInput('')
  }

  const send = () => {
    if (!input.trim()) return
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: ts,
    }
    const text = input
    setInput('')

    setSessions(prev => prev.map(s =>
      s.id === activeId
        ? { ...s, messages: [...s.messages, userMsg], preview: text, timestamp: ts }
        : s
    ))

    setTimeout(() => {
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        agentName: 'Root Agent',
        content: "I'm processing your request and coordinating with the relevant subagents. I'll have a detailed response shortly.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setSessions(prev => prev.map(s =>
        s.id === activeId ? { ...s, messages: [...s.messages, agentMsg] } : s
      ))
    }, 900)
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

  return (
    <div className="flex h-full" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Left panel: chat history ── */}
      <div className="w-56 shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col overflow-hidden">
        {/* New Chat button */}
        <div className="p-3 border-b border-[#E5E7EB] shrink-0">
          <button
            onClick={newChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-[#EE0033] hover:bg-[#CC002B] text-white text-[12px] font-semibold rounded-xl transition-all justify-center"
            style={{ boxShadow: '0 2px 6px rgba(238,0,51,0.22)' }}
          >
            <PlusIcon size={13} />
            New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                s.id === activeId
                  ? 'bg-[#FFF1F3] border-r-2 border-[#EE0033]'
                  : 'hover:bg-[#F8F9FB]'
              }`}
            >
              <div className="flex items-start gap-2">
                <MessageIcon
                  size={12}
                  className={`mt-0.5 shrink-0 ${s.id === activeId ? 'text-[#EE0033]' : 'text-[#9CA3AF]'}`}
                />
                <div className="min-w-0">
                  <div className={`text-[12px] font-semibold truncate leading-snug ${
                    s.id === activeId ? 'text-[#EE0033]' : 'text-[#374151]'
                  }`}>
                    {s.title}
                  </div>
                  <div className="text-[10px] text-[#9CA3AF] truncate mt-0.5 leading-snug">
                    {s.preview}
                  </div>
                  <div className="text-[10px] text-[#C4C9D4] mt-1">{s.timestamp}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="px-6 py-3.5 border-b border-[#E5E7EB] bg-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-[#111111] rounded-md flex items-center justify-center">
                <BotIcon size={13} className="text-white" />
              </div>
              <span className="text-[13px] font-semibold text-[#111111]">Root Agent</span>
              <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
              <span className="text-[11px] text-[#16A34A] font-medium">Online</span>
            </div>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5 ml-8">
              {activeSession.title} · {project.name}
            </p>
          </div>
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="text-[12px] text-[#6B7280] hover:text-[#111111] transition-colors"
          >
            {showPanel ? 'Hide panel' : 'Show panel'}
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {activeSession.messages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className="shrink-0">
                {msg.role === 'agent' ? (
                  <div className="w-7 h-7 bg-[#111111] rounded-lg flex items-center justify-center">
                    <BotIcon size={14} className="text-white" />
                  </div>
                ) : (
                  <div className="w-7 h-7 bg-[#EE0033] rounded-lg flex items-center justify-center">
                    <UserIcon size={14} className="text-white" />
                  </div>
                )}
              </div>
              <div className={`max-w-[72%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                {msg.role === 'agent' && (
                  <span className="text-[11px] font-semibold text-[#9CA3AF] ml-1">{msg.agentName}</span>
                )}
                <div
                  className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#EE0033] text-white rounded-tr-sm'
                      : 'bg-white border border-[#E5E7EB] text-[#374151] rounded-tl-sm'
                  }`}
                >
                  <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                </div>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {msg.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg">
                        <TerminalIcon size={11} className="text-[#9CA3AF]" />
                        <span className="font-mono text-[11px] text-[#EE0033]">{tc.name}</span>
                        <span className="text-[11px] text-[#9CA3AF]">→ {tc.result}</span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="text-[10px] text-[#9CA3AF] mx-1">{msg.timestamp}</span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-[#E5E7EB] bg-white shrink-0">
          <div className="flex items-end gap-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-3 focus-within:border-[#EE0033] transition-colors">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Message the root agent… (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="flex-1 bg-transparent text-[13px] text-[#111111] placeholder:text-[#9CA3AF] outline-none resize-none leading-relaxed"
            />
            <button
              onClick={send}
              disabled={!input.trim()}
              className="w-8 h-8 rounded-lg bg-[#EE0033] hover:bg-[#CC002B] disabled:bg-[#F3F4F6] flex items-center justify-center transition-colors shrink-0"
            >
              <SendIcon size={13} className={input.trim() ? 'text-white' : 'text-[#9CA3AF]'} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Right panel: subagents ── */}
      {showPanel && (
        <div className="w-72 border-l border-[#E5E7EB] bg-white flex flex-col shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB] shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#111111]">Subagents</span>
              <span className="text-[11px] text-[#9CA3AF]">{subagents.length} agents</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                <div className="w-5 h-5 bg-[#111111] rounded-md flex items-center justify-center">
                  <BotIcon size={10} className="text-white" />
                </div>
                <span className="text-[12px] font-semibold text-[#111111]">Root Agent</span>
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              </div>
              {subagents.map(agent => (
                <AgentTreeNode
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgent?.id === agent.id}
                  expanded={expandedAgents.has(agent.id)}
                  onSelect={() => setSelectedAgent(agent)}
                  onToggle={() => toggleExpand(agent.id)}
                  depth={1}
                />
              ))}
            </div>
          </div>

          {selectedAgent && (
            <div className="border-t border-[#E5E7EB] p-4 shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[12px] font-semibold text-[#111111]">{selectedAgent.name}</span>
                <StatusBadge status={selectedAgent.status} />
              </div>
              <p className="text-[11px] text-[#6B7280] mb-3 leading-snug">{selectedAgent.task}</p>
              <div className="space-y-2">
                <div>
                  <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">Skills</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.skills.map(s => (
                      <span key={s} className="px-2 py-0.5 bg-[#EFF6FF] text-[#1D4ED8] text-[10px] font-medium rounded">{s}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">MCP / Tools</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.tools.map(t => (
                      <span key={t} className="px-2 py-0.5 bg-[#F3F4F6] text-[#374151] text-[10px] font-medium rounded font-mono">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
              {selectedAgent.status === 'blocked' && (
                <div className="mt-3 p-2.5 bg-[#FFF1F3] border border-[#FECDD6] rounded-lg">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangleIcon size={12} className="text-[#EE0033]" />
                    <span className="text-[11px] font-semibold text-[#EE0033]">Awaiting HITL Approval</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentTreeNode({
  agent, selected, expanded, onSelect, onToggle, depth,
}: {
  agent: SubAgent
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
  depth: number
}) {
  const s = statusStyles[agent.status]
  const hasChildren = (agent.children?.length ?? 0) > 0

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={e => e.key === 'Enter' && onSelect()}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          selected ? 'bg-[#FFF1F3]' : 'hover:bg-[#F8F9FB]'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onToggle() }}
            onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), onToggle())}
            className="text-[#9CA3AF] hover:text-[#374151] cursor-pointer shrink-0"
          >
            {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
          </span>
        ) : (
          <span className="w-2.5 h-px bg-[#E5E7EB] shrink-0 ml-1" />
        )}
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.dot }} />
        <span className={`text-[12px] truncate ${selected ? 'font-semibold text-[#EE0033]' : 'text-[#374151]'}`}>
          {agent.name}
        </span>
        {agent.status === 'running' && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse shrink-0" />
        )}
      </div>
      {expanded && agent.children?.map(child => (
        <AgentTreeNode
          key={child.id}
          agent={child}
          selected={false}
          expanded={false}
          onSelect={() => {}}
          onToggle={() => {}}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const s = statusStyles[status]
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className={isUser ? 'text-white' : 'text-[#111111]'}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className={`font-mono text-[11px] px-1 py-0.5 rounded ${isUser ? 'bg-white/20 text-white' : 'bg-[#FFF1F3] text-[#EE0033]'}`}>
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part === '\n') return <br key={i} />
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
