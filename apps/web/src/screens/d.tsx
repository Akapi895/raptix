import type { ComponentType } from 'react'
import { agentRoutes } from './d-agents'
import { assetRoutes } from '../features/assets'
import { libraryRoutes } from '../features/library'

export const routes: Record<string, ComponentType> = { ...agentRoutes, ...assetRoutes, ...libraryRoutes }
