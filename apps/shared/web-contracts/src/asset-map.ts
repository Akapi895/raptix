/**
 * Asset Map read models (plan phase 3, ADR-0094). Every response states what it
 * loaded and what it knows about the whole: `total` is null when unknown, never zero,
 * and `loaded` is never presented as the environment size.
 */
import { isNonEmptyString, isRecord } from './guards.js'

export const ASSET_MAP_KINDS = ['host', 'dns_name', 'web_origin', 'network_segment', 'cloud_resource', 'identity', 'mobile_app', 'device', 'artifact'] as const
export type AssetMapKind = (typeof ASSET_MAP_KINDS)[number]

export type AssetMapSourceState = 'ok' | 'unavailable' | 'not_queried'

export interface AssetMapCompleteness {
  /** Items included in this response. */
  loaded: number
  /** Known total for the requested scope, or null when it was not computed. */
  total: number | null
  hasMore: boolean
  /** True when a server budget cut the response short. */
  truncated: boolean
  source: { catalog: AssetMapSourceState; graph: AssetMapSourceState }
  /** Changes whenever the catalog or the graph changes; paging restarts when it does. */
  revision: string
}

export interface AssetMapAssetRef {
  assetId: string
  kind: AssetMapKind
  namespace: string
  canonicalKey: string
}

export interface AssetMapOverview {
  engagementId: string
  groups: Array<{ kind: AssetMapKind; total: number }>
  completeness: AssetMapCompleteness
}

export interface AssetMapMembersPage {
  engagementId: string
  kind: AssetMapKind
  items: AssetMapAssetRef[]
  nextCursor: string | null
  completeness: AssetMapCompleteness
}

export interface AssetMapSearchResult {
  engagementId: string
  query: string
  items: AssetMapAssetRef[]
  completeness: AssetMapCompleteness
}

export interface AssetMapNeighborNode {
  /** Neo4j element id; stable only within one revision. */
  id: string
  /** Catalog identity when the node carries one, otherwise null. */
  assetId: string | null
  labels: string[]
  label: string
}

export interface AssetMapNeighborEdge {
  id: string
  source: string
  target: string
  type: string
}

export interface AssetMapNeighborhood {
  engagementId: string
  assetId: string
  /** Every graph node that carries this asset identity, so one asset split across writers stays whole. */
  centers: AssetMapNeighborNode[]
  nodes: AssetMapNeighborNode[]
  edges: AssetMapNeighborEdge[]
  /** Opens the next page of edges; null when the neighborhood is complete. */
  nextCursor: string | null
  completeness: AssetMapCompleteness
}

function isSourceState(value: unknown): value is AssetMapSourceState {
  return value === 'ok' || value === 'unavailable' || value === 'not_queried'
}

export function isAssetMapCompleteness(v: unknown): v is AssetMapCompleteness {
  return (
    isRecord(v) &&
    typeof v.loaded === 'number' &&
    (v.total === null || typeof v.total === 'number') &&
    typeof v.hasMore === 'boolean' &&
    typeof v.truncated === 'boolean' &&
    isRecord(v.source) &&
    isSourceState(v.source.catalog) &&
    isSourceState(v.source.graph) &&
    isNonEmptyString(v.revision)
  )
}

export function isAssetMapAssetRef(v: unknown): v is AssetMapAssetRef {
  return (
    isRecord(v) &&
    isNonEmptyString(v.assetId) &&
    typeof v.kind === 'string' &&
    (ASSET_MAP_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.namespace === 'string' &&
    isNonEmptyString(v.canonicalKey)
  )
}

export function isAssetMapOverview(v: unknown): v is AssetMapOverview {
  return (
    isRecord(v) &&
    isNonEmptyString(v.engagementId) &&
    Array.isArray(v.groups) &&
    v.groups.every(group => isRecord(group) && typeof group.kind === 'string' && typeof group.total === 'number') &&
    isAssetMapCompleteness(v.completeness)
  )
}

export function isAssetMapMembersPage(v: unknown): v is AssetMapMembersPage {
  return (
    isRecord(v) &&
    isNonEmptyString(v.engagementId) &&
    typeof v.kind === 'string' &&
    Array.isArray(v.items) &&
    v.items.every(isAssetMapAssetRef) &&
    (v.nextCursor === null || isNonEmptyString(v.nextCursor)) &&
    isAssetMapCompleteness(v.completeness)
  )
}

export function isAssetMapSearchResult(v: unknown): v is AssetMapSearchResult {
  return isRecord(v) && isNonEmptyString(v.engagementId) && typeof v.query === 'string' && Array.isArray(v.items) && v.items.every(isAssetMapAssetRef) && isAssetMapCompleteness(v.completeness)
}

function isAssetMapNeighborNode(node: unknown): node is AssetMapNeighborNode {
  return isRecord(node) && isNonEmptyString(node.id) && (node.assetId === null || isNonEmptyString(node.assetId)) && Array.isArray(node.labels) && typeof node.label === 'string'
}

export function isAssetMapNeighborhood(v: unknown): v is AssetMapNeighborhood {
  return (
    isRecord(v) &&
    isNonEmptyString(v.engagementId) &&
    isNonEmptyString(v.assetId) &&
    Array.isArray(v.centers) &&
    v.centers.every(isAssetMapNeighborNode) &&
    Array.isArray(v.nodes) &&
    v.nodes.every(isAssetMapNeighborNode) &&
    Array.isArray(v.edges) &&
    v.edges.every(edge => isRecord(edge) && isNonEmptyString(edge.id) && isNonEmptyString(edge.source) && isNonEmptyString(edge.target) && typeof edge.type === 'string') &&
    (v.nextCursor === null || isNonEmptyString(v.nextCursor)) &&
    isAssetMapCompleteness(v.completeness)
  )
}
