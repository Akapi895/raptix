import { http } from '../../platform/http';
import { errorMessage } from './dom';
import { createWorkflowsController, type WorkflowsDependencies } from './controller';
import type { RequestFn } from './model';
import { createWorkflowsService } from './service';
import { createWorkflowsView } from './view';

export * from './model';
export { createDom, escapeHtml, errorMessage } from './dom';
export { createWorkflowsService } from './service';
export * as WorkflowPackageClient from './package-client';
export { composeDraft } from './compose';
export { createWorkflowOrchestration } from './orchestration';
export type { WorkflowsDependencies } from './controller';
export function initWorkflows(deps: WorkflowsDependencies & { request?: RequestFn }) {
  const service = createWorkflowsService(deps.request ?? ((path, init) => http.raw(path, init)), undefined, deps.t);
  const view = createWorkflowsView(deps.doc, deps.t, error => deps.notify(deps.t(errorMessage(error)), 'error'), deps.applyPermissions);
  const controller = createWorkflowsController(service, view, deps);
  return { service, view, ...controller };
}
