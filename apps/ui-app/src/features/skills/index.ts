import { http } from '../../platform/http';
import type { KeyValueStorage } from '../../platform/storage';
import { createSkillsService, type RequestFn } from './service';
import { createSkillsView, type SkillsViewDeps } from './view';
import { createSkillsController, type SkillsControllerDeps } from './controller';
export { createSkillsService, SkillError } from './service';
export type { RequestFn, SkillsService } from './service';
export type { Skill, PackageFile, SkillsState } from './model';
export interface SkillsDependencies extends SkillsViewDeps, Omit<SkillsControllerDeps, 'service' | 'view'> { storage: KeyValueStorage; request?: RequestFn }
export function initSkills(deps: SkillsDependencies) {
  const service = createSkillsService({ request: deps.request ?? ((path, init) => http.raw(path, init)), storage: deps.storage });
  const view = createSkillsView(deps);
  const controller = createSkillsController({ ...deps, service, view });
  return { service, view, controller, activate: controller.activate, dispose: controller.dispose };
}
