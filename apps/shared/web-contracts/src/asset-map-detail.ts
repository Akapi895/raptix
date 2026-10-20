/**
 * Asset detail read model (plan phase 4): the inspector for one asset plus its typed
 * domain detail. Kinds without a typed view answer `unsupported` with a reason, never
 * an empty list that would read as "nothing found".
 */
import { isNonEmptyString, isRecord } from './guards.js'
import { isAssetMapAssetRef, isAssetMapCompleteness, type AssetMapAssetRef, type AssetMapCompleteness } from './asset-map.js'

export interface AssetMapProvenanceSource {
  source: string
  count: number
}

export interface AssetMapServiceItem {
  id: string
  port: number | null
  protocol: string | null
  service: string | null
  product: string | null
  version: string | null
  source: string | null
}

export interface AssetMapEndpointItem {
  id: string
  method: string
  path: string
  url: string
  statusCode: number | null
  source: string | null
  parameters: string[]
}

export type AssetMapDetailBody =
  | { kind: 'services'; items: AssetMapServiceItem[] }
  | { kind: 'endpoints'; items: AssetMapEndpointItem[] }
  | { kind: 'unsupported'; reason: string }

export interface AssetMapDetail {
  engagementId: string
  asset: AssetMapAssetRef
  provenance: { sources: AssetMapProvenanceSource[]; graphNodes: number }
  detail: AssetMapDetailBody
  nextCursor: string | null
  completeness: AssetMapCompleteness
}

export function isAssetMapDetail(v: unknown): v is AssetMapDetail {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isAssetMapAssetRef(v.asset)) return false
  if (!isRecord(v.provenance) || typeof v.provenance.graphNodes !== 'number' || !Array.isArray(v.provenance.sources)) return false
  if (!v.provenance.sources.every(item => isRecord(item) && isNonEmptyString(item.source) && typeof item.count === 'number')) return false
  if (!isRecord(v.detail)) return false
  if (v.nextCursor !== null && !isNonEmptyString(v.nextCursor)) return false
  if (!isAssetMapCompleteness(v.completeness)) return false
  if (v.detail.kind === 'unsupported') return isNonEmptyString(v.detail.reason)
  if (v.detail.kind === 'services') return Array.isArray(v.detail.items)
  if (v.detail.kind === 'endpoints') return Array.isArray(v.detail.items)
  return false
}
