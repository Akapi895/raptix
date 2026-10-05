/**
 * W13 graph/assets view-model: pure projection helpers. Counters derive from
 * the same table projection (never source constants), asset type tabs map the
 * public AssetSummaryView, and node detail keeps server-provenance labels.
 */
import type { AssetSummaryView, AssetsView, GraphView } from '@raptix/web-contracts'

export type AssetFilter = 'all' | 'hosts' | 'web' | 'identities' | 'mobile'

export const ASSET_FILTERS: { key: AssetFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hosts', label: 'Hosts' },
  { key: 'web', label: 'Web & API' },
  { key: 'identities', label: 'Identities' },
  { key: 'mobile', label: 'Mobile' },
]

export function matchesAssetFilter(asset: AssetSummaryView, filter: AssetFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'hosts') return asset.type === 'Host'
  if (filter === 'web') return asset.type === 'Web' || asset.type === 'API'
  if (filter === 'identities') return asset.type === 'Identity'
  return asset.type === 'Mobile'
}

export function matchesAssetSearch(asset: AssetSummaryView, search: string): boolean {
  if (!search) return true
  const needle = search.toLowerCase()
  return [asset.label, asset.hostname, asset.ip, asset.url, asset.os].some(value => typeof value === 'string' && value.toLowerCase().includes(needle))
}

export function filterAssets(assets: AssetSummaryView[], filter: AssetFilter, search: string): AssetSummaryView[] {
  return assets.filter(asset => matchesAssetFilter(asset, filter) && matchesAssetSearch(asset, search))
}

export function assetCounters(assets: AssetSummaryView[]): { total: number; hosts: number; web: number; identities: number; mobile: number } {
  const counters = { total: assets.length, hosts: 0, web: 0, identities: 0, mobile: 0 }
  for (const asset of assets) {
    if (asset.type === 'Host') counters.hosts += 1
    if (asset.type === 'Web' || asset.type === 'API') counters.web += 1
    if (asset.type === 'Identity') counters.identities += 1
    if (asset.type === 'Mobile') counters.mobile += 1
  }
  return counters
}

export function nodeDisplayLabel(node: GraphView['nodes'][number]): string {
  const keys = ['hostname', 'host', 'ip', 'name', 'title', 'username', 'url'] as const
  for (const key of keys) {
    const value = node.properties[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return node.labels[0] ?? node.id
}

export function graphSummary(view: GraphView): string {
  return `${view.nodes.length} nodes • ${view.edges.length} edges${view.truncated ? ' • truncated (payload bounded)' : ''}`
}

export function assetsSummary(view: AssetsView): string {
  return `${view.assets.length} assets${view.truncated ? ' • truncated (payload bounded)' : ''}`
}
