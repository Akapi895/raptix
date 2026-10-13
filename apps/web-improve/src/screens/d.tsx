import type { ComponentType } from 'react'
import { agentRoutes } from './d-agents'
import { assetRoutes } from './d-assets'
import { libraryRoutes } from './d-library'

export const routes: Record<string, ComponentType> = { ...agentRoutes, ...assetRoutes, ...libraryRoutes }
