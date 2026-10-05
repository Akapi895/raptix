import { useState } from 'react'
import type { Project } from '../types'
import {
  GRAPH_FIXTURE_PROJECT_ID,
  KNOWLEDGE_GRAPH_EDGES,
  KNOWLEDGE_GRAPH_GEOMETRY,
  KNOWLEDGE_GRAPH_NODES,
  KNOWLEDGE_GRAPH_SOURCE_NOTE,
} from '../mocks/fixtures/graphs'
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode as KGNode,
  KnowledgeGraphNodeCategory as NodeCategory,
} from '../mocks/fixtures/graphs'
import {
  SearchIcon,
  FilterIcon,
  MaximizeIcon,
  NetworkIcon,
  LayersIcon,
  DatabaseIcon,
  ChevronRightIcon,
  XIcon,
  AlertTriangleIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type GroupBy = 'type' | 'subnet' | 'domain'
type CategoryFilter = 'all' | NodeCategory

// SVG canvas dimensions
const W = KNOWLEDGE_GRAPH_GEOMETRY.width
const H = KNOWLEDGE_GRAPH_GEOMETRY.height
const CX = KNOWLEDGE_GRAPH_GEOMETRY.centerX
const CY = KNOWLEDGE_GRAPH_GEOMETRY.centerY

// Radial positions
const INNER_R = KNOWLEDGE_GRAPH_GEOMETRY.innerRadius
const OUTER_R = KNOWLEDGE_GRAPH_GEOMETRY.outerRadius

const NODES = KNOWLEDGE_GRAPH_NODES
const EDGES: KnowledgeGraphEdge[] = KNOWLEDGE_GRAPH_EDGES

const CAT_COLORS: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  Asset: { bg: '#0F2744', border: '#3B82F6', text: '#3B82F6' },
  Identity: { bg: '#2D1B50', border: '#A855F7', text: '#A855F7' },
  Service: { bg: '#0E2E2E', border: '#14B8A6', text: '#14B8A6' },
  Domain: { bg: '#3A1A00', border: '#F97316', text: '#F97316' },
  Network: { bg: '#1A2332', border: '#64748B', text: '#64748B' },
}

const CAT_FILTERS: { label: string; value: CategoryFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Assets', value: 'Asset' },
  { label: 'Identities', value: 'Identity' },
  { label: 'Services', value: 'Service' },
  { label: 'Domains', value: 'Domain' },
  { label: 'Network', value: 'Network' },
]

const GROUP_OPTIONS: { label: string; value: GroupBy }[] = [
  { label: 'By Type', value: 'type' },
  { label: 'By Subnet', value: 'subnet' },
  { label: 'By Domain', value: 'domain' },
]

const NODE_R: Record<KGNode['ring'], number> = { center: 30, inner: 22, outer: 18 }

const LEGEND_CATS: NodeCategory[] = ['Asset', 'Identity', 'Service', 'Domain', 'Network']

function calcEdge(x1: number, y1: number, x2: number, y2: number, r1: number, r2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return { x1, y1, x2, y2, mx: x1, my: y1 }
  const nx = dx / dist
  const ny = dy / dist
  return {
    x1: x1 + nx * (r1 + 3),
    y1: y1 + ny * (r1 + 3),
    x2: x2 - nx * (r2 + 10),
    y2: y2 - ny * (r2 + 10),
    mx: (x1 + x2) / 2,
    my: (y1 + y2) / 2,
  }
}

export default function KnowledgeGraph({ project }: Props) {
  if (project.id !== GRAPH_FIXTURE_PROJECT_ID) {
    return <EmptyGraphState projectName={project.name} note={KNOWLEDGE_GRAPH_SOURCE_NOTE} />
  }
  return <KnowledgeGraphCanvas />
}

