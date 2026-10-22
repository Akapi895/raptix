import type { ComponentType } from 'react'
import { ProjectPortfolio } from './views/portfolio-page'

/** The project list route group, mounted by the router registry for both modes. */
export const routes: Record<string, ComponentType> = {
  projects: ProjectPortfolio,
}
