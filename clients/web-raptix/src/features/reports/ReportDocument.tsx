import type { CSSProperties } from 'react'
import type { PhaseState, ReportSectionDef, SectionBlock } from './types'

const MONO = "'JetBrains Mono', monospace"

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#D97706',
  medium: '#CA8A04',
  low: '#16A34A',
}

function severityColor(value: string): string | undefined {
  return SEVERITY_COLORS[value.trim().toLowerCase()]
}

const PHASE_STYLES: Record<PhaseState, { border: string; bg: string; color: string; label: string }> = {
  completed: { border: '#16A34A', bg: '#F0FDF4', color: '#16A34A', label: 'COMPLETED' },
  active: { border: '#DC2626', bg: '#FEF2F2', color: '#DC2626', label: 'IN PROGRESS' },
  pending: { border: '#E2E8F0', bg: '#F1F5F9', color: '#94A3B8', label: 'PENDING' },
}

const noteStyles: Record<'info' | 'success', CSSProperties> = {
  info: { background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569' },
  success: { background: '#F0FDF4', border: '1px solid #86EFAC', color: '#15803D' },
}

function ParagraphBlock({ text }: { text: string }) {
  return <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, margin: '0 0 16px' }}>{text}</p>
}

function NoteBlock({ tone, title, text }: { tone: 'info' | 'success'; title?: string; text: string }) {
  return (
    <div style={{ ...noteStyles[tone], borderRadius: 6, padding: '12px 16px', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
      {title && <strong style={{ color: tone === 'info' ? '#0F172A' : undefined }}>{title}: </strong>}
      {text}
    </div>
  )
}

function RiskScoreBlock({ level, cvss }: { level: string; cvss: string }) {
  return (
    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        Overall Risk Score
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>{level}</div>
      <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
        CVSS Max: <strong>{cvss}</strong>
      </div>
    </div>
  )
}

function TableBlock({ block }: { block: Extract<SectionBlock, { kind: 'table' }> }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {block.columns.map(column => (
              <th
                key={column}
                style={{
                  padding: '8px 12px', textAlign: 'left', color: '#475569', fontWeight: 600,
                  border: '1px solid #E2E8F0', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => {
            const rowSeverity = row.map(severityColor).find(Boolean)
            return (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => {
                  const colored = block.severityColorColumns?.includes(colIndex)
                  const color = (colored && (severityColor(cell) ?? rowSeverity)) || '#0F172A'
                  const mono = block.columns[colIndex] === 'ID' || block.columns[colIndex] === 'CVSS' || block.columns[colIndex] === 'Asset'
                  return (
                    <td
                      key={colIndex}
                      style={{
                        padding: '8px 12px', border: '1px solid #E2E8F0', color,
                        fontWeight: colored ? 700 : 400,
                        fontFamily: mono ? MONO : undefined,
                        fontSize: mono ? 11 : undefined,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PhasesBlock({ block }: { block: Extract<SectionBlock, { kind: 'phases' }> }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {block.items.map(item => {
        const phase = PHASE_STYLES[item.state]
        return (
          <div key={item.title} style={{ borderLeft: `3px solid ${phase.border}`, paddingLeft: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, background: phase.bg, color: phase.color, padding: '2px 8px', borderRadius: 4 }}>
                {phase.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{item.title}</span>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, margin: 0 }}>{item.text}</p>
          </div>
        )
      })}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ background: '#0B0F19', borderRadius: 8, padding: '20px 24px', overflowX: 'auto', marginBottom: 16 }}>
      <pre style={{ margin: 0, fontFamily: MONO, fontSize: 12, color: '#E2E8F0', lineHeight: 1.6 }}>{code}</pre>
    </div>
  )
}

function StepsBlock({ block }: { block: Extract<SectionBlock, { kind: 'steps' }> }) {
  return (
    <div>
      {block.items.map((item, index) => (
        <div key={item.action} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #F1F5F9', alignItems: 'flex-start' }}>
          <span
            style={{
              minWidth: 24, height: 24, background: '#DC2626', color: '#FFFFFF', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}
          >
            {index + 1}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500, marginBottom: 4 }}>{item.action}</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              Effort: <strong style={{ color: '#475569' }}>{item.effort}</strong>
              {' '}·{' '}Risk Impact: <strong style={{ color: '#475569' }}>{item.impact}</strong>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function BlockView({ block }: { block: SectionBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return <ParagraphBlock text={block.text} />
    case 'note':
      return <NoteBlock tone={block.tone} title={block.title} text={block.text} />
    case 'riskScore':
      return <RiskScoreBlock level={block.level} cvss={block.cvss} />
    case 'table':
      return <TableBlock block={block} />
    case 'phases':
      return <PhasesBlock block={block} />
    case 'code':
      return <CodeBlock code={block.code} />
    case 'steps':
      return <StepsBlock block={block} />
  }
}

export function ReportSectionView({ section }: { section: { def: ReportSectionDef; blocks: SectionBlock[] } }) {
  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>
        {section.def.num}. {section.def.title}
      </h2>
      {section.blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}
