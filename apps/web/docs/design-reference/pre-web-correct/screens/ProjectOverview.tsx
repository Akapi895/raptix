import type { CSSProperties, ReactNode } from 'react'
import type { Project, ProjectStatus, Screen } from '../types'
import { useRunSnapshot } from '../features/agent-runs/store'
import { useNarrowViewport } from '../shared/hooks/useNarrowViewport'
import {
  ActivityIcon, AlertTriangleIcon, BookIcon, BotIcon, CheckIcon,
  ChevronRightIcon, DatabaseIcon, FileTextIcon, MessageIcon, TargetIcon,
} from '../components/Icons'

interface Props {
  project: Project
  navigate: (s: Screen) => void
  onHitl: () => void
  onNewChat?: () => void
}

const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" }

const card: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: 20,
}

const label: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#475569',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

const sourceChip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#64748B',
  borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 500,
}

const pill = (bg: string, border: string, color: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: bg, border: `1px solid ${border}`, color,
  borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 500,
})

const btnPrimary: CSSProperties = {
  background: '#DC2626', color: '#FFFFFF', border: 'none',
  borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
}

const PROJECT_STATUS: Record<ProjectStatus, { bg: string; border: string; color: string; label: string }> = {
  active: { bg: '#F0FDF4', border: '#86EFAC', color: '#16A34A', label: 'Active' },
  planning: { bg: '#EFF6FF', border: '#BFDBFE', color: '#2563EB', label: 'Planning' },
  paused: { bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', label: 'Paused' },
  completed: { bg: '#F1F5F9', border: '#E2E8F0', color: '#475569', label: 'Completed' },
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 10, height: 10 }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: 0.4, animation: 'ping 1.4s cubic-bezier(0,0,0.2,1) infinite' }} />
      <span style={{ position: 'relative', width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
    </span>
  )
}

const sectionHeader = (labelText: string, icon: ReactNode, rightEl?: ReactNode) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon}
      <span style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{labelText}</span>
    </div>
    {rightEl}
  </div>
)

function textLink(labelText: string, onClick: () => void): ReactNode {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', color: '#DC2626',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
      }}
    >
      {labelText}
      <ChevronRightIcon size={14} />
    </button>
  )
}

function MetricCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <span style={label}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: last ? 'none' : '1px solid #F1F5F9', minWidth: 0 }}>
      {children}
    </div>
  )
}

