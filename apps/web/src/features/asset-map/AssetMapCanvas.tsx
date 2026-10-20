import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { CanvasElements } from './canvas-model'

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

/** Asks the canvas to centre one asset. A new token repeats the request for the same asset. */
export interface CanvasFocus {
  assetId: string
  token: number
}

interface Props {
  elements: CanvasElements
  /** Called with the catalog asset id of the tapped node; nodes without one are ignored. */
  onSelectAsset: (assetId: string) => void
  focus?: CanvasFocus | null
}

/** Hides or shows one group's children and the edges that touch them; a collapsed group keeps its position. */
function setGroupVisible(group: cytoscape.NodeSingular, visible: boolean): void {
  const children = group.children()
  children.style('display', visible ? 'element' : 'none')
  children.connectedEdges().style('display', visible ? 'element' : 'none')
  group.data('collapsed', !visible)
}

/** A short digest of node positions: equal digests mean nothing moved, so a refresh can be checked from outside. */
function positionDigest(instance: Core): string {
  let hash = 5381
  const ordered = instance.nodes().toArray().sort((a, b) => (a.id() < b.id() ? -1 : 1))
  for (const node of ordered) {
    const at = node.position()
    for (const char of `${node.id()}:${Math.round(at.x)},${Math.round(at.y)};`) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0
  }
  return (hash >>> 0).toString(16)
}

/** Publishes what a check needs to see: drawn and visible counts, the pan, and the position digest. */
function publish(container: HTMLDivElement, instance: Core): void {
  container.dataset.nodeCount = String(instance.nodes().length)
  container.dataset.edgeCount = String(instance.edges().length)
  container.dataset.visibleNodeCount = String(instance.nodes().filter(node => node.style('display') !== 'none').length)
  container.dataset.positionDigest = positionDigest(instance)
  container.dataset.panX = String(Math.round(instance.pan().x))
  container.dataset.panY = String(Math.round(instance.pan().y))
}

/**
 * Cytoscape view of one neighborhood. Updates keep the positions of nodes that are still present:
 * removed nodes leave, new nodes are laid out on their own, and existing nodes do not move. Pan and
 * zoom only navigate; the list beside the canvas offers the same selection without a pointer.
 * Double-tapping a host toggles its group (services and origins); the toolbar does the same for all.
 */
export function AssetMapCanvas({ elements, onSelectAsset, focus = null }: Props) {
  const container = useRef<HTMLDivElement | null>(null)
  const core = useRef<Core | null>(null)
  const select = useRef(onSelectAsset)
  select.current = onSelectAsset
  const focused = useRef<number | null>(null)

  useEffect(() => {
    if (!container.current) return
    const instance = cytoscape({ container: container.current, elements: [], style: STYLE, minZoom: 0.2, maxZoom: 3 })
    instance.on('tap', 'node', event => {
      const assetId = event.target.data('assetId') as string | null
      if (assetId) select.current(assetId)
    })
    instance.on('dbltap', 'node:parent', event => {
      const group = event.target as cytoscape.NodeSingular
      setGroupVisible(group, group.data('collapsed') === true)
      if (container.current) publish(container.current, instance)
    })
    instance.on('zoom', () => {
      if (container.current) container.current.dataset.zoom = instance.zoom().toFixed(2)
    })
    instance.on('pan', () => {
      if (container.current) publish(container.current, instance)
    })
    instance.on('free', 'node', () => {
      if (container.current) publish(container.current, instance)
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
      // Children that arrive under a collapsed group stay hidden until the group is opened.
      instance.nodes(':parent').forEach(group => setGroupVisible(group, group.data('collapsed') !== true))
    })
    if (container.current) publish(container.current, instance)
  }, [elements])

  useEffect(() => {
    const instance = core.current
    if (!instance || !focus || focused.current === focus.token) return
    const target = instance.nodes().filter(node => node.data('assetId') === focus.assetId)
    // The node may not be on the canvas yet; the next update tries again with the same token.
    if (target.empty()) return
    focused.current = focus.token
    instance.center(target)
    target.select()
  }, [focus, elements])

  const fit = (): void => {
    core.current?.fit(undefined, 30)
  }
  const setAllGroups = (visible: boolean): void => {
    const instance = core.current
    if (!instance) return
    instance.batch(() => instance.nodes(':parent').forEach(group => setGroupVisible(group, visible)))
    if (container.current) publish(container.current, instance)
  }

  return (
    <div className="space-y-1">
      <div role="toolbar" aria-label="Canvas controls" className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={fit} className="rounded border px-2 py-1">
          Fit view
        </button>
        <button type="button" onClick={() => setAllGroups(false)} className="rounded border px-2 py-1">
          Collapse groups
        </button>
        <button type="button" onClick={() => setAllGroups(true)} className="rounded border px-2 py-1">
          Expand groups
        </button>
      </div>
      <div ref={container} data-testid="asset-map-canvas" role="img" aria-label="Asset relationship map" data-zoom="1.00" className="h-[420px] w-full rounded border border-slate-300 bg-white" />
    </div>
  )
}
