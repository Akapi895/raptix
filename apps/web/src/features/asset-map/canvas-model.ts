import type { AssetMapNeighborhood, AssetMapNeighborNode } from '@raptix/web-contracts'

/** Visible budget for one canvas (plan phase 5): more than this is counted as hidden, never drawn. */
export const VISIBLE_NODE_BUDGET = 100
export const VISIBLE_EDGE_BUDGET = 250

export interface CanvasNodeData {
  id: string
  label: string
  kind: string
  assetId: string | null
  /** Set for a node the centre exposes (service or origin): drawn inside the centre's group. */
  parent?: string
}

export interface CanvasEdgeData {
  id: string
  source: string
  target: string
  label: string
}

export interface CanvasElements {
  nodes: Array<{ data: CanvasNodeData }>
  edges: Array<{ data: CanvasEdgeData }>
  /** Loaded but not drawn because the visible budget is full. */
  hiddenNodes: number
  hiddenEdges: number
  /** Loaded but not drawn because the operator switched their kind off. */
  filteredNodes: number
}

export interface CanvasOptions {
  /** Kinds the operator switched off. Centres are always drawn. */
  hidden?: ReadonlySet<string>
}

const KIND_BY_LABEL: Readonly<Record<string, string>> = { Host: 'host', Service: 'service', Entrypoint: 'origin', Endpoint: 'endpoint' }

export function kindOf(node: AssetMapNeighborNode): string {
  const known = node.labels.find(label => label in KIND_BY_LABEL)
  if (known) return KIND_BY_LABEL[known]!
  return (node.labels[0] ?? 'node').toLowerCase()
}

/**
 * Turns the loaded neighborhood into Cytoscape elements. Centres are drawn first and never hidden.
 * Only edges whose ends are both drawn are kept, so a cut page never draws a dangling line. Nodes the
 * centre reaches directly become children of the centre (a compound group), which is how the host's
 * services and origins read. Anything beyond the visible budget is counted, so the UI can say so.
 */
export function toCanvasElements(view: AssetMapNeighborhood, options: CanvasOptions = {}): CanvasElements {
  const centreIds = new Set(view.centers.map(centre => centre.id))
  const all = new Map<string, CanvasNodeData>()
  for (const node of [...view.centers, ...view.nodes]) {
    if (all.has(node.id)) continue
    all.set(node.id, { id: node.id, label: node.label || node.labels[0] || node.id, kind: kindOf(node), assetId: node.assetId })
  }
  const wantedKind = (kind: string) => !options.hidden?.has(kind)
  const kept = new Map<string, CanvasNodeData>()
  let filteredNodes = 0
  for (const [id, data] of all) {
    if (centreIds.has(id)) {
      kept.set(id, data)
    } else if (!wantedKind(data.kind)) {
      filteredNodes += 1
    } else if (kept.size < VISIBLE_NODE_BUDGET) {
      kept.set(id, data)
    }
  }
  const drawableEdges = view.edges.filter(edge => kept.has(edge.source) && kept.has(edge.target))
  const edges = drawableEdges.slice(0, VISIBLE_EDGE_BUDGET).map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.type } }))
  for (const { data } of edges) {
    const { source, target } = data
    if (centreIds.has(source) && !centreIds.has(target) && kept.get(target)?.parent === undefined) {
      kept.get(target)!.parent = source
    }
  }
  return {
    nodes: [...kept.values()].map(data => ({ data })),
    edges,
    hiddenNodes: all.size - kept.size - filteredNodes,
    hiddenEdges: view.edges.length - edges.length,
    filteredNodes,
  }
}
