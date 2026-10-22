/**
 * The d route slice: agents, assets and the library. Feature route maps are combined here, so the registry loads the slice as one module.
 */
import type { ComponentType } from 'react'
import { agentRoutes } from '../features/agents/views/agents-page'
import { assetRoutes } from '../features/assets/index'
import { libraryRoutes } from '../features/library/index'

export const routes: Record<string, ComponentType> = { ...agentRoutes, ...assetRoutes, ...libraryRoutes }
