/**
 * Asset Map read API for real mode (plan phase 4–5). Every response is checked against its
 * contract guard before the page sees it; a failed check surfaces as a transport error,
 * never as an empty map.
 */
import {
  isAssetMapDetail,
  isAssetMapMembersPage,
  isAssetMapNeighborhood,
  isAssetMapOverlay,
  isAssetMapOverview,
  isAssetMapSearchResult,
  type AssetMapDetail,
  type AssetMapKind,
  type AssetMapMembersPage,
  type AssetMapNeighborhood,
  type AssetMapOverlay,
  type AssetMapOverview,
  type AssetMapSearchResult,
} from '@raptix/web-contracts'
import { apiFetch } from './transport'

const base = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}/asset-map`

function withCursor(path: string, cursor: string | null | undefined): string {
  return cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : path
}

export function fetchAssetMapOverview(engagementId: string): Promise<AssetMapOverview> {
  return apiFetch(`${base(engagementId)}/overview`, isAssetMapOverview)
}

export function fetchAssetMapMembers(engagementId: string, kind: AssetMapKind, cursor?: string | null): Promise<AssetMapMembersPage> {
  return apiFetch(withCursor(`${base(engagementId)}/groups/${kind}/members?limit=50`, cursor), isAssetMapMembersPage)
}

export function fetchAssetMapNeighborhood(engagementId: string, assetId: string, cursor?: string | null): Promise<AssetMapNeighborhood> {
  return apiFetch(withCursor(`${base(engagementId)}/assets/${encodeURIComponent(assetId)}/neighborhood`, cursor), isAssetMapNeighborhood)
}

/** `filter` narrows a web origin's sitemap by URL or path; a cursor is only valid for the filter it came from. */
export function fetchAssetMapDetail(engagementId: string, assetId: string, cursor?: string | null, filter = ''): Promise<AssetMapDetail> {
  const filtered = filter ? `&q=${encodeURIComponent(filter)}` : ''
  return apiFetch(withCursor(`${base(engagementId)}/assets/${encodeURIComponent(assetId)}/detail?limit=50${filtered}`, cursor), isAssetMapDetail)
}

/** Findings linked to the asset through their owning record, and how many findings have no such link. */
export function fetchAssetMapOverlay(engagementId: string, assetId: string): Promise<AssetMapOverlay> {
  return apiFetch(`${base(engagementId)}/assets/${encodeURIComponent(assetId)}/overlay`, isAssetMapOverlay)
}

export function fetchAssetMapSearch(engagementId: string, query: string): Promise<AssetMapSearchResult> {
  return apiFetch(`${base(engagementId)}/search?q=${encodeURIComponent(query)}&limit=25`, isAssetMapSearchResult)
}
