/**
 * Asset Map read API for real mode (plan phase 4–5). Every response is checked against its
 * contract guard before the page sees it; a failed check surfaces as a transport error,
 * never as an empty map.
 */
import {
  isAssetMapDetail,
  isAssetMapMembersPage,
  isAssetMapNeighborhood,
  isAssetMapOverview,
  type AssetMapDetail,
  type AssetMapKind,
  type AssetMapMembersPage,
  type AssetMapNeighborhood,
  type AssetMapOverview,
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

export function fetchAssetMapDetail(engagementId: string, assetId: string, cursor?: string | null): Promise<AssetMapDetail> {
  return apiFetch(withCursor(`${base(engagementId)}/assets/${encodeURIComponent(assetId)}/detail?limit=50`, cursor), isAssetMapDetail)
}
