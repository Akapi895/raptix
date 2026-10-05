/**
 * W12 real Findings & Evidence: the source screen's visual language (severity
 * summary bar, findings table, detail modal) bound to the new API only. Every
 * row is a parsed `FIND-*.md` from the owned engagement workspace with explicit
 * parser-quality flags; the artifact browser previews real allowlisted files.
 * Source demo workflow (status/report/assign, Run-PoC timer, Mark Verified,
 * dummy exports) has no real backend and is never rendered.
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useRealFindings } from './use-real-findings'
import {
  SEVERITY_ORDER, findingRows, formatSize, matchesSearch, severityCounts, contentHeader,
  type FindingRow, type Severity,
} from './findings-view'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626' }
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const SEV_STYLE: Record<Severity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: '#DC2626', bg: 'rgba(238,0,51,0.15)' },
  high: { label: 'High', color: '#F97316', bg: 'rgba(249,115,22,0.15)' },
  medium: { label: 'Medium', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  low: { label: 'Low', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  info: { label: 'Info', color: '#94A3B8', bg: 'rgba(107,114,128,0.15)' },
}

function SevBadge({ severity }: { severity: Severity }): React.JSX.Element {
  const style = SEV_STYLE[severity]
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.color }} />
      {style.label}
    </span>
  )
}

export default function RealFindings({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const state = useRealFindings(project)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<Severity | 'All'>('All')
  const [selected, setSelected] = useState<FindingRow['id'] | null>(null)

  const rows = useMemo(() => (state.findings ? findingRows(state.findings) : []), [state.findings])
  const counts = useMemo(() => (state.findings ? severityCounts(state.findings) : { critical: 0, high: 0, medium: 0, low: 0, info: 0 }), [state.findings])
  const filtered = useMemo(() => rows.filter(row => (severityFilter === 'All' || row.severity === severityFilter) && matchesSearch(row, search)), [rows, severityFilter, search])
  const selectedFinding = state.findings?.findings.find(finding => finding.id === selected) ?? null

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: C.page }}>
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#E2E8F0', backgroundColor: C.page }}>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold" style={{ color: C.ink }}>Findings</h1>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: C.red }}>{rows.length}</span>
          {state.findings?.truncated && <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: '#FFFBEB', color: '#D97706' }}>PARTIAL — workspace listing truncated</span>}
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search findings…"
            className="pl-3 pr-3 py-1.5 text-xs rounded-lg outline-none w-44"
            style={{ backgroundColor: C.card, border: '1px solid #E2E8F0', color: C.ink }} />
          <button onClick={state.refresh} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ backgroundColor: C.card, border: '1px solid #E2E8F0', color: C.body }}>↻ Refresh</button>
        </div>
      </div>

      {state.error && <div className="px-6 py-3 text-xs" role="alert" style={{ color: C.red, backgroundColor: '#FEF2F2' }}>{state.error}</div>}

      <div className="flex items-center gap-3 px-6 py-3 border-b" style={{ borderColor: '#F1F5F9', backgroundColor: C.card }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Severity</span>
        <div className="flex items-center gap-1.5 flex-1">
          <div className="flex h-2 rounded-full overflow-hidden flex-1 max-w-xs gap-px">
            {SEVERITY_ORDER.filter(severity => counts[severity] > 0).map(severity => (
              <div key={severity} className="h-full rounded-sm" style={{ backgroundColor: SEV_STYLE[severity].color, flex: counts[severity] }} title={`${SEV_STYLE[severity].label}: ${counts[severity]}`} />
            ))}
          </div>
          <div className="flex items-center gap-3 ml-2">
            {SEVERITY_ORDER.map(severity => (
              <button key={severity} onClick={() => setSeverityFilter(current => current === severity ? 'All' : severity)} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEV_STYLE[severity].color, opacity: counts[severity] === 0 ? 0.3 : 1 }} />
                <span className="text-[11px] font-medium" style={{ color: severityFilter === severity ? SEV_STYLE[severity].color : C.body, opacity: counts[severity] === 0 ? 0.4 : 1 }}>{SEV_STYLE[severity].label}</span>
                <span className="text-[10px] font-bold px-1.5 py-0 rounded-full" style={{ backgroundColor: severityFilter === severity ? SEV_STYLE[severity].bg : 'rgba(75,85,99,0.2)', color: severityFilter === severity ? SEV_STYLE[severity].color : C.muted }}>{counts[severity]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid text-[10px] font-semibold uppercase tracking-wider px-6 py-2.5 sticky top-0" style={{ gridTemplateColumns: '100px 1fr 190px 150px 90px', backgroundColor: C.card, borderBottom: '1px solid #E2E8F0', color: C.muted }}>
        <span>Severity</span><span>Title</span><span>Primary asset</span><span>Parser quality</span><span>Source</span>
      </div>

      <div className="flex-1 overflow-auto">
        {state.loading && <div className="flex items-center justify-center h-32"><span className="text-sm" style={{ color: C.muted }}>Loading findings…</span></div>}
        {!state.loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32"><span className="text-sm" style={{ color: C.muted }}>{state.findings && state.findings.findings.length === 0 && !search && severityFilter === 'All' ? 'No parsed FIND-*.md files in this engagement workspace yet.' : 'No findings match your filters'}</span></div>
        )}
        {filtered.map((row, index) => (
          <button key={row.id} onClick={() => setSelected(row.id)} className="w-full grid px-6 py-3 text-left"
            style={{ gridTemplateColumns: '100px 1fr 190px 150px 90px', backgroundColor: index % 2 === 0 ? C.card : C.page, borderBottom: '1px solid #F1F5F9' }}>
            <div className="flex items-center"><SevBadge severity={row.severity} /></div>
            <div className="flex flex-col justify-center pr-4 min-w-0">
              <span className="text-xs font-semibold truncate" style={{ color: C.ink }}>{row.title}</span>
              <span className="text-[10px] font-mono mt-0.5" style={{ color: '#3B82F6' }}>{row.id}</span>
            </div>
            <div className="flex items-center"><span className="font-mono text-[11px] truncate" style={{ color: C.body }}>{row.assets}</span></div>
            <div className="flex items-center">
              {row.flagged
                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: '#FFFBEB', color: '#D97706' }}>parsed defaults</span>
                : <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#16A34A' }}>parsed from file</span>}
            </div>
            <div className="flex items-center"><span className="text-[11px]" style={{ color: C.muted }}>{formatSize(row.sizeBytes)}</span></div>
          </button>
        ))}
      </div>

      <div className="border-t px-6 py-2.5" style={{ borderColor: '#E2E8F0', backgroundColor: C.card }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider mr-3" style={{ color: C.muted }}>Evidence artifacts</span>
        <span className="text-[11px]" style={{ color: C.body }}>
          {state.artifacts && state.artifacts.folders.length > 0
            ? state.artifacts.folders.map(folder => `${folder.folder} (${folder.files.length})`).join(' • ')
            : 'No allowlisted artifact folders (recon/exploit/post-exploit/findings/report) contain files yet.'}
        </span>
      </div>

      {selectedFinding && <RealFindingModal finding={selectedFinding} state={state} onClose={() => setSelected(null)} />}
    </div>
  )
}

function RealFindingModal({ finding, state, onClose }: { finding: NonNullable<ReturnType<typeof useRealFindings>['findings']>['findings'][number]; state: ReturnType<typeof useRealFindings>; onClose: () => void }): React.JSX.Element {
  const style = SEV_STYLE[finding.severity === 'informational' ? 'info' : finding.severity]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="relative w-full max-w-2xl mx-4 rounded-xl shadow-xl flex flex-col" style={{ backgroundColor: C.card, maxHeight: '90vh' }} onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: '#E2E8F0' }}>
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.color }}>{style.label}</span>
              {finding.cvssScore !== undefined && <span className="text-[11px] font-bold" style={{ color: style.color }}>CVSS {finding.cvssScore}</span>}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: '#F1F5F9', color: C.body }}>{finding.id}</span>
              {(finding.quality.defaultSeverity || finding.quality.placeholderDescription || finding.quality.placeholderEvidence) && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: '#FFFBEB', color: '#D97706' }}>parser defaults — not analyst-confirmed</span>
              )}
            </div>
            <h2 className="text-base font-bold leading-snug" style={{ color: C.ink }}>{finding.title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: C.muted }}>✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <ModalSection label="Description"><p style={PARA}>{finding.description}</p></ModalSection>
          <ModalSection label="Evidence"><p style={PARA}>{finding.evidence}</p></ModalSection>
          <ModalSection label="Attack vector"><p style={PARA}>{finding.attackVector}</p></ModalSection>
          {finding.affectedAssets.length > 0 && (
            <ModalSection label="Affected assets">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {finding.affectedAssets.map(asset => <span key={asset} style={{ ...PARA, fontFamily: MONO, fontSize: 11 }}>{asset}</span>)}
              </div>
            </ModalSection>
          )}
          {(finding.cwe?.length || finding.mitre?.length) ? (
            <ModalSection label="References">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(finding.cwe ?? []).map(cwe => <span key={cwe} className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: '#F1F5F9', color: C.body }}>{cwe}</span>)}
                {(finding.mitre ?? []).map(mitre => <span key={mitre} className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: '#FEF2F2', color: C.red }}>{mitre}</span>)}
              </div>
            </ModalSection>
          ) : null}
          {finding.remediation && <ModalSection label="Remediation"><p style={PARA}>{finding.remediation}</p></ModalSection>}
          <ModalSection label={`Raw source (${formatSize(finding.sizeBytes)})`}>
            <pre style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: C.body, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflowY: 'auto' }}>{finding.rawSource}</pre>
          </ModalSection>
          <ModalSection label="Artifact preview">
            <ArtifactBrowser state={state} />
          </ModalSection>
        </div>
        <div className="flex items-center gap-2 px-6 py-4 border-t" style={{ borderColor: '#E2E8F0' }}>
          <span style={{ fontSize: 11, color: C.muted }}>Review workflows (verified/assign/report export) need persistence services and are not rendered.</span>
          <button onClick={onClose} className="ml-auto px-4 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: '#F1F5F9', color: C.body }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ArtifactBrowser({ state }: { state: ReturnType<typeof useRealFindings> }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {state.artifacts && state.artifacts.folders.map(folder => (
        <div key={folder.folder} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{folder.folder}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {folder.files.map(file => (
              <button key={file.path} onClick={() => state.openArtifact(file.path)}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 6px', borderRadius: 4, background: state.content?.path === file.path ? '#FEF3C7' : 'transparent', border: 'none', cursor: 'pointer' }}>
                <span style={{ fontFamily: MONO, color: C.ink }}>{file.name}</span>
                <span style={{ color: C.muted }}>{formatSize(file.sizeBytes)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {state.contentLoading && <span style={{ fontSize: 11, color: C.muted }}>Loading preview…</span>}
      {state.contentError && <span role="alert" style={{ fontSize: 11, color: C.red }}>{state.contentError}</span>}
      {state.content && (
        <div>
          <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginBottom: 4 }}>{contentHeader(state.content)}</div>
          <pre style={{ margin: 0, fontSize: 10, fontFamily: MONO, background: '#0B0F19', border: '1px solid #1E2736', color: '#9CA3AF', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflowY: 'auto' }}>{state.content.content}</pre>
        </div>
      )}
    </div>
  )
}

const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }

function ModalSection({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.muted }}>{label}</div>
      {children}
    </div>
  )
}
