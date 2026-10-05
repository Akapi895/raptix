import { useState } from 'react'
import type { Project, ProjectStatus } from '../types'
import Dialog from '../shared/ui/Dialog'
import { XIcon, MessageIcon, ChevronRightIcon, SearchIcon, CheckIcon } from './Icons'

interface Props {
  projects: Project[]
  onClose: () => void
  onSelectProject: (p: Project) => void
  onOpenNewProject?: () => void
}

const statusConfig: Record<ProjectStatus, { label: string; dot: string }> = {
  active:    { label: 'Active',    dot: '#22C55E' },
  completed: { label: 'Completed', dot: '#6B7280' },
  paused:    { label: 'Paused',    dot: '#F59E0B' },
  planning:  { label: 'Planning',  dot: '#3B82F6' },
}

export default function NewChatModal({ projects, onClose, onSelectProject, onOpenNewProject = () => {} }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Project | null>(null)

  const available = projects.filter(p =>
    p.status !== 'completed' && (
      search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.client.toLowerCase().includes(search.toLowerCase())
    )
  )

  return (
    <Dialog
      onClose={onClose}
      labelId="new-chat-title"
      panelClassName="w-full max-w-md overflow-hidden flex flex-col rounded-3xl"
      panelStyle={{ maxHeight: '90dvh' }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: '#EE0033', boxShadow: '0 2px 8px rgba(238,0,51,0.35)' }}
            >
              <MessageIcon size={16} className="text-white" />
            </div>
            <div>
              <h3 id="new-chat-title" className="text-[16px] font-bold" style={{ color: '#F3F4F6' }}>New Chat</h3>
              <p className="text-[12px]" style={{ color: '#9CA3AF' }}>Select a project to chat in</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close new chat dialog"
            className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors"
            style={{ color: '#9CA3AF' }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#161D27'
              e.currentTarget.style.color = '#F3F4F6'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#9CA3AF'
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pb-3 shrink-0">
          <div className="relative">
            <SearchIcon size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4B5563' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              aria-label="Search projects"
              className="w-full pl-9 pr-4 py-2.5 text-[13px] rounded-2xl outline-none transition-all"
              style={{
                backgroundColor: '#161D27',
                border: '1px solid #273142',
                color: '#F3F4F6',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = '#EE0033'
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(238,0,51,0.1)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = '#273142'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto px-6 space-y-1.5 pb-2">
          {available.map(p => {
            const sc = statusConfig[p.status]
            const isSelected = selected?.id === p.id
            const members = p.members ?? []

            return (
              <button
                key={p.id}
                onClick={() => setSelected(isSelected ? null : p)}
                aria-pressed={isSelected}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all"
                style={{
                  backgroundColor: isSelected ? 'rgba(238,0,51,0.1)' : '#161D27',
                  border: isSelected ? '1px solid #EE0033' : '1px solid #273142',
                }}
                onMouseEnter={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = '#3D4F66'
                    e.currentTarget.style.backgroundColor = '#1E2736'
                  }
                }}
                onMouseLeave={e => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = '#273142'
                    e.currentTarget.style.backgroundColor = '#161D27'
                  }
                }}
              >
                {/* Radio circle */}
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                  style={{
                    backgroundColor: isSelected ? '#EE0033' : 'transparent',
                    borderColor: isSelected ? '#EE0033' : '#3D4F66',
                  }}
                >
                  {isSelected && <CheckIcon size={10} className="text-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold truncate" style={{ color: '#F3F4F6' }}>
                      {p.name}
                    </span>
                    <span
                      className="flex items-center gap-1 text-[10px] font-semibold shrink-0"
                      style={{ color: sc.dot }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sc.dot }} />
                      {sc.label}
                    </span>
                  </div>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: '#4B5563' }}>
                    {p.scopeType} · {members.length} member{members.length !== 1 ? 's' : ''}
                  </p>
                </div>

                <ChevronRightIcon
                  size={13}
                  className="shrink-0 transition-colors"
                  style={{ color: isSelected ? '#EE0033' : '#3D4F66' }}
                />
              </button>
            )
          })}

          {available.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-[13px]" style={{ color: '#4B5563' }}>
                {search ? `No projects match "${search}"` : 'No active projects yet.'}
              </p>
            </div>
          )}

          {/* Create project nudge */}
          <div className="pt-3 pb-1 flex items-center justify-center gap-1.5 text-[12px]" style={{ color: '#4B5563' }}>
            <span>No matching project?</span>
            <button
              onClick={() => { onClose(); onOpenNewProject() }}
              className="font-semibold hover:underline transition-colors"
              style={{ color: '#EE0033' }}
            >
              Create a new project →
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 shrink-0 flex items-center gap-3"
          style={{ borderTop: '1px solid #1E2736' }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid #273142',
              color: '#9CA3AF',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#161D27')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onSelectProject(selected)}
            disabled={!selected}
            className="flex-1 py-2.5 text-[13px] font-semibold rounded-2xl transition-all flex items-center justify-center gap-2"
            style={
              selected
                ? { backgroundColor: '#EE0033', color: '#fff', boxShadow: '0 2px 8px rgba(238,0,51,0.35)' }
                : { backgroundColor: '#161D27', color: '#4B5563', border: '1px solid #273142', cursor: 'not-allowed' }
            }
            onMouseEnter={e => { if (selected) e.currentTarget.style.backgroundColor = '#CC002B' }}
            onMouseLeave={e => { if (selected) e.currentTarget.style.backgroundColor = '#EE0033' }}
          >
            <MessageIcon size={14} />
            {selected ? 'Open Chat' : 'Select a project'}
          </button>
        </div>
    </Dialog>
  )
}
