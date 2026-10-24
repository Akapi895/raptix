/**
 * The d route slice: the asset inventory and the library. Feature route maps are combined here, so the registry loads the slice as one module.
 */
import type { ComponentType } from 'react'
import { assetRoutes } from '../features/assets/index'
import { capabilityRoutes } from '../features/capabilities/index'

export const routes: Record<string, ComponentType> = { ...assetRoutes, ...capabilityRoutes }
