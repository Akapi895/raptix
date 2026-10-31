import { http } from '../../platform/http';
import type { KeyValueStorage } from '../../platform/storage';
import { errorMessage, type RequestFn } from '../workflows';
import { createTasksController, type TasksDependencies } from './controller';
import { createTasksService } from './service';
import { createTasksView } from './view';

export { createTasksService } from './service';
export * from './model';
export type { TasksDependencies } from './controller';
export function initTasks(deps: TasksDependencies & { storage: KeyValueStorage; request?: RequestFn }) {
  const service = createTasksService({ request: deps.request ?? ((path, init) => http.raw(path, init)), storage: deps.storage, projects: deps.loadProjects });
  const view = createTasksView(deps.doc, deps.t, error => deps.alert(deps.t(errorMessage(error))), deps.applyPermissions);
  const controller = createTasksController(service, view, deps);
  return { service, view, ...controller };
}
