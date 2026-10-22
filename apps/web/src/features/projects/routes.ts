import type { ComponentType } from 'react'
import { ProjectPortfolio } from './views/portfolio-page'

/** The project route group, mounted by the router registry and the host for both modes. */
export const routes: Record<string, ComponentType> = {
  projects: ProjectPortfolio,
}

export { RealProjectDetail } from './views/project-detail-page'
export { RealProjectNewRoute } from './views/create-page'
