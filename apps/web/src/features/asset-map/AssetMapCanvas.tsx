import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { CanvasElements } from './graph-model'

const KIND_COLOUR: Readonly<Record<string, string>> = {
  host: '#2b6cb0',
  service: '#2f855a',
  origin: '#b7791f',
  endpoint: '#805ad5',
}

const STYLE: cytoscape.StylesheetJson = [
  { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'text-wrap': 'ellipsis', 'text-max-width': '140px', color: '#1a202c', 'background-color': '#a0aec0', width: 26, height: 26 } },
  ...Object.entries(KIND_COLOUR).map(([kind, colour]) => ({ selector: `node[kind = "${kind}"]`, style: { 'background-color': colour } })),
  { selector: 'node[kind = "host"]', style: { width: 44, height: 44, 'font-weight': 'bold' } },
  { selector: ':parent', style: { 'background-opacity': 0.06, 'border-width': 1, 'border-color': '#718096', padding: '14px' } },
  { selector: 'edge', style: { label: 'data(label)', 'font-size': 8, width: 1.5, 'line-color': '#718096', 'target-arrow-color': '#718096', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', color: '#4a5568' } },
  { selector: ':selected', style: { 'border-width': 3, 'border-color': '#1a202c' } },
]

interface Props {
  elements: CanvasElements
  /** Called with the catalog asset id of the tapped node; nodes without one are ignored. */
  onSelectAsset: (assetId: string) => void
}

/**
 * Cytoscape view of one neighborhood. Updates keep the positions of nodes that are still present:
 * removed nodes leave, new nodes are laid out on their own, and existing nodes do not move.
 * Pan and zoom only navigate; the list beside the canvas offers the same selection without a pointer.
 */
export function AssetMapCanvas({ elements, onSelectAsset }: Props) {
  const container = useRef<HTMLDivElement | null>(null)
  const core = useRef<Core | null>(null)
  const select = useRef(onSelectAsset)
  select.current = onSelectAsset

  useEffect(() => {
    if (!container.current) return
    const instance = cytoscape({ container: container.current, elements: [], style: STYLE, minZoom: 0.2, maxZoom: 3 })
    instance.on('tap', 'node', event => {
      const assetId = event.target.data('assetId') as string | null
      if (assetId) select.current(assetId)
    })
    instance.on('zoom', () => {
      if (container.current) container.current.dataset.zoom = instance.zoom().toFixed(2)
    })
    core.current = instance
    return () => {
      instance.destroy()
      core.current = null
    }
  }, [])

  useEffect(() => {
    const instance = core.current
    if (!instance) return
    const wanted: ElementDefinition[] = [...elements.nodes, ...elements.edges]
    const wantedIds = new Set(wanted.map(element => String(element.data.id)))
    const present = instance.elements()
    const removed = present.filter(element => !wantedIds.has(element.id()))
    instance.batch(() => {
      removed.remove()
      const fresh = wanted.filter(element => instance.getElementById(String(element.data.id)).empty())
      if (fresh.length === 0) return
      const added = instance.add(fresh)
      // The first layout places the whole graph; later ones place only what arrived, so existing nodes keep their positions.
      if (present.length === 0) {
        instance.layout({ name: 'breadthfirst', directed: true, fit: true, animate: false, spacingFactor: 1.2 }).run()
      } else {
        added.layout({ name: 'breadthfirst', directed: true, fit: false, animate: false, spacingFactor: 1.2 }).run()
      }
    })
    if (container.current) {
      container.current.dataset.nodeCount = String(instance.nodes().length)
      container.current.dataset.edgeCount = String(instance.edges().length)
    }
  }, [elements])

  return <div ref={container} data-testid="asset-map-canvas" role="img" aria-label="Asset relationship map" data-zoom="1.00" className="h-[420px] w-full rounded border border-slate-300 bg-white" />
}
