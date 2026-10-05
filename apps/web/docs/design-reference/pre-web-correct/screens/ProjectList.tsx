import { useState } from 'react'
import type { Project, ProjectStatus, MemberRole } from '../types'
import { PlusIcon, SearchIcon, DatabaseIcon, AlertTriangleIcon, BotIcon, MoreIcon, ChevronRightIcon } from '../components/Icons'

interface Props {
  projects: Project[]
  onEnter: (p: Project) => void
}

const STATUS_TABS: { id: ProjectStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'paused', label: 'Paused' },
  { id: 'planning', label: 'Planning' },
]

const statusConfig: Record<ProjectStatus, { label: string; bg: string; text: string; dot: string }> = {
  active:    { label: 'Active',    bg: '#DCFCE7', text: '#15803D', dot: '#16A34A' },
  completed: { label: 'Completed', bg: '#F3F4F6', text: '#374151', dot: '#6B7280' },
  paused:    { label: 'Paused',    bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' },
  planning:  { label: 'Planning',  bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
}

const roleConfig: Record<MemberRole, { bg: string; text: string }> = {
  Owner:  { bg: '#FFF1F3', text: '#EE0033' },
  Member: { bg: '#EFF6FF', text: '#1D4ED8' },
  Viewer: { bg: '#F3F4F6', text: '#6B7280' },
}

const phaseColors: Record<string, string> = {
  Intake:           '#6B7280',
  Reconnaissance:   '#1D4ED8',
  Assessment:       '#7C3AED',
  Exploitation:     '#EE0033',
  'Post-Exploitation': '#EA580C',
  Reporting:        '#16A34A',
}

export default function ProjectList({ projects, onEnter }: Props) {
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const filtered = projects.filter(p => {
    const matchStatus = filter === 'all' || p.status === filter
    const matchSearch = search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.client.toLowerCase().includes(search.toLowerCase()) ||
      p.scopeType.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="p-8">
      {/* Page header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-[24px] font-bold text-[#111111] tracking-tight">Projects</h1>
          <p className="text-[14px] text-[#6B7280] mt-1">
            {projects.filter(p => p.status === 'active').length} active ·{' '}
            {projects.length} total engagements
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-[#EE0033] hover:bg-[#CC002B] text-white text-[13px] font-semibold rounded-lg transition-colors">
          <PlusIcon size={14} className="text-white" />
          Create Project
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex gap-1 bg-[#F3F4F6] p-1 rounded-lg">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                filter === tab.id
                  ? 'bg-white text-[#111111] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#374151]'
              }`}
            >
              {tab.label}
              {tab.id !== 'all' && (
                <span className="ml-1.5 text-[10px] text-[#9CA3AF]">
                  {projects.filter(p => p.status === tab.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative">
          <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="pl-8 pr-4 py-2 text-[13px] bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#EE0033] transition-colors placeholder:text-[#9CA3AF] w-52"
          />
        </div>
      </div>

      {/* Card grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
        onClick={() => menuOpen && setMenuOpen(null)}
      >
        {filtered.map(project => (
          <ProjectCard
            key={project.id}
            project={project}
            menuOpen={menuOpen === project.id}
            onMenuToggle={id => setMenuOpen(prev => prev === id ? null : id)}
            onEnter={() => onEnter(project)}
          />
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <p className="text-[14px] text-[#9CA3AF]">No projects match your filters.</p>
          </div>
        )}
      </div>

      {/* Footer summary */}
      {filtered.length > 0 && (
        <div className="mt-6 flex items-center gap-5 text-[12px] text-[#9CA3AF]">
          <span>{filtered.length} of {projects.length} shown</span>
          <span>
            <span className="font-semibold text-[#EE0033]">
              {projects.reduce((a, p) => a + p.findings, 0)}
            </span>{' '}total findings
          </span>
          <span>
            <span className="font-semibold text-[#374151]">
              {projects.reduce((a, p) => a + p.assets, 0)}
            </span>{' '}total assets
          </span>
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project, menuOpen, onMenuToggle, onEnter,
}: {
  project: Project
  menuOpen: boolean
  onMenuToggle: (id: string) => void
  onEnter: () => void
}) {
  const sc = statusConfig[project.status]
  const rc = roleConfig[project.myRole]
  const phaseColor = phaseColors[project.currentPhase] || '#6B7280'
  const visibleMembers = project.members.slice(0, 3)
  const extraCount = project.members.length - visibleMembers.length

  return (
    <div
      className="group relative bg-white rounded-xl border border-[#E5E7EB] p-5 cursor-pointer
        hover:border-[#EE0033] hover:shadow-md transition-all duration-200 flex flex-col"
      onClick={onEnter}
    >
      {/* Top row: status + menu */}
      <div className="flex items-start justify-between mb-3">
        <span
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ backgroundColor: sc.bg, color: sc.text }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: sc.dot }}
          />
          {sc.label}
        </span>

        {/* 3-dot menu */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onMenuToggle(project.id)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
          >
            <MoreIcon size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-10 bg-white rounded-xl border border-[#E5E7EB] shadow-lg py-1 w-44">
              {[
                { label: 'View Overview' },
                { label: 'Open Chat' },
                { label: 'Manage Members' },
                { label: 'Archive Project', danger: true },
              ].map(item => (
                <button
                  key={item.label}
                  className={`w-full text-left px-3.5 py-2 text-[12px] hover:bg-[#F8F9FB] transition-colors ${
                    item.danger ? 'text-[#EE0033]' : 'text-[#374151]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Project name + scope type */}
      <h3 className="text-[15px] font-bold text-[#111111] leading-snug mb-0.5 group-hover:text-[#EE0033] transition-colors">
        {project.name}
      </h3>
      <p className="text-[12px] text-[#9CA3AF] mb-4">{project.scopeType}</p>

      {/* Current phase */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
          Current Phase
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: phaseColor }} />
          <span className="text-[13px] font-semibold" style={{ color: phaseColor }}>
            {project.currentPhase}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-4">
        <StatItem icon={<DatabaseIcon size={12} />} value={project.assets} label="Assets" />
        <StatItem icon={<AlertTriangleIcon size={12} />} value={project.findings} label="Findings" red={project.findings > 0} />
        <StatItem icon={<BotIcon size={12} />} value={project.agents} label="Agents" green={project.agents > 0} />
      </div>

      {/* Divider */}
      <div className="border-t border-[#F3F4F6] my-3" />

      {/* Members + role */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {visibleMembers.map((m, i) => (
              <div
                key={m.id}
                title={m.name}
                className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-bold text-white"
                style={{ backgroundColor: ['#111111', '#374151', '#1D4ED8', '#7C3AED'][i % 4] }}
              >
                {m.initials}
              </div>
            ))}
            {extraCount > 0 && (
              <div className="w-6 h-6 rounded-full border-2 border-white bg-[#F3F4F6] flex items-center justify-center text-[8px] font-semibold text-[#6B7280]">
                +{extraCount}
              </div>
            )}
          </div>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
            style={{ backgroundColor: rc.bg, color: rc.text }}
          >
            {project.myRole}
          </span>
        </div>
      </div>

      {/* Last activity */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] text-[#9CA3AF]">Updated {project.lastActivity}</span>
        <span className="text-[12px] font-semibold text-[#EE0033] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          Open <ChevronRightIcon size={12} />
        </span>
      </div>
    </div>
  )
}

function StatItem({
  icon, value, label, red, green,
}: {
  icon: React.ReactNode
  value: number
  label: string
  red?: boolean
  green?: boolean
}) {
  const color = red && value > 0 ? '#EE0033' : green && value > 0 ? '#16A34A' : '#6B7280'
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1" style={{ color }}>
        {icon}
        <span className="text-[13px] font-bold">{value}</span>
      </div>
      <span className="text-[10px] text-[#9CA3AF]">{label}</span>
    </div>
  )
}
