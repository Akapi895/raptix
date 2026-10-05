/**
 * W13 real Infrastructure & Data: the source screen's visual language (metric
 * counters, filter tabs, table, inspect modal) bound to the scoped public graph
 * projection. Node detail shows only server-redacted properties with source
 * provenance; compromised/objective decorations and pivot claims are never
 * fabricated — actual relations stay actual relations.
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GraphNodeView, ProjectViewModel } from '@raptix/web-contracts'
import { useRealGraph } from './use-real-graph'
import { graphSummary, nodeDisplayLabel } from './graph-view'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }

export default function RealInfrastructure({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const state = useRealGraph(project)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => (state.graph ? state.graph.nodes : []), [state.graph])
  const filtered = useMemo(() => rows.filter(node => !search || nodeDisplayLabel(node).toLowerCase().includes(search.toLowerCase()) || node.labels.join(' ').toLowerCase().includes(search.toLowerCase())), [rows, search])
  const selectedNode: GraphNodeView | null = rows.find(node => node.id === selected) ?? null

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Infrastructure & Data</h1>
          {state.graph && <span style={{ fontSize: 11, color: C.muted }}>{graphSummary(state.graph)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search nodes…"
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, color: C.ink, outline: 'none', width: 200 }} />
          <button onClick={state.refresh} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: C.body, background: C.card, cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {state.loading && <div style={CARD}><div style={{ padding: 20, ...PARA, color: C.muted }}>Loading scoped graph…</div></div>}
      {state.unavailable && <div role="alert" style={{ ...CARD, padding: 16, ...PARA, color: '#B91C1C' }}>Knowledge graph unavailable (503). The graph store did not answer — this is not an empty graph.</div>}
      {!state.loading && !state.unavailable && state.graph && state.graph.nodes.length === 0 && (
        <div style={CARD}><div style={{ padding: 20, ...PARA, color: C.muted }}>No scoped nodes carry this engagement yet. An empty graph is a truthful state, not an outage.</div></div>
      )}
      {state.error && !state.unavailable && <div role="alert" style={{ ...CARD, padding: 16, fontSize: 12, color: C.red }}>{state.error}</div>}

      {state.graph && state.graph.nodes.length > 0 && (
        <>
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}>
                    {['Label', 'Type', 'IP / Address', 'OS', 'Public properties'].map(head => (
                      <th key={head} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{head.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((node, index) => (
                    <tr key={node.id} onClick={() => setSelected(node.id)} style={{ borderBottom: index < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: '#FFFFFF', cursor: 'pointer' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: MONO, whiteSpace: 'nowrap' }}>{nodeDisplayLabel(node)}</td>
                      <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{node.labels.join(', ') || '—'}</span></td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{typeof node.properties.ip === 'string' ? node.properties.ip : typeof node.properties.url === 'string' ? node.properties.url : '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{typeof node.properties.os === 'string' ? node.properties.os : '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted }}>{Object.keys(node.properties).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ ...CARD, padding: '12px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Relations</div>
            <div style={{ ...PARA, fontSize: 11, fontFamily: MONO }}>
              {state.graph.edges.length === 0
                ? 'No edges between scoped nodes yet.'
                : state.graph.edges.slice(0, 12).map(edge => `${labelOf(state.graph!, edge.source)} —[${edge.type}]→ ${labelOf(state.graph!, edge.target)}`).join(' • ')}
              {state.graph.edges.length > 12 ? ` • +${state.graph.edges.length - 12} more` : ''}
            </div>
          </div>
        </>
      )}

      {selectedNode && (
        <NodeModal node={selectedNode} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function labelOf(view: NonNullable<ReturnType<typeof useRealGraph>['graph']>, id: string): string {
  const node = view.nodes.find(candidate => candidate.id === id)
  return node ? nodeDisplayLabel(node) : id.slice(-8)
}

function NodeModal({ node, onClose }: { node: GraphNodeView; onClose: () => void }): React.JSX.Element {
  const entries = Object.entries(node.properties)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 560, margin: '0 16px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={event => event.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{node.labels.join(', ') || 'NODE'}</span>
            <h2 style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: MONO }}>{nodeDisplayLabel(node)}</h2>
          </div>
          <button onClick={onClose} aria-label="Close node detail" style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '14px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Public properties (server-redacted)</div>
          {entries.length === 0 && <p style={PARA}>No public properties survive projection.</p>}
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F1F5F9', paddingBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, whiteSpace: 'nowrap' }}>{key}</span>
              <span style={{ fontSize: 12, color: value === '[REDACTED]' ? '#B91C1C' : C.body, fontFamily: MONO, wordBreak: 'break-all', textAlign: 'right' }}>{String(value)}</span>
            </div>
          ))}
          <p style={{ ...PARA, fontSize: 11, color: C.muted }}>Credential-like fields are removed server-side before this response. The browser never relays raw graph properties.</p>
        </div>
      </div>
    </div>
  )
}

const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, color: undefined }
