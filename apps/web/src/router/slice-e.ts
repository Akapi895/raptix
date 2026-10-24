/**
 * The e route slice: the findings and evidence presentations. Feature route maps are combined here, so the registry loads the slice as one module.
 */
import type { ComponentType } from 'react'
import { findingRoutes } from './findings'

export const routes: Record<string, ComponentType> = { ...findingRoutes }
