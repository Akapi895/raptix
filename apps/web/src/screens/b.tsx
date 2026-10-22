import type { ComponentType } from 'react'
import { ProjectNew } from './b-wizard'
import { ProjectPage } from './b-detail'

/** Slice record: the portfolio list is migrated (ticket 16); creation and the
 * project detail keep their bridged legacy screens until tickets 17–20. */
export const routes: Record<string, ComponentType> = { 'project-new': ProjectNew, project: ProjectPage }
