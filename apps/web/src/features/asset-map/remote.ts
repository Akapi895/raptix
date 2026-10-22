import type { AssetMapReads } from './service'
import {
  fetchAssetMapDetail,
  fetchAssetMapMembers,
  fetchAssetMapNeighborhood,
  fetchAssetMapOverlay,
  fetchAssetMapOverview,
  fetchAssetMapSearch,
} from './api'

/** The real Asset Map reads: each port method is one engagement-scoped wire call. */
export function createRealAssetMapReads(): AssetMapReads {
  return {
    overview: fetchAssetMapOverview,
    members: fetchAssetMapMembers,
    neighborhood: fetchAssetMapNeighborhood,
    detail: fetchAssetMapDetail,
    overlay: fetchAssetMapOverlay,
    search: fetchAssetMapSearch,
  }
}
