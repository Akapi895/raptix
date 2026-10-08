import { useState } from 'react'
import type { Project } from '../types'
import { CheckIcon, ClockIcon, AlertTriangleIcon, BotIcon, ActivityIcon, ZapIcon, InfoIcon } from '../components/Icons'

interface Props {
  project: Project
  onHitl: () => void
}

type PhaseStatus = 'done' | 'active' | 'hitl' | 'pending'

interface Phase {
  id: string
  name: string
  status: PhaseStatus
  progress: number
  owner: string
  agentName: string | null
  startDate: string | null
  endDate: string | null
  logsCount: number
  findingsCount: number
  checkpoint: boolean
  description: string
}

const phases: Phase[] = [
  {
    id: 'intake',
    name: 'Intake & Planning',
    status: 'done',
    progress: 100,
    owner: 'Alex Kim',
    agentName: 'Root Agent',
    startDate: '2026-09-10',
    endDate: '2026-09-11',
    logsCount: 18,
    findingsCount: 0,
    checkpoint: false,
    description: 'Engagement kickoff, rules of engagement, scope confirmation, tooling setup.',
  },
  {
    id: 'recon',
    name: 'Reconnaissance',
    status: 'done',
    progress: 100,
    owner: 'ReconAgent-1',
    agentName: 'ReconAgent-1',
    startDate: '2026-09-12',
    endDate: '2026-09-14',
    logsCount: 86,
    findingsCount: 2,
    checkpoint: false,
    description: 'Passive and active recon: DNS enum, subdomain discovery, port scanning, service fingerprinting.',
  },
  {
    id: 'assessment',
    name: 'Vulnerability Assessment',
    status: 'active',
    progress: 72,
    owner: 'VulnScanner-1',
    agentName: 'VulnScanner-1',
    startDate: '2026-09-15',
    endDate: null,
    logsCount: 143,
    findingsCount: 10,
    checkpoint: false,
    description: 'Automated and manual vulnerability scanning across all identified services and endpoints.',
  },
  {
    id: 'exploitation',
    name: 'Exploitation',
    status: 'hitl',
    progress: 15,
    owner: 'ExploitAgent-1',
    agentName: 'ExploitAgent-1',
    startDate: '2026-09-18',
    endDate: null,
    logsCount: 21,
    findingsCount: 2,
    checkpoint: true,
    description: 'Controlled exploitation of confirmed vulnerabilities to validate impact and exploitability.',
  },
  {
    id: 'post-exploit',
    name: 'Post-Exploitation',
    status: 'pending',
    progress: 0,
    owner: 'TBD',
    agentName: null,
    startDate: null,
    endDate: null,
    logsCount: 0,
    findingsCount: 0,
    checkpoint: true,
    description: 'Lateral movement, privilege escalation, and persistence simulation within authorized scope.',
  },
  {
    id: 'reporting',
    name: 'Reporting',
    status: 'pending',
    progress: 0,
    owner: 'Alex Kim',
    agentName: null,
    startDate: null,
    endDate: null,
    logsCount: 0,
    findingsCount: 0,
    checkpoint: false,
    description: 'Executive summary, technical report, finding evidence consolidation, and remediation guidance.',
  },
]

const statusConfig: Record<PhaseStatus, { icon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }>; label: string; color: string; bg: string }> = {
  done: { icon: CheckIcon, label: 'Completed', color: '#16A34A', bg: '#DCFCE7' },
  active: { icon: ActivityIcon, label: 'In Progress', color: '#EE0033', bg: '#FFF1F3' },
  hitl: { icon: AlertTriangleIcon, label: 'Needs Approval', color: '#EE0033', bg: '#FFF1F3' },
  pending: { icon: ClockIcon, label: 'Pending', color: '#9CA3AF', bg: '#F3F4F6' },
}

