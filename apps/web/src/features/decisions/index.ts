/** Public surface of the decisions feature (WS-2): the task inbox read and the decision semantics every surface shares. */
export { fetchTasks, isTasksView } from './remote'
export type { TaskEngagementView, TaskItemView, TasksView } from './remote'
export { countText, inboxLimits, splitTasks } from './model'
export type { InboxLimits, SplitTasks } from './model'
