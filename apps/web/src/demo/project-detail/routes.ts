import type { ComponentType } from 'react'
import { ProjectPage } from './project-page'

/** The demo project route group. The real project composition is features/projects; the demo keeps its own until its tabs are re-designed (follow-up). */
export const routes: Record<string, ComponentType> = { project: ProjectPage }
