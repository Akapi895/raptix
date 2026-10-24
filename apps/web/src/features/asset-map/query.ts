/**
 * The Asset Map page's reads. The route is real-only and behind its feature flag, so there is no mode to choose here;
 * the page reads through the port and the real adapter behind it.
 */
import { createRealAssetMapReads } from './remote'

export const assetMapReads = createRealAssetMapReads()
