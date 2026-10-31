import { createWebshellController, type WebshellControllerDependencies } from './controller';
import { createWebshellService, type WebshellServiceDependencies } from './service';
import { createWebshellView } from './view';

export { createWebshellService, WebshellError } from './service';
export type { WebshellService, WebshellServiceDependencies, AiEvent, AiRun, AiMessage, ProcessDetail } from './service';
export * from './model';
export * from './database';
export type WebshellDependencies = Omit<WebshellControllerDependencies, 'service'> & WebshellServiceDependencies;
export function initWebshell(deps: WebshellDependencies) {
  const service = createWebshellService(deps);
  const dependencies = { ...deps, service };
  const view = createWebshellView(dependencies);
  const controller = createWebshellController(dependencies, view, service);
  return { service, view, controller, activate: controller.activate, dispose: controller.dispose };
}
