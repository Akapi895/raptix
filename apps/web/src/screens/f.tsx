import type { ComponentType } from 'react'
import { routes as reportRoutes } from '../features/reports/views/list'
import { SettingsPage } from './f-settings'

/**
 * Legacy route group f: the reports views (features/reports/views) and the settings page until settings moves
 * into its own feature (slice S-C).
 */
export const routes: Record<string, ComponentType> = {
  ...reportRoutes,
  settings: SettingsPage,
}
