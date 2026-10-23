/**
 * Public surface of the overview feature (ADR-0096): the route group the router mounts, the port the composition root
 * builds and the types callers name. The feature's views and mock stay private.
 */
export { routes } from './routes'
export { createRealOverviewService } from './remote'
export { useOverviewTasks } from './query'
export { RealGlobalResource } from './views/global-resource'
export type { OverviewC2, OverviewCommand, OverviewFindings, OverviewProject, OverviewService, OverviewTask, OverviewTaskKind, OverviewTaskList } from './service'
