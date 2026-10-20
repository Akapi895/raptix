import type { AssetMapNeighborhood, AssetMapNeighborNode } from '@raptix/web-contracts'

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
}

const KIND_BY_LABEL: Readonly<Record<string, string>> = { Host: 'host', Service: 'service', Entrypoint: 'origin', Endpoint: 'endpoint' }

export function kindOf(node: AssetMapNeighborNode): string {
  const known = node.labels.find(label => label in KIND_BY_LABEL)
  if (known) return KIND_BY_LABEL[known]!
  return (node.labels[0] ?? 'node').toLowerCase()
}

/**
 * Turns one neighborhood page into Cytoscape elements. Only edges whose ends are both present
 * are kept, so a cut page never draws a dangling edge. Nodes the centre reaches directly become
 * children of the centre (a compound group), which is how the host's services and origins read.
 */
export function toCanvasElements(view: AssetMapNeighborhood): CanvasElements {
  const centreIds = new Set(view.centers.map(centre => centre.id))
  const nodes = new Map<string, CanvasNodeData>()
  for (const node of [...view.centers, ...view.nodes]) {
    nodes.set(node.id, { id: node.id, label: node.label || node.labels[0] || node.id, kind: kindOf(node), assetId: node.assetId })
  }
  const edges = view.edges
    .filter(edge => nodes.has(edge.source) && nodes.has(edge.target))
    .map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.type } }))
  for (const edge of edges) {
    const { source, target } = edge.data
    if (centreIds.has(source) && !centreIds.has(target) && nodes.get(target)?.parent === undefined) {
      nodes.get(target)!.parent = source
    }
  }
  return { nodes: [...nodes.values()].map(data => ({ data })), edges }
}
