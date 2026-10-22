import type { ComponentType } from 'react'
import { SettingsPage } from './views/settings-page'

/** The settings route group: the organization settings page, mounted by the router registry. */
export const routes: Record<string, ComponentType> = {
  settings: SettingsPage,
}
