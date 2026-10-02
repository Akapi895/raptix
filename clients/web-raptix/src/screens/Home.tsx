import { useState } from 'react'
import type { Project, ProjectStatus, MemberRole, Screen } from '../types'
import {
  SearchIcon, PlusIcon, ChevronRightIcon,
  DatabaseIcon, AlertTriangleIcon, BotIcon, MoreIcon,
  ShieldIcon, BellIcon, UserIcon, GridIcon, ListIcon,
  ZapIcon, TargetIcon, KeyIcon, TerminalIcon, CheckIcon,
  XIcon, ChevronDownIcon,
} from '../components/Icons'

interface Props {
  projects: Project[]
  onEnter: (p: Project, screen?: Screen) => void
  onNewChat: () => void
  onNewProject: () => void
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; bg: string; text: string; dot: string }> = {
  active:    { label: 'Active',    bg: 'rgba(34,197,94,0.12)',   text: '#22C55E', dot: '#22C55E' },
  completed: { label: 'Completed', bg: 'rgba(59,130,246,0.12)',  text: '#3B82F6', dot: '#3B82F6' },
  paused:    { label: 'Paused',    bg: 'rgba(245,158,11,0.12)',  text: '#F59E0B', dot: '#F59E0B' },
  planning:  { label: 'Planning',  bg: 'rgba(100,116,139,0.12)', text: '#64748B', dot: '#64748B' },
}

type FilterId = ProjectStatus | 'all' | 'needs-attention'

const FILTER_PILLS: { id: FilterId; label: string; count: (ps: Project[]) => number }[] = [
  { id: 'all',              label: 'All',             count: ps => ps.length },
  { id: 'active',          label: 'Active',          count: ps => ps.filter(p => p.status === 'active').length },
  { id: 'needs-attention', label: 'Needs Attention', count: ps => ps.filter(p => p.id === '1').length },
  { id: 'paused',          label: 'Paused',          count: ps => ps.filter(p => p.status === 'paused').length },
  { id: 'completed',       label: 'Completed',       count: ps => ps.filter(p => p.status === 'completed').length },
]

function getPhaseIndex(project: Project): number {
  if (project.id === '1') return 1
  if (project.id === '2') return 0
  const phase = project.currentPhase?.toLowerCase() ?? ''
  if (phase.includes('propagat') || phase.includes('lateral')) return 1
  if (phase.includes('object')) return 2
  return 0
}

interface PhaseNodeProps {
  label: string
  state: 'done' | 'active' | 'pending'
  isLast: boolean
}

function PhaseNode({ label, state, isLast }: PhaseNodeProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: isLast ? 'none' : '1' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <div style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: state === 'done' ? '#22C55E' : 'transparent',
          border: state === 'active' ? '2px solid #DC2626' : state === 'done' ? 'none' : '2px solid #CBD5E1',
          position: 'relative',
        }}>
          {state === 'done' && <CheckIcon size={11} color="#fff" />}
          {state === 'active' && (
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#DC2626',
              animation: 'pulseDot 2s cubic-bezier(0.4,0,0.6,1) infinite',
            }} />
          )}
        </div>
        <span style={{
          fontSize: 10,
          color: state === 'active' ? '#DC2626' : state === 'done' ? '#22C55E' : '#94A3B8',
          whiteSpace: 'nowrap',
          fontWeight: state === 'active' ? 600 : 400,
        }}>
          {label}
        </span>
      </div>
      {!isLast && (
        <div style={{
          flex: 1,
          height: 1,
          background: state === 'done' ? '#22C55E' : '#E2E8F0',
          margin: '0 4px',
          marginBottom: 14,
        }} />
      )}
    </div>
  )
}

function UKCStepper({ project }: { project: Project }) {
  const activeIdx = getPhaseIndex(project)
  const phases = ['Foothold', 'Propagation', 'Objectives']
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 12 }}>
      {phases.map((phase, i) => {
        const state: 'done' | 'active' | 'pending' = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'
        return <PhaseNode key={phase} label={phase} state={state} isLast={i === phases.length - 1} />
      })}
    </div>
  )
}