function KnowledgeGraphCanvas() {
  const [catFilter, setCatFilter] = useState<CategoryFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<KGNode | null>(null)

  const visibleIds = new Set(
    NODES.filter(n => {
      if (catFilter !== 'all' && n.category !== catFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!n.label.toLowerCase().includes(q) && !(n.sublabel ?? '').toLowerCase().includes(q)) return false
      }
      return true
    }).map(n => n.id),
  )

  const handleNodeClick = (node: KGNode) => {
    if (!visibleIds.has(node.id)) return
    setSelectedNode(prev => prev?.id === node.id ? null : node)
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: '#0B0F14', color: '#F3F4F6' }}>
      {/* Graph column */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Top controls ── */}
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 flex-shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid #273142', background: '#121821' }}
        >
          {/* Source of the graph data — explicit mock labeling (P7.5) */}
          <span
            role="note"
            title={KNOWLEDGE_GRAPH_SOURCE_NOTE}
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ background: '#3A2A00', color: '#FBBF24', border: '1px solid #6B4F00' }}
          >
            MOCK · sample knowledge graph
          </span>

          {/* Search */}
          <div className="relative">
            <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#4B5563' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search graph…"
              className="pl-8 pr-3 py-1.5 text-[11px] rounded-lg outline-none w-44 placeholder:text-[#4B5563]"
              style={{ background: '#0B0F14', border: '1px solid #273142', color: '#F3F4F6' }}
            />
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: '#273142' }} />

          {/* Category filters */}
          <div className="flex items-center gap-1">
            <FilterIcon size={11} style={{ color: '#4B5563' }} />
            {CAT_FILTERS.map(f => {
              const cc = f.value !== 'all' ? CAT_COLORS[f.value as NodeCategory] : null
              const active = catFilter === f.value
              return (
                <button
                  key={f.value}
                  onClick={() => setCatFilter(f.value)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
                  style={{
                    background: active ? (cc?.bg ?? '#1A2332') : 'transparent',
                    color: active ? (cc?.text ?? '#F3F4F6') : '#4B5563',
                    border: `1px solid ${active ? (cc?.border ?? '#273142') : '#273142'}`,
                  }}
                >
                  {cc && active && <span className="w-1.5 h-1.5 rounded-full" style={{ background: cc.border }} />}
                  {f.label}
                </button>
              )
            })}
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: '#273142' }} />

          {/* Group by */}
          <div className="flex items-center gap-1">
            <LayersIcon size={11} style={{ color: '#4B5563' }} />
            {GROUP_OPTIONS.map(g => (
              <button
                key={g.value}
                onClick={() => setGroupBy(g.value)}
                className="px-2 py-1 rounded text-[10px] transition-colors"
                style={{
                  background: groupBy === g.value ? '#161D27' : 'transparent',
                  color: groupBy === g.value ? '#9CA3AF' : '#4B5563',
                  border: `1px solid ${groupBy === g.value ? '#273142' : 'transparent'}`,
                }}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] transition-colors"
              style={{ background: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }}
            >
              <MaximizeIcon size={11} /> Fit
            </button>
            <button
              className="px-2.5 py-1 rounded text-[10px] transition-colors"
              style={{ background: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }}
            >
              Reset
            </button>
            <span className="text-[10px] ml-1" style={{ color: '#4B5563' }}>
              {visibleIds.size}/{NODES.length} nodes
            </span>
          </div>
        </div>

        {/* ── SVG canvas ── */}
        <div className="flex-1 relative overflow-x-auto overflow-y-hidden">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full block"
            preserveAspectRatio="xMidYMid meet"
            style={{ background: '#0B0F14', minWidth: 720 }}
          >
            <defs>
              <marker id="kg-arr" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">
                <polygon points="0 0, 7 3, 0 6" fill="#273142" />
              </marker>
              <pattern id="kg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0E1520" strokeWidth="0.75" />
              </pattern>
              {/* Radial gradient for center glow */}
              <radialGradient id="center-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#F97316" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="canvas-vignette" cx="50%" cy="50%" r="70%">
                <stop offset="60%" stopColor="#0B0F14" stopOpacity="0" />
                <stop offset="100%" stopColor="#060A0F" stopOpacity="0.6" />
              </radialGradient>
            </defs>

            {/* Background */}
            <rect width={W} height={H} fill="url(#kg-grid)" />
            <rect width={W} height={H} fill="url(#canvas-vignette)" />

            {/* Ring guides */}
            <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="#1A2332" strokeWidth={0.75} strokeDasharray="4 6" opacity={0.6} />
            <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="#1A2332" strokeWidth={0.75} strokeDasharray="4 6" opacity={0.4} />

            {/* Center glow */}
            <circle cx={CX} cy={CY} r={90} fill="url(#center-glow)" />

            {/* Edges */}
            {EDGES.map(edge => {
              const from = NODES.find(n => n.id === edge.from)
              const to = NODES.find(n => n.id === edge.to)
              if (!from || !to) return null
              const bothVisible = visibleIds.has(from.id) && visibleIds.has(to.id)
              const opacity = bothVisible ? 1 : 0.06
              const r1 = NODE_R[from.ring]
              const r2 = NODE_R[to.ring]
              const c = calcEdge(from.x, from.y, to.x, to.y, r1, r2)
              const isCenter = from.ring === 'center' || to.ring === 'center'
              return (
                <g key={`${edge.from}-${edge.to}`} opacity={opacity}>
                  <line
                    x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
                    stroke={isCenter ? '#2A3A50' : '#1E2736'}
                    strokeWidth={isCenter ? 1.25 : 0.75}
                    markerEnd="url(#kg-arr)"
                  />
                  {/* Relation label */}
                  {bothVisible && (
                    <g transform={`translate(${c.mx}, ${c.my})`}>
                      <rect
                        x={-24} y={-7} width={48} height={13}
                        rx={3}
                        fill="#0D1219"
                        stroke="#1E2736"
                        strokeWidth={0.75}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={6.5}
                        fontFamily="'Courier New', monospace"
                        fill="#3B4A5E"
                        fontWeight="600"
                        letterSpacing="0.5"
                      >
                        {edge.relation}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* Nodes */}
            {NODES.map(node => {
              const r = NODE_R[node.ring]
              const cc = CAT_COLORS[node.category]
              const visible = visibleIds.has(node.id)
              const selected = selectedNode?.id === node.id
              const hovered = hoveredNode?.id === node.id
              const isCenter = node.ring === 'center'

              return (
                <g
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  onMouseEnter={() => visible && setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: visible ? 'pointer' : 'default', opacity: visible ? 1 : 0.1 }}
                >
                  {/* Selection / hover ring */}
                  {(selected || hovered) && (
                    <circle cx={node.x} cy={node.y} r={r + 9} fill="none" stroke={cc.border} strokeWidth={1} opacity={0.3} />
                  )}
                  {/* Category outer ring */}
                  <circle cx={node.x} cy={node.y} r={r + 4} fill="none" stroke={cc.border} strokeWidth={0.75} opacity={isCenter ? 0.3 : 0.15} />
                  {/* Node body */}
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={cc.bg}
                    stroke={cc.border}
                    strokeWidth={selected ? 2 : 1.25}
                  />
                  {/* Center node has inner ring detail */}
                  {isCenter && (
                    <circle cx={node.x} cy={node.y} r={r - 7} fill="none" stroke={cc.border} strokeWidth={0.75} opacity={0.4} />
                  )}
                  {/* Findings badge */}
                  {node.findings > 0 && (
                    <g>
                      <circle cx={node.x + r - 4} cy={node.y - r + 4} r={5} fill="#3B0014" stroke="#EE0033" strokeWidth={1} />
                      <text x={node.x + r - 4} y={node.y - r + 4.5} textAnchor="middle" dominantBaseline="middle" fontSize={5.5} fontFamily="monospace" fill="#EE0033" fontWeight="700">
                        {node.findings}
                      </text>
                    </g>
                  )}
                  {/* Label */}
                  <text
                    x={node.x}
                    y={node.y + r + (isCenter ? 16 : 13)}
                    textAnchor="middle"
                    fontSize={isCenter ? 10 : node.ring === 'inner' ? 8.5 : 7.5}
                    fontFamily="'Courier New', monospace"
                    fill={selected ? cc.text : '#6B7280'}
                    fontWeight={selected || isCenter ? '600' : '400'}
                  >
                    {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
                  </text>
                  {/* Sublabel for center */}
                  {isCenter && (
                    <text x={node.x} y={node.y + r + 26} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="#4B5563">
                      {node.sublabel}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Hover tooltip */}
            {hoveredNode && !selectedNode && (() => {
              const n = hoveredNode
              const cc = CAT_COLORS[n.category]
              const tipX = n.x > W * 0.65 ? n.x - 228 : n.x + NODE_R[n.ring] + 12
              const tipY = Math.max(8, Math.min(n.y - 25, H - 140))
              return (
                <foreignObject x={tipX} y={tipY} width={215} height={135} style={{ pointerEvents: 'none' }}>
                  <div
                    style={{
                      background: '#161D27',
                      border: `1px solid ${cc.border}`,
                      borderRadius: 8,
                      padding: '9px 12px',
                      fontSize: 11,
                      fontFamily: 'system-ui, sans-serif',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#F3F4F6', fontWeight: 700, fontSize: 12, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                      <span style={{ color: cc.text, fontSize: 9, fontWeight: 700, background: cc.bg, padding: '1px 6px', borderRadius: 4, border: `1px solid ${cc.border}` }}>{n.category}</span>
                    </div>
                    {n.sublabel && <div style={{ color: '#9CA3AF', fontSize: 10, marginBottom: 5 }}>{n.sublabel}</div>}
                    <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
                      <div>
                        <span style={{ color: '#4B5563' }}>Relations </span>
                        <span style={{ color: '#9CA3AF', fontWeight: 600 }}>{n.relationships}</span>
                      </div>
                      <div>
                        <span style={{ color: '#4B5563' }}>Findings </span>
                        <span style={{ color: n.findings > 0 ? '#EE0033' : '#9CA3AF', fontWeight: 600 }}>{n.findings}</span>
                      </div>
                    </div>
                    {n.tags && n.tags.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {n.tags.slice(0, 3).map(t => (
                          <span key={t} style={{ fontSize: 8, color: '#6B7280', background: '#1A2332', border: '1px solid #273142', padding: '1px 5px', borderRadius: 3 }}>{t}</span>
                        ))}
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
          style={{ borderTop: '1px solid #1E2736', background: '#0D1219' }}
        >
          <NetworkIcon size={11} style={{ color: '#273142' }} />
          <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#273142' }}>Node Type</span>
          {LEGEND_CATS.map(cat => {
            const cc = CAT_COLORS[cat]
            return (
              <div key={cat} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: cc.border }} />
                <span className="text-[10px]" style={{ color: '#6B7280' }}>{cat}</span>
              </div>
            )
          })}
          <div className="ml-auto flex items-center gap-1.5 text-[9px]" style={{ color: '#4B5563' }}>
            <AlertTriangleIcon size={10} style={{ color: '#EE0033' }} />
            <span>Badge = finding count · Relationships are mock observations, not confirmed attack paths</span>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selectedNode && (
        <div
          className="w-80 flex flex-col flex-shrink-0 overflow-hidden"
          style={{ borderLeft: '1px solid #273142', background: '#121821' }}
        >
          {/* Panel header */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #1E2736' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      background: CAT_COLORS[selectedNode.category].bg,
                      color: CAT_COLORS[selectedNode.category].text,
                      border: `1px solid ${CAT_COLORS[selectedNode.category].border}`,
                    }}
                  >
                    {selectedNode.category}
                  </span>
                  {selectedNode.findings > 0 && (
                    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#3B0014', color: '#EE0033', border: '1px solid #7F1D1D' }}>
                      <AlertTriangleIcon size={9} />
                      {selectedNode.findings} {selectedNode.findings === 1 ? 'finding' : 'findings'}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[12px] font-bold break-all leading-tight" style={{ color: '#F3F4F6' }}>
                  {selectedNode.label}
                </div>
                {selectedNode.sublabel && (
                  <div className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>{selectedNode.sublabel}</div>
                )}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded hover:bg-[#1A2332] transition-colors flex-shrink-0"
                style={{ color: '#4B5563' }}
              >
                <XIcon size={14} />
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-px" style={{ background: '#1E2736', borderBottom: '1px solid #1E2736' }}>
            <StatTile label="Relations" value={selectedNode.relationships} />
            <StatTile label="Findings" value={selectedNode.findings} highlight={selectedNode.findings > 0} />
            <StatTile label="Ring" value={selectedNode.ring === 'center' ? 'Hub' : selectedNode.ring === 'inner' ? 'Inner' : 'Outer'} />
          </div>

          {/* Details */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 space-y-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#273142' }}>Properties</div>
              {Object.entries(selectedNode.details).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3">
                  <span className="text-[10px] flex-shrink-0" style={{ color: '#4B5563' }}>{k}</span>
                  <span className="text-[10px] font-medium text-right break-words max-w-[160px]" style={{ color: '#9CA3AF' }}>{v}</span>
                </div>
              ))}
              {selectedNode.tags && selectedNode.tags.length > 0 && (
                <div className="pt-1">
                  <div className="text-[9px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#273142' }}>Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedNode.tags.map(t => (
                      <span key={t} className="text-[9px] px-2 py-0.5 rounded" style={{ background: '#161D27', color: '#6B7280', border: '1px solid #273142' }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="pt-1">
                <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#273142' }}>Last Updated</div>
                <div className="font-mono text-[10px]" style={{ color: '#4B5563' }}>{selectedNode.lastUpdated}</div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="px-4 pb-4 space-y-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#273142' }}>Quick Actions</div>
              {[
                { label: 'View in Attack Graph', Icon: NetworkIcon },
                { label: 'View Findings', Icon: AlertTriangleIcon, badge: selectedNode.findings > 0 ? selectedNode.findings : undefined },
                { label: 'View Evidence', Icon: DatabaseIcon },
              ].map(({ label, Icon, badge }) => (
                <button
                  key={label}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left"
                  style={{ background: '#161D27', border: '1px solid #273142' }}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={12} style={{ color: '#4B5563' }} />
                    <span className="text-[11px]" style={{ color: '#9CA3AF' }}>{label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {badge !== undefined && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#3B0014', color: '#EE0033' }}>{badge}</span>
                    )}
                    <ChevronRightIcon size={12} style={{ color: '#4B5563' }} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyGraphState({ projectName, note }: { projectName: string; note: string }) {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0B0F14' }}>
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#F3F4F6' }}>
              {projectName} — Knowledge Graph
            </h1>
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: '#3A2A00', color: '#FBBF24', border: '1px solid #6B4F00' }}
            >
              MOCK PREVIEW
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#4B5563' }}>No knowledge graph data for this project yet.</div>
        </div>
        <div style={{ background: '#121821', border: '1px solid #273142', borderRadius: 10, padding: '24px 28px', maxWidth: 720 }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#9CA3AF', lineHeight: 1.6 }}>
            This graph is empty on purpose. The demo build ships one clearly labeled sample graph
            fixture (the Acme Corp demo project); it is not copied into other projects, so nothing
            here is presented as a confirmed relationship map for {projectName}.
          </p>
          <p style={{ margin: '0', fontSize: 12, color: '#4B5563', lineHeight: 1.6 }}>
            Real backend integration is separately gated at the app level (see the notice on real
            data mode); no live data or simulated success is substituted here.
          </p>
          <div style={{ marginTop: 14, fontSize: 11, color: '#4B5563', fontFamily: 'monospace' }}>
            {note}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-3" style={{ background: '#121821' }}>
      <div className="text-[14px] font-bold" style={{ color: highlight ? '#EE0033' : '#F3F4F6' }}>
        {value}
      </div>
      <div className="text-[9px] mt-0.5" style={{ color: '#4B5563' }}>{label}</div>
    </div>
  )
}
