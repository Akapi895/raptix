import { useState } from 'react'
import type { Project } from '../types'
import { BotIcon, ZapIcon, DatabaseIcon, TerminalIcon, PlusIcon, RefreshIcon, PlayIcon, PauseIcon, StopIcon, AlertTriangleIcon } from '../components/Icons'

interface Props {
  project: Project
}

type AgentStatus = 'running' | 'idle' | 'done' | 'blocked' | 'spawning'

interface Agent {
  id: string
  name: string
  type: string
  status: AgentStatus
  task: string
  parentId: string | null
  skills: string[]
  tools: string[]
  taskCount: number
  uptime: string
}

const agents: Agent[] = [
  {
    id: 'root',
    name: 'Root Agent',
    type: 'Orchestrator',
    status: 'running',
    task: 'Coordinating full engagement for Acme Corp',
    parentId: null,
    skills: ['orchestrate', 'plan', 'summarize', 'report'],
    tools: ['agent-spawner', 'findings-api', 'asset-store'],
    taskCount: 47,
    uptime: '4h 12m',
  },
  {
    id: 'recon-1',
    name: 'ReconAgent-1',
    type: 'Reconnaissance',
    status: 'done',
    task: 'DNS enumeration & subdomain discovery',
    parentId: 'root',
    skills: ['dns-enum', 'subdomain-brute', 'whois'],
    tools: ['subfinder', 'amass', 'dig', 'whois'],
    taskCount: 12,
    uptime: '1h 45m',
  },
  {
    id: 'recon-2',
    name: 'ReconAgent-2',
    type: 'Reconnaissance',
    status: 'running',
    task: 'Port scanning & service fingerprinting',
    parentId: 'root',
    skills: ['port-scan', 'banner-grab', 'os-detect'],
    tools: ['nmap', 'masscan', 'netcat'],
    taskCount: 8,
    uptime: '2h 03m',
  },
  {
    id: 'vuln-1',
    name: 'VulnScanner-1',
    type: 'Vulnerability Scanner',
    status: 'idle',
    task: 'Vulnerability assessment on identified services',
    parentId: 'root',
    skills: ['vuln-scan', 'cve-lookup', 'web-scan'],
    tools: ['nikto', 'nuclei', 'whatweb'],
    taskCount: 6,
    uptime: '3h 10m',
  },
  {
    id: 'exploit-1',
    name: 'ExploitAgent-1',
    type: 'Exploitation',
    status: 'blocked',
    task: 'CVE-2024-49113 on admin.acme-staging.io:8080',
    parentId: 'root',
    skills: ['exploit-dev', 'post-exploit', 'pivoting'],
    tools: ['metasploit', 'msfvenom', 'nc'],
    taskCount: 2,
    uptime: '38m',
  },
  {
    id: 'dns-scanner',
    name: 'DNS Scanner',
    type: 'Micro-agent',
    status: 'done',
    task: 'Brute-force subdomain list against acme.com',
    parentId: 'recon-1',
    skills: ['dns-enum'],
    tools: ['subfinder'],
    taskCount: 3,
    uptime: '22m',
  },
]

