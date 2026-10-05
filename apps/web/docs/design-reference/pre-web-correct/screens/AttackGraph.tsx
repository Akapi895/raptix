import { useState } from 'react'
import type { Project } from '../types'
import {
  ATTACK_GRAPH_EDGES,
  ATTACK_GRAPH_NODES,
  ATTACK_GRAPH_SOURCE_NOTE,
  ATTACK_GRAPH_ZONES,
  GRAPH_FIXTURE_PROJECT_ID,
} from '../mocks/fixtures/graphs'
import type {
  AttackGraphEdge,
  AttackGraphNode as GraphNode,
} from '../mocks/fixtures/graphs'
import {
  SearchIcon,
  FilterIcon,
  MaximizeIcon,
  TerminalIcon,
  ZapIcon,
  XIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type NodeState = GraphNode['state']
type NodeType = GraphNode['type']
type TypeFilter = 'all' | NodeType
type StateFilter = 'all' | NodeState

const NODES = ATTACK_GRAPH_NODES
const EDGES: AttackGraphEdge[] = ATTACK_GRAPH_EDGES
const ZONES = ATTACK_GRAPH_ZONES

const STATE_COLORS: Record<NodeState, { bg: string; border: string; text: string }> = {
  unknown: { bg: '#FFFFFF', border: '#E2E8F0', text: '#94A3B8' },
  discovered: { bg: '#DBEAFE', border: '#2563EB', text: '#2563EB' },
  compromised: { bg: '#DCFCE7', border: '#16A34A', text: '#16A34A' },
  objective: { bg: '#FEF2F2', border: '#DC2626', text: '#DC2626' },
}

const EDGE_STYLE: Record<AttackGraphEdge['edgeState'], { stroke: string; dash?: string }> = {
  active: { stroke: '#22C55E' },
  discovered: { stroke: '#3B82F6', dash: '6 3' },
  targeting: { stroke: '#DC2626', dash: '4 2' },
  unknown: { stroke: '#E2E8F0', dash: '3 3' },
}

const TYPE_ABBREV: Record<NodeType, string> = { host: 'H', user: 'U', service: 'S', domain: 'D' }
const NODE_R = 22
const OBJ_R = 26

function calcEdge(x1: number, y1: number, x2: number, y2: number, r1 = NODE_R, r2 = NODE_R) {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return { x1, y1, x2, y2 }
  const nx = dx / dist
  const ny = dy / dist
  return {
    x1: x1 + nx * (r1 + 3),
    y1: y1 + ny * (r1 + 3),
    x2: x2 - nx * (r2 + 10),
    y2: y2 - ny * (r2 + 10),
  }
}

const TYPE_FILTERS: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Hosts', value: 'host' },
  { label: 'Users', value: 'user' },
  { label: 'Services', value: 'service' },
  { label: 'Domains', value: 'domain' },
]

const STATE_FILTERS: { label: string; value: StateFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Compromised', value: 'compromised' },
  { label: 'Discovered', value: 'discovered' },
  { label: 'Unknown', value: 'unknown' },
]

const LEGEND_ITEMS = [
  { label: 'Unknown', color: '#CBD5E1' },
  { label: 'Discovered', color: '#3B82F6' },
  { label: 'Compromised', color: '#22C55E' },
  { label: 'Objective', color: '#DC2626' },
]