export default function ProjectOverview({ project, navigate, onHitl, onNewChat }: Props) {
  const narrow = useNarrowViewport()
  const snapshot = useRunSnapshot(project.id)

  const runActive = snapshot.runState === 'running'
  const unresolvedHitl = snapshot.agents.filter(a => a.status === 'blocked' && !snapshot.approvals[a.id])
  const activeAgents = snapshot.agents.filter(a => a.status === 'running')
  const hasDemoRun = snapshot.agents.some(a => a.id !== 'root')
  const planningEmpty = project.status === 'planning' && project.findings === 0 && project.assets === 0
  const status = PROJECT_STATUS[project.status]
  const openAgentRun = () => { if (onNewChat) onNewChat(); else navigate('agent-run') }

  const activity = snapshot.agents
    .flatMap(a => a.recentActions.map(action => ({ agent: a.name, label: action.label, ts: action.ts })))
    .slice(0, 6)

  const runGuidance = runActive
    ? 'A simulated demo run is active. Counts and activity below come from the shared mock run store in this browser; nothing touches a live runtime.'
    : hasDemoRun
      ? 'The demo run is stopped. Restart it from the Root Agent workspace; previously recorded mock activity stays visible below.'
      : 'No agent run exists for this project in the demo data. Start a simulated session from the Root Agent workspace to generate activity.'

  const metricCaption = (count: number, noun: string) => (count === 0 ? `No ${noun} recorded yet` : 'Count from mock project record')

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: 24 }}>
      <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>

      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', minWidth: 0 }}>
            <div style={{ width: 4, background: status.color, borderRadius: 2, marginRight: 16, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.2, wordBreak: 'break-word' }}>
                  {project.name}
                </h1>
                <span style={sourceChip}>Mock demo data</span>
              </div>
              <p style={{ fontSize: 13, color: '#475569', margin: '6px 0 0', wordBreak: 'break-word' }}>
                {project.scopeType} · {project.scopeLabel}
              </p>
              <p style={{ fontSize: 12, color: '#94A3B8', margin: '6px 0 0' }}>
                Started {project.startDate} · Last activity {project.lastActivity}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span style={pill(status.bg, status.border, status.color)}>{status.label}</span>
              <span style={pill('#F8FAFC', '#E2E8F0', '#475569')}>Phase: {project.currentPhase}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => navigate('operator-console')} style={btnPrimary}>
                Operator Console
                <ChevronRightIcon size={14} />
              </button>
              <button
                onClick={openAgentRun}
                style={{ ...btnPrimary, background: '#FFFFFF', color: '#334155', border: '1px solid #E2E8F0' }}
              >
                Root Agent
              </button>
            </div>
          </div>
        </div>
      </div>

      {planningEmpty && (
        <div style={{ ...card, marginBottom: 20, background: '#EFF6FF', borderColor: '#BFDBFE', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <BookIcon size={18} style={{ color: '#2563EB', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E40AF', marginBottom: 4 }}>
              Planning project — no assessment data yet
            </div>
            <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}>
              This project has no findings, assets or agent activity. Review the engagement documents before
              starting work; the outcome cards below stay empty until a run records data in the demo.
            </p>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {textLink('Charter & ROE', () => navigate('charter'))}
              {textLink('Scope & Boundaries', () => navigate('scope-boundaries'))}
              {textLink('Start a demo run', openAgentRun)}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        <MetricCard icon={<FileTextIcon size={16} style={{ color: '#2563EB' }} />} title="Findings">
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{project.findings}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>{metricCaption(project.findings, 'findings')}</div>
          {textLink('View findings', () => navigate('findings'))}
        </MetricCard>

        <MetricCard icon={<DatabaseIcon size={16} style={{ color: '#475569' }} />} title="Assets">
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{project.assets}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>{metricCaption(project.assets, 'assets')}</div>
          {textLink('View inventory', () => navigate('assets'))}
        </MetricCard>

        <MetricCard icon={<BotIcon size={16} style={{ color: '#475569' }} />} title="Agent Run">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {runActive && <PulsingDot color="#22C55E" />}
            <span style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>
              {runActive ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
            {activeAgents.length}/{snapshot.agents.length} agents active · Source: {snapshot.source}
          </div>
          {textLink('Operator Console', () => navigate('operator-console'))}
        </MetricCard>

        <MetricCard
          icon={<AlertTriangleIcon size={16} style={{ color: unresolvedHitl.length ? '#DC2626' : '#475569' }} />}
          title="HITL Approvals"
        >
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color: unresolvedHitl.length ? '#DC2626' : '#0F172A' }}>
              {unresolvedHitl.length}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
            {unresolvedHitl.length ? 'Awaiting operator decision' : 'No approvals pending'} · Source: {snapshot.source}
          </div>
          {unresolvedHitl.length ? (
            <button onClick={onHitl} style={{ ...btnPrimary, padding: '7px 12px', fontSize: 12 }}>
              Review
              <ChevronRightIcon size={13} />
            </button>
          ) : (
            <span style={{ fontSize: 12, color: '#16A34A', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckIcon size={13} /> Up to date
            </span>
          )}
        </MetricCard>
      </div>

      <div style={{ ...card, marginBottom: 20 }}>
        {sectionHeader(
          'Agent Run & Recent Activity',
          <ActivityIcon size={16} style={{ color: '#475569' }} />,
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={pill(runActive ? '#F0FDF4' : '#F1F5F9', runActive ? '#86EFAC' : '#E2E8F0', runActive ? '#16A34A' : '#64748B')}>
              {runActive ? 'Run running' : 'Run stopped'}
            </span>
            <span style={sourceChip}>Source: {snapshot.source}</span>
          </span>,
        )}
        <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12', lineHeight: 1.5 }}>{runGuidance}</p>
        {activity.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activity.map((ev, i) => (
              <Row key={`${ev.agent}-${ev.ts}-${i}`} last={i === activity.length - 1}>
                <span style={{ ...mono, fontSize: 11, color: '#94A3B8', flexShrink: 0, minWidth: 38 }}>{ev.ts}</span>
                <span style={{ ...mono, fontSize: 11, color: '#475569', flexShrink: 0, minWidth: narrow ? 0 : 110 }}>{ev.agent}</span>
                <span style={{ fontSize: 12, color: '#0F172A', lineHeight: 1.5, minWidth: 0 }}>{ev.label}</span>
              </Row>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
            No agent activity recorded yet — recent actions appear here once a run starts.
          </p>
        )}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {textLink('Open Root Agent workspace', openAgentRun)}
          {textLink('Operations Log', () => navigate('logs'))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 60fr) minmax(0, 40fr)', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={card}>
            {sectionHeader('Engagement Details', <TargetIcon size={16} style={{ color: '#475569' }} />)}
            <Row><span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Status</span><span style={{ fontSize: 12, color: status.color, fontWeight: 600 }}>{status.label}</span></Row>
            <Row><span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Phase</span><span style={{ fontSize: 12, color: '#0F172A' }}>{project.currentPhase}</span></Row>
            <Row><span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Target scope</span><span style={{ fontSize: 12, color: '#0F172A', textAlign: 'right', wordBreak: 'break-word' }}>{project.scopeLabel}</span></Row>
            <Row><span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Engagement type</span><span style={{ fontSize: 12, color: '#0F172A', textAlign: 'right' }}>{project.scopeType}</span></Row>
            <Row><span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Started</span><span style={{ ...mono, fontSize: 12, color: '#0F172A' }}>{project.startDate}</span></Row>
            <Row last>
              <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0 }}>Authorization</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: project.authorizationConfirmed === true ? '#16A34A' : '#D97706' }}>
                {project.authorizationConfirmed === true ? 'Confirmed (demo metadata)' : 'Not recorded'}
              </span>
            </Row>
          </div>

          <div style={card}>
            {sectionHeader('Recent Threads', <MessageIcon size={16} style={{ color: '#475569' }} />)}
            {snapshot.threads.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {snapshot.threads.slice(0, 3).map((t, i) => (
                  <Row key={t.id} last={i === Math.min(snapshot.threads.length, 3) - 1}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{t.title}</span>
                        <span style={{ ...mono, fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>{t.timestamp}</span>
                      </div>
                      <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.preview}
                      </p>
                    </div>
                  </Row>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>No chat threads yet.</p>
            )}
            <div style={{ marginTop: 10 }}>{textLink('Open Root Agent workspace', openAgentRun)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: unresolvedHitl.length ? '#FEF2F2' : '#FFFFFF', border: `1.5px solid ${unresolvedHitl.length ? '#EF4444' : '#E2E8F0'}`, borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <AlertTriangleIcon size={16} style={{ color: unresolvedHitl.length ? '#DC2626' : '#475569' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: unresolvedHitl.length ? '#DC2626' : '#0F172A' }}>
                HITL Approval Required
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 14 }}>
              {unresolvedHitl.length
                ? `${unresolvedHitl.length} action${unresolvedHitl.length === 1 ? '' : 's'} awaiting human approval · Source: ${snapshot.source}`
                : hasDemoRun || runActive
                  ? 'No approvals pending in the shared run.'
                  : 'No run started for this project yet.'}
            </div>
            {unresolvedHitl.length > 0 ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {unresolvedHitl.map(a => (
                    <div key={a.id} style={{ background: '#FFFFFF', border: '1px solid #FECACA', borderRadius: 6, padding: '12px 14px' }}>
                      <div style={{ ...mono, fontSize: 12, color: '#0F172A', marginBottom: 4 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: '#475569', marginBottom: 8, lineHeight: 1.5 }}>{a.task}</div>
                      <span style={{ display: 'inline-block', background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        Blocked — awaiting approval
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={onHitl} style={{ ...btnPrimary, width: '100%', justifyContent: 'center' }}>
                  Review in approval dialog
                </button>
                <p style={{ fontSize: 11, color: '#94A3B8', margin: '8px 0 0', lineHeight: 1.5 }}>
                  Approve/reject is recorded in the HITL dialog and applies to the shared mock run.
                </p>
              </>
            ) : !hasDemoRun && !runActive ? (
              <div>
                <p style={{ fontSize: 12, color: '#475569', margin: '0 0 8', lineHeight: 1.5 }}>
                  Start a simulated run in the Root Agent workspace to exercise the HITL approval flow with mock data.
                </p>
                {textLink('Open Root Agent workspace', openAgentRun)}
              </div>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #86EFAC', color: '#16A34A', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500 }}>
                <CheckIcon size={13} /> No approvals pending
              </div>
            )}
          </div>

          <div style={card}>
            {sectionHeader('Outcomes', <FileTextIcon size={16} style={{ color: '#475569' }} />)}
            {[
              { label: 'Findings', value: project.findings === 0 ? 'No findings recorded yet (mock record)' : `${project.findings} recorded (mock project record)`, to: 'findings' as Screen },
              { label: 'Evidence', value: 'Count not tracked in demo data', to: 'evidence' as Screen },
              { label: 'Reports', value: 'Mock previews only — export limited to JSON/Markdown', to: 'reports' as Screen },
              { label: 'Operations Log', value: `Shared run (${snapshot.source}) + demo archive`, to: 'logs' as Screen },
            ].map((row, i) => (
              <Row key={row.label} last={i === 3}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{row.label}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{row.value}</div>
                </div>
                {textLink('Open', () => navigate(row.to))}
              </Row>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
