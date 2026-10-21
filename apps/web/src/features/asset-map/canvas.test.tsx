import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasElements } from './canvas-model'

/**
 * A stand-in for the parts of the Cytoscape core that the canvas uses. jsdom has no layout or canvas,
 * so these tests check what the component asks Cytoscape to do; the browser check covers what it draws.
 */
class FakeElement {
  kids: FakeElement[] = []
  linked: FakeElement[] = []
  selected = false
  styles: Record<string, string> = {}
  constructor(
    private readonly identifier: string,
    private readonly values: Record<string, unknown>,
  ) {}
  id(): string {
    return this.identifier
  }
  data(key?: string, value?: unknown): unknown {
    if (key === undefined) return this.values
    if (value !== undefined) this.values[key] = value
    return this.values[key]
  }
  children(): FakeCollection {
    return new FakeCollection(this.kids)
  }
  connectedEdges(): FakeCollection {
    return new FakeCollection(this.linked)
  }
  position(): { x: number; y: number } {
    return { x: 0, y: 0 }
  }
  style(name: string, value?: string): FakeCollection | string {
    return new FakeCollection([this]).style(name, value)
  }
}

class FakeCollection {
  constructor(readonly items: FakeElement[]) {}
  get length(): number {
    return this.items.length
  }
  empty(): boolean {
    return this.items.length === 0
  }
  toArray(): FakeElement[] {
    return [...this.items]
  }
  filter(test: (element: FakeElement) => boolean): FakeCollection {
    return new FakeCollection(this.items.filter(test))
  }
  forEach(action: (element: FakeElement) => void): void {
    this.items.forEach(action)
  }
  children(): FakeCollection {
    return new FakeCollection(this.items.flatMap(element => element.kids))
  }
  connectedEdges(): FakeCollection {
    return new FakeCollection(this.items.flatMap(element => element.linked))
  }
  style(name: string, value?: string): FakeCollection | string {
    if (value === undefined) return this.items[0]?.styles[name] ?? ''
    this.items.forEach(element => {
      element.styles[name] = value
    })
    return this
  }
  data(key: string, value?: unknown): unknown {
    return this.items[0]?.data(key, value)
  }
  select(): FakeCollection {
    this.items.forEach(element => {
      element.selected = true
    })
    return this
  }
  /** Removal is not exercised by these tests; the canvas only calls it with an empty set here. */
  remove(): FakeCollection {
    return this
  }
  layout(): { run: () => void } {
    return { run: () => undefined }
  }
}

type Handler = (event: unknown) => void

interface FakeCore {
  handlers: Array<{ event: string; selector: string | Handler; handler: Handler }>
  nodeList: FakeElement[]
  edgeList: FakeElement[]
  nodes: (selector?: string) => FakeCollection
  edges: () => FakeCollection
  elements: () => FakeCollection
  getElementById: (id: string) => FakeCollection
  add: (definitions: Array<{ data: Record<string, unknown> }>) => FakeCollection
  batch: (action: () => void) => void
  layout: () => { run: () => void }
  fit: ReturnType<typeof vi.fn>
  center: ReturnType<typeof vi.fn>
  viewport: ReturnType<typeof vi.fn>
  zoom: () => number
  pan: () => { x: number; y: number }
  on: (event: string, selector: string | Handler, handler?: Handler) => void
  destroy: ReturnType<typeof vi.fn>
}

const instances: FakeCore[] = []

function createFakeCore(): FakeCore {
  const nodeList: FakeElement[] = []
  const edgeList: FakeElement[] = []
  const all = () => [...nodeList, ...edgeList]
  const core: FakeCore = {
    handlers: [],
    nodeList,
    edgeList,
    nodes: selector => new FakeCollection(selector === ':parent' ? nodeList.filter(node => node.kids.length > 0) : nodeList),
    edges: () => new FakeCollection(edgeList),
    elements: () => new FakeCollection(all()),
    getElementById: id => new FakeCollection(all().filter(element => element.id() === id)),
    add: definitions => {
      const added = definitions.map(definition => new FakeElement(String(definition.data.id), { ...definition.data }))
      for (const element of added) {
        if (element.data('source') !== undefined) edgeList.push(element)
        else nodeList.push(element)
      }
      for (const element of added) {
        const parentId = element.data('parent')
        if (typeof parentId === 'string') nodeList.find(node => node.id() === parentId)?.kids.push(element)
        if (typeof element.data('source') === 'string') {
          for (const endpoint of [element.data('source'), element.data('target')]) {
            nodeList.find(node => node.id() === endpoint)?.linked.push(element)
          }
        }
      }
      return new FakeCollection(added)
    },
    batch: action => action(),
    layout: () => ({ run: () => undefined }),
    fit: vi.fn(),
    center: vi.fn(),
    viewport: vi.fn(),
    zoom: () => 1,
    pan: () => ({ x: 0, y: 0 }),
    on: (event, selector, handler) => {
      core.handlers.push({ event, selector, handler: handler ?? (selector as Handler) })
    },
    destroy: vi.fn(),
  }
  instances.push(core)
  return core
}

vi.mock('cytoscape', () => ({ default: () => createFakeCore() }))

const { AssetMapCanvas } = await import('./AssetMapCanvas')

const host = { id: 'h', label: '10.0.0.1', kind: 'host', assetId: 'asset_h' }
const service = { id: 's', label: 'tcp/80', kind: 'service', assetId: null, parent: 'h' }
const twoNodes: CanvasElements = {
  nodes: [{ data: host }, { data: service }],
  edges: [{ data: { id: 'e', source: 'h', target: 's', label: 'HOSTS' } }],
  hiddenNodes: 0,
  hiddenEdges: 0,
  filteredNodes: 0,
}
const empty: CanvasElements = { nodes: [], edges: [], hiddenNodes: 0, hiddenEdges: 0, filteredNodes: 0 }

