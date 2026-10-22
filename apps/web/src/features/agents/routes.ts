import type { ComponentType } from 'react'
import { AgentsCompat, C2Compat, InfrastructureRoute } from './views/infrastructure-page'

/** The Infrastructure route group, mounted by the router registry. */
export const routes: Record<string, ComponentType> = {
  infrastructure: InfrastructureRoute,
  agents: AgentsCompat,
  c2: C2Compat,
}