function TelemetryBox({ project }: { project: Project }) {
  const isActive = project.id === '1'
  return (
    <div style={{
      background: '#F8FAFC',
      border: '1px solid #E2E8F0',
      borderRadius: 6,
      padding: '10px 12px',
      marginTop: 12,
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        💻 {isActive ? '3 Live Shells' : '0 Shells'}
      </span>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        🔑 {isActive ? '18 Creds' : '—'}
      </span>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        🎯 {isActive ? '1/5 Objectives' : '0/5 Objectives'}
      </span>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        🛡 {isActive ? '2 Critical' : '0 Critical'}
      </span>
    </div>
  )
}

function AvatarCluster({ members }: { members: Project['members'] }) {
  const shown = members.slice(0, 3)
  const extra = members.length - shown.length
  const colors = ['#DC2626', '#3B82F6', '#8B5CF6', '#F59E0B', '#22C55E']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex' }}>
        {shown.map((m, i) => (
          <div
            key={m.id}
            title={m.name}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: colors[i % colors.length],
              border: '2px solid #fff',
              marginLeft: i > 0 ? -6 : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              zIndex: shown.length - i,
              position: 'relative',
            }}
          >
            {m.initials}
          </div>
        ))}
        {extra > 0 && (
          <div style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#E2E8F0',
            border: '2px solid #fff',
            marginLeft: -6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            color: '#64748B',
            position: 'relative',
            zIndex: 0,
          }}>
            +{extra}
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: '#94A3B8' }}>
        {shown[0]?.name} (Lead)
      </span>
    </div>
  )
}

