/**
 * Public surface of the asset feature (ADR-0096). Callers import from here; the feature's files stay private.
 * The real adapter is wired by the composition root, so it is not exported here.
 */
export { assetRoutes } from './views/asset-pages'
export { ProjectAssets } from './views/project-assets'
export { AssetPreviewModal } from './preview-modal'
export { AssetReadError, useAssetDetail, useAssetList, useAssetPort, useAssetScope, useObservedGraph } from './query'
export type { AssetCapabilities, AssetListItem, AssetListQuery, AssetListRead, AssetDetailRead, AssetObservedGraph, AssetScopeRead, AssetService } from './service'
export type { AssetImportOutcome, AssetImportRow, AssetScopeApprovalInput, AssetScopeWriteInput, AssetScopeWriteOutcome } from './writes'
