import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import {
  AlertTriangleIcon, BotIcon, DatabaseIcon, GridIcon, ListIcon, PlusIcon,
  RefreshIcon, SearchIcon, ShieldIcon, TargetIcon, ZapIcon,
} from '../../../components/Icons'
import {
  REAL_HOME_COLORS as C, REAL_LIFECYCLE_META, countByLifecycle,
  filterRealProjects, formatPublicCount, formatUpdatedAt,
} from '../real-project.types'
import type { RealProjectFilter, RealProjectsHomeProps } from '../real-project.types'

const FILTERS: { id: RealProjectFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'draft', label: 'Draft' }, { id: 'planning', label: 'Planning' },
  { id: 'running', label: 'Running' }, { id: 'completed', label: 'Completed' }, { id: 'failed', label: 'Failed' },
]
const LIST_COLUMNS = '2fr 110px 1.6fr 90px 90px 100px 120px 90px'
const LIST_HEADERS = ['Project • Slug', 'Status', 'Target', 'Findings', 'Assets', 'Agents', 'Updated', 'Actions']
const MONO = "'JetBrains Mono', monospace"

function StatusPill({ status }: { status: ProjectViewModel['lifecycleStatus'] }) {
  const meta = REAL_LIFECYCLE_META[status]
  return (
    <span style={{ fontSize: 11, fontWeight: 600, background: meta.bg, color: meta.text, borderRadius: 20, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.dot, display: 'inline-block', animation: status === 'running' ? 'pulseDot 2s cubic-bezier(0.4,0,0.6,1) infinite' : undefined }} />
      {meta.label}
    </span>
  )
}

