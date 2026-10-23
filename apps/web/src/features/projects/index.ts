/** Public surface of the projects feature (ADR-0096): the project reads, the create mutation and their query keys. */
export { invalidateProjects, projectKeys, useCreateProject, useProjectCacheActor, useRealMembershipRole, useRealProjectList, useRealProjects } from './query'
export { listEngagements } from './remote'
export { createRealProjectsService, projectsUnavailableReason } from './remote'
export { showCreateProject, useCreateProjectDialog } from './create-dialog-state'
export type { ProjectRow, ProjectsService } from './service'
export { getEngagement } from './remote'
export { isEnvironmentPreparingError, withPreparedEnvironment } from './environment-api'
