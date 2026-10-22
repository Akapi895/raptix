import type { ComponentType } from 'react'
import { agentRoutes } from './d-agents'
import { assetRoutes } from '../features/assets/views/asset-pages'
import { libraryRoutes } from '../features/library/views/library-pages'

export const routes: Record<string, ComponentType> = { ...agentRoutes, ...assetRoutes, ...libraryRoutes }
