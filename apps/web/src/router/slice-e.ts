/**
 * The e route slice: attack analysis and findings. Feature route maps are combined here, so the registry loads the slice as one module.
 */
import type { ComponentType } from 'react'
import { analysisRoutes } from '../features/analysis/views/analysis-page'
import { findingRoutes } from './findings'

export const routes: Record<string, ComponentType> = { ...analysisRoutes, ...findingRoutes }
