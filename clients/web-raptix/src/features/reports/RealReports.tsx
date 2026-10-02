/**
 * W14 real Reports: preview built from actual engagement and findings DTOs
 * (no dummy deliverables, authors or page counts) plus the real export
 * attachments. JSON/Markdown are the only offered formats because they are the
 * only formats the server validates; PDF/DOCX/AI-compile are stated as absent,
 * never faked with a success toast.
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useRealFindings } from '../findings-evidence/use-real-findings'
import { artifactPaths, findingRows, SEVERITY_ORDER, severityCounts } from '../findings-evidence/findings-view'
import { exportEngagement, EXPORT_FORMATS, type ExportDownload, type ExportFormat } from './real-reports-api'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626', green: '#15803D' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }

interface ExportState {
  busy: ExportFormat | null
  done: ExportDownload | null
  error: string | null
}

export default function RealReports({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const findingsState = useRealFindings(project)
  const [exportState, setExportState] = useState<ExportState>({ busy: null, done: null, error: null })

  const counts = useMemo(() => (findingsState.findings ? severityCounts(findingsState.findings) : null), [findingsState.findings])
  const rows = useMemo(() => (findingsState.findings ? findingRows(findingsState.findings) : []), [findingsState.findings])
  const artifacts = useMemo(() => (findingsState.artifacts ? artifactPaths(findingsState.artifacts) : []), [findingsState.artifacts])
  const totalFindings = counts ? SEVERITY_ORDER.reduce((sum, severity) => sum + counts[severity], 0) : 0

  async function runExport(format: ExportFormat): Promise<void> {
    setExportState({ busy: format, done: null, error: null })
    try {
      const download = await exportEngagement(project.id, format, new AbortController().signal)
      setExportState({ busy: null, done: download, error: null })
    } catch (cause) {
      setExportState({ busy: null, done: null, error: cause instanceof Error ? cause.message : 'Export failed' })
    }
  }

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Reports</h1>
          <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>Preview from the live engagement, planning and findings data of this project — not a rendered deliverable.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {EXPORT_FORMATS.map(format => (
            <button key={format} disabled={exportState.busy !== null} onClick={() => { void runExport(format) }}
              style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, color: format === 'json' ? C.ink : C.body, background: C.card, cursor: exportState.busy ? 'wait' : 'pointer' }}>
              {exportState.busy === format ? 'Exporting…' : format === 'json' ? 'Export JSON' : 'Export Markdown'}
            </button>
          ))}
        </div>
      </div>

      {exportState.done && (
        <div role="status" style={{ ...CARD, padding: '12px 16px', ...PARA, fontSize: 12, color: C.green, background: '#F0FDF4' }}>
          Download ready: <span style={{ fontFamily: MONO }}>{exportState.done.filename}</span> ({exportState.done.body.length.toLocaleString()} bytes{exportState.done.contentType ? `, ${exportState.done.contentType}` : ''}). The file contains this engagement's actual plan documents and findings.
        </div>
      )}
      {exportState.error && (
        <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{exportState.error}</div>
      )}

      <div style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={LABEL}>Engagement</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: MONO }}>{project.displayName}</div>
          <div style={{ ...PARA, fontSize: 11, color: C.muted, fontFamily: MONO }}>{project.id}</div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={LABEL}>Findings (parsed workspace)</div>
            {findingsState.loading && <div style={PARA}>Loading findings…</div>}
            {!findingsState.loading && totalFindings === 0 && <div style={PARA}>No parsed findings yet.</div>}
            {counts && totalFindings > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {SEVERITY_ORDER.map(severity => (
                  <span key={severity} style={{ fontSize: 12, color: C.body }}>
                    <b style={{ color: C.ink }}>{counts[severity]}</b> {severity}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={LABEL}>Workspace artifacts</div>
            <div style={PARA}>{artifacts.length} file{artifacts.length === 1 ? '' : 's'} across allowlisted folders.</div>
          </div>
        </div>
        {findingsState.error && <div style={{ fontSize: 12, color: C.red }}>{findingsState.error}</div>}
      </div>

      {rows.length > 0 && (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}>
                  {['ID', 'Title', 'Severity', 'CVSS'].map(head => (
                    <th key={head} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em' }}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} style={{ borderBottom: index < rows.length - 1 ? '1px solid #F1F5F9' : 'none', background: '#FFFFFF' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{row.id}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink }}>{row.title}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{row.severity}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{row.cvss ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ ...CARD, padding: '12px 16px' }}>
        <p style={{ ...PARA, fontSize: 11, color: C.muted }}>
          JSON and Markdown exports are validated server-side; any other format is rejected with an explicit error instead of silently falling back. PDF/DOCX rendering, AI compilation, signing and custom templates need generation, job and storage APIs that this build does not have — no button here pretends otherwise.
        </p>
      </div>
    </div>
  )
}
