import { http } from '../../platform/http';
import { createKnowledgeService, type RequestFn } from './service';
import { createKnowledgeView, type KnowledgeViewDeps } from './view';
import { createKnowledgeController, type KnowledgeControllerDeps } from './controller';
export { createKnowledgeService, KnowledgeError } from './service';
export { knowledgeIndexErrorAdvice, retrievedCount, formatTime, preview } from './model';
export type { KnowledgeService, RequestFn } from './service';
export type { KnowledgeItem, KnowledgeState, IndexStatus, RetrievalLog } from './model';
export { createKnowledgeToast, type ToastKind } from './toast';
export interface KnowledgeDependencies extends KnowledgeViewDeps, Omit<KnowledgeControllerDeps, 'service' | 'view'> { request?: RequestFn; now?: () => number }
export function initKnowledge(deps: KnowledgeDependencies) {
  const service = createKnowledgeService({ request: deps.request ?? ((path, init) => http.raw(path, init)), now: deps.now });
  const view = createKnowledgeView(deps);
  const controller = createKnowledgeController({ ...deps, service, view });
  return { service, view, controller, activate: controller.activate, dispose: controller.dispose };
}
