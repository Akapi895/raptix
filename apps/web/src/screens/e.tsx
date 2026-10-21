import type { ComponentType } from 'react'
import { analysisRoutes } from './e-analysis'
import { findingRoutes } from '../router/findings'

export const routes: Record<string, ComponentType> = { ...analysisRoutes, ...findingRoutes }
