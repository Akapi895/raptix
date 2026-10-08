/**
 * W13 real Assets & Inventory: source-screen visual language (metric counters,
 * filter tabs, search, table, inspect modal) with counters derived from the
 * same public projection — never source constants (134/47/68). Tag/Update
 * Scope/Export CSV and the multi-select dock are separate mutations without a
 * backend and are not rendered.
 */
import { useMemo, useState } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useRealGraph } from './use-real-graph'
import { ASSET_FILTERS, assetCounters, assetsSummary, filterAssets, type AssetFilter } from './graph-view'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626' }
const MONO = "'JetBrains Mono', monospace"

export default function RealAssets({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const state = useRealGraph(project)
  const [filter, setFilter] = useState<AssetFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const assets = useMemo(() => (state.assets ? state.assets.assets : []), [state.assets])
  const counters = useMemo(() => assetCounters(assets), [assets])
  const filtered = useMemo(() => filterAssets(assets, filter, search), [assets, filter, search])
  const selectedAsset = assets.find(asset => asset.id === selected) ?? null

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Assets & Inventory</h1>
          {state.assets && <span style={{ fontSize: 11, color: C.muted }}>{assetsSummary(state.assets)}</span>}
        </div>
        <button onClick={state.refresh} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: C.body, background: C.card, cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Assets', value: counters.total },
          { label: 'Hosts', value: counters.hosts },
          { label: 'Web Endpoints', value: counters.web },
          { label: 'Identities', value: counters.identities },
          { label: 'Mobile APKs', value: counters.mobile },
        ].map(metric => (
          <div key={metric.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 20px', minWidth: 110 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>{metric.value}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{metric.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 7, padding: 3 }}>
          {ASSET_FILTERS.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: filter === tab.key ? 700 : 500,
              background: filter === tab.key ? C.card : 'transparent',
              color: filter === tab.key ? C.ink : '#64748B',
              border: filter === tab.key ? `1px solid ${C.border}` : '1px solid transparent',
              borderRadius: 5, cursor: 'pointer',
            }}>{tab.label}</button>
          ))}
        </div>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search assets…"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 13, color: C.ink, outline: 'none', width: 210 }} />
      </div>

      {state.loading && <div style={{ ...CARD, padding: 20, fontSize: 12, color: C.muted }}>Loading scoped inventory…</div>}
      {state.unavailable && <div role="alert" style={{ ...CARD, padding: 16, fontSize: 12, color: '#B91C1C' }}>Knowledge graph unavailable (503). Asset counts stay empty — they are never faked to zero from an outage.</div>}
      {state.error && !state.unavailable && <div role="alert" style={{ ...CARD, padding: 16, fontSize: 12, color: C.red }}>{state.error}</div>}
      {!state.loading && !state.unavailable && assets.length === 0 && (
        <div style={{ ...CARD, padding: 20, fontSize: 12, color: C.muted }}>No scoped assets derived from the engagement graph yet.</div>
      )}

      {filtered.length > 0 && (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}>
                  {['Asset Name', 'Type', 'IP / Address', 'Open Ports', 'Findings', 'Actions'].map(head => (
                    <th key={head} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{head.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset, index) => (
                  <tr key={asset.id} style={{ borderBottom: index < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: C.card }}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: MONO, whiteSpace: 'nowrap' }}>{asset.label}</td>
                    <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{asset.type}</span></td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO }}>{asset.ip ?? asset.hostname ?? asset.url ?? '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body, fontFamily: MONO, whiteSpace: 'nowrap' }}>{asset.ports.length ? asset.ports.join(', ') : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{asset.relatedFindingIds.length ? `${asset.relatedFindingIds.length} linked` : '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => setSelected(asset.id)} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: C.body, background: C.card, cursor: 'pointer' }}>Inspect</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedAsset && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={() => setSelected(null)}>
          <div style={{ background: C.card, borderRadius: 12, width: '100%', maxWidth: 520, margin: '0 16px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={event => event.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{selectedAsset.type}</span>
                <h2 style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 700, color: C.ink, fontFamily: MONO }}>{selectedAsset.label}</h2>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close asset detail" style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            <div style={{ padding: '14px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: C.body }}>
              {(['hostname', 'ip', 'url', 'os'] as const).map(key => selectedAsset[key] !== undefined ? (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F1F5F9', paddingBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.muted, textTransform: 'capitalize' }}>{key}</span>
                  <span style={{ fontFamily: MONO, wordBreak: 'break-all', textAlign: 'right' }}>{selectedAsset[key]}</span>
                </div>
              ) : null)}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F1F5F9', paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.muted }}>Open ports</span>
                <span style={{ fontFamily: MONO }}>{selectedAsset.ports.length ? selectedAsset.ports.join(', ') : 'none recorded'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F1F5F9', paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: C.muted }}>Related findings</span>
                <span style={{ fontFamily: MONO, wordBreak: 'break-all', textAlign: 'right' }}>{selectedAsset.relatedFindingIds.length ? selectedAsset.relatedFindingIds.join(', ') : 'none linked in graph'}</span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Derived from the engagement-scoped graph with server-side redaction. Compromise or pivot claims are never fabricated from presence alone.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CARD = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10 }
