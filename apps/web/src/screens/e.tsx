import type { ComponentType } from 'react'
import { analysisRoutes } from '../features/analysis/views/analysis-page'
import { findingRoutes } from '../router/findings'

export const routes: Record<string, ComponentType> = { ...analysisRoutes, ...findingRoutes }
