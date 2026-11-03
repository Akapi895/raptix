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

/** A pointer back to the observation that asserted this asset. Raw payloads stay in artifact storage. */
/** A capture imported from the workspace artifact an observation came from. */
export interface AssetMapEvidenceCapture {
  id: string
  path: string
  digest: string
  classification: string
}

export interface AssetMapEvidenceRef {
  source: string
  sourceEpisodeId: string | null
  observedAt: string | null
  /** The engagement-relative workspace artifact the observation was read from, when known. */
  artifactRef: string | null
  /** The sha256 of the artifact bytes the observation was parsed from. A capture links only when its digest equals this. */
  artifactDigest: string | null
  /** The capture of that artifact version in this engagement, or null while that version has not been imported. */
  capture: AssetMapEvidenceCapture | null
}

export interface AssetMapServiceItem {
  id: string
  port: number | null
  protocol: string | null
  service: string | null
  product: string | null
  version: string | null
  source: string | null
  sourceEpisodeId: string | null
}

export interface AssetMapEndpointItem {
  id: string
  method: string
  path: string
  /** Redacted: credentials are removed and sensitive query values masked. */
  url: string
  statusCode: number | null
  source: string | null
  sourceEpisodeId: string | null
  parameters: string[]
}

export type AssetMapDetailBody =
  | { kind: 'services'; items: AssetMapServiceItem[] }
  | { kind: 'endpoints'; items: AssetMapEndpointItem[] }
  | { kind: 'unsupported'; reason: string }

export interface AssetMapDetail {
  engagementId: string
  asset: AssetMapAssetRef
  provenance: { sources: AssetMapProvenanceSource[]; graphNodes: number; evidence: AssetMapEvidenceRef[] }
  detail: AssetMapDetailBody
  nextCursor: string | null
  completeness: AssetMapCompleteness
}

function isEvidenceRef(item: unknown): item is AssetMapEvidenceRef {
  if (!isRecord(item) || !isNonEmptyString(item.source)) return false
  if (item.artifactRef !== null && typeof item.artifactRef !== 'string') return false
  if (item.artifactDigest !== null && typeof item.artifactDigest !== 'string') return false
  const capture = item.capture
  if (capture === null) return true
  return isRecord(capture) && isNonEmptyString(capture.id) && typeof capture.path === 'string' && typeof capture.digest === 'string' && typeof capture.classification === 'string'
}

export function isAssetMapDetail(v: unknown): v is AssetMapDetail {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isAssetMapAssetRef(v.asset)) return false
  if (!isRecord(v.provenance) || typeof v.provenance.graphNodes !== 'number' || !Array.isArray(v.provenance.sources) || !Array.isArray(v.provenance.evidence)) return false
  if (!v.provenance.evidence.every(isEvidenceRef)) return false
  if (!v.provenance.sources.every(item => isRecord(item) && isNonEmptyString(item.source) && typeof item.count === 'number')) return false
  if (!isRecord(v.detail)) return false
  if (v.nextCursor !== null && !isNonEmptyString(v.nextCursor)) return false
  if (!isAssetMapCompleteness(v.completeness)) return false
  if (v.detail.kind === 'unsupported') return isNonEmptyString(v.detail.reason)
  if (v.detail.kind === 'services') return Array.isArray(v.detail.items)
  if (v.detail.kind === 'endpoints') return Array.isArray(v.detail.items)
  return false
}