function ProjectCard({
  project,
  onEnter,
  menuOpen,
  setMenuOpen,
}: {
  project: Project
  onEnter: (p: Project, screen?: Screen) => void
  menuOpen: string | null
  setMenuOpen: (id: string | null) => void
}) {
  const statusCfg = STATUS_CONFIG[project.status]
  const hasHITL = project.id === '1'
  const isWithinWindow = project.id === '1'

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#94A3B8', flex: 1 }}>{project.client}</span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          background: statusCfg.bg,
          color: statusCfg.text,
          borderRadius: 20,
          padding: '2px 8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.dot, display: 'inline-block' }} />
          {statusCfg.label}
        </span>
        {hasHITL && (
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            background: '#FEF2F2',
            color: '#EF4444',
            borderRadius: 20,
            padding: '2px 8px',
            animation: 'pulseDot 2s cubic-bezier(0.4,0,0.6,1) infinite',
            border: '1px solid #EF4444',
          }}>
            ⚠ HITL PENDING
          </span>
        )}
        <div style={{ position: 'relative' }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === project.id ? null : project.id) }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#94A3B8',
              padding: '2px 4px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <MoreIcon size={16} />
          </button>
          {menuOpen === project.id && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: 26,
              background: '#fff',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: '4px 0',
              zIndex: 30,
              minWidth: 140,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}>
              {['View Charter & ROE', 'Edit Charter', 'Archive', 'Delete'].map(item => (
                <button
                  key={item}
                  onClick={() => setMenuOpen(null)}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: '7px 14px',
                    fontSize: 13,
                    color: item === 'Delete' ? '#EF4444' : '#0F172A',
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Title & scope */}
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>{project.name}</div>
      <div style={{ fontSize: 12, color: '#475569', fontFamily: "'JetBrains Mono', monospace" }}>{project.scopeLabel}</div>

      {/* UKC Stepper */}
      <UKCStepper project={project} />

      {/* Telemetry */}
      <TelemetryBox project={project} />

      {/* Testing window */}
      <div style={{ marginTop: 8, fontSize: 11, color: isWithinWindow ? '#22C55E' : '#94A3B8', fontWeight: isWithinWindow ? 600 : 400 }}>
        {isWithinWindow
          ? '🟢 Within Authorized Window (22:00 – 05:00 UTC)'
          : '⏸ Outside Testing Window'}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <AvatarCluster members={project.members} />
        <span style={{ fontSize: 11, color: '#94A3B8' }}>Updated {project.lastActivity}</span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onEnter(project, 'operator-console')}
          style={{
            flex: 1,
            background: '#DC2626',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <ZapIcon size={13} />
          Enter Operator Console
        </button>
        <button
          onClick={() => onEnter(project)}
          style={{
            background: '#fff',
            color: '#475569',
            border: '1px solid #E2E8F0',
            borderRadius: 6,
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Charter & ROE
        </button>
      </div>
    </div>
  )
}

function ListRow({ project, onEnter }: { project: Project; onEnter: (p: Project) => void }) {
  const statusCfg = STATUS_CONFIG[project.status]
  const hasHITL = project.id === '1'
  const activeIdx = getPhaseIndex(project)
  const phaseNames = ['Foothold', 'Propagation', 'Objectives']
  const phaseName = phaseNames[activeIdx] ?? 'Foothold'
  const isWithinWindow = project.id === '1'
  const sessions = project.id === '1' ? 5 : 0
  const lead = project.members[0]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 100px 120px 80px 100px 90px 130px 90px',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid #E2E8F0',
        borderLeft: hasHITL ? '3px solid #EF4444' : '3px solid transparent',
        background: hasHITL ? '#FFF5F5' : 'transparent',
        gap: 8,
        transition: 'background 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={e => { if (!hasHITL) (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
      onMouseLeave={e => { if (!hasHITL) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{project.name}</div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>{project.client}</div>
      </div>

      <span style={{
        fontSize: 11,
        fontWeight: 600,
        background: statusCfg.bg,
        color: statusCfg.text,
        borderRadius: 20,
        padding: '2px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusCfg.dot, display: 'inline-block' }} />
        {statusCfg.label}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: project.status === 'active' ? '#DC2626' : '#94A3B8',
          display: 'inline-block',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, color: '#0F172A' }}>{phaseName}</span>
      </div>

      <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        {sessions}
      </span>

      <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>
        {project.id === '1' ? '1/5' : '0/5'}
      </span>

      <span style={{ fontSize: 11, color: isWithinWindow ? '#22C55E' : '#94A3B8' }}>
        {isWithinWindow ? '🟢 Active' : '⏸ Off'}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#DC2626',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}>
          {lead?.initials}
        </div>
        <span style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead?.name}
        </span>
      </div>

      <button
        onClick={() => onEnter(project)}
        style={{
          background: '#DC2626',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Enter
      </button>
    </div>
  )
}

export default function Home({ projects, onEnter, onNewChat: _onNewChat, onNewProject }: Props) {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const activeCount = projects.filter(p => p.status === 'active').length
  const pausedCount = projects.filter(p => p.status === 'paused').length
  const completedCount = projects.filter(p => p.status === 'completed').length
  const planningCount = projects.filter(p => p.status === 'planning').length

  const filteredProjects = projects.filter(p => {
    const matchesSearch =
      search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.client.toLowerCase().includes(search.toLowerCase()) ||
      p.scopeLabel.toLowerCase().includes(search.toLowerCase())

    let matchesFilter = true
    if (filter === 'all') matchesFilter = true
    else if (filter === 'needs-attention') matchesFilter = p.id === '1'
    else matchesFilter = p.status === filter

    return matchesSearch && matchesFilter
  })

  return (
    <div
      style={{ background: '#F8FAFC', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}
      onClick={() => setMenuOpen(null)}
    >
      {/* Sticky Topbar */}
      <div style={{
        position: 'sticky',
        top: 0,
        height: 60,
        background: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 16,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <div style={{
            width: 32,
            height: 32,
            background: '#DC2626',
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <ShieldIcon size={18} color="#fff" />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px' }}>
            <span style={{ color: '#0F172A' }}>RAPT</span>
            <span style={{ color: '#DC2626' }}>IX</span>
          </span>
        </div>

        {/* Center Search */}
        <div style={{ position: 'relative', width: 220 }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }}>
            <SearchIcon size={14} />
          </div>
          <input
            placeholder="Search projects, clients, domains…"
            style={{
              width: '100%',
              background: '#F1F5F9',
              border: '1px solid #E2E8F0',
              borderRadius: 7,
              padding: '7px 10px 7px 32px',
              fontSize: 13,
              color: '#0F172A',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* Bell */}
        <div style={{ position: 'relative' }}>
          <button style={{
            background: 'none',
            border: '1px solid #E2E8F0',
            borderRadius: 7,
            padding: '6px',
            cursor: 'pointer',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
          }}>
            <BellIcon size={16} />
          </button>
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#DC2626',
            border: '1.5px solid #fff',
          }} />
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: '#fff',
          }}>
            AK
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', lineHeight: 1.2 }}>Alex Kim</div>
            <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.2 }}>Lead Pentester</div>
          </div>
        </div>
      </div>

      {/* Page Header */}
      <div style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Projects Management</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
            {activeCount} active engagement{activeCount !== 1 ? 's' : ''} • {projects.length} total
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onNewProject() }}
          style={{
            background: '#DC2626',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            padding: '9px 16px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <PlusIcon size={14} />
          New Project
        </button>
      </div>

      {/* Fleet Metrics Banner */}
      <div style={{ padding: '0 32px 20px', display: 'flex', gap: 16 }}>
        {/* Active Engagements */}
        <div style={{
          flex: 1,
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 8,
          padding: '16px 20px',
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#0F172A' }}>{activeCount}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginTop: 2 }}>Active Engagements</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
            {pausedCount} Paused • {completedCount} Completed • {planningCount} Planning
          </div>
        </div>

        {/* HITL Approval */}
        <div style={{
          flex: 1,
          background: '#FEF2F2',
          border: '1.5px solid #EF4444',
          borderRadius: 8,
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <AlertTriangleIcon size={16} color="#EF4444" />
            <div style={{ fontSize: 28, fontWeight: 700, color: '#EF4444' }}>1</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>HITL Approval Required</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#EF4444', marginTop: 4, opacity: 0.85 }}>
            Acme Corp: secretsdump NTDS blocked
          </div>
        </div>

        {/* Live C2 Sessions */}
        <div style={{
          flex: 1,
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 8,
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <TerminalIcon size={16} color="#22C55E" />
            <div style={{ fontSize: 28, fontWeight: 700, color: '#0F172A' }}>5</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Live C2 Sessions</div>
          <div style={{ fontSize: 11, color: '#22C55E', marginTop: 4 }}>Active beacons across 2 networks</div>
        </div>
      </div>

      {/* Filter & Action Bar */}
      <div style={{ padding: '0 32px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }}>
            <SearchIcon size={14} />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by project name, client, IP…"
            style={{
              width: '100%',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 7,
              padding: '8px 10px 8px 32px',
              fontSize: 13,
              color: '#0F172A',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTER_PILLS.map(pill => {
            const count = pill.count(projects)
            const isActive = filter === pill.id
            return (
              <button
                key={pill.id}
                onClick={() => setFilter(pill.id)}
                style={{
                  background: isActive ? '#DC2626' : '#FFFFFF',
                  color: isActive ? '#fff' : '#475569',
                  border: isActive ? '1px solid #DC2626' : '1px solid #E2E8F0',
                  borderRadius: 20,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {pill.label} ({count})
              </button>
            )
          })}
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'list'] as const).map(mode => {
            const isActive = viewMode === mode
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: '#fff',
                  border: isActive ? '1px solid #DC2626' : '1px solid #E2E8F0',
                  color: isActive ? '#DC2626' : '#94A3B8',
                  borderRadius: 6,
                  padding: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {mode === 'grid' ? <GridIcon size={15} /> : <ListIcon size={15} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Projects — Grid */}
      {viewMode === 'grid' ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16,
          padding: '0 32px 32px',
        }}>
          {filteredProjects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onEnter={onEnter}
              menuOpen={menuOpen}
              setMenuOpen={setMenuOpen}
            />
          ))}
          {filteredProjects.length === 0 && (
            <div style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '48px 0',
              color: '#94A3B8',
              fontSize: 14,
            }}>
              No projects match the current filters.
            </div>
          )}
        </div>
      ) : (
        /* Projects — List */
        <div style={{ padding: '0 32px 32px' }}>
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 100px 120px 80px 100px 90px 130px 90px',
              padding: '10px 16px',
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              gap: 8,
            }}>
              {['PROJECT • CLIENT', 'STATUS', 'UKC PHASE', 'SESSIONS', 'OBJECTIVES', 'WINDOW', 'LEAD', 'ACTIONS'].map(col => (
                <span key={col} style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#94A3B8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  {col}
                </span>
              ))}
            </div>
            {filteredProjects.map(project => (
              <ListRow key={project.id} project={project} onEnter={onEnter} />
            ))}
            {filteredProjects.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: 14 }}>
                No projects match the current filters.
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}