const statusConfig: Record<AgentStatus, { bg: string; text: string; dot: string; label: string }> = {
  running: { bg: '#DCFCE7', text: '#15803D', dot: '#16A34A', label: 'Running' },
  idle: { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF', label: 'Idle' },
  done: { bg: '#F3F4F6', text: '#374151', dot: '#6B7280', label: 'Done' },
  blocked: { bg: '#FFF1F3', text: '#EE0033', dot: '#EE0033', label: 'Blocked' },
  spawning: { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6', label: 'Spawning' },
}

function getChildren(parentId: string) {
  return agents.filter(a => a.parentId === parentId)
}

export default function Orchestrator({ project }: Props) {
  const [selected, setSelected] = useState<Agent>(agents[0])

  const rootAgent = agents.find(a => a.parentId === null)!
  const topLevelChildren = getChildren('root')

  const stats = [
    { label: 'Total Agents', value: agents.length, color: '#EE0033' },
    { label: 'Running', value: agents.filter(a => a.status === 'running').length, color: '#16A34A' },
    { label: 'Blocked', value: agents.filter(a => a.status === 'blocked').length, color: '#EE0033' },
    { label: 'Total Tasks', value: agents.reduce((a, ag) => a + ag.taskCount, 0), color: '#6B7280' },
  ]

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#111111]">Orchestrator</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">Agent hierarchy and control panel</p>
        </div>
        <button className="flex items-center gap-1.5 px-3.5 py-2 bg-[#EE0033] hover:bg-[#CC002B] text-white text-[13px] font-medium rounded-lg transition-colors">
          <PlusIcon size={13} className="text-white" />
          Spawn Agent
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
            <div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[12px] text-[#6B7280] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-5">
        {/* Agent tree */}
        <div className="space-y-3">
          {/* Root */}
          <AgentCard agent={rootAgent} selected={selected.id === rootAgent.id} onSelect={() => setSelected(rootAgent)} />

          {/* First level children */}
          {topLevelChildren.map(agent => (
            <div key={agent.id} className="ml-6 relative">
              {/* Connector line */}
              <div className="absolute -left-3 top-6 w-3 h-px bg-[#E5E7EB]" />
              <div className="absolute -left-3 -top-6 bottom-6 w-px bg-[#E5E7EB]" />
              <AgentCard agent={agent} selected={selected.id === agent.id} onSelect={() => setSelected(agent)} />
              {/* Sub-children */}
              {getChildren(agent.id).map(child => (
                <div key={child.id} className="ml-6 mt-2 relative">
                  <div className="absolute -left-3 top-5 w-3 h-px bg-[#E5E7EB]" />
                  <div className="absolute -left-3 -top-2 top-5 w-px bg-[#E5E7EB]" />
                  <AgentCard agent={child} selected={selected.id === child.id} onSelect={() => setSelected(child)} compact />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 bg-[#111111] rounded-xl flex items-center justify-center shrink-0">
                <BotIcon size={18} className="text-white" />
              </div>
              <div>
                <div className="text-[14px] font-bold text-[#111111]">{selected.name}</div>
                <div className="text-[12px] text-[#9CA3AF]">{selected.type}</div>
              </div>
              <StatusPill status={selected.status} />
            </div>

            <div className="text-[12px] text-[#4B5563] mb-4 leading-relaxed bg-[#F8F9FB] px-3 py-2 rounded-lg">
              {selected.task}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-center">
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <div className="text-[18px] font-bold text-[#111111]">{selected.taskCount}</div>
                <div className="text-[11px] text-[#9CA3AF]">Tasks run</div>
              </div>
              <div className="bg-[#F8F9FB] rounded-lg px-3 py-2">
                <div className="text-[18px] font-bold text-[#111111]">{selected.uptime}</div>
                <div className="text-[11px] text-[#9CA3AF]">Uptime</div>
              </div>
            </div>

            {selected.status === 'blocked' && (
              <div className="mb-4 p-3 bg-[#FFF1F3] border border-[#FECDD6] rounded-lg flex items-start gap-2">
                <AlertTriangleIcon size={13} className="text-[#EE0033] mt-0.5 shrink-0" />
                <p className="text-[12px] text-[#EE0033] font-medium">Awaiting HITL approval to proceed with exploit execution.</p>
              </div>
            )}

            {/* Skills */}
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ZapIcon size={11} /> Attached Skills
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.skills.map(s => (
                  <span key={s} className="px-2.5 py-1 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] text-[11px] font-medium rounded-lg">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Tools */}
            <div className="mb-5">
              <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <TerminalIcon size={11} /> MCP / Tools
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.tools.map(t => (
                  <span key={t} className="font-mono px-2.5 py-1 bg-[#F3F4F6] text-[#374151] text-[11px] rounded-lg">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {selected.status !== 'done' && (
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-[#E5E7EB] rounded-lg text-[12px] font-medium text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                  <PauseIcon size={12} /> Pause
                </button>
              )}
              {selected.status === 'idle' && (
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-[#EE0033] hover:bg-[#CC002B] rounded-lg text-[12px] font-semibold text-white transition-colors">
                  <PlayIcon size={12} /> Resume
                </button>
              )}
              <button className="flex items-center justify-center gap-1.5 px-3 py-2 border border-[#E5E7EB] rounded-lg text-[12px] text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
                <RefreshIcon size={12} />
              </button>
            </div>
          </div>

          {/* Skill attachment */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
            <div className="text-[12px] font-semibold text-[#111111] mb-3">Attach Skill / MCP</div>
            <div className="flex gap-2">
              <input
                placeholder="Search skills or tools…"
                className="flex-1 px-3 py-2 text-[12px] bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg outline-none focus:border-[#EE0033] placeholder:text-[#9CA3AF]"
              />
              <button className="px-3 py-2 bg-[#EE0033] hover:bg-[#CC002B] text-white rounded-lg transition-colors">
                <PlusIcon size={13} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent, selected, onSelect, compact }: { agent: Agent; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const s = statusConfig[agent.status]
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 bg-white rounded-xl border transition-all ${
        selected ? 'border-[#EE0033] shadow-sm' : 'border-[#E5E7EB] hover:border-[#9CA3AF]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`${compact ? 'w-7 h-7' : 'w-9 h-9'} bg-[#111111] rounded-lg flex items-center justify-center shrink-0`}>
          <BotIcon size={compact ? 12 : 16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-[#111111] truncate ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
              {agent.name}
            </span>
            <span
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: s.bg, color: s.text }}
            >
              {agent.status === 'running' && <span className="w-1 h-1 rounded-full bg-current animate-pulse" />}
              {s.label}
            </span>
          </div>
          {!compact && (
            <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">{agent.task}</p>
          )}
          {!compact && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-[#9CA3AF]">{agent.type}</span>
              <span className="text-[11px] text-[#9CA3AF]">·</span>
              <span className="text-[11px] text-[#9CA3AF]">{agent.taskCount} tasks</span>
              <span className="text-[11px] text-[#9CA3AF]">·</span>
              <span className="text-[11px] text-[#9CA3AF]">{agent.uptime}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function StatusPill({ status }: { status: AgentStatus }) {
  const s = statusConfig[status]
  return (
    <span
      className="ml-auto shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}