export default function Phases({ project, onHitl }: Props) {
  const [selected, setSelected] = useState<Phase>(phases[2])

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-[#111111]">Phases</h1>
          <p className="text-[13px] text-[#6B7280] mt-1">Engagement timeline and progress</p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[#6B7280]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#16A34A]" /><span>Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#EE0033]" /><span>Active / HITL</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#E5E7EB]" /><span>Pending</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-2">
        {phases.map((phase, i) => {
          const isLast = i === phases.length - 1
          const s = statusConfig[phase.status]
          const active = selected.id === phase.id
          return (
            <div key={phase.id} className="flex items-center shrink-0">
              <button
                onClick={() => setSelected(phase)}
                className={`flex flex-col items-center gap-2 group transition-all`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    active ? 'border-[#EE0033] scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: s.bg }}
                >
                  <s.icon size={16} style={{ color: s.color }} />
                </div>
                <span className={`text-[11px] font-medium text-center max-w-[80px] leading-tight ${active ? 'text-[#EE0033]' : 'text-[#6B7280]'}`}>
                  {phase.name}
                </span>
                {phase.checkpoint && (
                  <span className="text-[9px] font-bold text-[#EE0033] uppercase tracking-wider">HITL</span>
                )}
              </button>
              {!isLast && (
                <div className="w-12 h-px mx-1 mt-[-18px]" style={{
                  backgroundColor: i < phases.findIndex(p => p.status === 'pending') ? '#16A34A' : '#E5E7EB'
                }} />
              )}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-5">
        {/* Phase list */}
        <div className="space-y-3">
          {phases.map(phase => {
            const s = statusConfig[phase.status]
            const isSelected = selected.id === phase.id
            return (
              <button
                key={phase.id}
                onClick={() => setSelected(phase)}
                className={`w-full text-left bg-white rounded-xl border p-5 transition-all ${
                  isSelected ? 'border-[#EE0033] shadow-sm' : 'border-[#E5E7EB] hover:border-[#9CA3AF]'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Status icon */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: s.bg }}
                  >
                    <s.icon size={16} style={{ color: s.color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-semibold text-[#111111]">{phase.name}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                        style={{ backgroundColor: s.bg, color: s.color }}
                      >
                        {s.label}
                      </span>
                      {phase.checkpoint && (
                        <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#B45309] text-[10px] font-semibold rounded-full">
                          Checkpoint
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#6B7280] mb-3 leading-snug">{phase.description}</p>

                    {/* Progress bar */}
                    {phase.status !== 'pending' && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-[#9CA3AF]">Progress</span>
                          <span className="text-[11px] font-semibold" style={{ color: s.color }}>{phase.progress}%</span>
                        </div>
                        <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${phase.progress}%`, backgroundColor: s.color }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-4 text-[11px] text-[#9CA3AF]">
                      {phase.agentName && (
                        <span className="flex items-center gap-1">
                          <BotIcon size={11} />{phase.agentName}
                        </span>
                      )}
                      {phase.startDate && (
                        <span className="flex items-center gap-1">
                          <ClockIcon size={11} />{phase.startDate}{phase.endDate ? ` → ${phase.endDate}` : ' → now'}
                        </span>
                      )}
                      {phase.logsCount > 0 && (
                        <span>{phase.logsCount} log entries</span>
                      )}
                      {phase.findingsCount > 0 && (
                        <span className="text-[#EE0033] font-semibold">{phase.findingsCount} findings</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Detail panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <h3 className="text-[14px] font-bold text-[#111111] mb-1">{selected.name}</h3>
            <p className="text-[12px] text-[#6B7280] mb-4">{selected.description}</p>

            <div className="space-y-3 mb-4">
              <InfoRow label="Status" value={<StatusChip phase={selected} />} />
              <InfoRow label="Progress" value={`${selected.progress}%`} />
              {selected.agentName && <InfoRow label="Agent" value={selected.agentName} mono />}
              {selected.owner && <InfoRow label="Owner" value={selected.owner} />}
              {selected.startDate && <InfoRow label="Start" value={selected.startDate} />}
              {selected.endDate && <InfoRow label="End" value={selected.endDate} />}
              <InfoRow label="Log entries" value={String(selected.logsCount)} />
              <InfoRow label="Findings" value={String(selected.findingsCount)} highlight={selected.findingsCount > 0} />
            </div>

            {selected.status === 'hitl' && (
              <button
                onClick={onHitl}
                className="w-full py-2.5 bg-[#EE0033] hover:bg-[#CC002B] text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <AlertTriangleIcon size={14} className="text-white" />
                Review Approval Request
              </button>
            )}
            {selected.status === 'pending' && (
              <div className="p-3 bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg">
                <p className="text-[12px] text-[#9CA3AF] text-center">This phase has not started yet.</p>
              </div>
            )}
          </div>

          {/* Checkpoint notice */}
          {selected.checkpoint && (
            <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl p-4">
              <div className="flex items-start gap-2.5">
                <InfoIcon size={14} className="text-[#B45309] mt-0.5 shrink-0" />
                <div>
                  <div className="text-[12px] font-semibold text-[#92400E] mb-1">Human Checkpoint</div>
                  <p className="text-[11px] text-[#92400E] leading-snug">
                    This phase requires explicit human approval before the agent can proceed. All actions within this phase are high-risk and irreversible.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusChip({ phase }: { phase: Phase }) {
  const s = statusConfig[phase.status]
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function InfoRow({ label, value, mono, highlight }: { label: string; value: React.ReactNode; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-[#9CA3AF]">{label}</span>
      <span className={`font-medium ${mono ? 'font-mono text-[11px]' : ''} ${highlight ? 'text-[#EE0033]' : 'text-[#374151]'}`}>
        {value}
      </span>
    </div>
  )
}
