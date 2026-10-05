import { useEffect, useState } from 'react'
import type { Project } from '../types'
import {
  CameraIcon,
  DatabaseIcon,
  DownloadIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  TerminalIcon,
  XIcon,
} from '../components/Icons'
import { CapabilityButton, MockSourceChip } from '../features/planning/ui'
import { MOCK_CHIP } from '../features/planning/styles'
import Dialog from '../shared/ui/Dialog'
import { FINDINGS_FIXTURES } from '../mocks/fixtures/findings'
import { EVIDENCE_FIXTURES, linkedFindingsFor } from '../mocks/fixtures/evidence'
import type { EvidenceItem, EvidenceType } from '../mocks/fixtures/evidence'

interface Props {
  project: Project
  evidencePath?: string
  onEvidenceSelect?: (id: string) => void
  onCloseEvidence?: () => void
  onFindingSelect?: (id: string) => void
}

const typeConfig: Record<EvidenceType, { label: string; color: string; bg: string; Icon: React.FC<{ size?: number; style?: React.CSSProperties }> }> = {
  screenshot:       { label: 'Screenshot',       color: '#2563EB', bg: 'rgba(59,130,246,0.15)',  Icon: CameraIcon },
  log:              { label: 'Log',              color: '#16A34A', bg: 'rgba(34,197,94,0.15)',   Icon: FileTextIcon },
  extracted_data:   { label: 'Extracted Data',   color: '#D97706', bg: 'rgba(245,158,11,0.15)', Icon: DatabaseIcon },
  tool_output:      { label: 'Tool Output',      color: '#9D174D', bg: 'rgba(236,72,153,0.15)', Icon: TerminalIcon },
  terminal_capture: { label: 'Terminal Capture', color: '#0D9488', bg: 'rgba(16,185,129,0.15)', Icon: TerminalIcon },
}

const sevColors: Record<string, string> = {
  critical: '#DC2626',
  high: '#F97316',
  medium: '#F59E0B',
  low: '#3B82F6',
  info: '#94A3B8',
}

const TYPE_FILTERS: (EvidenceType | 'All')[] = [
  'All', 'screenshot', 'log', 'extracted_data', 'tool_output', 'terminal_capture',
]

const ADD_EVIDENCE_REASON = 'Evidence upload/registration has no service in this demo build — artifacts are collected by agent runs.'
const LINK_REASON = 'Manual finding links have no API in this demo build — links come from run artifacts.'
const EXPORT_REASON = 'Artifact export needs the file service — not available in this demo build.'
const BINARY_PREVIEW_REASON = 'Binary artifact preview is unavailable — image rendering needs the file service, which is not connected in this demo build. Only text, JSON and Markdown artifacts can be previewed here.'

