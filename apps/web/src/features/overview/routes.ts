import type { ComponentType } from 'react'
import { OverviewPage } from './views/overview-page'

/** The System Overview route group: the global overview, mounted by the router registry for both modes. */
export const routes: Record<string, ComponentType> = {
  overview: OverviewPage,
}
