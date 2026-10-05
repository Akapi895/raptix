import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangleIcon, LockIcon } from '../../components/Icons'
import { MOCK_CHIP } from './styles'
export { CapabilityButton } from '../../shared/ui/CapabilityButton'

export function MockSourceChip({ source }: { source: string }) {
  return <span style={MOCK_CHIP}>MOCK · {source}</span>
}

export function PlanningNotice({ children, style, tone }: {
  children: ReactNode
  style?: CSSProperties
  tone?: 'amber' | 'red'
}) {
  const red = tone === 'red'
  return (
    <div
      role="note"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        background: red ? '#FEF2F2' : '#FFFBEB',
        border: `1px solid ${red ? '#FECACA' : '#FDE68A'}`, borderRadius: 8,
        padding: '10px 14px', marginBottom: 16, fontSize: 12, lineHeight: 1.55,
        color: red ? '#991B1B' : '#92400E',
        ...style,
      }}
    >
      <AlertTriangleIcon size={14} color={red ? '#DC2626' : '#D97706'} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}

export function DocCard({ title, source, children, style }: {
  title: string
  source: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', ...style }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{title}</span>
        <MockSourceChip source={source} />
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  )
}

export function MissingDocsState({ project, subject }: {
  project: { name: string; status: string }
  subject: string
}) {
  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0F172A' }}>
            {project.name} — {subject}
          </h1>
          <span style={MOCK_CHIP}>DEMO BUILD</span>
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8' }}>
          Project status: {project.status} — documents not yet available.
        </div>
      </div>

      <div style={{
        background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10,
        padding: '24px 28px', maxWidth: 720,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <LockIcon size={18} color="#94A3B8" />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
            Not available for this project
          </span>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          {subject} are generated from the engagement planning bundle —{' '}
          <code style={{ fontFamily: 'monospace', fontSize: 12, background: '#F1F5F9', padding: '1px 5px', borderRadius: 4 }}>plan/roe.json</code>,{' '}
          <code style={{ fontFamily: 'monospace', fontSize: 12, background: '#F1F5F9', padding: '1px 5px', borderRadius: 4 }}>plan/conops.json</code>,{' '}
          <code style={{ fontFamily: 'monospace', fontSize: 12, background: '#F1F5F9', padding: '1px 5px', borderRadius: 4 }}>plan/deconfliction.json</code>{' '}
          and the orchestrator-built{' '}
          <code style={{ fontFamily: 'monospace', fontSize: 12, background: '#F1F5F9', padding: '1px 5px', borderRadius: 4 }}>plan/opplan.json</code>.
          This demo project has no recorded planning bundle. Its lifecycle status alone does not establish whether documents exist.
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          In this demo build the planning interview that produces the bundle is not connected, so
          projects created here stay in “Planning” without documents. No sample data is shown in
          place of a missing bundle.
        </p>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Where to go next
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
          <li>Review or update project metadata under <strong>Settings</strong> (sidebar → Settings).</li>
          <li>Return to <strong>Overview</strong> for the current phase and next steps.</li>
          <li>To preview planning documents, open <strong>Acme Corp External Assessment</strong>, the clearly marked sample archive project.</li>
        </ul>
      </div>
    </div>
  )
}