function core(): FakeCore {
  const instance = instances.at(-1)
  if (!instance) throw new Error('the canvas did not create a Cytoscape instance')
  return instance
}

function handlerFor(event: string, selector: string): Handler {
  const found = core().handlers.find(item => item.event === event && item.selector === selector)
  if (!found) throw new Error(`no ${event} handler for ${selector}`)
  return found.handler
}

beforeEach(() => {
  instances.length = 0
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AssetMapCanvas', () => {
  it('reports how many nodes and relations it drew', () => {
    render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    const canvas = screen.getByTestId('asset-map-canvas')
    expect(canvas.dataset.nodeCount).toBe('2')
    expect(canvas.dataset.edgeCount).toBe('1')
  });

  it('reports the catalog asset of a tapped node and ignores nodes without one', () => {
    const onSelectAsset = vi.fn()
    render(<AssetMapCanvas elements={twoNodes} onSelectAsset={onSelectAsset} />)
    const tap = handlerFor('tap', 'node')
    tap({ target: core().nodeList[0] })
    tap({ target: core().nodeList[1] })
    expect(onSelectAsset.mock.calls).toEqual([['asset_h']])
  });

  it('collapses every group from the toolbar, hides the relations that touch its children, and expands it again', () => {
    render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    const canvas = screen.getByTestId('asset-map-canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse groups' }))
    expect(core().nodeList[0].kids[0].styles.display).toBe('none')
    expect(core().edgeList[0].styles.display).toBe('none')
    expect(canvas.dataset.visibleNodeCount).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Expand groups' }))
    expect(core().nodeList[0].kids[0].styles.display).toBe('element')
    expect(core().edgeList[0].styles.display).toBe('element')
    expect(canvas.dataset.visibleNodeCount).toBe('2')
  });

  it('publishes a position digest that stays the same until a node moves', () => {
    const { rerender } = render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    const digest = screen.getByTestId('asset-map-canvas').dataset.positionDigest
    expect(digest).toMatch(/^[0-9a-f]+$/)
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    expect(screen.getByTestId('asset-map-canvas').dataset.positionDigest).toBe(digest)
  });

  it('toggles one group on a double tap and keeps it closed when children arrive later', () => {
    const { rerender } = render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    const doubleTap = handlerFor('dbltap', 'node:parent')
    doubleTap({ target: core().nodeList[0] })
    expect(core().nodeList[0].kids.map(child => child.styles.display)).toEqual(['none'])
    rerender(
      <AssetMapCanvas
        elements={{ ...twoNodes, nodes: [...twoNodes.nodes, { data: { id: 's2', label: 'tcp/22', kind: 'service', assetId: null, parent: 'h' } }] }}
        onSelectAsset={vi.fn()}
      />,
    )
    expect(core().nodeList[0].kids.map(child => child.styles.display)).toEqual(['none', 'none'])
    doubleTap({ target: core().nodeList[0] })
    expect(core().nodeList[0].kids.map(child => child.styles.display)).toEqual(['element', 'element'])
  });

  it('centres a focused asset once per focus token and again only for a new token', () => {
    const { rerender } = render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} focus={{ assetId: 'asset_h', token: 1 }} />)
    expect(core().center).toHaveBeenCalledTimes(1)
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} focus={{ assetId: 'asset_h', token: 1 }} />)
    expect(core().center).toHaveBeenCalledTimes(1)
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} focus={{ assetId: 'asset_h', token: 2 }} />)
    expect(core().center).toHaveBeenCalledTimes(2)
  });

  it('waits for a focused asset that is not on the canvas yet', () => {
    const { rerender } = render(<AssetMapCanvas elements={empty} onSelectAsset={vi.fn()} focus={{ assetId: 'asset_h', token: 1 }} />)
    expect(core().center).not.toHaveBeenCalled()
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} focus={{ assetId: 'asset_h', token: 1 }} />)
    expect(core().center).toHaveBeenCalledTimes(1)
  });

  it('fits the view from the toolbar', () => {
    render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }))
    expect(core().fit).toHaveBeenCalledWith(undefined, 30)
  });
});

describe('AssetMapCanvas camera', () => {
  it('applies the saved camera once, after the graph is drawn', () => {
    const camera = { zoom: 1.5, x: 40, y: -20 }
    const { rerender } = render(<AssetMapCanvas elements={empty} onSelectAsset={vi.fn()} restore={{ camera, token: 1 }} />)
    expect(core().viewport).not.toHaveBeenCalled()
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} restore={{ camera, token: 1 }} />)
    expect(core().viewport).toHaveBeenCalledTimes(1)
    expect(core().viewport).toHaveBeenCalledWith({ zoom: 1.5, pan: { x: 40, y: -20 } })
    rerender(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} restore={{ camera, token: 1 }} />)
    expect(core().viewport).toHaveBeenCalledTimes(1)
  });

  it('reports the camera once it has been still for a moment, not on every movement', () => {
    vi.useFakeTimers()
    try {
      const onCameraChange = vi.fn()
      render(<AssetMapCanvas elements={twoNodes} onSelectAsset={vi.fn()} onCameraChange={onCameraChange} />)
      const pan = core().handlers.find(item => item.event === 'pan')?.handler as (event: unknown) => void
      pan({})
      pan({})
      expect(onCameraChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onCameraChange).toHaveBeenCalledTimes(1)
      expect(onCameraChange).toHaveBeenCalledWith({ zoom: 1, x: 0, y: 0 })
    } finally {
      vi.useRealTimers()
    }
  });
});

