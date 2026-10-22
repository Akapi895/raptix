/**
 * Public surface of the asset feature (ADR-0096). Callers import from here; the feature's files stay private.
 * The mock store and the real adapter are wired by the composition roots, so they are not exported here.
 */
export { assetRoutes } from './views/asset-pages'
export { AssetPreviewModal } from './preview-modal'
export { AssetReadError, useAssetDetail, useAssetList, useAssetPort, useAssetScope, useObservedGraph } from './query'
export type { AssetCapabilities, AssetListItem, AssetListQuery, AssetListRead, AssetDetailRead, AssetObservedGraph, AssetScopeRead, AssetService } from './service'
export { changeAssetScopeTransaction, importAssetsTransaction } from './writes'
export type { AssetImportOutcome, AssetImportRow, AssetScopeApprovalInput, AssetScopeWriteInput, AssetScopeWriteOutcome } from './writes'
