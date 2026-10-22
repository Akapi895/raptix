import type { ComponentType } from 'react'
import { ProjectNew } from './b-wizard'

/** Slice record for the demo project creation wizard, which stays mock-only (follow-up). */
export const routes: Record<string, ComponentType> = { 'project-new': ProjectNew }
