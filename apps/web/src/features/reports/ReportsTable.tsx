import { useState } from 'react'
import type { CSSProperties } from 'react'
import { REPORT_FIXTURES } from '../../mocks/fixtures/reports'
import { CAPABILITY_LIMITS } from './export'
import type { ExportFormat } from './export'
import type { ReportMeta, ReportStatus, ReportType } from './types'
import { CapabilityButton } from './ui'
import { DEMO_CHIP } from './styles'
import { DownloadIcon, ExternalLinkIcon, SearchIcon } from '../../components/Icons'

interface Props {
  onOpen: (report: ReportMeta) => void
  onExport: (report: ReportMeta, format: ExportFormat) => void
}

type TabKey = 'all' | 'technical' | 'executive' | 'attestation'

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(author: string) {
  if (author === 'Alex Kim') return '#DC2626'
  if (author === 'AI Engine') return '#7C3AED'
  if (author === 'Sarah Rowe') return '#2563EB'
  return '#475569'
}

function getTypeStyle(type: ReportType) {
  switch (type) {
    case 'Full Technical': return { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD' }
    case 'Executive Summary': return { bg: '#FAF5FF', color: '#7C3AED', border: '#E9D5FF' }
    case 'Remediation Playbook': return { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' }
    case 'Attestation Certificate': return { bg: '#F0FDF4', color: '#15803D', border: '#86EFAC' }
  }
}

function getStatusStyle(status: ReportStatus) {
  switch (status) {
    case 'Draft': return { bg: '#F1F5F9', color: '#475569' }
    case 'In Review': return { bg: '#FFFBEB', color: '#D97706' }
    case 'Approved': return { bg: '#F0FDF4', color: '#16A34A' }
    case 'Delivered': return { bg: '#EFF6FF', color: '#2563EB' }
  }
}

const GRID_COLUMNS = 'minmax(300px, 1.4fr) 150px 110px 140px 140px 100px 280px'

const downloadButton: CSSProperties = {
  background: 'none', border: '1px solid #E2E8F0', borderRadius: 5, padding: '5px 10px',
  fontSize: 11, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center',
  gap: 4, whiteSpace: 'nowrap',
}

export function ReportsTable({ onOpen, onExport }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')

  const filteredReports = REPORT_FIXTURES.filter(r => {
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'technical' && r.type === 'Full Technical') ||
      (activeTab === 'executive' && r.type === 'Executive Summary') ||
      (activeTab === 'attestation' && r.type === 'Attestation Certificate')
    const q = search.toLowerCase()
    const matchesSearch = r.title.toLowerCase().includes(q) ||
      r.author.toLowerCase().includes(q) ||
      r.framework.toLowerCase().includes(q)
    return matchesTab && matchesSearch
  })

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          { key: 'all', label: `All Deliverables (${REPORT_FIXTURES.length})` },
          { key: 'technical', label: 'Technical Reports' },
          { key: 'executive', label: 'Executive Summaries' },
          { key: 'attestation', label: 'Attestation Letters' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '7px 14px',
              border: activeTab === tab.key ? 'none' : '1px solid #E2E8F0',
              background: activeTab === tab.key ? '#DC2626' : '#FFFFFF',
              color: activeTab === tab.key ? '#FFFFFF' : '#475569',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer',
              borderRadius: 20,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
        <SearchIcon size={14} color="#94A3B8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reports…"
          aria-label="Search reports"
          style={{
            width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
            border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 13, color: '#0F172A',
            background: '#FFFFFF', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, overflowX: 'auto' }}>
        <div style={{ minWidth: 1160 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: GRID_COLUMNS,
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              padding: '10px 20px',
              gap: 8,
            }}
          >
            {['DOCUMENT', 'TYPE', 'STATUS', 'FRAMEWORK', 'AUTHOR', 'MODIFIED', 'ACTIONS'].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
            ))}
          </div>

          {filteredReports.map((report, idx) => {
            const typeStyle = getTypeStyle(report.type)
            const statusStyle = getStatusStyle(report.status)
            const avatarColor = getAvatarColor(report.author)
            const initials = report.author === 'AI Engine' ? 'AI' : getInitials(report.author)

            return (
              <div
                key={report.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLUMNS,
                  padding: '14px 20px',
                  borderBottom: idx < filteredReports.length - 1 ? '1px solid #E2E8F0' : 'none',
                  gap: 8,
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={DEMO_CHIP}>DEMO</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#0F172A' }}>{report.title}</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#94A3B8' }}>
                    sample · {report.pages} pages · {report.words.toLocaleString()} words
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}` }}>
                    {report.type}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: statusStyle.bg, color: statusStyle.color }}>
                    {report.status}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                    {report.framework}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: avatarColor, color: '#FFFFFF', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <span style={{ fontSize: 12, color: '#0F172A' }}>{report.author}</span>
                </div>

                <div style={{ fontSize: 12, color: '#94A3B8' }}>{report.modified}</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => onOpen(report)}
                    style={{ background: 'none', border: '1px solid #DC2626', borderRadius: 5, padding: '5px 10px', fontSize: 11, color: '#DC2626', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => onExport(report, 'json')}
                    title="Download JSON demo export (sample data, project-based filename)"
                    style={downloadButton}
                  >
                    <DownloadIcon size={11} /> JSON
                  </button>
                  <button
                    onClick={() => onExport(report, 'markdown')}
                    title="Download Markdown demo export (sample data, project-based filename)"
                    style={downloadButton}
                  >
                    <DownloadIcon size={11} /> MD
                  </button>
                  <CapabilityButton title={CAPABILITY_LIMITS.pdf} label="Download PDF unavailable in demo build" style={{ ...downloadButton }}>
                    <DownloadIcon size={11} /> PDF
                  </CapabilityButton>
                  <CapabilityButton title={CAPABILITY_LIMITS.share} label="Share report unavailable in demo build" style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 5, padding: '5px 8px', fontSize: 11, color: '#475569' }}>
                    <ExternalLinkIcon size={12} />
                  </CapabilityButton>
                </div>
              </div>
            )
          })}

          {filteredReports.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No reports match your filter.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