/** Parse naive ANSI-like escape sequences to colored spans */
function renderTermLine(line: string): React.ReactNode {
  const segments: { text: string; color: string }[] = []
  const raw = line
    /* eslint-disable no-control-regex -- parsing ANSI-like escape sequences */
    .replace(/\x1b\[32m/g, '\0green\0')
    .replace(/\x1b\[33m/g, '\0yellow\0')
    .replace(/\x1b\[31m/g, '\0red\0')
    .replace(/\x1b\[0m/g, '\0reset\0')
    /* eslint-enable no-control-regex */
  const parts = raw.split('\0')
  let color = '#0F172A'
  for (const p of parts) {
    if (p === 'green') { color = '#22C55E'; continue }
    if (p === 'yellow') { color = '#F59E0B'; continue }
    if (p === 'red') { color = '#DC2626'; continue }
    if (p === 'reset') { color = '#0F172A'; continue }
    if (p) segments.push({ text: p, color })
  }
  if (segments.length === 0) return <span>&nbsp;</span>
  return <>{segments.map((s, i) => <span key={i} style={{ color: s.color }}>{s.text}</span>)}</>
}

export default function AttackGraph({ project }: Props) {
  if (project.id !== GRAPH_FIXTURE_PROJECT_ID) {
    return <EmptyGraphState projectName={project.name} note={ATTACK_GRAPH_SOURCE_NOTE} />
  }
  return <AttackGraphCanvas />
}

function AttackGraphCanvas() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [activeTab, setActiveTab] = useState(0)

  const handleNodeClick = (node: GraphNode) => {
    if (!visibleIds.has(node.id)) return
    setSelectedNode(prev => prev?.id === node.id ? null : node)
    setActiveTab(0)
  }

  const visibleIds = new Set(
    NODES.filter(n => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      if (stateFilter !== 'all' && n.state !== stateFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!n.label.toLowerCase().includes(q) && !(n.ip ?? '').includes(q)) return false
      }
      return true
    }).map(n => n.id),
  )

  const SVG_W = 976
  const SVG_H = 500

  return (
    <div className="flex h-full overflow-hidden" style={{ background: '#F8FAFC', color: '#0F172A' }}>
      {/* Graph column */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Top controls ── */}
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 flex-shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid #E2E8F0', background: '#FFFFFF' }}
        >
          {/* Source of the graph data — explicit mock labeling (P7.5) */}
          <span
            role="note"
            title={ATTACK_GRAPH_SOURCE_NOTE}
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
          >
            MOCK · sample attack graph
          </span>

          {/* Search */}
          <div className="relative">
            <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search nodes…"
              className="pl-8 pr-3 py-1.5 text-[11px] rounded-lg outline-none w-40 placeholder:text-[#94A3B8]"
              style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F172A' }}
            />
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: '#E2E8F0' }} />

          {/* Type filters */}
          <div className="flex items-center gap-1">
            <FilterIcon size={11} style={{ color: '#94A3B8' }} />
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
                style={{
                  background: typeFilter === f.value ? '#DC2626' : '#F1F5F9',
                  color: typeFilter === f.value ? '#fff' : '#475569',
                  border: `1px solid ${typeFilter === f.value ? '#DC2626' : '#E2E8F0'}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: '#E2E8F0' }} />

          {/* State filters */}
          {STATE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStateFilter(f.value)}
              className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
              style={{
                background: stateFilter === f.value ? '#F1F5F9' : 'transparent',
                color: stateFilter === f.value ? '#0F172A' : '#94A3B8',
                border: `1px solid ${stateFilter === f.value ? '#E2E8F0' : 'transparent'}`,
              }}
            >
              {f.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-1.5">
            {(['Zoom In', 'Zoom Out', 'Fit'] as const).map(label => (
              <button
                key={label}
                className="flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
                style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', minWidth: 32 }}
              >
                {label === 'Fit' ? <MaximizeIcon size={11} /> : label === 'Zoom In' ? '+' : '−'}
              </button>
            ))}
            <span className="text-[10px] ml-1" style={{ color: '#94A3B8' }}>
              {visibleIds.size}/{NODES.length} nodes
            </span>
          </div>
        </div>

        {/* ── SVG canvas ── */}
        <div className="flex-1 relative overflow-x-auto overflow-y-hidden">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full h-full block"
            preserveAspectRatio="xMidYMid meet"
            style={{ background: '#F8FAFC', minWidth: 720 }}
          >
            <defs>
              {(['active', 'discovered', 'targeting', 'unknown'] as const).map(s => (
                <marker key={s} id={`arr-${s}`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill={EDGE_STYLE[s].stroke} />
                </marker>
              ))}
              <pattern id="ag-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="0.75" />
              </pattern>
            </defs>

            {/* Grid */}
            <rect width={SVG_W} height={SVG_H} fill="url(#ag-grid)" />

            {/* Zone bands */}
            {ZONES.map((z, i) => (
              <g key={z.label}>
                <rect x={z.x} y={0} width={z.w} height={SVG_H} fill={i % 2 === 0 ? '#F1F5F9' : '#F8FAFC'} opacity={0.5} />
                <line x1={z.x} y1={0} x2={z.x} y2={SVG_H} stroke="#F1F5F9" strokeWidth={0.75} strokeDasharray="4 4" />
                <text x={z.x + z.w / 2} y={15} textAnchor="middle" fontSize={8.5} fontFamily="monospace" fill="#F1F5F9" fontWeight="600" letterSpacing="1.5">
                  {z.label.toUpperCase()}
                </text>
              </g>
            ))}

            {/* Edges */}
            {EDGES.map(edge => {
              const from = NODES.find(n => n.id === edge.from)
              const to = NODES.find(n => n.id === edge.to)
              if (!from || !to) return null
              const visible = visibleIds.has(from.id) && visibleIds.has(to.id)
              const fromR = from.state === 'objective' ? OBJ_R : NODE_R
              const toR = to.state === 'objective' ? OBJ_R : NODE_R
              const c = calcEdge(from.x, from.y, to.x, to.y, fromR, toR)
              const es = EDGE_STYLE[edge.edgeState]
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
                  stroke={es.stroke}
                  strokeWidth={1.5}
                  strokeDasharray={es.dash}
                  strokeOpacity={visible ? 0.85 : 0.08}
                  markerEnd={`url(#arr-${edge.edgeState})`}
                />
              )
            })}

            {/* Nodes */}
            {NODES.map(node => {
              const r = node.state === 'objective' ? OBJ_R : NODE_R
              const sc = STATE_COLORS[node.state]
              const visible = visibleIds.has(node.id)
              const selected = selectedNode?.id === node.id
              const hovered = hoveredNode?.id === node.id

              return (
                <g
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  onMouseEnter={() => visible && setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: visible ? 'pointer' : 'default', opacity: visible ? 1 : 0.12 }}
                >
                  {/* Outer glow on hover/select */}
                  {(selected || hovered) && (
                    <circle cx={node.x} cy={node.y} r={r + 11} fill="none" stroke={sc.border} strokeWidth={1} opacity={0.3} />
                  )}
                  {/* State pulse ring */}
                  {(node.state === 'compromised' || node.state === 'objective') && (
                    <circle cx={node.x} cy={node.y} r={r + 6} fill="none" stroke={sc.border} strokeWidth={0.75} opacity={0.18} />
                  )}
                  {/* Body */}
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={sc.bg}
                    stroke={sc.border}
                    strokeWidth={selected ? 2.5 : 1.5}
                  />
                  {/* Type letter */}
                  <text
                    x={node.x} y={node.y + 0.5}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontFamily="'Courier New', monospace"
                    fill={sc.text} fontWeight="700"
                  >
                    {TYPE_ABBREV[node.type]}
                  </text>
                  {/* Label below */}
                  <text
                    x={node.x} y={node.y + r + 13}
                    textAnchor="middle" fontSize={8.5}
                    fontFamily="'Courier New', monospace"
                    fill={selected ? sc.text : '#94A3B8'}
                    fontWeight={selected ? '700' : '400'}
                  >
                    {node.label}
                  </text>
                  {/* Active session dot */}
                  {node.session && (
                    <circle cx={node.x + r - 5} cy={node.y - r + 5} r={4} fill="#22C55E" stroke="#F8FAFC" strokeWidth={1.5} />
                  )}
                  {/* Objective marker */}
                  {node.state === 'objective' && (
                    <circle cx={node.x + r - 4} cy={node.y - r + 4} r={4} fill="#DC2626" stroke="#F8FAFC" strokeWidth={1.5} />
                  )}
                </g>
              )
            })}

            {/* Hover tooltip (foreignObject) */}
            {hoveredNode && !selectedNode && (() => {
              const n = hoveredNode
              const sc = STATE_COLORS[n.state]
              const tipX = n.x > SVG_W * 0.7 ? n.x - 240 : n.x + 34
              const tipY = Math.max(10, Math.min(n.y - 20, SVG_H - 150))
              return (
                <foreignObject x={tipX} y={tipY} width={222} height={148} style={{ pointerEvents: 'none' }}>
                  <div
                    style={{
                      background: '#F1F5F9',
                      border: `1px solid ${sc.border}`,
                      borderRadius: 8,
                      padding: '10px 13px',
                      fontSize: 11,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                      <span style={{ color: '#0F172A', fontWeight: 700, fontSize: 12 }}>{n.label}</span>
                      <span style={{ color: sc.text, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{n.state}</span>
                    </div>
                    {n.ip && <Row label="IP" value={n.ip} mono />}
                    {n.os && <Row label="OS" value={n.os} />}
                    {n.user && <Row label="User" value={n.user} mono color="#22C55E" />}
                    {n.privilege && <Row label="Priv" value={n.privilege} color={sc.text} />}
                    {n.session && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
                        <span style={{ color: '#22C55E', fontSize: 9, fontWeight: 600 }}>Session (metadata only)</span>
                      </div>
                    )}
                  </div>
                </foreignObject>
              )
            })()}
          </svg>
        </div>

        {/* ── Legend bar ── */}
        <div
          className="flex items-center gap-5 px-4 py-2 flex-shrink-0 flex-wrap"
          style={{ borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}
        >
          <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>State</span>
          {LEGEND_ITEMS.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="text-[10px]" style={{ color: '#94A3B8' }}>{l.label}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-5 text-[9px]" style={{ color: '#94A3B8' }}>
            <span className="flex items-center gap-1.5">
              <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#22C55E" strokeWidth="1.5" /></svg>
              Compromised path
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#3B82F6" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              Discovered
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#DC2626" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              Targeting
            </span>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selectedNode && (
        <div
          className="w-80 flex flex-col flex-shrink-0 overflow-hidden"
          style={{ borderLeft: '1px solid #E2E8F0', background: '#FFFFFF' }}
        >
          {/* Panel header */}
          <div className="flex items-start justify-between px-4 py-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{
                    background: STATE_COLORS[selectedNode.state].bg,
                    color: STATE_COLORS[selectedNode.state].text,
                    border: `1px solid ${STATE_COLORS[selectedNode.state].border}`,
                  }}
                >
                  {selectedNode.state}
                </span>
                <span
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase"
                  style={{ background: '#F1F5F9', color: '#94A3B8', border: '1px solid #E2E8F0' }}
                >
                  {selectedNode.type}
                </span>
              </div>
              <div className="font-mono text-[13px] font-bold leading-tight" style={{ color: '#0F172A' }}>
                {selectedNode.label}
              </div>
              {selectedNode.ip && (
                <div className="font-mono text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>{selectedNode.ip}</div>
              )}
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="ml-2 p-1 rounded hover:bg-[#1A2332] transition-colors flex-shrink-0"
              style={{ color: '#94A3B8' }}
            >
              <XIcon size={14} />
            </button>
          </div>

          {/* Node metadata */}
          <div className="px-4 py-3 space-y-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
            {selectedNode.session && (
              <div className="flex items-center gap-2 mb-2 py-1.5 px-2.5 rounded-lg" style={{ background: '#DCFCE7', border: '1px solid #16A34A' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <span className="text-[10px] font-semibold" style={{ color: '#22C55E' }}>Session (metadata only)</span>
                <span className="font-mono text-[9px] ml-auto truncate" style={{ color: '#16A34A' }}>{selectedNode.session}</span>
              </div>
            )}
            {selectedNode.os && <DetailRow label="OS" value={selectedNode.os} />}
            {selectedNode.user && (
              <DetailRow label="User" value={selectedNode.user} mono highlight={selectedNode.state === 'compromised' || selectedNode.state === 'objective'} />
            )}
            {selectedNode.privilege && (
              <DetailRow
                label="Privilege"
                value={selectedNode.privilege}
                highlight={
                  selectedNode.privilege.includes('root') ||
                  selectedNode.privilege.includes('SYSTEM') ||
                  selectedNode.privilege.includes('Domain Admin')
                }
              />
            )}
            {selectedNode.ports && <DetailRow label="Ports" value={selectedNode.ports} mono small />}
            {selectedNode.agent && (
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Agent</span>
                <div className="flex items-center gap-1.5">
                  <ZapIcon size={10} style={{ color: '#F59E0B' }} />
                  <span className="text-[10px] font-semibold" style={{ color: '#F59E0B' }}>{selectedNode.agent}</span>
                </div>
              </div>
            )}
            {selectedNode.task && (
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-wider block mb-1" style={{ color: '#94A3B8' }}>Current Task</span>
                <span className="text-[10px]" style={{ color: '#475569' }}>{selectedNode.task}</span>
              </div>
            )}
          </div>

          {/* Terminal workspace */}
          {selectedNode.terminalTabs && selectedNode.terminalOutputs && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center" style={{ borderBottom: '1px solid #1E2736', background: '#0D1219' }}>
                <TerminalIcon size={11} className="ml-3 mr-2 flex-shrink-0" style={{ color: '#4B5563' }} />
                {selectedNode.terminalTabs.map((tab, i) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(i)}
                    className="px-3 py-2 text-[10px] font-medium transition-colors flex-shrink-0 truncate"
                    style={{
                      color: activeTab === i ? '#22C55E' : '#94A3B8',
                      borderBottom: `2px solid ${activeTab === i ? '#22C55E' : 'transparent'}`,
                      background: activeTab === i ? '#080E07' : 'transparent',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Output */}
              <div
                className="flex-1 overflow-y-auto p-3 font-mono text-[10px] leading-[1.65]"
                style={{ background: '#0B0F19', color: '#D1D5DB' }}
              >
                {(selectedNode.terminalOutputs[activeTab] ?? []).map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {renderTermLine(line)}
                  </div>
                ))}
                <div className="mt-1.5" style={{ color: '#22C55E' }}>▊</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Small helper components ──────────────────────────────────────────────────

function EmptyGraphState({ projectName, note }: { projectName: string; note: string }) {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#F8FAFC' }}>
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0F172A' }}>
              {projectName} — Attack Graph
            </h1>
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
            >
              MOCK PREVIEW
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8' }}>No attack graph data for this project yet.</div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '24px 28px', maxWidth: 720 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
            This graph is empty on purpose. The demo build ships one clearly labeled sample graph
            fixture (the Acme Corp demo project); it is not copied into other projects, so nothing
            here is presented as a confirmed attack path for {projectName}.
          </p>
          <p style={{ margin: '0', fontSize: 12, color: '#94A3B8', lineHeight: 1.6 }}>
            Real backend integration is separately gated at the app level (see the notice on real
            data mode); no live data or simulated success is substituted here.
          </p>
          <div style={{ marginTop: 14, fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
            {note}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
      <span style={{ color: '#94A3B8', fontSize: 10 }}>{label}</span>
      <span style={{ color: color ?? '#475569', fontSize: mono ? 9 : 10, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  )
}

function DetailRow({
  label, value, mono, highlight, small,
}: {
  label: string; value: string; mono?: boolean; highlight?: boolean; small?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] flex-shrink-0" style={{ color: '#94A3B8' }}>{label}</span>
      <span
        className={`text-right break-words ${mono ? 'font-mono' : ''} ${small ? 'text-[9px]' : 'text-[10px]'} font-medium`}
        style={{ color: highlight ? '#22C55E' : '#475569' }}
      >
        {value}
      </span>
    </div>
  )
}
