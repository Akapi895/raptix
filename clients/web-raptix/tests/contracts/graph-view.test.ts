import { expect, it } from 'vitest'
import type { AssetSummaryView, AssetsView, GraphView } from '@raptix/web-contracts'
import { ASSET_FILTERS, assetCounters, assetsSummary, filterAssets, graphSummary, matchesAssetSearch, nodeDisplayLabel } from '../../src/features/infrastructure/graph-view'

const hostNode: GraphView['nodes'][number] = { id: '1', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows' } }
const identityNode: GraphView['nodes'][number] = { id: '2', labels: ['Identity'], properties: { username: 'CORP\\svc_backup' } }

const host: AssetSummaryView = { id: '1', type: 'Host', label: 'dc01.corp', hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows', ports: ['445'], services: [], relatedFindingIds: [], source: 'graph' }
const identity: AssetSummaryView = { id: '2', type: 'Identity', label: 'CORP\\svc_backup', ports: [], services: [], relatedFindingIds: [], source: 'graph' }
const web: AssetSummaryView = { id: '3', type: 'Web', label: 'https://api.corp', url: 'https://api.corp', ports: [], services: [], relatedFindingIds: ['FIND-2026-001'], source: 'graph' }

it('derives counters from the same table projection instead of source constants', () => {
  expect(assetCounters([host, identity, web])).toEqual({ total: 3, hosts: 1, web: 1, identities: 1, mobile: 0 })
  expect(assetCounters([])).toEqual({ total: 0, hosts: 0, web: 0, identities: 0, mobile: 0 })
})

it('filters by the source tabs and searches across identity fields', () => {
  const assets = [host, identity, web]
  expect(ASSET_FILTERS.map(tab => tab.key)).toEqual(['all', 'hosts', 'web', 'identities', 'mobile'])
  expect(filterAssets(assets, 'hosts', '')).toEqual([host])
  expect(filterAssets(assets, 'web', '')).toEqual([web])
  expect(filterAssets(assets, 'identities', '')).toEqual([identity])
  expect(filterAssets(assets, 'mobile', '')).toEqual([])
  expect(assets.filter(asset => matchesAssetSearch(asset, 'corp'))).toHaveLength(3)
  expect(assets.filter(asset => matchesAssetSearch(asset, 'FIND-2026'))).toHaveLength(0)
  expect(assets.filter(asset => matchesAssetSearch(asset, ''))).toHaveLength(3)
})

it('labels graph nodes from public properties and summarizes bounded payloads', () => {
  expect(nodeDisplayLabel(hostNode)).toBe('dc01.corp')
  expect(nodeDisplayLabel(identityNode)).toBe('CORP\\svc_backup')
  const emptyNode: GraphView['nodes'][number] = { id: '9', labels: [], properties: {} }
  expect(nodeDisplayLabel(emptyNode)).toBe('9')
  const graph = { engagementId: 'eng', nodes: [hostNode], edges: [], truncated: true, source: 'graph' as const }
  expect(graphSummary(graph)).toContain('truncated')
  const assets: AssetsView = { engagementId: 'eng', assets: [host, identity], truncated: false, source: 'graph' }
  expect(assetsSummary(assets)).toBe('2 assets')
})
