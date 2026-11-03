import { createC2Controller, type C2ControllerDependencies } from './controller';
import { createC2Service, type C2Dependencies } from './service';
import { createC2View, type C2ViewDependencies } from './view';

export { createC2Service, C2Error } from './service';
export type { C2Service, C2Dependencies } from './service';
export * from './model';
export interface C2FeatureDependencies extends Omit<C2Dependencies, 'notify'>, C2ControllerDependencies, Omit<C2ViewDependencies, 'service' | 't' | 'doc'> {}
export function initC2(deps: C2FeatureDependencies) {
  const reference: { controller?: ReturnType<typeof createC2Controller> } = {};
  const service = createC2Service({ ...deps, allow: deps.can, sessionTasksChanged: id => { void reference.controller?.loadSessionTasks(id).catch(error => deps.notify(String(error), 'error')); deps.sessionTasksChanged?.(id); } });
  const view = createC2View({ ...deps, doc: deps.browser.doc, service });
  const controller = createC2Controller(deps, service, view);
  reference.controller = controller;
  return { service, view, controller, activate: controller.activate, dispose: controller.dispose };
}
