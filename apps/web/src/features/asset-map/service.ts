import type { AssetMapDetail, AssetMapKind, AssetMapMembersPage, AssetMapNeighborhood, AssetMapOverlay, AssetMapOverview, AssetMapSearchResult } from '@raptix/web-contracts'

export interface AssetMapReads {
  overview(engagementId: string): Promise<AssetMapOverview>
  members(engagementId: string, kind: AssetMapKind, cursor?: string | null): Promise<AssetMapMembersPage>
  neighborhood(engagementId: string, assetId: string, cursor?: string | null): Promise<AssetMapNeighborhood>
  /** `filter` narrows a web origin's sitemap; a cursor is only valid for the filter it came from. */
  detail(engagementId: string, assetId: string, cursor?: string | null, filter?: string): Promise<AssetMapDetail>
  overlay(engagementId: string, assetId: string): Promise<AssetMapOverlay>
  search(engagementId: string, query: string): Promise<AssetMapSearchResult>
}
