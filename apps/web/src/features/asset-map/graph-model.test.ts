import type { AssetMapNeighborhood } from '@raptix/web-contracts'
import { describe, expect, it } from 'vitest'
import { toCanvasElements } from './graph-model'

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
