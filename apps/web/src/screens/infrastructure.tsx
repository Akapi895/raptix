/**
 * Composition of the Infrastructure route group (ADR-0096). The page lives in features/agents; its C2 tabs are the C2 mock screens,
 * which migrate in their own slice. This file is the only place that binds the two.
 */
import type { ComponentType } from 'react'
import { AgentsCompat, C2Compat, InfrastructureRoute } from '../features/agents/views/infrastructure-page'
import { C2InfraContent, routes as c2Routes, Sessions } from './h'

const slots = {
  c2: C2InfraContent,
  sessions: () => <Sessions all monitor />,
  projectC2: c2Routes.c2,
}

export const routes: Record<string, ComponentType> = {
  infrastructure: () => <InfrastructureRoute slots={slots} />,
  agents: () => <AgentsCompat slots={slots} />,
  c2: () => <C2Compat slots={slots} />,
}
