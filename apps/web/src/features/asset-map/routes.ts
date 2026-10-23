import type { ComponentType } from 'react'
import { AssetMapPage } from './AssetMapPage'

/** The Asset Map route group (flagged), mounted by the router registry for the mock console. */
export const routes: Record<string, ComponentType> = {
  'asset-map': AssetMapPage,
}