function CountChip({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <span style={{ fontSize: 11, fontFamily: MONO, color: C.body, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {icon} {label} {formatPublicCount(value)}
    </span>
  )
}

function MetricBox({ big, bigColor, icon, label, sub, alert }: {
  big: number; bigColor: string; icon?: ReactNode; label: string; sub: string; alert?: boolean
}) {
  return (
    <div style={{ flex: '1 1 220px', borderRadius: 8, padding: '16px 20px', background: alert ? '#FEF2F2' : C.card, border: `1.5px solid ${alert ? C.redAlert : C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon}
        <div style={{ fontSize: 28, fontWeight: 700, color: bigColor }}>{big}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: alert ? C.redAlert : C.ink }}>{label}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function ProjectCard({ project, onEnter }: { project: ProjectViewModel; onEnter: RealProjectsHomeProps['onEnter'] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.workspaceSlug}</span>
        <StatusPill status={project.lifecycleStatus} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{project.displayName}</div>
      <div style={{ fontSize: 12, color: C.body, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${project.targetType}: ${project.targetValue}`}>
        {project.targetType} • {project.targetValue}
      </div>
      <div style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <CountChip icon={<DatabaseIcon size={12} />} label="Findings" value={project.findingCount} />
        <CountChip icon={<TargetIcon size={12} />} label="Assets" value={project.assetCount} />
        <CountChip icon={<BotIcon size={12} />} label="Active agents" value={project.activeAgentCount} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, fontWeight: project.authorizationConfirmed ? 600 : 400, color: project.authorizationConfirmed ? C.green : C.amber }}>
        {project.authorizationConfirmed ? 'Authorization confirmed' : 'Authorization not confirmed'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 11, color: project.metadataState === 'needs_review' ? C.amber : C.muted }}>
          {project.metadataState === 'needs_review' ? 'Metadata needs review' : 'Metadata verified'}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>Updated {formatUpdatedAt(project.updatedAt)}</span>
      </div>
      <button
        onClick={() => onEnter(project)}
        style={{ width: '100%', background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <ZapIcon size={13} />
        Enter Project
      </button>
    </div>
  )
}

function ListRow({ project, onEnter }: { project: ProjectViewModel; onEnter: RealProjectsHomeProps['onEnter'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: LIST_COLUMNS, alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.displayName}</div>
        <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.workspaceSlug}</div>
      </div>
      <StatusPill status={project.lifecycleStatus} />
      <span style={{ fontSize: 12, fontFamily: MONO, color: C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={project.targetValue}>{project.targetValue}</span>
      <span style={{ fontSize: 12, fontFamily: MONO, color: C.body }}>{formatPublicCount(project.findingCount)}</span>
      <span style={{ fontSize: 12, fontFamily: MONO, color: C.body }}>{formatPublicCount(project.assetCount)}</span>
      <span style={{ fontSize: 12, fontFamily: MONO, color: C.body }}>{formatPublicCount(project.activeAgentCount)}</span>
      <span style={{ fontSize: 11, color: C.muted }}>{formatUpdatedAt(project.updatedAt)}</span>
      <button onClick={() => onEnter(project)} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
        Enter
      </button>
    </div>
  )
}

export default function RealProjectsHome({ projects, loading, error, onEnter, onCreate, onRefresh }: RealProjectsHomeProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<RealProjectFilter>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const runningCount = countByLifecycle(projects, 'running')
  const failedCount = countByLifecycle(projects, 'failed')
  const visible = filterRealProjects(projects, search, filter)
  const knownAgents = projects.reduce((total, project) => total + (project.activeAgentCount ?? 0), 0)
  const agentsProjected = projects.some(project => project.activeAgentCount !== null)
  return (
    <div style={{ background: C.page, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Sticky topbar: source logo + working search. Notification/user chrome is
          intentionally absent — real mode carries no fake owner identity. */}
      <div style={{ position: 'sticky', top: 0, height: 60, background: C.card, borderBottom: `1px solid ${C.border}`, zIndex: 20, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, background: C.red, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldIcon size={18} color="#fff" />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px' }}>
            <span style={{ color: C.ink }}>RAPT</span>
            <span style={{ color: C.red }}>IX</span>
          </span>
        </div>
        <div style={{ position: 'relative', width: 220 }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }}>
            <SearchIcon size={14} />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search projects"
            placeholder="Search name, slug or target…"
            style={{ width: '100%', background: '#F1F5F9', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px 7px 32px', fontSize: 13, color: C.ink, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh projects"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', cursor: loading ? 'default' : 'pointer', color: C.body, fontSize: 12, fontWeight: 500 }}
        >
          <RefreshIcon size={14} />
          Refresh
        </button>
      </div>

      <div style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.ink }}>Projects Management</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.body }}>
            {runningCount} running engagement{runningCount !== 1 ? 's' : ''} • {projects.length} total
          </p>
        </div>
        <button onClick={onCreate} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <PlusIcon size={14} />
          New Project
        </button>
      </div>

      {/* Metrics: only counts derivable from the public view models. */}
      <div style={{ padding: '0 32px 20px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricBox
          big={projects.length}
          bigColor={C.ink}
          label="Total Engagements"
          sub={`${countByLifecycle(projects, 'running')} Running • ${countByLifecycle(projects, 'planning')} Planning • ${countByLifecycle(projects, 'draft')} Draft`}
        />
        <MetricBox
          big={runningCount}
          bigColor={C.green}
          label="Running Engagements"
          sub={agentsProjected ? `${knownAgents} active agent${knownAgents !== 1 ? 's' : ''} reported` : 'Agent counts not reported'}
        />
        <MetricBox
          big={failedCount}
          bigColor={failedCount > 0 ? C.redAlert : C.ink}
          icon={failedCount > 0 ? <AlertTriangleIcon size={16} color={C.redAlert} /> : undefined}
          label="Failed Engagements"
          alert={failedCount > 0}
          sub={`${countByLifecycle(projects, 'completed')} Completed • ${failedCount > 0 ? 'Needs review' : 'No failures reported'}`}
        />
      </div>

      <div style={{ padding: '0 32px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }}>
            <SearchIcon size={14} />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Filter projects"
            placeholder="Filter by name, slug or target…"
            style={{ width: '100%', background: C.page, border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px 8px 32px', fontSize: 13, color: C.ink, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(({ id, label }) => {
            const count = id === 'all' ? projects.length : countByLifecycle(projects, id)
            const isActive = filter === id
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                aria-pressed={isActive}
                style={{ background: isActive ? C.red : C.card, color: isActive ? '#fff' : C.body, border: `1px solid ${isActive ? C.red : C.border}`, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap' }}
              >
                {label} ({count})
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              aria-label={`${mode} view`}
              style={{ background: '#fff', border: `1px solid ${viewMode === mode ? C.red : C.border}`, color: viewMode === mode ? C.red : C.muted, borderRadius: 6, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              {mode === 'grid' ? <GridIcon size={15} /> : <ListIcon size={15} />}
            </button>
          ))}
        </div>
      </div>

      {/* Body: error / loading / empty occupy the source content position. */}
      {error !== null ? (
        <div role="alert" style={{ margin: '0 32px 32px', background: '#FEF2F2', border: `1.5px solid ${C.redAlert}`, borderRadius: 8, padding: '20px 24px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.redAlert }}>Projects unavailable</div>
          <div style={{ fontSize: 13, color: C.body, marginTop: 4 }}>{error}</div>
          <button onClick={onRefresh} style={{ marginTop: 12, background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Retry
          </button>
        </div>
      ) : loading && projects.length === 0 ? (
        <p role="status" style={{ padding: '48px 32px', color: C.muted, fontSize: 14 }}>Loading projects…</p>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(480px, 100%), 1fr))', gap: 16, padding: '0 32px 32px' }}>
          {visible.map(project => <ProjectCard key={project.id} project={project} onEnter={onEnter} />)}
          {visible.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 0', color: C.muted, fontSize: 14 }}>
              No projects match the current filters.
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '0 32px 32px' }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: LIST_COLUMNS, padding: '10px 16px', background: C.page, borderBottom: `1px solid ${C.border}`, gap: 8 }}>
              {LIST_HEADERS.map(col => (
                <span key={col} style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</span>
              ))}
            </div>
            {visible.map(project => <ListRow key={project.id} project={project} onEnter={onEnter} />)}
            {visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, fontSize: 14 }}>
                No projects match the current filters.
              </div>
            )}
          </div>
        </div>
      )}

      <style>{'@keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }'}</style>
    </div>
  )
}
