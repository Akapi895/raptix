import type { AssetMapNeighborhood } from '@raptix/web-contracts'
import { describe, expect, it } from 'vitest'
import { toCanvasElements, VISIBLE_NODE_BUDGET } from './graph-model'

const completeness = { loaded: 2, total: null, hasMore: false, truncated: false, source: { catalog: 'ok', graph: 'ok' }, revision: 'rev-1' } as const

function neighborhood(overrides: Partial<AssetMapNeighborhood> = {}): AssetMapNeighborhood {
  return {
    engagementId: 'eng-1',
    assetId: 'asset_a',
    centers: [{ id: '4:host', assetId: 'asset_a', labels: ['Host'], label: '10.0.0.1' }],
    nodes: [
      { id: '4:svc', assetId: null, labels: ['Service'], label: '10.0.0.1:80/tcp' },
      { id: '4:origin', assetId: 'asset_o', labels: ['Entrypoint'], label: 'http://10.0.0.1:80' },
    ],
    edges: [
      { id: '5:1', source: '4:host', target: '4:svc', type: 'HOSTS' },
      { id: '5:2', source: '4:host', target: '4:origin', type: 'HAS' },
    ],
    nextCursor: null,
    completeness,
    ...overrides,
  }
}

describe('toCanvasElements', () => {
  it('maps labels to kinds and keeps the catalog id for navigation', () => {
    const { nodes } = toCanvasElements(neighborhood())
    expect(nodes.find(n => n.data.id === '4:host')?.data).toMatchObject({ kind: 'host', assetId: 'asset_a' })
    expect(nodes.find(n => n.data.id === '4:origin')?.data).toMatchObject({ kind: 'origin', assetId: 'asset_o' })
    expect(nodes.find(n => n.data.id === '4:svc')?.data.assetId).toBeNull()
  });

  it('draws services and origins inside the centre group', () => {
    const { nodes } = toCanvasElements(neighborhood())
    expect(nodes.find(n => n.data.id === '4:host')?.data.parent).toBeUndefined()
    expect(nodes.find(n => n.data.id === '4:svc')?.data.parent).toBe('4:host')
    expect(nodes.find(n => n.data.id === '4:origin')?.data.parent).toBe('4:host')
  });

  it('drops an edge whose far end was not loaded so a cut page never draws a dangling line', () => {
    const { edges } = toCanvasElements(neighborhood({ edges: [{ id: '5:9', source: '4:host', target: '4:missing', type: 'HOSTS' }] }))
    expect(edges).toEqual([])
  });
});

describe('visible budget', () => {
  it('draws at most the node budget and counts what was left out', () => {
    const many = Array.from({ length: VISIBLE_NODE_BUDGET + 30 }, (_, i) => ({ id: `4:n${i}`, assetId: null, labels: ['Service'], label: `svc-${i}` }))
    const elements = toCanvasElements(neighborhood({ nodes: many, edges: [] }))
    // The centre counts against the budget: 1 centre + 30 extra services are loaded beyond the 100 drawn.
    expect(elements.nodes.length).toBe(VISIBLE_NODE_BUDGET)
    expect(elements.hiddenNodes).toBe(31)
  });

  it('never hides a centre, even when the budget is full', () => {
    const many = Array.from({ length: VISIBLE_NODE_BUDGET + 5 }, (_, i) => ({ id: `4:n${i}`, assetId: null, labels: ['Service'], label: `svc-${i}` }))
    const { nodes } = toCanvasElements(neighborhood({ nodes: many, edges: [] }))
    expect(nodes.some(node => node.data.id === '4:host')).toBe(true)
  });
});