export default function Evidence({ project, evidencePath, onEvidenceSelect, onCloseEvidence, onFindingSelect }: Props) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<EvidenceType | 'All'>('All')
  const [findingFilter, setFindingFilter] = useState<string>('All')
  const [drawer, setDrawer] = useState<EvidenceItem | null>(null)

  const showFixtures = project.id === '1' && project.status !== 'planning' && project.findings > 0
  const evidence = showFixtures ? EVIDENCE_FIXTURES : []

  useEffect(() => {
    if (!evidencePath || !showFixtures) {
      setDrawer(null)
      return
    }
    setDrawer(EVIDENCE_FIXTURES.find(item => item.id === evidencePath) ?? null)
  }, [evidencePath, showFixtures])

  const deepLinkMissing = !!evidencePath && (!showFixtures || !EVIDENCE_FIXTURES.some(item => item.id === evidencePath))

  const openEvidence = (item: EvidenceItem) => {
    setDrawer(item)
    onEvidenceSelect?.(item.id)
  }

  const closeEvidence = () => {
    setDrawer(null)
    onCloseEvidence?.()
  }

  const filtered = evidence.filter(e => {
    if (typeFilter !== 'All' && e.type !== typeFilter) return false
    if (findingFilter !== 'All' && !e.findingIds.includes(findingFilter)) return false
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) && !e.sourceAgent.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F8FAFC' }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold" style={{ color: '#0F172A' }}>Evidence</h1>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: '#DC2626' }}
          >
            {evidence.length}
          </span>
          {showFixtures && <MockSourceChip source="evidence + findings fixtures" />}
        </div>
        {showFixtures && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search evidence…"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg outline-none w-44"
                style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A' }}
              />
            </div>
            <select
              value={findingFilter}
              onChange={e => setFindingFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg outline-none max-w-[220px]"
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                color: findingFilter === 'All' ? '#475569' : '#0F172A',
              }}
            >
              <option value="All">All Findings</option>
              {FINDINGS_FIXTURES.map(f => (
                <option key={f.id} value={f.id}>{f.id} — {f.title}</option>
              ))}
            </select>
            <CapabilityButton
              title={ADD_EVIDENCE_REASON}
              label="Add Evidence unavailable in demo build"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 8, fontSize: 12, fontWeight: 600,
                backgroundColor: '#DC2626', color: '#fff',
              }}
            >
              <PlusIcon size={12} /> Add Evidence
            </CapabilityButton>
          </div>
        )}
      </div>

      {deepLinkMissing && (
        <div
          role="status"
          className="px-6 py-2 text-xs border-b"
          style={{ backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' }}
        >
          Deep-linked evidence “{evidencePath}” was not found in this project&apos;s data.
        </div>
      )}

      {!showFixtures ? (
        <EvidenceEmptyState project={project} />
      ) : (
        <>
          {/* Type filter pills */}
          <div
            className="flex items-center gap-2 px-6 py-3 border-b overflow-x-auto scrollbar-none"
            style={{ borderColor: '#F1F5F9', backgroundColor: '#FFFFFF' }}
          >
            {TYPE_FILTERS.map(f => {
              const count = f === 'All'
                ? evidence.length
                : evidence.filter(e => e.type === f).length
              const tc = f !== 'All' ? typeConfig[f as EvidenceType] : null
              const active = typeFilter === f
              return (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0"
                  style={active
                    ? { backgroundColor: tc?.bg ?? 'rgba(255,255,255,0.08)', color: tc?.color ?? '#0F172A', border: '1px solid transparent' }
                    : { backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }
                  }
                >
                  {tc && <tc.Icon size={11} />}
                  {f === 'All' ? 'All Types' : tc!.label}
                  <span
                    className="text-[10px] font-bold px-1 py-0 rounded-full"
                    style={{
                      backgroundColor: active ? 'rgba(0,0,0,0.2)' : '#F1F5F9',
                      color: active ? (tc?.color ?? '#0F172A') : '#94A3B8',
                    }}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-auto p-6">
            {filtered.length === 0 && (
              <div className="flex items-center justify-center h-40">
                <span className="text-sm" style={{ color: '#94A3B8' }}>No evidence matches your filters</span>
              </div>
            )}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {filtered.map(ev => (
                <EvidenceCard key={ev.id} item={ev} onClick={() => openEvidence(ev)} />
              ))}
            </div>
          </div>
        </>
      )}

      {drawer && (
        <EvidenceDrawer item={drawer} onClose={closeEvidence} onFindingSelect={onFindingSelect} />
      )}
    </div>
  )
}

function EvidenceEmptyState({ project }: { project: Project }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div
        className="rounded-xl w-full"
        style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', padding: '26px 30px', maxWidth: 640 }}
      >
        <div className="flex items-center gap-2.5 mb-3 flex-wrap">
          <DatabaseIcon size={18} style={{ color: '#94A3B8' }} />
          <span className="text-sm font-bold" style={{ color: '#0F172A' }}>No evidence collected yet</span>
          <span style={MOCK_CHIP}>DEMO BUILD</span>
        </div>
        <p className="text-xs leading-relaxed mb-2" style={{ color: '#475569' }}>
          This project is in “{project.status}” status with no collected artifacts. Evidence items appear
          here as agent runs collect screenshots, logs and tool output — no sample data is shown in place
          of real collected artifacts.
        </p>
        <p className="text-xs leading-relaxed mb-3" style={{ color: '#475569' }}>
          Preview capability in this build: text, JSON and Markdown artifacts only. Binary previews
          (screenshots) and artifact upload/export need the file service, which is not connected.
        </p>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>
          Where to go next
        </div>
        <ul className="text-xs leading-relaxed list-disc pl-4 space-y-1" style={{ color: '#475569' }}>
          <li>Start or review agent activity under <strong>Runs</strong> or the <strong>Console</strong>.</li>
          <li>To preview this screen with sample artifacts, open a project with recorded findings — those are clearly marked mock fixtures.</li>
        </ul>
      </div>
    </div>
  )
}

function EvidenceCard({ item, onClick }: { item: EvidenceItem; onClick: () => void }) {
  const tc = typeConfig[item.type]
  const TypeIcon = tc.Icon
  const linked = linkedFindingsFor(item)

  return (
    <button
      onClick={onClick}
      className="flex flex-col text-left rounded-xl overflow-hidden transition-all"
      style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = '#374151'
        el.style.backgroundColor = '#F1F5F9'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = '#E2E8F0'
        el.style.backgroundColor = '#FFFFFF'
      }}
    >
      {/* Preview area */}
      {item.type === 'screenshot' ? (
        <div
          className="flex flex-col items-center justify-center h-36 w-full"
          style={{ backgroundColor: '#0F1520', borderBottom: '1px solid #1E2736' }}
        >
          <CameraIcon size={28} style={{ color: '#374151' }} />
          <span className="text-[10px] mt-2 font-medium" style={{ color: '#94A3B8' }}>
            Binary preview unavailable
          </span>
          <span className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>
            no file service in demo build
          </span>
        </div>
      ) : (
        <div
          className="h-36 w-full overflow-hidden p-3 flex flex-col justify-start"
          style={{ backgroundColor: '#0B1120', borderBottom: '1px solid #1E2736' }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#DC2626', opacity: 0.7 }} />
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B', opacity: 0.7 }} />
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#22C55E', opacity: 0.7 }} />
            <span className="ml-auto text-[9px] font-mono uppercase" style={{ color: '#64748B' }}>text preview</span>
          </div>
          {item.preview.map((line, i) => (
            <div
              key={i}
              className="font-mono text-[10px] leading-relaxed truncate"
              style={{ color: i === 0 ? '#16A34A' : '#9CA3AF' }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Card body */}
      <div className="p-3 flex-1">
        <div className="flex items-center justify-between mb-2">
          <span
            className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: tc.bg, color: tc.color }}
          >
            <TypeIcon size={9} />
            {tc.label}
          </span>
          <span className="text-[10px] font-mono" style={{ color: '#94A3B8' }}>{item.size}</span>
        </div>

        <div className="text-xs font-semibold mb-1.5 leading-snug" style={{ color: '#0F172A' }}>
          {item.title}
        </div>

        <div className="text-[10px] mb-2">
          <span style={{ color: '#94A3B8' }}>via </span>
          <span className="font-mono" style={{ color: '#475569' }}>{item.sourceAgent}</span>
        </div>

        {linked.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {linked.map(f => (
              <span
                key={f.id}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full truncate max-w-[140px]"
                style={{
                  backgroundColor: `${sevColors[f.severity]}22`,
                  color: sevColors[f.severity],
                  border: `1px solid ${sevColors[f.severity]}40`,
                }}
                title={f.title}
              >
                {f.title.length > 22 ? f.title.slice(0, 22) + '…' : f.title}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono" style={{ color: '#94A3B8' }}>{item.id}</span>
          <span className="text-[10px]" style={{ color: '#94A3B8' }}>· {item.timestamp}</span>
        </div>
      </div>
    </button>
  )
}

function EvidenceDrawer({
  item, onClose, onFindingSelect,
}: {
  item: EvidenceItem
  onClose: () => void
  onFindingSelect?: (id: string) => void
}) {
  const tc = typeConfig[item.type]
  const TypeIcon = tc.Icon
  const linked = linkedFindingsFor(item)

  return (
    <Dialog
      onClose={onClose}
      labelId="evidence-drawer-title"
      panelClassName="w-full rounded-xl overflow-hidden flex flex-col"
      panelStyle={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #E2E8F0',
        width: 'min(480px, calc(100vw - 2rem))',
      }}
    >
        {/* Header */}
        <div className="px-5 py-4 border-b" style={{ borderColor: '#E2E8F0' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: tc.bg, color: tc.color }}
                >
                  <TypeIcon size={10} />
                  {tc.label}
                </span>
                <span className="font-mono text-[10px]" style={{ color: '#94A3B8' }}>{item.id}</span>
                <span className="font-mono text-[10px]" style={{ color: '#94A3B8' }}>{item.size}</span>
              </div>
              <h3 id="evidence-drawer-title" className="text-sm font-bold" style={{ color: '#0F172A' }}>{item.title}</h3>
              <div className="text-[11px] mt-1">
                <span style={{ color: '#94A3B8' }}>via </span>
                <span className="font-mono" style={{ color: '#475569' }}>{item.sourceAgent}</span>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close evidence details" className="p-1 rounded" style={{ color: '#94A3B8' }}>
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* Preview */}
          {item.type === 'screenshot' ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Preview
              </div>
              <div
                className="rounded-lg flex flex-col items-center justify-center p-4"
                style={{ backgroundColor: '#F8FAFC', border: '1px dashed #CBD5E1' }}
              >
                <CameraIcon size={28} style={{ color: '#94A3B8' }} />
                <span className="text-xs mt-2 font-semibold text-center" style={{ color: '#475569' }}>
                  Binary preview unavailable
                </span>
                <span className="text-[10px] mt-1 text-center leading-relaxed" style={{ color: '#94A3B8' }}>
                  {BINARY_PREVIEW_REASON}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Text Preview
              </div>
              <div className="rounded-lg p-4" style={{ backgroundColor: '#0B1120', border: '1px solid #1E2736' }}>
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#DC2626', opacity: 0.7 }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#F59E0B', opacity: 0.7 }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22C55E', opacity: 0.7 }} />
                  <span className="ml-2 text-[10px] font-mono" style={{ color: '#9CA3AF' }}>{item.sourceAgent}</span>
                </div>
                <div className="font-mono text-[11px] space-y-1 leading-relaxed">
                  {item.preview.map((line, i) => (
                    <div key={i} style={{ color: i === 0 ? '#22C55E' : '#9CA3AF' }}>{line}</div>
                  ))}
                  <div style={{ color: '#4B5563' }}>… preview truncated — full artifact retrieval needs the file service (not connected in this demo build)</div>
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Description
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{item.description}</p>
          </div>

          {/* Details */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Details
            </div>
            <div className="space-y-2">
              <DrawerRow label="Type" value={tc.label} />
              <DrawerRow label="Source Agent" value={item.sourceAgent} mono />
              <DrawerRow label="File Size" value={item.size} />
              <DrawerRow label="Collected" value={item.timestamp} />
            </div>
          </div>

          {/* Tags */}
          {item.tags.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
                  >
                    <TagIcon size={9} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Linked findings */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: '#94A3B8' }}>
              Linked Findings
              <span
                className="text-[10px] font-bold px-1.5 py-0 rounded-full"
                style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: '#DC2626' }}
              >
                {linked.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {linked.map(f => {
                const content = (
                  <>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: sevColors[f.severity] || '#94A3B8' }}
                    />
                    <span className="text-[11px] flex-1" style={{ color: '#0F172A' }}>{f.title}</span>
                    <span className="text-[10px] font-mono" style={{ color: '#94A3B8' }}>#{f.id}</span>
                  </>
                )
                const rowStyle = { backgroundColor: '#F1F5F9', border: '1px solid #F1F5F9' }
                return onFindingSelect ? (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onFindingSelect(f.id)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg w-full text-left transition-colors"
                    style={rowStyle}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#E2E8F0' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F1F5F9' }}
                    title={`Open finding ${f.id}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={f.id} className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={rowStyle}>
                    {content}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex gap-2" style={{ borderColor: '#E2E8F0' }}>
          <CapabilityButton
            title={LINK_REASON}
            label="Link to Finding unavailable in demo build"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              backgroundColor: '#DC2626', color: '#fff',
            }}
          >
            Link to Finding
          </CapabilityButton>
          <CapabilityButton
            title={EXPORT_REASON}
            label="Export unavailable in demo build"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569',
            }}
          >
            <DownloadIcon size={13} /> Export
          </CapabilityButton>
        </div>
    </Dialog>
  )
}

function DrawerRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: '#94A3B8' }}>{label}</span>
      <span
        className={`text-[11px] font-medium ${mono ? 'font-mono text-[10px]' : ''}`}
        style={{ color: '#475569' }}
      >
        {value}
      </span>
    </div>
  )
}
