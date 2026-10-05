/**
 * W14 real Operations Log: the source screen's visual language (counter header,
 * filter selects, table, detail modal) bound to the merged server timeline.
 * Filters derive from the actual payload; there is no "Live" indicator and no
 * synthetic streaming — the log only shows entries the server returned, with a
 * truthful bounded/trace-completeness note.
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel, TimelineEntryView } from '@raptix/web-contracts'
import { useRealLogs } from './use-real-logs'
import { entryProvenance, filterOptions, filterTimeline, formatEntryTime, SOURCE_LABELS, timelineSummary, type SourceFilter, type TimelineFilters } from './logs-view'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const SELECT: CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 12, color: C.ink, background: C.card, outline: 'none' }
const SOURCE_BADGE: Record<TimelineEntryView['source'], CSSProperties> = {
  runtime: { background: '#DBEAFE', color: '#1D4ED8' },
  checkpoint: { background: '#FEF3C7', color: '#92400E' },
  workspace: { background: '#DCFCE7', color: '#15803D' },
}

export default function RealLogs({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const state = useRealLogs(project)
  const [filters, setFilters] = useState<TimelineFilters>({ source: 'all', agent: 'all', tool: 'all', status: 'all', search: '' })
  const [selected, setSelected] = useState<TimelineEntryView | null>(null)

  const view = state.timeline
  const filtered = useMemo(() => (view ? filterTimeline(view, filters) : []), [view, filters])
  const agentOptions = useMemo(() => (view ? filterOptions(view, entry => entry.agent) : ['all']), [view])
  const toolOptions = useMemo(() => (view ? filterOptions(view, entry => entry.tool) : ['all']), [view])
  const statusOptions = useMemo(() => (view ? filterOptions(view, entry => entry.status) : ['all']), [view])

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Operations Log</h1>
          {view && <span style={{ fontSize: 11, color: C.muted }}>{timelineSummary(view)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} placeholder="Search entries…"
            style={{ ...SELECT, width: 200 }} />
          <button onClick={state.refresh} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: C.body, background: C.card, cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Filter by source" value={filters.source} onChange={event => setFilters(current => ({ ...current, source: event.target.value as SourceFilter }))} style={SELECT}>
          <option value="all">All sources</option>
          <option value="runtime">Run</option>
          <option value="checkpoint">Checkpoint</option>
          <option value="workspace">Workspace</option>
        </select>
        <select aria-label="Filter by agent" value={filters.agent} onChange={event => setFilters(current => ({ ...current, agent: event.target.value }))} style={SELECT}>
          {agentOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'All agents' : option}</option>)}
        </select>
        <select aria-label="Filter by tool" value={filters.tool} onChange={event => setFilters(current => ({ ...current, tool: event.target.value }))} style={SELECT}>
          {toolOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'All tools' : option}</option>)}
        </select>
        <select aria-label="Filter by status" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} style={SELECT}>
          {statusOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'All statuses' : option}</option>)}
        </select>
      </div>

      {state.loading && <div style={CARD}><div style={{ padding: 20, ...PARA, color: C.muted }}>Loading merged operations timeline…</div></div>}
      {state.error && !state.loading && <div role="alert" style={{ ...CARD, padding: 16, fontSize: 12, color: C.red }}>{state.error}</div>}
      {view && view.truncated && (
        <div role="status" style={{ ...CARD, padding: '10px 16px', ...PARA, fontSize: 11, color: '#92400E', background: '#FFFBEB' }}>
          The server bounded this history — the newest {view.entries.length} entries are shown and older entries are hidden. Trace completeness is limited, not lost silently.
        </div>
      )}
      {view && filtered.length === 0 && (
        <div style={CARD}><div style={{ padding: 20, ...PARA, color: C.muted }}>No log entries match. An empty log is a truthful state — no activity has been recorded for this engagement yet.</div></div>
      )}

      {view && filtered.length > 0 && (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}>
                  {['Time', 'Source', 'Event', 'Agent', 'Tool', 'Run', 'Status'].map(head => (
                    <th key={head} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{head.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, index) => (
                  <tr key={entry.id} onClick={() => setSelected(entry)} style={{ borderBottom: index < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: '#FFFFFF', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO, whiteSpace: 'nowrap' }}>{formatEntryTime(entry.at)}</td>
                    <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 7px', ...SOURCE_BADGE[entry.source] }}>{SOURCE_LABELS[entry.source]}</span></td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink }}>{entry.label}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{entry.agent ?? '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{entry.tool ?? '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{entry.runId ?? '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{entry.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <EntryModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function EntryModal({ entry, onClose }: { entry: TimelineEntryView; onClose: () => void }): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ['Time', formatEntryTime(entry.at)],
    ['Source', SOURCE_LABELS[entry.source]],
    ['Kind', entry.kind],
    ...(entry.agent !== undefined ? [['Agent', entry.agent] as [string, string]] : []),
    ...(entry.tool !== undefined ? [['Tool', entry.tool] as [string, string]] : []),
    ...(entry.runId !== undefined ? [['Run', entry.runId] as [string, string]] : []),
    ...(entry.status !== undefined ? [['Status', entry.status] as [string, string]] : []),
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 520, margin: '0 16px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={event => event.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 7px', ...SOURCE_BADGE[entry.source] }}>{SOURCE_LABELS[entry.source]}</span>
            <h2 style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 700, color: C.ink }}>{entry.label}</h2>
          </div>
          <button onClick={onClose} aria-label="Close log entry detail" style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '14px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F1F5F9', paddingBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, whiteSpace: 'nowrap' }}>{key}</span>
              <span style={{ fontSize: 12, color: C.body, fontFamily: MONO, wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
            </div>
          ))}
          <p style={{ ...PARA, fontSize: 11, color: C.muted }}>{entryProvenance(entry)}</p>
        </div>
      </div>
    </div>
  )
}
